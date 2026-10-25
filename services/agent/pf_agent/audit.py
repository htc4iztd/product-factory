"""Markdown の見出しごとの本文を取り出す（文章だけで作っていた頃の版を下書きに移すときに使う）。

更新前の検査は frameworks.check が項目単位で行う。
"""
from __future__ import annotations

import re


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
