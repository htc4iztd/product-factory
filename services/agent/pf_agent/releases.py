"""リリース（サイクルの外。プロダクトレビューのあと）。

1. オンボーディング：リリースエージェント（⑭の担当）が、インフラ設計（⑩）・運用設計（⑪）・コード（⑫）・テスト（⑬）と
   接続先を読み、リリース先の環境（クラウド・オンプレなど）・リリース方式・手順・設定・確認・切り戻しを定義する
2. リリース前レビュー：PdM が定義を読み、直させる（もう一度オンボーディング）か、リリースを承認する
3. リリース：承認すると、リリースエージェントが接続先でデプロイ・設定を行う。接続先は
   - github_actions：プロダクトのリポジトリのワークフローを workflow_dispatch で起動する（中身は GitHub 側）
   - webhook：決めた URL（https・外部のアドレスだけ）にリリースの定義を JSON で送る（署名つき）。CD の仕組みが受ける
   - manual：手順書を出し、PdM が終わったら完了にする
   このファクトリーが直接クラウドの API を叩いてデプロイすることはしない（接続先の仕組みに任せる）
4. 終わったら、⑭の「デプロイ記録」「監視設定」に残し、サイクルを完了にする（次のサイクル待ち）
"""
from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import ipaddress
import json
import re
import socket
import urllib.error
import urllib.parse
import urllib.request

from pydantic import BaseModel, Field
from sqlalchemy import select

from . import cycles, fwlib, jobs, llm, llmconf, repo, tenantsec
from . import frameworks as fx
from .db import JobRun, Product, ProductCycle, session
from .stages import STAGE_BY_ID

KINDS = {"github_actions": "GitHub Actions", "webhook": "Webhook（CD の仕組みに送る）", "manual": "手動（手順書）"}
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")

jobs.JOBS["onboarding"] = jobs.JobDef(
    "onboarding",
    "リリースのオンボーディング",
    "リリースエージェントが、インフラ設計・運用設計・コード・テストと接続先から、リリース先の環境と方式・手順・設定を定義する。",
    "プロダクトレビューを完了してリリースに進んだとき・リリース前レビューで直させたとき",
    20,
)
jobs.JOBS["release"] = jobs.JobDef(
    "release",
    "リリース",
    "PdM の承認を受けて、リリースエージェントが接続先でデプロイ・設定を行う。",
    "リリース前レビューで「リリースを承認する」",
    30,
)


class ReleaseError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _now() -> str:
    return dt.datetime.now(dt.UTC).isoformat()


def _secret_name(pid: str) -> str:
    return f"release_secret:{pid}"


# ---------------- 接続先 ----------------
def target(product: Product) -> dict:
    with session() as s:
        t = dict(s.get(Product, product.id).release_target or {})
    return {**t, "kind_label": KINDS.get(t.get("kind", ""), "まだ決めていません"),
            "has_secret": bool(tenantsec.get(product.tenant_id, _secret_name(product.id)))}


def set_target(product: Product, actor: str, body: dict) -> dict:
    kind = body.get("kind")
    if kind not in KINDS:
        raise ReleaseError(422, f"接続先は {'・'.join(KINDS)} のどれかです")
    t: dict = {"kind": kind}
    if kind == "github_actions":
        rp = (body.get("repo") or product.repo or "").strip()
        wf = (body.get("workflow") or "").strip()
        if not REPO_RE.match(rp):
            raise ReleaseError(422, "リポジトリは owner/name の形で書いてください")
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}\.ya?ml|\d+", wf):
            raise ReleaseError(422, "ワークフローは .github/workflows のファイル名（release.yml など）です")
        t.update(repo=rp, workflow=wf, ref=(body.get("ref") or "main").strip()[:100],
                 pass_plan=bool(body.get("pass_plan")))
    elif kind == "webhook":
        url = (body.get("url") or "").strip()
        if urllib.parse.urlparse(url).scheme != "https":
            raise ReleaseError(422, "Webhook の URL は https で書いてください")
        t["url"] = url[:500]
    t["note"] = str(body.get("note") or "")[:1000]
    with session() as s:
        s.get(Product, product.id).release_target = t
        s.commit()
    repo.log(product.id, None, "human", actor, "release.target", {"kind": kind})
    return target(product)


def set_secret(product: Product, actor: str, secret: str | None) -> dict:
    tenantsec.put(product.tenant_id, _secret_name(product.id), secret or None, actor)
    return target(product)


# ---------------- オンボーディング ----------------
class EnvOut(BaseModel):
    kind: str = Field(description="cloud | onprem | hybrid | saas")
    provider: str = Field(description="クラウドの事業者・オンプレの基盤など（例：Google Cloud、AWS、"
        "自社データセンター）")
    region: str = Field(description="リージョン・設置場所")
    summary: str = Field(description="リリース先の構成（何をどこに置くか）")


class MethodOut(BaseModel):
    strategy: str = Field(description="all-at-once | rolling | blue-green | canary | manual")
    summary: str = Field(description="なぜこの方式か・どう切り替えるか")


class StepOut(BaseModel):
    title: str
    detail: str


class ConfigOut(BaseModel):
    name: str = Field(description="設定の名前（環境変数・秘密・インフラの設定など）")
    value: str = Field(description="値か、値の決め方（秘密の値そのものは書かない）")


class PlanOut(BaseModel):
    environment: EnvOut
    method: MethodOut
    steps: list[StepOut]
    configs: list[ConfigOut]
    checks: list[str] = Field(description="リリースのあとに確かめること（監視・疎通・主要な使い方）")
    rollback: str = Field(description="切り戻しの手順")
    risks: list[str]


def _cycle_row(s, product_id: str) -> ProductCycle:
    p = s.get(Product, product_id)
    return s.execute(
        select(ProductCycle).where(ProductCycle.product_id == product_id, ProductCycle.number == (p.cycle or 1))
    ).scalar_one()


def _set_release(product_id: str, **kw) -> dict:
    cycles.current(product_id)
    with session() as s:
        c = _cycle_row(s, product_id)
        rel = {**(c.release or {}), **kw}
        c.release = rel
        s.commit()
        return rel


def start_onboarding(product: Product, actor: str, feedback: str = "") -> str:
    """リリースエージェントに、リリースの定義を作らせる（ジョブ）。"""
    conn = llmconf.resolve(product.tenant_id)
    cur = cycles.current(product.id).release or {}
    history = list(cur.get("history") or [])
    if cur.get("plan"):
        history.append({"plan": cur["plan"], "feedback": feedback, "at": _now()})
    job = jobs.create("onboarding", product.tenant_id, product.id, actor, {"feedback": feedback[:4000]}, total=1,
                      model=conn.chat_model,
                      tasks=[{"id": "define", "name": "リリースエージェントがリリースを定義する",
                              "group": "オンボーディング",
                              "deps": []}])
    _set_release(product.id, status="defining", job_id=job, feedback=feedback[:4000], history=history[-10:],
                 started_at=cur.get("started_at") or _now())
    jobs.dispatch(job)
    return job


def _material(product: Product) -> str:
    out = []
    for sid in ("s10", "s11", "s12", "s13"):
        st = STAGE_BY_ID[sid]
        out.append(fx.to_markdown(st, fwlib.of(product.id, sid), repo.draft(product.id, sid))[:12000])
    return "\n\n".join(out)


def run_onboarding(job_id: str) -> None:
    from . import agentrun

    with session() as s:
        j = s.get(JobRun, job_id)
        product = s.get(Product, j.product_id)
        s.expunge(product)
        feedback = j.params.get("feedback") or ""
    conn = llmconf.resolve(product.tenant_id)
    t = target(product)
    c = cycles.current(product.id)
    with jobs.task(job_id, "define"):
        if conn.provider == "stub":
            llm._record("stub", 0, 0)
            out = PlanOut(
                environment=EnvOut(kind="cloud", provider="Google Cloud", region="asia-northeast1",
                                   summary="（スタブ）⑩インフラ設計のとおり、アプリをコンテナで動かし、"
                                       "DB はマネージドを使う"),
                method=MethodOut(strategy="blue-green",
                                 summary="（スタブ）新しい版を並べて立ち上げ、確かめてから切り替える"),
                steps=[StepOut(title="ビルド", detail="⑫のコードからコンテナを作る"),
                       StepOut(title="デプロイ", detail="新しい版を立ち上げる"),
                       StepOut(title="切り替え", detail="確認が通ったら利用者の通信を新しい版に向ける")],
                configs=[ConfigOut(name="DATABASE_URL", value="秘密の管理から渡す")],
                checks=["主要な使い方を最後まで通せる", "エラー率が上がっていない"],
                rollback="切り替え前の版に通信を戻す", risks=["DB の変更が戻せない場合は、先にバックアップを取る"],
            )
        else:
            prep = agentrun.prepare(product.tenant_id, product, "s14")
            prompt = (
                f"あなたはプロダクト「{product.name}」（{product.idea}）のリリースエージェント（⑭リリースの担当）です。"
                f"サイクル {c.number}（{c.label or '位置付けなし'}）のプロダクトレビューが終わりました。"
                "インフラ設計・運用設計・コード・テストの成果物と接続先から、リリースを定義します。\n"
                + prep.header()
                + f"\n\n## 接続先（デプロイを実行する仕組み）"
                    f"\n{json.dumps({k: v for k, v in t.items() if k != 'has_secret'}, ensure_ascii=False)}\n"
                + (f"\n## PdM の前回の指摘（これを直す）\n{feedback}\n" if feedback else "")
                + "\n## 出力\nenvironment（リリース先の環境：cloud・onprem・hybrid・saas と事業者・場所・構成）、"
                "method（リリース方式と理由）、steps（手順。接続先の仕組みで実行できる粒度）、configs（必要な設定。秘密の値は書かない）、"
                "checks（リリース後に確かめること）、rollback（切り戻し）、risks。成果物にないことは推測と書く。"
                "位置付けに対して過剰な構成にしない。期限や時刻は書かない。\n\n"
                + _material(product)[:60000]
            )
            out = agentrun.think(conn, prep, prompt, PlanOut)
        plan = out.model_dump()
        jobs.set_task(job_id, "define", detail=f"{plan['environment']['kind']}・{plan['method']['strategy']}")
    _set_release(product.id, status="review", plan=plan, defined_at=_now(), error=None)
    cycles._set_state(product.id, cycles.PRERELEASE)
    cycles._notify(product, "s14",
                   f"【リリース前レビュー】サイクル {c.number} のリリースを定義しました"
                   f"（{plan['environment']['provider']}・"
                   f"{plan['method']['strategy']}）。内容を確かめ、リリースを承認するか、直すところを指示してください。",
                   "リリース", f"/p/{product.id}/release", cycle=c.number)


jobs.HANDLERS["onboarding"] = run_onboarding


# ---------------- リリース前レビュー・リリース ----------------
def request_changes(product: Product, actor: str, feedback: str) -> dict:
    if cycles.state_of(product.id) != cycles.PRERELEASE:
        raise ReleaseError(409, "リリース前レビュー中ではありません")
    if not feedback.strip():
        raise ReleaseError(422, "直すところを書いてください")
    cycles._set_state(product.id, cycles.ONBOARDING)
    start_onboarding(product, actor, feedback.strip())
    return view(product)


def approve(product: Product, actor: str) -> dict:
    """リリースを承認する。接続先でデプロイ・設定を行う（ジョブ）。"""
    if cycles.state_of(product.id) != cycles.PRERELEASE:
        raise ReleaseError(409, "リリース前レビュー中ではありません")
    t = target(product)
    if not t.get("kind"):
        raise ReleaseError(409, "先にリリースの接続先を決めてください")
    rel = cycles.current(product.id).release or {}
    if not rel.get("plan"):
        raise ReleaseError(409, "リリースの定義がありません")
    conn = llmconf.resolve(product.tenant_id)
    job = jobs.create("release", product.tenant_id, product.id, actor, {"kind": t["kind"]}, total=1,
                      model=conn.chat_model,
                      tasks=[{"id": "deploy", "name": f"{t['kind_label']}でリリースする", "group": "リリース",
                              "deps": []}])
    _set_release(product.id, status="releasing", approved_by=actor, approved_at=_now(), job_id=job, error=None)
    cycles._set_state(product.id, cycles.RELEASING)
    repo.log(product.id, None, "human", actor, "release.approve", {"kind": t["kind"]})
    jobs.dispatch(job)
    return view(product)


def _guard(url: str) -> None:
    host = urllib.parse.urlparse(url).hostname or ""
    for info in socket.getaddrinfo(host, 443):
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise ReleaseError(422, "内部ネットワークのアドレスには送れません")


def _post(url: str, body: bytes, headers: dict) -> tuple[int, str]:
    _guard(url)
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 - https と外部のアドレスだけ（_guard）
            return r.status, r.read(2000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(2000).decode("utf-8", "replace")


def _payload(product: Product, c: ProductCycle, plan: dict) -> dict:
    return {"product": {"id": product.id, "name": product.name}, "cycle": c.number, "label": c.label,
            "plan": plan, "at": _now()}


def run_release(job_id: str) -> None:
    from . import code, ghsync

    with session() as s:
        j = s.get(JobRun, job_id)
        product = s.get(Product, j.product_id)
        s.expunge(product)
    t = target(product)
    c = cycles.current(product.id)
    plan = (c.release or {}).get("plan") or {}
    log: list[str] = []
    status, detail = "failed", ""
    with jobs.task(job_id, "deploy"):
        try:
            if t["kind"] == "github_actions":
                tok, _ = ghsync.token(product.tenant_id)
                if not tok:
                    raise ReleaseError(409, "GitHub のトークンがありません（設定 → GitHub）")
                body: dict = {"ref": t.get("ref") or "main"}
                if t.get("pass_plan"):
                    body["inputs"] = {"pf_cycle": str(c.number),
                                      "pf_plan": json.dumps(plan, ensure_ascii=False)[:60000]}
                code.call("POST", f"/repos/{t['repo']}/actions/workflows/{t['workflow']}/dispatches", tok, body)
                url = f"https://github.com/{t['repo']}/actions/workflows/{t['workflow']}"
                log.append(f"GitHub Actions のワークフロー {t['workflow']}（{t['repo']}・{body['ref']}）を起動しました")
                status, detail = "released", f"デプロイは GitHub Actions で動いています：{url}"
            elif t["kind"] == "webhook":
                raw = json.dumps(_payload(product, c, plan), ensure_ascii=False).encode()
                headers = {"content-type": "application/json", "user-agent": "product-factory"}
                secret = tenantsec.get(product.tenant_id, _secret_name(product.id))
                if secret:
                    headers["x-pf-signature"] = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
                code_, text = _post(t["url"], raw, headers)
                log.append(f"Webhook に送りました（HTTP {code_}）：{text[:300]}")
                if 200 <= code_ < 300:
                    status, detail = "released", "接続先の CD の仕組みが受け付けました"
                else:
                    detail = f"接続先が受け付けませんでした（HTTP {code_}）"
            else:
                status = "waiting_manual"
                detail = "手順書のとおりに作業し、終わったら「リリースを完了にする」を押してください"
                log.append("手動のリリースです。手順書を出しました")
        except (ReleaseError, code.CodeError) as e:
            detail = getattr(e, "message", str(e))
            log.append(f"失敗：{detail}")
        jobs.set_task(job_id, "deploy", detail=detail[:200])
    _finish(product, status, detail, log)


jobs.HANDLERS["release"] = run_release


def _finish(product: Product, status: str, detail: str, log: list[str]) -> None:
    c = cycles.current(product.id)
    rel = c.release or {}
    result = {"status": status, "detail": detail, "log": log, "at": _now()}
    _set_release(product.id, status=status, result=result, error=detail if status == "failed" else None)
    if status == "released":
        plan = rel.get("plan") or {}
        env, method = plan.get("environment") or {}, plan.get("method") or {}
        record = (f"## サイクル {c.number}（{c.label}）のリリース {result['at'][:16]}\n"
                  f"- 環境：{env.get('kind', '')}・{env.get('provider', '')}・{env.get('region', '')}\n"
                  f"- 方式：{method.get('strategy', '')}\n- 結果：{detail}\n" + "".join(f"- {x}\n" for x in log))
        d = repo.draft(product.id, "s14")
        merged = (record + "\n" + str(d.get("sec1") or "")).strip()
        repo.set_field(product.id, "s14", "sec1", merged, "release", "agent")
        if not str(d.get("sec2") or "").strip() and plan.get("checks"):
            repo.set_field(product.id, "s14", "sec2", "\n".join(f"- {x}" for x in plan["checks"]), "release", "agent")
        cycles._set_state(product.id, cycles.DONE)
        cycles._notify(product, "s14", f"【リリース】サイクル {c.number} をリリースしました。{detail}"
                       "次のサイクルを始めるときは、レビュー画面で戦略を決めてください。",
                       "リリース", f"/p/{product.id}/release", cycle=c.number)
    elif status == "failed":
        cycles._set_state(product.id, cycles.PRERELEASE)  # 直して、もう一度承認できる
        cycles._notify(product, "s14", f"【相談】サイクル {c.number} のリリースに失敗しました：{detail}"
                       "接続先を直してもう一度承認するか、リリースの定義を直させてください。",
                       "リリース", f"/p/{product.id}/release", cycle=c.number, ask="consult", ask_label="相談")


def finish_manual(product: Product, actor: str, ok: bool, note: str) -> dict:
    if cycles.state_of(product.id) != cycles.RELEASING:
        raise ReleaseError(409, "リリース中ではありません")
    rel = cycles.current(product.id).release or {}
    if rel.get("status") != "waiting_manual":
        raise ReleaseError(409, "手動のリリースではありません")
    log = [*((rel.get("result") or {}).get("log") or []), f"{actor}：{note.strip() or ('完了' if ok else '失敗')}"]
    _finish(product, "released" if ok else "failed", "手動で作業しました" if ok else f"手動の作業で失敗：{note}", log)
    return view(product)


def view(product: Product) -> dict:
    st = cycles.state(product)
    return {**st, "target": target(product), "kinds": KINDS,
            "releases": [{"number": c["number"], "label": c["label"], **(c.get("release") or {})}
                         for c in [st["current"], *st["past"]] if c.get("release")]}
