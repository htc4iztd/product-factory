"""ファクトリー全体で1つのチャット。

- 何もメンションしない発言は、いま開いているページについての指示・質問として扱う。
  @ でページ・工程・機能・エージェント・Issue を指すと、開いていないものについても話せる
- 答えるのは PdM が話せる相手だけ（指揮系統）：工程・PM の領域のことはその領域の PM、
  ファクトリーの稼働・スケジュール・ペルソナなどの設定はプラットフォーム
- 何かを変えるときは、答えに「変更前 → 変更後」の承認依頼（actions）を付ける。PdM が承認したものだけを
  コードが検証して実行し、否認したものは何もしない
- PM が答えたものは、PM の対話の記録（PmMessage）にも残す（PM の作業場所・会議の報告で使う）
"""

from __future__ import annotations

import json
import re
import uuid

from pydantic import BaseModel, Field
from sqlalchemy import or_, select

from . import frameworks as fx
from . import fwlib, llm, llmconf, repo
from .db import AgentIssue, AssistantMessage, Product, session
from .stages import STAGE_BY_ID, STAGES
from .team import DOMAIN, KEYS, PM_OF, PMS, TeamError, _iso, name_of

RESPONDERS = (*PMS, "platform")
ACTION_TYPES = (
    "set_field", "issue_create", "issue_update", "schedule", "agent_enabled", "platform_act", "ui_page",
    "stage_complete",
)
STATUS_JA = {"not_started": "未着手", "in_progress": "作業中", "awaiting_approval": "承認待ち", "revising": "修正中",
             "completed": "更新済み（完了）", "skipped": "使わない", "needs_recheck": "要再確認"}
PAGES = {
    "": ("dashboard", "ダッシュボード"),
    "board": ("board", "掲示板"),
    "issues": ("issues", "Issue"),
    "meetings-daily": ("meetings", "振り返りの会議"),
    "team": ("team", "エージェントの組織"),
    "cast": ("cast", "ペルソナ・スキル・ツール"),
    "schedule": ("schedule", "スケジュール"),
    "frameworks": ("frameworks", "フレームワーク"),
    "platform": ("platform", "プラットフォーム"),
    "reports": ("reports", "報告資料"),
    "agents": ("agents", "定期の仕事"),
    "canvas": ("canvas", "プロダクト・キャンバス"),
    "preproducts": ("preproducts", "プリプロダクト"),
    "docs": ("docs", "ドキュメント"),
    "settings": ("settings", "ステージの設定"),
}
PLATFORM_KINDS = {"platform", "schedule", "cast", "team", "factory", "agents", "frameworks"}


class AssistantError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


# ---------------- いま開いているページ・メンション ----------------
def parse_path(path: str) -> dict:
    """画面のパスから、話題（プロダクト・ページの種類・対象）を読む。"""
    p = (path or "/").split("?")[0].rstrip("/")
    m = re.match(r"^/p/([0-9a-f]{8,32})(?:/(.*))?$", p)
    if not m:
        return {"path": path, "kind": "factory", "label": "ファクトリー全体", "product_id": None}
    pid, rest = m.group(1), (m.group(2) or "")
    parts = rest.split("/") if rest else []
    ctx = {"path": path, "product_id": pid}
    if parts[:1] == ["s"] and len(parts) > 2 and parts[1] in STAGE_BY_ID and parts[2] == "ui":
        st = STAGE_BY_ID[parts[1]]
        return {**ctx, "kind": "ui", "stage_id": st.id, "label": f"{st.no}{st.name}の UI エディタ"}
    if parts[:1] == ["s"] and len(parts) > 1 and parts[1] in STAGE_BY_ID:
        st = STAGE_BY_ID[parts[1]]
        return {**ctx, "kind": "stage", "stage_id": st.id, "label": f"{st.no}{st.name}"}
    if parts[:1] == ["issues"] and len(parts) > 1 and parts[1].isdigit():
        return {**ctx, "kind": "issue", "number": int(parts[1]), "label": f"Issue #{parts[1]}"}
    if parts[:1] == ["pm"] and len(parts) > 1 and parts[1] in PMS:
        return {**ctx, "kind": "pm", "pm": parts[1], "label": f"{name_of(parts[1])}の作業場所"}
    if parts[:1] == ["meetings-daily"] and len(parts) > 1 and parts[1].isdigit():
        return {**ctx, "kind": "meeting", "meeting_id": int(parts[1]), "label": "振り返りの会議"}
    kind, label = PAGES.get(parts[0] if parts else "", ("page", rest or "ページ"))
    return {**ctx, "kind": kind, "label": label}


def focus(ctx: dict, mentions: list[dict]) -> dict:
    """メンションがあれば、最初のメンションを話題にする（プロダクトはいまのまま）。"""
    for mt in mentions:
        k, ref = mt.get("kind"), str(mt.get("ref") or "")
        if k == "stage" and ref in STAGE_BY_ID:
            st = STAGE_BY_ID[ref]
            return {**ctx, "kind": "stage", "stage_id": ref, "label": f"{st.no}{st.name}", "mentioned": True}
        if k == "agent" and ref in RESPONDERS:
            return {**ctx, "kind": "agent", "agent": ref, "label": name_of(ref), "mentioned": True}
        if k == "issue" and ref.isdigit():
            return {**ctx, "kind": "issue", "number": int(ref), "label": f"Issue #{ref}", "mentioned": True}
        if k == "page":
            sub = parse_path(ref) if ref.startswith("/") else None
            if sub and sub.get("product_id") in (ctx.get("product_id"), None):
                return {
                    **ctx,
                    **{x: y for x, y in sub.items() if x != "path"},
                    "product_id": ctx.get("product_id"),
                    "mentioned": True,
                }
    return ctx


def _stage_in_text(text: str) -> str | None:
    for st in STAGES:
        if st.no in text or st.name in text:
            return st.id
    return None


def route(conn, ctx: dict, text: str) -> str:
    """答えるエージェント（PdM が話せる相手：PM か プラットフォーム）。"""
    k = ctx["kind"]
    if k == "agent":
        return ctx["agent"]
    if k in PLATFORM_KINDS or not ctx.get("product_id"):
        return "platform"
    if k in ("stage", "ui"):
        return PM_OF[ctx["stage_id"]]
    if k == "pm":
        return ctx["pm"]
    if k == "issue":
        with session() as s:
            i = s.execute(
                select(AgentIssue).where(AgentIssue.product_id == ctx["product_id"], AgentIssue.number == ctx["number"])
            ).scalar_one_or_none()
            if i is not None:
                return i.assignee if i.assignee in PMS else PM_OF.get(i.assignee, "pm_biz")
    sid = _stage_in_text(text)
    if sid:
        return PM_OF[sid]
    if conn.provider == "stub":
        return "pm_biz"
    out = llm._json(
        conn,
        conn.chat_model,
        (
            "PdM の発言を、誰が答えるべきかで振り分けます。"
            "pm_biz（①アイディエーション〜⑤事業計画：事業・市場・戦略・お金）、"
            "pm_design（⑥UXデザイン〜⑪運用方式設計：体験・要求・設計）、pm_impl（⑫コーディング〜⑭リリース：作る・試す・出す）、"
            "platform（ファクトリーの稼働・ジョブ・設定）のどれか1つを key に入れる。\n"
            f"いまのページ：{ctx.get('label')}\n発言：{text[:2000]}"
        ),
        _Route,
    )
    return out.key if out.key in RESPONDERS else "pm_biz"


class _Route(BaseModel):
    key: str


# ---------------- 答えと承認依頼 ----------------
class ActionOut(BaseModel):
    type: str = Field(
        description="set_field | issue_create | issue_update | schedule | agent_enabled | platform_act | ui_page"
        " | stage_complete"
    )
    stages: list[str] = Field(default_factory=list, description="stage_complete：確定する工程（s01〜s14）")
    stage_id: str = ""
    field: str = Field(default="", description="set_field：項目の key")
    value: str = Field(default="", description="set_field：新しい値。箇条書き・表は JSON で")
    assignee: str = Field(default="", description="issue_create：宛先（pm_*・s01〜s14）")
    subject: str = ""
    description: str = ""
    number: int = Field(default=0, description="issue_update：Issue の番号／platform_act：問題の id")
    status: str = ""
    notes: str = ""
    keys: list[str] = Field(default_factory=list, description="schedule・agent_enabled：エージェントの key")
    cron: str = Field(default="", description="schedule：cron（分 時 日 月 曜日）")
    enabled: str = Field(default="", description="agent_enabled：on か off")
    page_id: str = Field(default="", description="ui_page：書き換える画面の id（新しい画面なら空）")
    screen: str = Field(default="", description="ui_page：画面一覧の ID（SC-01 など）")
    html: str = Field(default="", description="ui_page：画面の HTML（body の中身）")
    css: str = Field(default="", description="ui_page：画面の CSS")
    reason: str = ""


class AssistantReply(BaseModel):
    reply: str
    actions: list[ActionOut] = Field(default_factory=list)


def _show(v) -> str:
    """値を読みやすい文字にする（承認依頼の変更前・変更後）。"""
    if v is None or v == "" or v == [] or v == {}:
        return "（空）"
    if isinstance(v, list):
        if all(isinstance(x, str) for x in v):
            return "\n".join(f"- {x}" for x in v)
        if all(isinstance(x, dict) for x in v):
            return "\n".join("・".join(f"{k}：{y}" for k, y in r.items() if str(y or "").strip()) for r in v)[:4000]
    if isinstance(v, dict):
        return json.dumps(v, ensure_ascii=False, indent=1)[:4000]
    return str(v)[:4000]


def _value(f, raw: str):
    if f.kind == fx.T:
        return raw
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        if f.kind == fx.L:
            return [x.strip(" -・") for x in raw.splitlines() if x.strip(" -・")]
        raise


def prepare_action(tenant: str, product: Product | None, responder: str, a: ActionOut) -> dict:
    """承認依頼の形にする（変更前・変更後を作り、実行できるかを先に確かめる）。できないものは ValueError。"""
    from . import schedule

    base = {"id": uuid.uuid4().hex[:12], "type": a.type, "status": "pending", "by": responder, "reason": a.reason}
    if a.type in ("set_field", "issue_create", "issue_update", "schedule", "agent_enabled") and product is None:
        raise ValueError("プロダクトを開いてから指示してください")
    if a.type == "set_field":
        sid = a.stage_id
        if sid not in STAGE_BY_ID:
            raise ValueError(f"工程 {sid} はありません")
        f = fwlib.of((product.id if product else None), sid).get(a.field)
        if f is None:
            raise ValueError(f"{STAGE_BY_ID[sid].name}に項目 {a.field} はありません")
        new = fx.coerce(f, _value(f, a.value))
        old = repo.draft(product.id, sid).get(f.key)
        st = STAGE_BY_ID[sid]
        from .approvals import change

        return {
            **base,
            "title": f"{st.no}{st.name}の「{f.label}」を書き換える",
            "before": _show(old),
            "after": _show(new),
            "changes": [change(f, f.label, old, new)],
            "args": {"stage_id": sid, "field": f.key, "value": new},
        }
    if a.type == "issue_create":
        if responder not in PMS:
            raise ValueError("Issue を起票できるのは PM です")
        if a.assignee not in KEYS or a.assignee == responder:
            raise ValueError(f"宛先 {a.assignee} には起票できません")
        if not a.subject.strip():
            raise ValueError("題名が空です")
        return {
            **base,
            "title": f"{name_of(a.assignee)}に Issue を起票する",
            "before": "（なし）",
            "after": f"題名：{a.subject}\n{a.description}".strip(),
            "args": {
                "assignee": a.assignee,
                "subject": a.subject[:300],
                "description": a.description[:8000],
                "stage_id": a.stage_id if a.stage_id in STAGE_BY_ID else None,
            },
        }
    if a.type == "issue_update":
        from . import issues as iss

        if responder not in PMS:
            raise ValueError("Issue を更新できるのは PM です")
        cur = iss.get(product, a.number)
        if a.status and a.status not in iss.STATUSES:
            raise ValueError(f"状態 {a.status} はありません")
        after = [f"状態：{iss.STATUSES[a.status]}" if a.status else "", f"注記：{a.notes}" if a.notes else ""]
        return {
            **base,
            "title": f"#{a.number}「{cur['subject']}」を更新する",
            "before": f"状態：{cur['status_label']}",
            "after": "\n".join(x for x in after if x) or "（変更なし）",
            "args": {"number": a.number, "status": a.status or None, "notes": a.notes},
        }
    if a.type == "schedule":
        keys = [k for k in a.keys if k in schedule.GROUP_OF]
        if not keys:
            raise ValueError("予定を変えるエージェントがいません")
        pv = schedule.preview(a.cron)
        cur = {x["key"]: x for x in schedule.view(product)["agents"]}
        return {
            **base,
            "title": f"{len(keys)} 人の予定を変える",
            "before": "\n".join(
                f"{cur[k]['name']}：{cur[k]['label'] if cur[k]['enabled'] else '止めています'}" for k in keys
            ),
            "after": f"{pv['label']}（次：{'、'.join(t[5:16].replace('T', ' ') for t in pv['next'])}）",
            "args": {"keys": keys, "cron": pv["cron"]},
        }
    if a.type == "agent_enabled":
        keys = [k for k in a.keys if k in schedule.GROUP_OF]
        on = a.enabled == "on"
        if not keys or a.enabled not in ("on", "off"):
            raise ValueError("止める・動かすエージェントが決まっていません")
        return {
            **base,
            "title": f"{len(keys)} 人を{'動かす' if on else '止める'}",
            "before": "\n".join(name_of(k) for k in keys),
            "after": "定期実行で動かす" if on else "定期実行を止める",
            "args": {"keys": keys, "enabled": on},
        }
    if a.type == "ui_page":
        if product is None:
            raise ValueError("プロダクトを開いてから指示してください")
        if not a.html.strip():
            raise ValueError("画面の HTML が空です")
        pages = (repo.draft(product.id, "s06").get("ui") or {}).get("pages") or []
        old = next((p for p in pages if a.page_id and p["id"] == a.page_id), None)
        name = (a.subject or (old or {}).get("name") or a.screen or "新しい画面")[:120]
        return {
            **base,
            "title": f"UI デザイン「{name}」を{'書き換える' if old else '作る'}",
            "before": fx.ui_text(old["html"]) if old else "（新しい画面）",
            "after": fx.ui_text(a.html),
            "preview": {"html": a.html[:300_000], "css": a.css[:200_000]},
            "args": {
                "page_id": (old or {}).get("id") or "",
                "name": name,
                "screen": a.screen or (old or {}).get("screen", ""),
                "html": a.html[:300_000],
                "css": a.css[:200_000],
            },
        }
    if a.type == "stage_complete":
        return _prepare_complete(product, base, a)
    if a.type == "platform_act":
        from . import platform_agent as pa

        f = next((x for x in pa.findings(tenant, 0) if x["id"] == a.number), None)
        if f is None or not f.get("action"):
            raise ValueError("実行できる対処がありません")
        return {
            **base,
            "title": f"対処を実行する：{f['action']['label']}",
            "before": f["title"],
            "after": f["action"]["label"],
            "args": {"finding": a.number},
        }
    raise ValueError(f"知らない変更の種類：{a.type}")


def _prepare_complete(product: Product | None, base: dict, a: ActionOut) -> dict:
    """工程を確定する（下書きを新しい版にして「更新済み（完了）」にする）。必須が空の工程は確定できない。"""
    if product is None:
        raise ValueError("プロダクトを開いてから指示してください")
    if base["by"] not in PMS:
        raise ValueError("工程を確定する依頼を出せるのは PM です")
    sids = [s for s in dict.fromkeys(a.stages or ([a.stage_id] if a.stage_id else [])) if s in STAGE_BY_ID]
    if not sids:
        raise ValueError("確定する工程が決まっていません（stages に s01〜s14）")
    rs = repo.runs(product.id)
    bad, before, after = [], [], []
    for sid in sids:
        st, r = STAGE_BY_ID[sid], rs[sid]
        miss = fx.check(fwlib.of(product.id, sid), repo.draft(product.id, sid))
        if miss:
            bad.append(f"{st.no}{st.name}（{'、'.join(miss)[:200]}）")
            continue
        before.append(f"{st.no}{st.name}：{STATUS_JA.get(r.status, r.status)}・版 v{r.approved_version or 0}")
        after.append(f"{st.no}{st.name}：今の下書きを v{r.current_version + 1} として確定し、更新済み（完了）にする")
    if bad:
        raise ValueError("必須が空なので確定できません：" + "／".join(bad))
    return {
        **base,
        "title": f"{len(sids)} 工程を確定する（完了にする）",
        "before": "\n".join(before),
        "after": "\n".join(after) + "\n（下流で参照している工程は「要再確認」になります）",
        "args": {"stages": sids},
    }


def _complete(product: Product, user: str, sids: list[str]) -> str:
    """PdM がチャットで承認した＝承認者の判断。版を作り、承認が要る工程もそのまま承認する。"""
    from . import api
    from .engine import Engine, FactoryError
    from .stages import APPROVE, AWAITING_APPROVAL, COMPLETED

    engine = api.engine or Engine()  # API が持っている Engine を使う（作り直すと重い）

    done, skipped = [], []
    for sid in sids:
        st = STAGE_BY_ID[sid]
        try:
            engine.commit(product, sid, user, "チャットで PdM が確定を承認", False)
        except FactoryError as e:
            skipped.append(f"{st.no}{st.name}（{e.message}）")
            continue
        r = repo.get_run(product.id, sid)
        if r.status == AWAITING_APPROVAL:
            engine.decide(product, sid, user, APPROVE, "チャットで PdM が承認")
        if repo.get_run(product.id, sid).status == COMPLETED:
            done.append(f"{st.no}{st.name}")
    out = f"確定しました：{'、'.join(done)}" if done else "確定した工程はありません"
    return out + (f"／確定できなかった：{'、'.join(skipped)}" if skipped else "")


def _material(product: Product | None, ctx: dict, mentions: list[dict]) -> str:
    """話題のページの中身（固定の入力。ツールで読む）。"""
    from . import tools as tl

    if product is None:
        return ""
    t = tl.Ctx(product, "pm_design", product.tenant_id)
    parts = []
    k = ctx["kind"]
    if k == "stage":
        parts.append(tl.call(t, "stage_draft", {"stage_id": ctx["stage_id"]}))
        parts.append(tl.call(t, "stage_fields", {"stage_id": ctx["stage_id"]}))
    if k == "issue":
        parts.append(tl.call(t, "issue_read", {"number": ctx["number"]}))
    if k in ("schedule", "team"):
        from . import schedule

        v = schedule.view(product)
        parts.append(
            "## 予定\n"
            + "\n".join(
                f"- {a['key']} {a['name']}：{a['label'] if a['enabled'] else '止めています'}" for a in v["agents"]
            )
        )
    for mt in mentions[1:5]:
        if mt.get("kind") == "stage" and mt.get("ref") in STAGE_BY_ID:
            parts.append(tl.call(t, "stage_draft", {"stage_id": mt["ref"]}))
    return "\n\n".join(parts)[:40000]


def _stub(product: Product | None, ctx: dict, responder: str, text: str) -> AssistantReply:
    llm._record("stub", 0, 0)
    where = ctx.get("label", "")
    acts: list[ActionOut] = []
    if ctx["kind"] == "ui" and product is not None:
        # UI エディタで話すと、言葉から画面を組んで承認依頼にする（スタブ：決まった部品で組む）
        title = re.sub(r"(画面|ページ)?を?(作って|作る|直して|変えて|にして).*$", "", text.strip())[:40] or "新しい画面"
        html = (
            f'<header class="pf-nav"><strong>{product.name}</strong></header><main class="pf-main">'
            f'<h1>{title}</h1><p>{text[:120]}</p><input class="pf-input" placeholder="入力"/>'
            '<button class="pf-btn">決定</button></main>'
        )
        acts.append(ActionOut(type="ui_page", subject=title, html=html, reason="PdM の指示から画面を組みました"))
    if ctx["kind"] == "stage":
        sid = ctx["stage_id"]
        m = re.match(r"^「?(.+?)」?を「?(.+?)」?に(して|する|変えて)", text.strip())
        fields = fwlib.of(product.id if product else None, sid).fields
        f = next((x for x in fields if m and x.label == m.group(1)), None)
        if f is not None and f.kind == fx.T:
            acts.append(ActionOut(type="set_field", stage_id=sid, field=f.key, value=m.group(2), reason="PdM の指示"))
        elif responder in PMS and re.search(r"して|作って|直して|確かめて|見直して", text):
            acts.append(
                ActionOut(
                    type="issue_create",
                    stage_id=sid,
                    assignee=sid,
                    subject=text[:80],
                    description=f"PdM の指示：{text}",
                    reason="担当に動いてもらう",
                )
            )
    if ctx["kind"] == "schedule":
        m = re.search(r"(\d+)分ごと", text)
        if m and product is not None:
            keys = [s.id for s in STAGES]
            acts.append(ActionOut(type="schedule", keys=keys, cron=f"*/{m.group(1)} * * * *", reason="PdM の指示"))
    head = f"（スタブ）{name_of(responder)}です。{where}について承りました。"
    if responder == "platform" and product is not None and ctx["kind"] != "schedule":
        from . import platform_agent as pa

        pa.detect(product.tenant_id)
        live = [f for f in pa.findings(product.tenant_id, 0) if f["status"] != "resolved"]
        head += (
            f"未解決の問題は {len(live)} 件です。" + "".join(f"\n- {f['title']}" for f in live[:3])
            if live
            else "いま見つかっている問題はありません。"
        )
        acts += [
            ActionOut(type="platform_act", number=f["id"], reason=f["suggestion"]) for f in live[:2] if f["action"]
        ]
    return AssistantReply(reply=head + ("変更の内容を確かめて、承認してください。" if acts else ""), actions=acts)


def _prompt(
    product: Product | None,
    ctx: dict,
    responder: str,
    text: str,
    header: str,
    material: str,
    extra: str,
    history: list[dict],
) -> str:
    who = name_of(responder)
    return (
        f"あなたは{who}です。PdM（人）がファクトリーのチャットで話しかけています。"
        + (f"プロダクト「{product.name}」（{product.idea}）。" if product else "")
        + f"いま PdM が見ているのは「{ctx.get('label')}」です"
        + "（メンションがなければ、このページについての指示・質問）。\n"
        + header
        + "\n\n## 出力\n- reply：日本語で短く直接答える。前置き・称賛は書かない。"
            "根拠の弱い意図には率直に指摘する。報告だけで終えない：最後は、"
            "自分が次にやること（承認依頼にしたもの）か、"
            "PdM への質問・相談・合意依頼・終了承認依頼のどれかで終える。期限や時刻は書かない。"
            "actions はまだ実行されていない（PdM が承認したら実行される）。reply に「更新しました」「完了にしました」と"
            "書かず、「〜の承認依頼を出しました」と書く。\n"
        "- actions：何かを変えるときだけ。自分では実行せず、PdM の承認を待つ承認依頼として出す。種類は "
        "set_field（工程の項目を書き換える：stage_id・field・value）、issue_create（担当に動いてもらう：assignee・"
        "subject・description・stage_id。PM のときだけ）、issue_update（number・status・notes。PM のときだけ）、"
        "schedule（keys・cron）、agent_enabled（keys・enabled は on/off）、platform_act（number は問題の id）、"
        "stage_complete（工程を確定して「更新済み（完了）」にする：stages に工程の id。"
        "工程の状態は項目ではないので set_field では変えない。必須が空の工程は確定できない）、"
        "ui_page（⑥UIデザインの画面：page_id は書き換える画面の id か空、subject は画面名、screen は SC-xx、"
        "html は body の中身、css。クラス pf-nav・pf-main・pf-btn・pf-input・pf-card が使える）。"
        "質問への答えだけなら空にする。\n\n"
        + (f"## ページの中身\n{material}\n\n" if material else "")
        + (f"## 添えられたもの\n{extra}\n\n" if extra else "")
        + "## これまでの対話\n"
        + "\n".join(f"{'PdM' if m['role'] == 'pdm' else m['agent_name']}：{m['text'][:600]}" for m in history[-10:])
        + (
            f"\n\n## PdM が返事をしている、元の発言（{ctx['reply_to']['agent_name']}）\n{ctx['reply_to']['text']}"
            if ctx.get("reply_to")
            else ""
        )
        + f"\n\n## PdM の発言\n{text}\n"
    )


def message_dict(m: AssistantMessage) -> dict:
    return {
        "id": m.id,
        "role": m.role,
        "agent": m.agent,
        "agent_name": name_of(m.agent) if m.agent else "PdM",
        "text": m.text,
        "context": m.context or {},
        "mentions": m.mentions or [],
        "attachments": m.attachments or [],
        "actions": m.actions or [],
        "product_id": m.product_id,
        "created_at": _iso(m.created_at),
    }


def feed(tenant: str, user: str, limit: int = 80, after: int = 0, product_id: str | None = None) -> list[dict]:
    """チャットの対話。プロダクトのページではそのプロダクトの対話だけ、プロダクトの外ではファクトリー全体の対話だけ。"""
    with session() as s:
        q = select(AssistantMessage).where(
            AssistantMessage.tenant_id == tenant,
            or_(AssistantMessage.user == user, AssistantMessage.user.is_(None)),
            AssistantMessage.id > after,
            AssistantMessage.product_id == product_id if product_id else AssistantMessage.product_id.is_(None),
        )
        rows = list(s.execute(q.order_by(AssistantMessage.id.desc()).limit(limit)).scalars())
        return [message_dict(m) for m in reversed(rows)]


def notify(
    tenant: str, product_id: str | None, agent: str, text: str, context: dict | None = None, actions: list | None = None
) -> dict:
    """エージェントから PdM に話しかける（テナントの全員のチャットに出る）。型は asks.py の4つだけ。"""
    with session() as s:
        m = AssistantMessage(
            tenant_id=tenant,
            user=None,
            product_id=product_id,
            role="agent",
            agent=agent,
            text=text[:8000],
            context=context or {},
            actions=actions or [],
        )
        s.add(m)
        s.commit()
        return message_dict(m)


def _save(tenant, user, product_id, role, agent, text, ctx, mentions=None, attachments=None, actions=None) -> dict:
    with session() as s:
        m = AssistantMessage(
            tenant_id=tenant,
            user=user,
            product_id=product_id,
            role=role,
            agent=agent,
            text=text[:8000],
            context=ctx,
            mentions=mentions or [],
            attachments=attachments or [],
            actions=actions or [],
        )
        s.add(m)
        s.commit()
        return message_dict(m)


def quote_of(tenant: str, message_id: int) -> dict:
    """返事をする元の発言（引用）。返事の宛先は、元の発言をしたエージェントにする。"""
    with session() as s:
        m = s.get(AssistantMessage, message_id)
        if m is None or m.tenant_id != tenant or m.role != "agent":
            raise AssistantError(404, "返事をする元の発言がありません")
        return {"id": m.id, "agent": m.agent, "agent_name": name_of(m.agent), "text": m.text[:1500],
                "ask": (m.context or {}).get("ask"), "product_id": m.product_id}


def send(
    tenant: str,
    user: str,
    path: str,
    text: str,
    mentions: list[dict],
    attachment_ids: list[int],
    material: str = "",
    reply_to: int | None = None,
) -> dict:
    from . import agentrun, attachments, pms

    text = text.strip()
    if not text:
        raise AssistantError(422, "本文が空です")
    quote = quote_of(tenant, reply_to) if reply_to else None
    if quote and quote["agent"] in RESPONDERS and not any(m.get("ref") == quote["agent"] for m in mentions):
        mentions = [{"kind": "agent", "ref": quote["agent"], "label": quote["agent_name"]}, *mentions]
    ctx = parse_path(path)
    product = None
    if ctx.get("product_id"):
        with session() as s:
            product = s.get(Product, ctx["product_id"])
            if product is None or product.tenant_id != tenant:
                raise AssistantError(404, "プロダクトがありません")
            s.expunge(product)
    if attachment_ids and product is None:
        raise AssistantError(422, "添付はプロダクトのページで使えます")
    try:
        files = attachments.take(product, "assistant", attachment_ids) if product else []
    except attachments.AttachmentError as e:
        raise AssistantError(e.status, e.message) from None
    extra, images = attachments.material([f["id"] for f in files])
    if material.strip():
        extra = (extra + "\n\n" if extra else "") + material.strip()[:40000]
    ctx = focus(ctx, mentions)
    if product is not None and ctx["kind"] not in ("stage", "agent", "issue") and ctx["kind"] not in PLATFORM_KINDS:
        sid = _stage_in_text(text)  # 工程の名前・番号が出てきたら、その工程の話として扱う
        if sid:
            st = STAGE_BY_ID[sid]
            ctx = {**ctx, "kind": "stage", "stage_id": sid, "label": f"{st.no}{st.name}", "inferred": True}
    if product is not None:
        ctx["product_name"] = product.name
    conn = llmconf.resolve(tenant)
    responder = route(conn, ctx, text)
    ctx["responder"] = responder
    if quote:
        ctx["reply_to"] = {k: quote[k] for k in ("id", "agent", "agent_name", "text", "ask")}
    mine = _save(tenant, user, ctx.get("product_id"), "pdm", "", text, ctx, mentions, files)
    if conn.provider == "stub":
        out = _stub(product, ctx, responder, text)
    else:
        prep = agentrun.prepare(tenant, product, responder)
        history = feed(tenant, user, 12, product_id=ctx.get("product_id"))
        prompt = _prompt(
            product, ctx, responder, text, prep.header(), _material(product, ctx, mentions), extra, history
        )
        out = agentrun.think(conn, prep, prompt, AssistantReply, images)
    actions, dropped = [], []
    for a in out.actions[:6]:
        if a.type not in ACTION_TYPES:
            continue
        try:
            actions.append(prepare_action(tenant, product, responder, a))
        except (ValueError, TypeError, KeyError, TeamError) as e:
            dropped.append(f"{a.type}：{getattr(e, 'message', e)}")
        except Exception as e:  # noqa: BLE001  1つの案の不備で答え全体を落とさない
            dropped.append(f"{a.type}：{getattr(e, 'message', e)}")
    # 出せなかった変更は、何も変えていないことを先頭ではっきり出す（本文が「更新しました」と書いていても）
    reply = (
        f"⚠ 次の変更は出せませんでした（何も変えていません）：{'／'.join(dropped)}\n\n" if dropped else ""
    ) + out.reply
    actx = {k: v for k, v in ctx.items() if k != "reply_to"}  # 引用は PdM の発言にだけ付ける
    answer = _save(tenant, user, ctx.get("product_id"), "agent", responder, reply, actx, actions=actions)
    if product is not None and responder in PMS:  # PM の対話の記録にも残す
        said = (f"> {quote['text'][:300]}\n\n" if quote else "") + text  # 何への返事かを PM の記録にも残す
        pms._say(product.id, responder, "pdm", user, said, ctx.get("stage_id"), ctx.get("meeting_id"), files)
        pms._say(product.id, responder, "pm", name_of(responder), reply, ctx.get("stage_id"), ctx.get("meeting_id"))
    return {"message": mine, "reply": answer}


def decide(tenant: str, user: str, message_id: int, action_id: str, approve: bool) -> dict:
    """承認依頼に答える。承認したものだけ実行する（もう一度確かめてから）。"""
    with session() as s:
        m = s.get(AssistantMessage, message_id)
        if m is None or m.tenant_id != tenant or (m.user not in (None, user)):
            raise AssistantError(404, "その発言はありません")
        acts = list(m.actions or [])
        a = next((x for x in acts if x["id"] == action_id), None)
        if a is None:
            raise AssistantError(404, "その承認依頼はありません")
        if a["status"] != "pending":
            raise AssistantError(409, "もう答えています")
        product = s.get(Product, m.product_id) if m.product_id else None
        if product is not None:
            s.expunge(product)
    if not approve and a["type"] == "pm_ask":  # 合意しない・終了を否認する、も PM に返して動かす
        from . import asks

        try:
            a.update(status="rejected", result=asks.execute(product, user, a, False))
        except Exception as e:  # noqa: BLE001
            a.update(status="failed", result=f"伝えられませんでした：{getattr(e, 'message', e)}")
    elif not approve:
        a.update(status="rejected", result="否認しました。何も変えていません")
    else:
        try:
            a.update(status="approved", result=_execute(tenant, product, user, a))
        except Exception as e:  # noqa: BLE001  実行できなかったことを承認依頼に残す
            a.update(status="failed", result=f"実行できませんでした：{getattr(e, 'message', e)}")
    a["decided_by"] = user
    with session() as s:
        m = s.get(AssistantMessage, message_id)
        m.actions = [a if x["id"] == action_id else x for x in acts]
        s.commit()
        return message_dict(m)


def _execute(tenant: str, product: Product | None, user: str, a: dict) -> str:
    from . import issues as iss
    from . import schedule

    x = a["args"]
    if a["type"] == "set_field":
        repo.set_field(product.id, x["stage_id"], x["field"], x["value"], user, "chat")
        return "書き換えました"
    if a["type"] == "issue_create":
        i = iss.create(product, a["by"], x["assignee"], x["subject"], x["description"], stage_id=x.get("stage_id"))
        return f"#{i['number']} を起票しました（{name_of(x['assignee'])}がすぐ動きます）"
    if a["type"] == "issue_update":
        iss.update(product, a["by"], x["number"], notes=x["notes"], status=x["status"])
        return f"#{x['number']} を更新しました"
    if a["type"] == "schedule":
        schedule.bulk(product, x["keys"], x["cron"], None)
        return "予定を変えました"
    if a["type"] == "agent_enabled":
        schedule.bulk(product, x["keys"], None, x["enabled"])
        return "動かします" if x["enabled"] else "止めました"
    if a["type"] == "ui_page":
        import uuid as _uuid

        cur = repo.draft(product.id, "s06").get("ui") or {}
        pages = list(cur.get("pages") or [])
        pid = x["page_id"] or f"p{_uuid.uuid4().hex[:6]}"
        page = {
            "id": pid,
            "name": x["name"],
            "screen": x["screen"],
            "html": x["html"],
            "css": x["css"],
            "project": None,
        }
        pages = [page if p["id"] == pid else p for p in pages] if any(p["id"] == pid for p in pages) else [*pages, page]
        repo.set_field(product.id, "s06", "ui", {"pages": pages}, user, "chat")
        return f"UI デザインの「{x['name']}」に反映しました"
    if a["type"] == "platform_act":
        from . import platform_agent as pa

        return pa.act(tenant, user, x["finding"])["done"]
    if a["type"] == "stage_complete":
        return _complete(product, user, x["stages"])
    if a["type"] == "pm_ask":
        from . import asks

        return asks.execute(product, user, a, True)
    raise AssistantError(422, "知らない変更の種類です")


def mention_choices(product: Product | None) -> list[dict]:
    """@ で選べるもの（工程・ページ・エージェント）。"""
    out: list[dict] = [{"kind": "agent", "ref": k, "label": name_of(k)} for k in RESPONDERS]
    if product is None:
        return out
    out += [{"kind": "stage", "ref": s.id, "label": f"{s.no}{s.name}"} for s in STAGES]
    out += [
        {"kind": "page", "ref": f"/p/{product.id}/{k}" if k else f"/p/{product.id}", "label": label}
        for k, (_, label) in PAGES.items()
    ]
    return out


__all__ = ["send", "decide", "feed", "notify", "mention_choices", "DOMAIN"]
