"""プロダクトのコード（GitHub リポジトリ）を読む。IDE はこの API からファイルを取る。

IDE のための読み取りと、Issues 連携（ghsync）のための呼び出し口。公開リポジトリはトークンなしで読める
（GitHub の上限は1時間60回）。トークンは、テナントが設定画面で入れたもの、なければ環境変数 GITHUB_TOKEN。
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("PF_GITHUB_API", "https://api.github.com")  # テストでは手元の偽物に向ける
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
MAX_FILE = 5 * 1024 * 1024
_tree_cache: dict[tuple[str, str], tuple[float, dict]] = {}


class CodeError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _send(method: str, path: str, token: str | None, accept: str, body: dict | None) -> tuple[bytes, dict]:
    headers = {"Accept": accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "product-factory"}
    token = token or os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read(MAX_FILE + 1), dict(r.headers)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise CodeError(404, "リポジトリかファイルが見つかりません（非公開ならトークンが要ります）") from None
        if e.code in (401, 403):
            what = "読む" if method == "GET" else "書き込む"
            raise CodeError(403, f"GitHub に{what}権限がありません（トークンの権限か上限を確認してください）") from None
        if e.code == 422:
            detail = e.read().decode("utf-8", "replace")[:200]
            raise CodeError(422, f"GitHub が受け付けませんでした：{detail}") from None
        raise CodeError(502, f"GitHub の応答が {e.code} でした") from None
    except urllib.error.URLError as e:
        raise CodeError(502, f"GitHub に接続できません（{e.reason}）") from None


def _get(path: str, accept: str = "application/vnd.github+json", token: str | None = None) -> tuple[bytes, dict]:
    return _send("GET", path, token, accept, None)


def call(method: str, path: str, token: str | None, body: dict | None = None):
    """JSON の API を呼んで、JSON で返す（Issues 連携用）。"""
    if method == "GET":
        raw, _ = _get(path, token=token)
    else:
        raw, _ = _send(method, path, token, "application/vnd.github+json", body)
    return json.loads(raw) if raw else None


def check_repo(repo: str, token: str | None = None) -> dict:
    if not REPO_RE.match(repo):
        raise CodeError(422, "リポジトリは owner/name の形で書いてください")
    body, _ = _get(f"/repos/{repo}", token=token)
    info = json.loads(body)
    return {"full_name": info["full_name"], "default_branch": info.get("default_branch") or "main",
            "private": info.get("private", False), "html_url": info.get("html_url")}


def tree(repo: str, branch: str, token: str | None = None) -> dict:
    """ファイルの一覧。30秒だけ覚えておく（IDE を開くたびに GitHub を叩かない）。"""
    key = (repo, branch)
    hit = _tree_cache.get(key)
    if hit and time.time() - hit[0] < 30:
        return hit[1]
    body, _ = _get(f"/repos/{repo}/git/trees/{urllib.parse.quote(branch, safe='')}?recursive=1", token=token)
    data = json.loads(body)
    out = {"sha": data.get("sha"), "truncated": data.get("truncated", False),
           "entries": [{"path": e["path"], "type": "dir" if e["type"] == "tree" else "file", "size": e.get("size", 0)}
                       for e in data.get("tree", []) if e["type"] in ("tree", "blob")]}
    _tree_cache[key] = (time.time(), out)
    return out


def read_file(repo: str, branch: str, path: str, token: str | None = None) -> bytes:
    if not path or path.startswith("/") or ".." in path.split("/"):
        raise CodeError(422, "パスが正しくありません")
    body, _ = _get(f"/repos/{repo}/contents/{urllib.parse.quote(path)}?ref={urllib.parse.quote(branch, safe='')}",
                   accept="application/vnd.github.raw+json", token=token)
    if len(body) > MAX_FILE:
        raise CodeError(413, "ファイルが大きすぎます（5MB まで）")
    return body
