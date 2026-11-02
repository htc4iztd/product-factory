"""システムの事実と、AI の文章の「状態が変わった」という主張の照合（LLM を使わない）。

背景：PM 同士の連絡で、AI が「本番にカナリアデプロイ完了」「全展開を承認する」と、起きていないことを書いた。
1. システムの状態（サイクル・リリース・ジョブ）は DB から取り、「システムの状態（事実）」として AI に渡す。
   リリースがなければ「リリースは行われていない」と明記する
2. AI が状態の変化（デプロイした・リリースした・本番で稼働・承認した・テストが通った など）を書くなら、
   根拠の ID（job:… / issue:#n / note:n / report:key）を必須にし、DB と照合する。照合できない文は載せない
   - デプロイ・リリース・本番・承認の主張は、成功したリリースのジョブ（job:）でしか裏付けられない
   - それ以外の主張（マージ・テストが通った など）は、実在する ID なら可
3. PM はリリースを承認できない（承認・サイクルの完了は PdM だけ）。PM の「承認する」は事実として扱わない
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy import select

from .db import AgentIssue, JobRun, PmNote, Product, ProductCycle, session

# 状態の単語：デプロイ・リリース・本番・承認の系統（成功したリリースのジョブでしか裏付けられない）
RELEASE_WORDS = ("デプロイ", "リリース", "本番", "カナリア", "全展開", "ロールアウト", "ロールバック", "切り戻し",
                 "承認", "公開した", "公開しました", "deploy", "release", "production")
# それ以外の状態の単語（実在する根拠の ID があれば可）
OTHER_WORDS = ("マージ", "テストが通", "テストに合格", "テストを通過", "合格", "稼働", "ビルドが通", "ビルドに成功")
# 完了の言い方（これと状態の単語がそろったら「状態が変わった」という主張とみなす）
DONE = re.compile(r"(完了|済み|済|しました|した[。、]|した$|できた|できました|成功|稼働し|稼働中|通った|"
                  r"通りました|合格|"
                  r"承認する|承認します|承認しました|承認した|開始した|開始しました|展開した|展開しました|確認した|確認しました|"
                  r"移行した|移行しました|反映した|反映しました)")
# 主張ではない文（否定・予定・質問・依頼）
NOT_CLAIM = re.compile(r"(していない|されていない|行われていない|ていません|ありません|まだ|未実施|未完了|"
                       r"予定|計画|準備|方針|検討|"
                       r"てよいか|べきか|ですか|ますか|か？|\?|ください|してほしい|お願い|必要|要る|待ち|前に)")
# 成果物（文書）の更新を言っている文は、システムの状態の主張ではない（実行・実施を含むなら主張として扱う）
ABOUT_DOC = re.compile(r"(の定義|手順書|手順を(書|更新|追記|見直)|設計を|設計書|方針|計画を|下書き|項目|"
                       r"ドキュメント|文書|記述|成果物)")
DID = re.compile(r"(実行|実施|行った|行いました)")
ID_RE = re.compile(r"^(job:[0-9a-f]{6,64}|issue:#?\d+|note:\d+|report:[a-z0-9_]+)$")

RULE = (
    "デプロイ・リリース・本番での稼働・承認・テストの合否・マージなど、システムの状態が変わったことは、"
    "「システムの状態（事実）」と材料にあることだけを書き、evidence にその根拠の ID（[job:…]・[issue:#n]・[note:n]・"
    "[report:key]）を入れる。そこにないことは起きていないものとして扱い、推測で書かない。分からなければ「分からない」と書く。"
    "PM はリリースを承認できない（リリースの承認・サイクルの完了は PdM だけ）。要るなら「PdM に上げる」と書く。"
)


def sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[。！!？?\n])", text) if s.strip()]


def claim_kind(sentence: str) -> str | None:
    """状態が変わったという主張なら、その系統（release | other）。主張でなければ None。"""
    s = sentence.strip()
    if not s or NOT_CLAIM.search(s) or not DONE.search(s):
        return None
    if ABOUT_DOC.search(s) and not DID.search(s):
        return None
    low = s.lower()
    if any(w in s or w in low for w in RELEASE_WORDS):
        return "release"
    if any(w in s for w in OTHER_WORDS):
        return "other"
    return None


@dataclass
class Facts:
    """AI に渡す事実の欄と、引用してよい根拠の ID。"""
    md: str
    ids: set[str] = field(default_factory=set)
    release_jobs: dict[str, str] = field(default_factory=dict)  # 成功・失敗などリリース系ジョブの id → status


def system_facts(product_id: str) -> Facts:
    """サイクル・リリース・リリース系のジョブの、DB にある事実。"""
    from . import cycles

    with session() as s:
        p = s.get(Product, product_id)
        if p is None:
            return Facts("")
        n, st = p.cycle or 1, p.cycle_state or "running"
        c = s.execute(
            select(ProductCycle).where(ProductCycle.product_id == product_id, ProductCycle.number == n)
        ).scalar_one_or_none()
        rel = dict((c.release if c else None) or {})
        jobs = list(
            s.execute(
                select(JobRun).where(JobRun.product_id == product_id, JobRun.kind.in_(("release", "onboarding")))
                .order_by(JobRun.created_at.desc()).limit(10)
            ).scalars()
        )
        done_releases = sum(
            1 for r in s.execute(select(ProductCycle).where(ProductCycle.product_id == product_id)).scalars()
            if (r.release or {}).get("status") == "released"
        )
    lines = ["### システムの状態（事実。DB から取った。ここにないことは起きていない）",
             f"- サイクル {n}（{c.label if c and c.label else '位置付けなし'}）：{cycles.STATE_LABEL.get(st, st)}"]
    if rel.get("status"):
        lines.append(f"- このサイクルのリリース：{_REL.get(rel['status'], rel['status'])}"
                     + (f"（承認：{rel['approved_by']}）" if rel.get("approved_by") else "（PdM の承認はまだ）"))
    else:
        lines.append("- このサイクルのリリース：行われていない（オンボーディングも始まっていない）")
    lines.append(f"- これまでに成功したリリース：{done_releases} 回")
    ids: set[str] = set()
    rj: dict[str, str] = {}
    for j in jobs:
        ids.add(f"job:{j.id}")
        rj[j.id] = f"{j.kind}:{j.status}"
        lines.append(f"- [job:{j.id}] {j.kind}（{'リリース' if j.kind == 'release' else 'オンボーディング'}）："
                     f"{j.status}" + (f"・終了 {j.finished_at:%m/%d %H:%M}" if j.finished_at else ""))
    if not jobs:
        lines.append("- リリース・オンボーディングのジョブ：1つもない（デプロイは一度も行われていない）")
    lines.append("- デプロイ・リリースの承認は PdM だけができる。PM・担当には承認の権限がない")
    return Facts("\n".join(lines) + "\n", ids, rj)


_REL = {"defining": "オンボーディング中（リリースエージェントが定義している）",
        "review": "リリース前レビュー待ち（未承認）",
        "releasing": "リリース中", "waiting_manual": "手動の作業待ち", "released": "成功（リリース済み）",
        "failed": "失敗"}


def valid_ids(product_id: str, evidence: list[str], allowed: set[str] | None = None) -> list[str]:
    """根拠の ID のうち、形が正しく、DB に実在するもの（allowed を渡すと、その中にあるものだけ）。"""
    from .team import KEYS

    out = []
    for raw in evidence or []:
        e = raw.strip().strip("[]")
        if not ID_RE.match(e) or (allowed is not None and e not in allowed):
            continue
        kind, val = e.split(":", 1)
        with session() as s:
            if kind == "job":
                ok = (j := s.get(JobRun, val)) is not None and j.product_id == product_id
            elif kind == "issue":
                q = select(AgentIssue.id).where(AgentIssue.product_id == product_id,
                                                AgentIssue.number == int(val.lstrip("#")))
                ok = s.execute(q).first() is not None
            elif kind == "note":
                ok = (nt := s.get(PmNote, int(val))) is not None and nt.product_id == product_id
            else:
                ok = val in KEYS
        if ok:
            out.append(e)
    return out


def check(
    product_id: str, text: str, evidence: list[str], allowed: set[str] | None = None
) -> tuple[list[str], list[str]]:
    """文ごとに照合する。返り値は（残してよい文, 根拠のない主張の文）。
    リリース系の主張は、成功したリリースのジョブ（job:・status done）が根拠にあるときだけ通す。"""
    ev = valid_ids(product_id, evidence, allowed)
    jobs = []
    with session() as s:
        for e in ev:
            if e.startswith("job:"):
                j = s.get(JobRun, e[4:])
                if j is not None:
                    jobs.append((j.kind, j.status))
    keep, bad = [], []
    for sent in sentences(text):
        k = claim_kind(sent)
        if k == "release":
            ok = any(kind == "release" and status == "done" for kind, status in jobs)
        elif k == "other":
            ok = bool(ev)
        else:
            ok = True
        (keep if ok else bad).append(sent)
    return keep, bad


def scrub(product_id: str, text: str, evidence: list[str] | None = None, mark: bool = False) -> tuple[str, list[str]]:
    """根拠のない主張の文を外す（mark なら「［根拠なし］」の印を付けて残す）。返り値は（直した文章, 外した文）。"""
    keep, bad = check(product_id, text, evidence or [])
    if not bad:
        return text, []
    if mark:
        out = "".join(f"［根拠なし・未確認］{s}" if s in bad else s for s in sentences(text))
    else:
        out = "".join(keep).strip()
    return out, bad
