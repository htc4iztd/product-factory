"""事前監査（設計書 8.1）。決定的に判定できるものだけをここで行う。"""
from __future__ import annotations

import re

from .stages import Stage


def sections(markdown: str) -> dict[str, str]:
    """'## 見出し' ごとの本文を返す。"""
    out: dict[str, str] = {}
    cur = None
    buf: list[str] = []
    for line in markdown.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            if cur is not None:
                out[cur] = "\n".join(buf).strip()
            cur, buf = m.group(1), []
        elif cur is not None:
            buf.append(line)
    if cur is not None:
        out[cur] = "\n".join(buf).strip()
    return out


def check(stage: Stage, markdown: str) -> list[str]:
    """不合格の理由を返す。空なら合格。"""
    findings: list[str] = []
    if not markdown.strip():
        return ["成果物が空です"]
    secs = sections(markdown)
    for h in stage.sections:
        if h not in secs:
            findings.append(f"必須の見出し「{h}」がありません")
        elif not secs[h]:
            findings.append(f"見出し「{h}」の本文が空です")
    return findings
