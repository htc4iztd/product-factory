"""システムの事実と、AI の文章の「状態が変わった」という主張の照合（LLM を使わない）。

背景：PM 同士の連絡で、AI が「本番にカナリアデプロイ完了」「全展開を承認する」と、起きていないことを書いた。
1. システムの状態（サイクル・工程・リリース・ジョブ・PdM の判断・レビューの回）は DB から取り、
   「システムの状態（事実）」として ID つきで AI に渡す。リリースがなければ「行われていない」と明記する
2. AI が状態の変化を書くなら、根拠の ID（refs.py の `種類:キー`）を必須にし、系統ごとに決めた根拠で照合する。
   照合できない文は載せない（投稿）・外す（報告）・印を付ける（Issue の注記・PM の記録）

| 系統 | 主張の例 | 通る根拠 |
|---|---|---|
| release | デプロイした・リリースした・本番で稼働・全展開した | 成功したリリースのジョブ（job・release・done） |
| approval | 承認した・合意した・了承した | PdM が承認した記録（msg）・確定済みの工程（stage）・
  成功したリリース・完了したレビュー |
| confirm | 確定した・版を上げた | 確定済みの工程（stage の status が completed か版がある） |
| merge | マージした | マージ済みのプルリクエスト（pr） |
| test | テストが通った・合格した・ビルドに成功した | 成功したジョブ（job・done）・
  ⑬の中身のある項目（field:s13.…）・マージ済みの pr |
| review | レビューが完了した・通過した | 結果の出たレビューの回（review）・PdM の判断（msg） |
| doc | ⑦の業務フローを書いた・設計を更新した | 中身のある項目（field）・工程（stage）・Issue・担当の報告・PM の記録 |

3. PM・担当にはリリースを承認する権限も、サイクルを完了にする権限もない（PdM だけ）
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy import select

from . import refs
from .db import AssistantMessage, JobRun, Product, ProductCycle, session

# 系統ごとの単語（上から順に判定する。成果物の更新の文は先に doc として扱う）
CATEGORIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("release", ("デプロイ", "リリース", "本番", "カナリア", "全展開", "ロールアウト", "ロールバック", "切り戻し",
                 "公開した", "公開しました", "稼働", "deploy", "release", "production")),
    ("merge", ("マージ", "merge", "取り込みました", "取り込んだ")),
    ("test", ("テストが通", "テストに合格", "テストを通過", "テストが成功", "合格", "ビルドが通", "ビルドに成功",
              "CI が通", "CIが通")),
    ("review", ("レビューが完了", "レビューを完了", "レビューが終わ", "レビューを通過", "レビューに通")),
    ("confirm", ("確定", "版を上げ", "版を更新", "更新済み")),
    ("approval", ("承認", "合意", "了承", "許可")),
)
# 完了の言い方（これと系統の単語がそろったら「状態が変わった」という主張とみなす）
DONE = re.compile(r"(完了|済み|済|しました|した[。、]|した$|できた|できました|成功|稼働し|稼働中|通った|"
                  r"通りました|合格|承認する|承認します|合意する|開始した|開始しました|展開した|展開しました|"
                  r"確認した|確認しました|移行した|移行しました|反映した|反映しました|書いた|作成した|追加した|"
                  r"更新した|取り込)")
# 主張ではない文（否定・予定・質問・依頼）
NOT_CLAIM = re.compile(r"(していない|されていない|行われていない|ていません|ありません|まだ|未実施|未完了|"
                       r"予定|計画|準備|方針|検討|てよいか|べきか|ですか|ますか|か？|\?|ください|してほしい|"
                       r"お願い|必要|要る|待ち|前に|"
                       # 「〜の承認依頼を出しました」は、この発言に付けた依頼のこと（状態が変わったという主張ではない）
                       r"承認依頼|合意依頼|依頼を出)")
# 成果物（文書）の更新を言っている文（実行・実施を含むなら、システムの状態の主張として扱う）
ABOUT_DOC = re.compile(r"(の定義|手順書|手順を(書|更新|追記|見直)|設計を|設計書|計画を|下書き|項目|"
                       r"ドキュメント|文書|記述|成果物|を書|を作成|を追加|を更新)")
DID = re.compile(r"(実行|実施|行った|行いました)")

RULE = (
    "デプロイ・リリース・本番での稼働・承認・確定・マージ・テストの合否・レビューの完了・成果物の更新など、"
    "状態が変わったことは、「システムの状態（事実）」と材料にあることだけを書き、evidence にその根拠の ID"
    "（[job:…]・[issue:#n]・[note:n]・[report:key]・[post:n]・[stage:sNN]・[field:sNN.項目]・[msg:n]・"
    "[review:cNrM]・[pr:#n]）を入れる。そこにないことは起きていないものとして扱い、推測で書かない。"
    "分からなければ「分からない」と書く。"
    "PM・担当はリリースを承認できない（リリースの承認・サイクルの完了は PdM だけ）。"
    "要るなら「PdM に上げる」と書く。"
)


def sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[。！!？?\n])", text) if s.strip()]


def claim_kind(sentence: str) -> str | None:
    """状態が変わったという主張なら、その系統。主張でなければ None。"""
    s = sentence.strip()
    if not s or NOT_CLAIM.search(s) or not DONE.search(s):
        return None
    if ABOUT_DOC.search(s) and not DID.search(s):
        return "doc"
    low = s.lower()
    for name, words in CATEGORIES:
        if any(w in s or w in low for w in words):
            return name
    return None


def _ok(kind: str, ev: list[dict]) -> bool:
    """系統ごとに、解決した根拠が主張を裏付けるか。"""
    def has(k: str, pred=lambda r: True) -> bool:
        return any(r["kind"] == k and pred(r) for r in ev)

    release_done = has("job", lambda r: r["job_kind"] == "release" and r["status"] == "done")
    pdm_ok = has("msg", lambda r: any(d["status"] == "approved" and d.get("decided_by") for d in r["decisions"]))
    stage_done = has("stage", lambda r: r["status"] == "completed" or r["approved_version"] > 0)
    if kind == "release":
        return release_done
    if kind == "approval":
        return pdm_ok or stage_done or release_done or has("review", lambda r: r["completed"])
    if kind == "confirm":
        return stage_done
    if kind == "merge":
        return has("pr", lambda r: r["merged"])
    if kind == "test":
        return (has("job", lambda r: r["status"] == "done") or has("pr", lambda r: r["merged"])
                or has("field", lambda r: r["filled"] and r["stage_id"] == "s13"))
    if kind == "review":
        return has("review", lambda r: r["status"] in ("ready", "fixed") or r["completed"]) or pdm_ok
    if kind == "doc":
        return (has("field", lambda r: r["filled"]) or has("stage") or has("issue") or has("report")
                or has("note"))
    return True


def check(
    product_id: str, text: str, evidence: list[str], allowed: set[str] | None = None
) -> tuple[list[str], list[str]]:
    """文ごとに照合する。返り値は（残してよい文, 根拠のない主張の文）。
    allowed を渡すと、その中の ID（材料に出した ID）だけを根拠として認める。"""
    ev = []
    for e in evidence or []:
        r = refs.normalize(e)
        if r is None or (allowed is not None and r not in allowed):
            continue
        got = refs.resolve(product_id, r)
        if got is not None:
            ev.append(got)
    keep, bad = [], []
    for sent in sentences(text):
        k = claim_kind(sent)
        (keep if k is None or _ok(k, ev) else bad).append(sent)
    return keep, bad


def scrub(product_id: str, text: str, evidence: list[str] | None = None, mark: bool = False) -> tuple[str, list[str]]:
    """根拠のない主張の文を外す（mark なら「［根拠なし・未確認］」の印を付けて残す）。
    返り値は（直した文章, 外した文）。"""
    keep, bad = check(product_id, text, evidence or [])
    if not bad:
        return text, []
    if mark:
        out = "".join(f"［根拠なし・未確認］{s}" if s in bad else s for s in sentences(text))
    else:
        out = "".join(keep).strip()
    return out, bad


# ---------------- AI に渡す事実の欄 ----------------
@dataclass
class Facts:
    """AI に渡す事実の欄と、引用してよい根拠の ID。"""
    md: str
    ids: set[str] = field(default_factory=set)


_REL = {"defining": "オンボーディング中（リリースエージェントが定義している）",
        "review": "リリース前レビュー待ち（未承認）",
        "releasing": "リリース中", "waiting_manual": "手動の作業待ち",
        "released": "成功（リリース済み）",
        "failed": "失敗"}
_STAGE = {"not_started": "未着手", "in_progress": "作業中", "awaiting_approval": "承認待ち", "revising": "修正中",
          "completed": "確定済み", "skipped": "使わない", "needs_recheck": "要再確認"}
_ROUND = {"reviewing": "PM がレビュー中", "ready": "PM のレビューが出た", "fixing": "担当が修正中",
          "fixed": "修正が終わった"}


def system_facts(product_id: str) -> Facts:
    """サイクル・工程・リリース・ジョブ・PdM の判断・レビューの回の、DB にある事実（ID つき）。"""
    from . import cycles, repo
    from .stages import STAGES

    with session() as s:
        p = s.get(Product, product_id)
        if p is None:
            return Facts("")
        n, st = p.cycle or 1, p.cycle_state or "running"
        c = s.execute(
            select(ProductCycle).where(ProductCycle.product_id == product_id, ProductCycle.number == n)
        ).scalar_one_or_none()
        label = c.label if c else ""
        rel = dict((c.release if c else None) or {})
        rv = dict((c.review if c else None) or {})
        jobs = list(
            s.execute(select(JobRun).where(JobRun.product_id == product_id).order_by(JobRun.created_at.desc()).limit(8))
            .scalars()
        )
        rel_jobs = list(
            s.execute(
                select(JobRun).where(JobRun.product_id == product_id, JobRun.kind.in_(("release", "onboarding")))
                .order_by(JobRun.created_at.desc()).limit(5)
            ).scalars()
        )
        done_releases = sum(
            1 for r in s.execute(select(ProductCycle).where(ProductCycle.product_id == product_id)).scalars()
            if (r.release or {}).get("status") == "released"
        )
        decisions = [
            (m.id, a)
            for m in s.execute(
                select(AssistantMessage)
                .where(AssistantMessage.product_id == product_id, AssistantMessage.role == "agent")
                .order_by(AssistantMessage.id.desc()).limit(40)
            ).scalars()
            for a in m.actions or []
            if a.get("status") in ("approved", "rejected")
        ][:8]
    lines = ["### システムの状態（事実。DB から取った。ここにないことは起きていない）",
             f"- サイクル {n}（{label or '位置付けなし'}）：{cycles.STATE_LABEL.get(st, st)}"]
    ids: set[str] = set()
    # 工程の状態（確定済みかどうか・版）
    rs = repo.runs(product_id)
    parts = []
    for sg in STAGES:
        r = rs.get(sg.id)
        if r is None or not r.enabled:
            continue
        ids.add(f"stage:{sg.id}")
        ver = f" v{r.approved_version}" if r.approved_version else ""
        parts.append(f"[stage:{sg.id}] {sg.no}{_STAGE.get(r.status, r.status)}{ver}")
    lines.append("- 工程：" + "・".join(parts))
    # リリース
    if rel.get("status"):
        lines.append(f"- このサイクルのリリース：{_REL.get(rel['status'], rel['status'])}"
                     + (f"（承認：{rel['approved_by']}）" if rel.get("approved_by") else "（PdM の承認はまだ）"))
    else:
        lines.append("- このサイクルのリリース：行われていない（オンボーディングも始まっていない）")
    lines.append(f"- これまでに成功したリリース：{done_releases} 回")
    if not rel_jobs:
        lines.append("- リリース・オンボーディングのジョブ：1つもない（デプロイは一度も行われていない）")
    # プロダクトレビューの回
    for r in rv.get("rounds", [])[-3:]:
        ref = f"review:c{n}r{r['n']}"
        ids.add(ref)
        lines.append(f"- [{ref}] プロダクトレビュー 第 {r['n']} 回：{_ROUND.get(r.get('status'), r.get('status'))}"
                     + ("（レビューは完了）" if rv.get("done_at") else ""))
    # PdM の判断（チャットの承認依頼に答えたもの）
    for mid, a in decisions:
        ids.add(f"msg:{mid}")
        lines.append(f"- [msg:{mid}] PdM の判断：「{a.get('title', '')[:60]}」を"
                     f"{'承認' if a['status'] == 'approved' else '否認'}（{a.get('decided_by', '')}）")
    # 最近のジョブ（リリース系を含む）
    for j in {x.id: x for x in [*rel_jobs, *jobs]}.values():
        ids.add(f"job:{j.id}")
        lines.append(f"- [job:{j.id}] ジョブ {j.kind}：{j.status}"
                     + (f"・終了 {j.finished_at:%m/%d %H:%M}" if j.finished_at else ""))
    lines.append("- デプロイ・リリースの承認とサイクルの完了は PdM だけができる。PM・担当には権限がない")
    return Facts("\n".join(lines) + "\n", ids)
