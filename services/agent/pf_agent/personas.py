"""エージェントのペルソナ・スキル・ツール（テナントで共通の配役）。

層
- ペルソナ：エージェントごとの人物像（役割名・性格・大事にすること・話し方・得意・気をつけること）
- エージェントに直結するスキル（kind: agent）：その役割の手順と判断の基準。参照するスキルと使うツールを宣言する
- 参照スキル（kind: reference）：共通の知識を小さく分けたもの。直結するスキルが refs で参照したときだけ読み込む
- ツール（tools.py）：固定のロジック。スキルが名前で呼ぶ

コンテキストを1つのスキルに詰め込まないよう、読み込むのは「直結するスキル」と「そこから参照を辿ったスキル」だけ
（深さ・数・文字数に上限。同じスキルは1回だけ）。

既定はリポジトリ（このファイルと skills/*.md）。テナントは画面でペルソナ・割り当てを変え、スキルを作る・上書きできる
（AgentProfile・TenantSkill）。使えるツール ＝ 割り当てたツール ∩ 読み込んだスキルが宣言したツール ∩ 役割で使えるもの。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import yaml
from sqlalchemy import select

from . import tools as tl
from .db import AgentProfile, TenantSkill, session

SKILL_DIR = Path(__file__).parent / "skills"
MAX_DEPTH = 3
MAX_REFS = 12
MAX_CHARS = 24000
PERSONA_FIELDS = {
    "title": "役割名",
    "character": "性格・振る舞い",
    "values": "大事にすること",
    "tone": "話し方",
    "strengths": "得意なこと",
    "cautions": "気をつけること",
}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,58}$")


class ProfileError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _p(title, character, values, tone, strengths, cautions) -> dict:
    return {
        "title": title,
        "character": character,
        "values": values,
        "tone": tone,
        "strengths": strengths,
        "cautions": cautions,
    }


PERSONAS: dict[str, dict] = {
    "platform": _p(
        "プラットフォームエンジニア",
        "落ち着いて記録を読み、騒がず、止まっているものから順に片づける",
        "ファクトリーが止まらないこと。推測より記録",
        "短く、事実・影響・対処の順で話す",
        "障害の切り分け、定期実行・ジョブ・接続の診断",
        "自分でコードを直さない。承認のない対処はしない",
    ),
    "pm_biz": _p(
        "事業プロジェクトマネージャー",
        "決断が早く、数字と期限で話を進める",
        "作る価値と事業の成り立ち。撤退の判断を先送りしない",
        "結論から。根拠の弱い意図にははっきり言う",
        "優先順位づけ、①〜⑤のつながりの管理",
        "数字の出所を確かめずに進めない",
    ),
    "pm_design": _p(
        "設計プロジェクトマネージャー",
        "全体の整合を気にかけ、工程間の食い違いを見逃さない",
        "要求から設計までの一貫性",
        "論点を並べ、決めることを1つずつ確かめる",
        "⑥〜⑪の依存関係と抜けの管理",
        "細部に入りすぎて全体の期限を落とさない",
    ),
    "pm_impl": _p(
        "実装プロジェクトマネージャー",
        "手を動かす人の目線で、止まっている作業を先に解く",
        "出せる状態にすること。品質の基準を下げない",
        "短く具体的に。次の一手を必ず添える",
        "⑫〜⑭の進行と障害物の除去",
        "急ぐあまり受入基準の確認を飛ばさない",
    ),
    "s01": _p(
        "アイディエーター",
        "好奇心が強く、課題の言い換えを何度も試す",
        "誰のどんな課題かが具体的であること",
        "問いかけを交えて、仮説を短く言い切る",
        "課題の発見と仮説の言語化",
        "解決策に早く飛びつかない",
    ),
    "s02": _p(
        "市場アナリスト",
        "慎重で、数字の出所を必ず確かめる",
        "推計式と出典",
        "数字と前提を並べて淡々と",
        "市場規模の推計、セグメント分け",
        "出典のない数字を書かない",
    ),
    "s03": _p(
        "競合リサーチャー",
        "鋭い観察者。代替手段まで目を配る",
        "比較の公平さ",
        "比較の軸を先に示す",
        "競合と代替手段の比較",
        "機能の有無の羅列で終わらせない",
    ),
    "s04": _p(
        "プロダクトストラテジスト",
        "筋道を重んじ、選ばないことを決められる",
        "一貫した価値提案と撤退条件",
        "結論と理由をセットで",
        "ポジショニングと指標設計",
        "抽象論で終わらせず、数値の条件にする",
    ),
    "s05": _p(
        "事業計画プランナー",
        "実務的で、計算のつながりにこだわる",
        "前提から計算で出る数字",
        "表と前提で説明する",
        "KPI ツリーと財務三表",
        "手入力の数字に理由を書き忘れない",
    ),
    "s06": _p(
        "UXデザイナー",
        "共感的で観察深い。利用者のつまずきを先回りして探す",
        "利用者が目的を果たせること。体験の一貫性",
        "利用者の言葉で、場面を具体的に描く",
        "ペルソナ・ジャーニー・ユーザーフロー・情報設計・受入基準",
        "見た目の好みで決めず、ストーリーと根拠でつなぐ",
    ),
    "s07": _p(
        "業務アナリスト",
        "丁寧で、人の作業と例外を拾い上げる",
        "現場で回る業務",
        "流れの順に説明する",
        "業務フロー・業務ルールの整理",
        "システムで解く前提で人の作業を消さない",
    ),
    "s08": _p(
        "システム要件エンジニア",
        "几帳面で、抜けと曖昧さを嫌う",
        "ID で追える要求",
        "番号と条件で正確に",
        "機能・非機能要求の定義",
        "実装方法を要求に混ぜない",
    ),
    "s09": _p(
        "アプリケーションアーキテクト",
        "整合性を重んじ、依存の向きを気にする",
        "データモデルと処理の一貫性",
        "図と表で根拠を示す",
        "データモデル・処理仕様・API 設計",
        "作り込みすぎず、⑧の要求の範囲に留める",
    ),
    "s10": _p(
        "クラウドインフラエンジニア",
        "冷静で、コストと信頼性の釣り合いを取る",
        "要求を満たす最小の構成",
        "構成とコストを並べて",
        "構成設計とコスト見積",
        "要求のない冗長化を足さない",
    ),
    "s11": _p(
        "SRE・運用設計者",
        "用心深く、壊れ方から考える",
        "測れる SLO と戻せる手順",
        "手順と閾値で話す",
        "監視・障害対応・CI/CD",
        "人手の運用を前提に増やしすぎない",
    ),
    "s12": _p(
        "ソフトウェアエンジニア",
        "実直で、小さく作って確かめる",
        "動くことと読みやすさ",
        "具体的なユニットと状態で",
        "実装の分割と進行",
        "設計にない仕様を足さない",
    ),
    "s13": _p(
        "QAエンジニア",
        "疑い深く、境界とエラーを突く",
        "受入基準をすべて確かめること",
        "再現手順と期待結果で",
        "結合・受入テストと網羅の管理",
        "確かめていないことを合格にしない",
    ),
    "s14": _p(
        "リリースマネージャー",
        "朗らかで段取りがいい",
        "安全に出して、戻せること",
        "チェックリストで",
        "デプロイと監視の設定",
        "未解決の失敗を残して出さない",
    ),
}

STAGE_SKILL = {
    "s01": "ideation",
    "s02": "market-analysis",
    "s03": "competitor-analysis",
    "s04": "product-strategy",
    "s05": "business-plan",
    "s06": "ux-design",
    "s07": "business-requirements",
    "s08": "system-requirements",
    "s09": "app-design",
    "s10": "infra-design",
    "s11": "ops-design",
    "s12": "coding",
    "s13": "testing",
    "s14": "release",
}


def keys() -> tuple[str, ...]:
    from .team import KEYS

    return ("platform", *KEYS)


def default_skills(key: str) -> list[str]:
    if key == "platform":
        return ["platform-ops"]
    if key.startswith("pm_"):
        return ["pm-coordination", "pm-status-check"]
    return ["issue-work", STAGE_SKILL[key]]


def default_tools(key: str) -> list[str]:
    std = builtin()
    names: list[str] = []
    seen: set[str] = set()
    todo = list(default_skills(key))
    while todo:  # 既定のスキルが（参照先も含めて）使うツールをすべて許す
        sid = todo.pop(0)
        if sid in seen or sid not in std:
            continue
        seen.add(sid)
        names += [t for t in std[sid]["tools"] if t not in names]
        todo += std[sid]["refs"]
    return tl.allowed_for(key, names)


# ---------------- スキル ----------------
def _parse(text: str) -> dict:
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    if not m:
        raise ValueError("先頭に --- で囲んだ定義がありません")
    meta = yaml.safe_load(m.group(1)) or {}
    return {
        "id": str(meta["id"]),
        "name": str(meta.get("name") or meta["id"]),
        "kind": "agent" if meta.get("kind") == "agent" else "reference",
        "description": str(meta.get("description") or ""),
        "refs": [str(x) for x in meta.get("refs") or []],
        "tools": [str(x) for x in meta.get("tools") or []],
        "prefetch": [str(x) for x in meta.get("prefetch") or []],
        "body": m.group(2).strip(),
    }


@cache
def builtin() -> dict[str, dict]:
    out = {}
    for f in sorted(SKILL_DIR.glob("*.md")):
        d = _parse(f.read_text(encoding="utf-8"))
        out[d["id"]] = {**d, "source": "builtin"}
    return out


def _tenant_skills(tenant: str) -> dict[str, dict]:
    with session() as s:
        rows = list(s.execute(select(TenantSkill).where(TenantSkill.tenant_id == tenant)).scalars())
    return {
        r.skill_id: {
            "id": r.skill_id,
            "name": r.name,
            "kind": r.kind,
            "description": r.description,
            "refs": r.refs or [],
            "tools": r.tools or [],
            "prefetch": r.prefetch or [],
            "body": r.body,
            "source": "override" if r.skill_id in builtin() else "custom",
            "updated_by": r.updated_by,
        }
        for r in rows
    }


def skills(tenant: str) -> dict[str, dict]:
    return {**builtin(), **_tenant_skills(tenant)}


def save_skill(tenant: str, user: str, d: dict) -> dict:
    sid = str(d.get("id") or "").strip()
    if not ID_RE.match(sid):
        raise ProfileError(422, "スキルの id は英小文字・数字・ハイフンで2〜60文字にしてください")
    name = str(d.get("name") or "").strip()
    if not name:
        raise ProfileError(422, "スキルの名前が空です")
    body = str(d.get("body") or "").strip()
    if len(body) > 8000:
        raise ProfileError(422, "1つのスキルは8000文字までにしてください（参照スキルに分けます）")
    known = skills(tenant)
    refs = [str(x) for x in d.get("refs") or []]
    bad = [r for r in refs if r not in known or r == sid]
    if bad:
        raise ProfileError(422, f"参照できないスキル：{'、'.join(bad)}")
    tools = [str(x) for x in d.get("tools") or []]
    prefetch = [str(x) for x in d.get("prefetch") or []]
    unknown = [t for t in [*tools, *prefetch] if t not in tl.TOOLS]
    if unknown:
        raise ProfileError(422, f"ないツール：{'、'.join(unknown)}")
    if any(tl.TOOLS[t].kind != "read" or t not in tools for t in prefetch):
        raise ProfileError(422, "先に読む（prefetch）にできるのは、このスキルが使う読むツールだけです")
    if _cycle(known, sid, refs):
        raise ProfileError(422, "参照が輪になっています（自分を辿って戻ってくる参照は作れません）")
    kind = "agent" if d.get("kind") == "agent" else "reference"
    with session() as s:
        r = s.execute(
            select(TenantSkill).where(TenantSkill.tenant_id == tenant, TenantSkill.skill_id == sid)
        ).scalar_one_or_none()
        if r is None:
            r = TenantSkill(tenant_id=tenant, skill_id=sid)
            s.add(r)
        r.name, r.kind, r.description = name[:200], kind, str(d.get("description") or "")[:2000]
        r.refs, r.tools, r.prefetch, r.body, r.updated_by = refs, tools, prefetch, body, user
        s.commit()
    return skills(tenant)[sid]


def _cycle(known: dict[str, dict], start: str, refs: list[str]) -> bool:
    """start の参照を refs にしたとき、辿って start に戻るか。"""
    graph = {k: v["refs"] for k, v in known.items()}
    graph[start] = refs
    stack, seen = list(refs), set()
    while stack:
        sid = stack.pop()
        if sid == start:
            return True
        if sid in seen:
            continue
        seen.add(sid)
        stack += graph.get(sid, [])
    return False


def delete_skill(tenant: str, sid: str) -> None:
    """テナントのスキルを消す（標準スキルの上書きなら、標準に戻る）。"""
    with session() as s:
        r = s.execute(
            select(TenantSkill).where(TenantSkill.tenant_id == tenant, TenantSkill.skill_id == sid)
        ).scalar_one_or_none()
        if r is None:
            raise ProfileError(404, "そのスキルはテナントにありません（標準スキルは消せません）")
        users = [k for k, p in profiles(tenant).items() if sid in p["skills"]]
        referers = [x["id"] for x in skills(tenant).values() if sid in x["refs"] and x["id"] != sid]
        if sid not in builtin() and (users or referers):
            raise ProfileError(409, f"使われています：{'、'.join(users + referers)}")
        s.delete(r)
        s.commit()


# ---------------- プロフィール（ペルソナと割り当て） ----------------
def _rows(tenant: str) -> dict[str, AgentProfile]:
    with session() as s:
        rows = {r.key: r for r in s.execute(select(AgentProfile).where(AgentProfile.tenant_id == tenant)).scalars()}
        for r in rows.values():
            s.expunge(r)
    return rows


def profiles(tenant: str) -> dict[str, dict]:
    rows = _rows(tenant)
    out = {}
    for k in keys():
        r = rows.get(k)
        out[k] = {
            "key": k,
            "persona": {**PERSONAS[k], **((r.persona if r else None) or {})},
            "skills": (r.skills if r and r.skills is not None else default_skills(k)),
            "tools": (r.tools if r and r.tools is not None else default_tools(k)),
            "customized": {
                "persona": bool(r and r.persona),
                "skills": bool(r and r.skills is not None),
                "tools": bool(r and r.tools is not None),
            },
        }
    return out


def save_profile(
    tenant: str,
    user: str,
    key: str,
    persona: dict | None,
    skill_ids: list[str] | None,
    tool_names: list[str] | None,
    reset: bool = False,
) -> dict:
    if key not in keys():
        raise ProfileError(404, f"エージェント {key} はいません")
    with session() as s:
        r = s.execute(
            select(AgentProfile).where(AgentProfile.tenant_id == tenant, AgentProfile.key == key)
        ).scalar_one_or_none()
        if reset:
            if r is not None:
                s.delete(r)
                s.commit()
            return profiles(tenant)[key]
        if r is None:
            r = AgentProfile(tenant_id=tenant, key=key)
            s.add(r)
        if persona is not None:
            clean = {k: str(v).strip()[:1000] for k, v in persona.items() if k in PERSONA_FIELDS}
            r.persona = {k: v for k, v in clean.items() if v != PERSONAS[key].get(k)} or None
        if skill_ids is not None:
            known = skills(tenant)
            bad = [x for x in skill_ids if x not in known]
            if bad:
                raise ProfileError(422, f"ないスキル：{'、'.join(bad)}")
            if not skill_ids:
                raise ProfileError(422, "直結するスキルを1つ以上割り当ててください")
            r.skills = list(dict.fromkeys(skill_ids))
        if tool_names is not None:
            bad = [t for t in tool_names if t not in tl.TOOLS]
            if bad:
                raise ProfileError(422, f"ないツール：{'、'.join(bad)}")
            role_bad = [t for t in tool_names if t not in tl.allowed_for(key, [t])]
            if role_bad:
                raise ProfileError(422, f"この役割には割り当てられないツール：{'、'.join(role_bad)}")
            r.tools = list(dict.fromkeys(tool_names))
        r.updated_by = user
        s.commit()
    return profiles(tenant)[key]


# ---------------- 読み込み（実行のたびに組み立てる） ----------------
@dataclass
class Loadout:
    key: str
    persona: dict
    agent_skills: list[dict]
    ref_skills: list[dict]
    reads: list[str]  # AI が呼べる読むツール
    writes: list[str]  # 最後の出力に入れられる書くツール
    prefetch: list[str]  # AI を呼ぶ前に読むツール
    warnings: list[str] = field(default_factory=list)

    def text(self) -> str:
        p = self.persona
        lines = ["## あなた（ペルソナ）", f"役割：{p.get('title', '')}"]
        lines += [f"{label}：{p[k]}" for k, label in PERSONA_FIELDS.items() if k != "title" and p.get(k)]
        for sk in self.agent_skills:
            lines += ["", f"## スキル：{sk['name']}", sk["body"]]
        for sk in self.ref_skills:
            lines += ["", f"## 参照スキル：{sk['name']}", sk["body"]]
        if self.reads or self.writes:
            lines += ["", "## 使えるツール"]
            lines += [f"- 読む：{n}（{tl.TOOLS[n].label}）" for n in self.reads]
            lines += [
                f"- 書く：{n}（{tl.TOOLS[n].label}。最後の出力の {tl.TOOLS[n].section} に入れる）" for n in self.writes
            ]
        return "\n".join(lines)


def loadout(tenant: str, key: str) -> Loadout:
    prof = profiles(tenant)[key]
    known = skills(tenant)
    warn: list[str] = []
    agent = [known[s] for s in prof["skills"] if s in known]
    warn += [f"割り当てたスキル {s} がありません" for s in prof["skills"] if s not in known]
    # 参照を辿る（幅優先・深さ・数・文字数に上限。同じスキルは1回だけ）
    seen = {s["id"] for s in agent}
    refs: list[dict] = []
    used = sum(len(s["body"]) for s in agent)
    frontier = [(r, 1) for s in agent for r in s["refs"]]
    while frontier:
        sid, depth = frontier.pop(0)
        if sid in seen:
            continue
        seen.add(sid)
        sk = known.get(sid)
        if sk is None:
            warn.append(f"参照スキル {sid} がありません")
            continue
        if depth > MAX_DEPTH or len(refs) >= MAX_REFS or used + len(sk["body"]) > MAX_CHARS:
            warn.append(f"上限のため参照スキル「{sk['name']}」を読み込みませんでした")
            continue
        refs.append(sk)
        used += len(sk["body"])
        frontier += [(r, depth + 1) for r in sk["refs"]]
    declared = list(dict.fromkeys(t for s in agent + refs for t in s["tools"]))
    granted = set(tl.allowed_for(key, prof["tools"]))
    missing = [t for t in declared if t not in granted]
    if missing:
        warn.append(f"スキルが使うのに割り当てていないツール：{'、'.join(missing)}")
    usable = [t for t in declared if t in granted]
    prefetch = list(dict.fromkeys(t for s in agent for t in s.get("prefetch") or [] if t in usable))
    return Loadout(
        key=key,
        persona=prof["persona"],
        agent_skills=agent,
        ref_skills=refs,
        reads=[t for t in usable if tl.TOOLS[t].kind == "read"],
        writes=[t for t in usable if tl.TOOLS[t].kind == "write"],
        prefetch=prefetch,
        warnings=warn,
    )


def loadout_dict(lo: Loadout) -> dict:
    return {
        "key": lo.key,
        "agent_skills": [s["id"] for s in lo.agent_skills],
        "ref_skills": [s["id"] for s in lo.ref_skills],
        "reads": lo.reads,
        "writes": lo.writes,
        "prefetch": lo.prefetch,
        "warnings": lo.warnings,
        "chars": len(lo.text()),
    }
