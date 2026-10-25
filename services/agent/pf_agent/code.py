"""プロダクトのコード（GitHub リポジトリ）を読む。IDE はこの API からファイルを取る。

読むだけで、書き込みはしない。公開リポジトリはトークンなしで読める（GitHub の上限は1時間60回）。
非公開リポジトリは環境変数 GITHUB_TOKEN（そのリポジトリを読めるトークン）が要る。
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.github.com"
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
MAX_FILE = 5 * 1024 * 1024
_tree_cache: dict[tuple[str, str], tuple[float, dict]] = {}


class CodeError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _get(path: str, accept: str = "application/vnd.github+json") -> tuple[bytes, dict]:
    headers = {"Accept": accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "product-factory"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['GITHUB_TOKEN']}"
    req = urllib.request.Request(API + path, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read(MAX_FILE + 1), dict(r.headers)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise CodeError(404, "リポジトリかファイルが見つかりません（非公開なら GITHUB_TOKEN が要ります）") from None
        if e.code in (401, 403):
            raise CodeError(403, "GitHub に読む権限がありません（トークンか上限を確認してください）") from None
        raise CodeError(502, f"GitHub の応答が {e.code} でした") from None
    except urllib.error.URLError as e:
        raise CodeError(502, f"GitHub に接続できません（{e.reason}）") from None


def check_repo(repo: str) -> dict:
    if not REPO_RE.match(repo):
        raise CodeError(422, "リポジトリは owner/name の形で書いてください")
    body, _ = _get(f"/repos/{repo}")
    info = json.loads(body)
    return {"full_name": info["full_name"], "default_branch": info.get("default_branch") or "main",
            "private": info.get("private", False), "html_url": info.get("html_url")}


def tree(repo: str, branch: str) -> dict:
    """ファイルの一覧。30秒だけ覚えておく（IDE を開くたびに GitHub を叩かない）。"""
    key = (repo, branch)
    hit = _tree_cache.get(key)
    if hit and time.time() - hit[0] < 30:
        return hit[1]
    body, _ = _get(f"/repos/{repo}/git/trees/{urllib.parse.quote(branch, safe='')}?recursive=1")
    data = json.loads(body)
    out = {"sha": data.get("sha"), "truncated": data.get("truncated", False),
           "entries": [{"path": e["path"], "type": "dir" if e["type"] == "tree" else "file", "size": e.get("size", 0)}
                       for e in data.get("tree", []) if e["type"] in ("tree", "blob")]}
    _tree_cache[key] = (time.time(), out)
    return out


def read_file(repo: str, branch: str, path: str) -> bytes:
    if not path or path.startswith("/") or ".." in path.split("/"):
        raise CodeError(422, "パスが正しくありません")
    body, _ = _get(f"/repos/{repo}/contents/{urllib.parse.quote(path)}?ref={urllib.parse.quote(branch, safe='')}",
                   accept="application/vnd.github.raw+json")
    if len(body) > MAX_FILE:
        raise CodeError(413, "ファイルが大きすぎます（5MB まで）")
    return body
