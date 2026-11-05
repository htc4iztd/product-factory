"""開発の作業場：エージェント（⑫コーディング）が書くコードの原本を、ファクトリーの中に持つ。

- 書くたびに変更の記録（WorkspaceCommit：誰が・どのユニットで・何を変えたか・差分）を残す。
- GitHub のリポジトリをつなぐと、作業場のコードを GitHub に写す（作業場 → GitHub の一方向）。つないだあとも作業場は
  更新を続ける（GitHub に届かないときの控え・エージェントが GitHub を見に行かずに読むため）。
- GitHub 側に作業場にない変更（人が直接コミットしたなど）があれば、上書きせずに止め（diverged）、
  「GitHub の変更を取り込む」で作業場に入れてから送り直す。
"""
from __future__ import annotations

import datetime as dt
import difflib
import hashlib
import re
import threading

from sqlalchemy import func, select

from .db import Product, WorkspaceCommit, WorkspaceFile, WorkspaceSync, session

MAX_FILE = 512 * 1024        # 1つのファイルの大きさ
MAX_FILES = 2000             # 作業場のファイル数
MAX_PATCH = 200_000          # 1つの記録に残す差分の長さ
PATH_RE = re.compile(r"^[A-Za-z0-9._\-][A-Za-z0-9._\-/ ]*$")


class WorkspaceError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _sha(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def clean_path(path: str) -> str:
    p = (path or "").strip().replace("\\", "/")
    while p.startswith("./"):
        p = p[2:]
    if not p or p.startswith("/") or len(p) > 400 or ".." in p.split("/") or "//" in p or p.endswith("/"):
        raise WorkspaceError(422, f"パスが正しくありません：{path[:80]}")
    if not PATH_RE.match(p) or p.split("/")[0] in (".git",):
        raise WorkspaceError(422, f"使えない文字か場所です：{path[:80]}")
    return p


# ---------------- 読む ----------------
def tree(product_id: str) -> dict:
    """ファイルの一覧（IDE と同じ形：entries に dir と file）。"""
    with session() as s:
        rows = s.execute(select(WorkspaceFile.path, WorkspaceFile.size, WorkspaceFile.sha)
                         .where(WorkspaceFile.product_id == product_id).order_by(WorkspaceFile.path)).all()
    dirs = sorted({"/".join(p.split("/")[:i]) for p, _, _ in rows for i in range(1, p.count("/") + 1)})
    entries = [{"path": d, "type": "dir", "size": 0} for d in dirs]
    entries += [{"path": p, "type": "file", "size": n, "sha": h} for p, n, h in rows]
    return {"sha": None, "truncated": False, "entries": entries, "source": "workspace"}


def count(product_id: str) -> int:
    with session() as s:
        return s.execute(select(func.count()).select_from(WorkspaceFile)
                         .where(WorkspaceFile.product_id == product_id)).scalar_one()


def read(product_id: str, path: str) -> str:
    p = clean_path(path)
    with session() as s:
        f = s.execute(select(WorkspaceFile).where(WorkspaceFile.product_id == product_id,
                                                  WorkspaceFile.path == p)).scalar_one_or_none()
        if f is None:
            raise WorkspaceError(404, f"ファイル {p} はありません")
        return f.content


# ---------------- 書く ----------------
def _diff(path: str, old: str | None, new: str | None) -> tuple[str, int, int]:
    a = (old or "").splitlines(keepends=True)
    b = (new or "").splitlines(keepends=True)
    lines = list(difflib.unified_diff(a, b, fromfile=f"a/{path}" if old is not None else "/dev/null",
                                      tofile=f"b/{path}" if new is not None else "/dev/null", n=3))
    plus = sum(1 for x in lines if x.startswith("+") and not x.startswith("+++"))
    minus = sum(1 for x in lines if x.startswith("-") and not x.startswith("---"))
    text = "".join(x if x.endswith("\n") else x + "\n\\ No newline at end of file\n" for x in lines)
    return text, plus, minus


def commit(product_id: str, author: str, message: str, files: list[dict], deletes: list[str] | None = None,
           unit: str = "", source: str = "agent", push: bool = True) -> dict | None:
    """作業場に書き込み、変更の記録を残す。中身が変わらなければ記録しない（None）。"""
    writes = {}
    for f in files or []:
        content = str(f.get("content") or "")
        if len(content.encode("utf-8")) > MAX_FILE:
            raise WorkspaceError(413, f"ファイル {f.get('path')} が大きすぎます（512KB まで）")
        writes[clean_path(str(f.get("path") or ""))] = content
    gone = [clean_path(p) for p in deletes or [] if p]
    changed, patches = [], []
    with session() as s:
        cur = {f.path: f for f in s.execute(select(WorkspaceFile).where(
            WorkspaceFile.product_id == product_id, WorkspaceFile.path.in_(list(writes) + gone))).scalars()}
        total = s.execute(select(func.count()).select_from(WorkspaceFile)
                          .where(WorkspaceFile.product_id == product_id)).scalar_one()
        added = sum(1 for p in writes if p not in cur)
        if total + added > MAX_FILES:
            raise WorkspaceError(422, f"作業場のファイルは {MAX_FILES} 個までです")
        for p, content in writes.items():
            old = cur.get(p)
            if old is not None and old.content == content:
                continue
            text, plus, minus = _diff(p, old.content if old else None, content)
            patches.append(text)
            changed.append({"path": p, "op": "modify" if old else "add", "lines": [plus, minus]})
            if old is None:
                s.add(WorkspaceFile(product_id=product_id, path=p, content=content, sha=_sha(content),
                                    size=len(content.encode("utf-8")), updated_by=author[:200], updated_at=_now()))
            else:
                old.content, old.sha, old.size = content, _sha(content), len(content.encode("utf-8"))
                old.updated_by, old.updated_at = author[:200], _now()
        for p in gone:
            old = cur.get(p)
            if old is None:
                continue
            text, plus, minus = _diff(p, old.content, None)
            patches.append(text)
            changed.append({"path": p, "op": "delete", "lines": [plus, minus]})
            s.delete(old)
        if not changed:
            s.rollback()
            return None
        n = (s.execute(select(func.max(WorkspaceCommit.number)).where(
            WorkspaceCommit.product_id == product_id)).scalar() or 0) + 1
        patch = "".join(patches)
        c = WorkspaceCommit(product_id=product_id, number=n, author=author[:200], unit=(unit or "")[:40],
                            message=(message or "（説明なし）")[:2000], files=changed,
                            patch=patch[:MAX_PATCH] + ("\n…（長いので省きました）\n" if len(patch) > MAX_PATCH else ""),
                            source=source)
        s.add(c)
        s.commit()
        out = commit_dict(c)
    if push:
        push_later(product_id)
    return out


def commit_dict(c: WorkspaceCommit, patch: bool = False) -> dict:
    d = {"number": c.number, "author": c.author, "unit": c.unit, "message": c.message, "files": c.files or [],
         "source": c.source, "github_sha": c.github_sha, "at": c.created_at.isoformat() if c.created_at else None}
    if patch:
        d["patch"] = c.patch
    return d


def history(product_id: str, limit: int = 100) -> list[dict]:
    with session() as s:
        rows = s.execute(select(WorkspaceCommit).where(WorkspaceCommit.product_id == product_id)
                         .order_by(WorkspaceCommit.number.desc()).limit(limit)).scalars().all()
        return [commit_dict(c) for c in rows]


def get_commit(product_id: str, number: int) -> dict:
    with session() as s:
        c = s.execute(select(WorkspaceCommit).where(WorkspaceCommit.product_id == product_id,
                                                    WorkspaceCommit.number == number)).scalar_one_or_none()
        if c is None:
            raise WorkspaceError(404, f"変更の記録 #{number} はありません")
        return commit_dict(c, patch=True)


def units(product_id: str) -> list[dict]:
    """⑨のユニット分割と、ユニットごとの変更の記録（どこまで作ったか）。"""
    from . import repo

    rows = [r for r in repo.draft(product_id, "s09").get("units") or [] if isinstance(r, dict) and r.get("id")]
    with session() as s:
        cs = s.execute(select(WorkspaceCommit.unit, func.count(), func.max(WorkspaceCommit.number))
                       .where(WorkspaceCommit.product_id == product_id).group_by(WorkspaceCommit.unit)).all()
    by = {u: (n, last) for u, n, last in cs}
    out = [{"id": str(r["id"]), "name": str(r.get("name") or ""), "scope": str(r.get("scope") or ""),
            "done_when": str(r.get("done") or ""), "commits": by.get(str(r["id"]), (0, None))[0],
            "last": by.get(str(r["id"]), (0, None))[1]} for r in rows]
    known = {u["id"] for u in out}
    out += [{"id": u or "", "name": "（ユニットなし）" if not u else "（⑨にないユニット）", "scope": "",
             "done_when": "",
             "commits": n, "last": last} for u, (n, last) in by.items() if u not in known]
    return out


# ---------------- GitHub への写し ----------------
def sync_state(product_id: str) -> dict:
    with session() as s:
        st = s.get(WorkspaceSync, product_id)
        unpushed = s.execute(select(func.count()).select_from(WorkspaceCommit).where(
            WorkspaceCommit.product_id == product_id, WorkspaceCommit.github_sha.is_(None))).scalar_one()
        if st is None:
            return {"status": "off", "repo": "", "branch": "", "remote_sha": "", "error": "", "at": None,
                    "unpushed": unpushed}
        return {"status": st.status, "repo": st.repo, "branch": st.branch, "remote_sha": st.remote_sha,
                "error": st.error, "at": st.at.isoformat() if st.at else None, "unpushed": unpushed}


def _set_state(product_id: str, **kw) -> None:
    with session() as s:
        st = s.get(WorkspaceSync, product_id) or WorkspaceSync(product_id=product_id)
        for k, v in kw.items():
            setattr(st, k, v)
        st.at = _now()
        s.merge(st)
        s.commit()


def _product(product_id: str) -> Product:
    with session() as s:
        p = s.get(Product, product_id)
        s.expunge(p)
        return p


_locks: dict[str, threading.Lock] = {}


def push_later(product_id: str) -> None:
    """GitHub がつながっていれば、裏で送る（失敗しても作業場はそのまま。状態に残して次の機会に送り直す）。"""
    p = _product(product_id)
    if not p.repo:
        return
    threading.Thread(target=lambda: _safe_push(product_id), daemon=True).start()


def _safe_push(product_id: str) -> None:
    try:
        push(product_id)
    except Exception as e:  # noqa: BLE001  状態に残す（画面で見える）
        _set_state(product_id, status="error", error=str(getattr(e, "message", e))[:500])


def _gh(product: Product):
    from . import code, ghsync

    tok = ghsync.token(product.tenant_id)[0]
    return code, tok


def remote_head(product: Product) -> str:
    """GitHub のブランチの先頭（空のリポジトリなら空）。"""
    code, tok = _gh(product)
    branch = product.repo_branch or "main"
    try:
        ref = code.call("GET", f"/repos/{product.repo}/git/ref/heads/{branch}", tok)
        return (ref or {}).get("object", {}).get("sha", "")
    except code.CodeError as e:
        if e.status in (404, 409, 502):
            return ""
        raise


def push(product_id: str, overwrite: bool = False) -> dict:
    """作業場の、まだ送っていない変更を GitHub に送る。GitHub 側に作業場にない変更があれば止める。
    overwrite：GitHub を作業場の内容そのものにする（GitHub で直接された変更を戻す。
    GitHub は作業場の写しなので、運用では GitHub での直接の変更は禁止）。
    履歴は消さず、作業場の内容に戻すコミットを重ねる（強制プッシュはしない）。"""
    lock = _locks.setdefault(product_id, threading.Lock())
    with lock:
        p = _product(product_id)
        if not p.repo:
            raise WorkspaceError(409, "GitHub のリポジトリがつながっていません")
        code, tok = _gh(p)
        branch = p.repo_branch or "main"
        st = sync_state(product_id)
        head = remote_head(p)
        diverged = bool(st["remote_sha"] and head and head != st["remote_sha"])
        if (diverged or (not st["remote_sha"] and head and st["status"] == "diverged")) and not overwrite:
            _set_state(product_id, repo=p.repo, branch=branch, status="diverged",
                       error="GitHub で直接変更されています（GitHub は作業場の写しです）。"
                             "作業場の内容で上書きするか、GitHub の変更を取り込んでください")
            return sync_state(product_id)
        with session() as s:
            todo = s.execute(select(WorkspaceCommit).where(WorkspaceCommit.product_id == product_id,
                                                           WorkspaceCommit.github_sha.is_(None))
                             .order_by(WorkspaceCommit.number)).scalars().all()
            first = not st["remote_sha"]
            files = {f.path: f.content for f in s.execute(select(WorkspaceFile).where(
                WorkspaceFile.product_id == product_id)).scalars()}
            touched: dict[str, str | None] = {}
            if first or overwrite:  # はじめて写す・上書き：作業場のファイルをすべて
                touched = dict(files)
            for c in todo:
                for f in c.files or []:
                    touched[f["path"]] = files.get(f["path"])
            numbers = [c.number for c in todo]
            if overwrite:
                message = "作業場の内容で上書き（GitHub で直接された変更を戻しました）"
            elif len(todo) > 1:
                message = f"作業場から {len(todo)} 件の変更（#{numbers[0]}〜#{numbers[-1]}）"
            else:
                message = todo[0].message if todo else "ファクトリーの作業場から"
        if not touched:
            _set_state(product_id, repo=p.repo, branch=branch, status="ok", error="", remote_sha=head)
            return sync_state(product_id)
        if not head:  # 空のリポジトリ：最初の1つを Contents API で置いて、ブランチを作る
            import base64

            path0 = next(iter(touched))
            body = {"message": "ファクトリーの作業場から（はじめて）", "branch": branch,
                    "content": base64.b64encode((touched[path0] or "").encode()).decode()}
            code.call("PUT", f"/repos/{p.repo}/contents/{path0}", tok, body)
            head = remote_head(p)
        tree = [{"path": path, "mode": "100644", "type": "blob", **({"content": c} if c is not None else {"sha": None})}
                for path, c in touched.items()]
        base = code.call("GET", f"/repos/{p.repo}/git/commits/{head}", tok)
        # 上書きは、作業場のファイルだけでツリーを作る（GitHub にだけあるファイルは消える）。ふだんは差分だけを重ねる
        body = {"tree": tree} if overwrite else {"base_tree": base["tree"]["sha"], "tree": tree}
        t = code.call("POST", f"/repos/{p.repo}/git/trees", tok, body)
        cm = code.call("POST", f"/repos/{p.repo}/git/commits", tok,
                       {"message": f"{message}\n\nProduct Factory の作業場から送りました", "tree": t["sha"],
                        "parents": [head]})
        code.call("PATCH", f"/repos/{p.repo}/git/refs/heads/{branch}", tok, {"sha": cm["sha"], "force": False})
        with session() as s:
            for c in s.execute(select(WorkspaceCommit).where(WorkspaceCommit.product_id == product_id,
                                                             WorkspaceCommit.number.in_(numbers))).scalars():
                c.github_sha = cm["sha"]
            s.commit()
        _set_state(product_id, repo=p.repo, branch=branch, status="ok", error="", remote_sha=cm["sha"])
        return sync_state(product_id)


def import_remote(product_id: str, user: str) -> dict:
    """GitHub のいまの中身を作業場に取り込む。
    GitHub にだけある変更を作業場に入れる（作業場にだけあるファイルは残す）。"""
    p = _product(product_id)
    if not p.repo:
        raise WorkspaceError(409, "GitHub のリポジトリがつながっていません")
    code, tok = _gh(p)
    branch = p.repo_branch or "main"
    head = remote_head(p)
    files, skipped = [], 0
    if head:
        tr = code.tree(p.repo, branch, token=tok)
        for e in [e for e in tr["entries"] if e["type"] == "file"][:MAX_FILES]:
            if e.get("size", 0) > MAX_FILE:
                skipped += 1
                continue
            try:
                data = code.read_file(p.repo, branch, e["path"], token=tok)
                files.append({"path": e["path"], "content": data.decode("utf-8")})
            except (UnicodeDecodeError, code.CodeError, WorkspaceError):
                skipped += 1
    note = f"（読めないファイル {skipped} 個は外した）" if skipped else ""
    c = commit(product_id, user, f"GitHub（{p.repo}@{branch}）から取り込み{note}",
               [f for f in files if _ok_path(f["path"])], source="github", push=False)
    with session() as s:  # 取り込んだ分は GitHub にあるので、送るものに数えない
        for x in s.execute(select(WorkspaceCommit).where(WorkspaceCommit.product_id == product_id,
                                                         WorkspaceCommit.github_sha.is_(None),
                                                         WorkspaceCommit.source == "github")).scalars():
            x.github_sha = head or None
        s.commit()
    _set_state(product_id, repo=p.repo, branch=branch, status="ok", error="", remote_sha=head)
    out = sync_state(product_id)
    if out["unpushed"]:
        push_later(product_id)
    return {"commit": c, "sync": out, "skipped": skipped}


def _ok_path(path: str) -> bool:
    try:
        clean_path(path)
        return True
    except WorkspaceError:
        return False


def on_link(product_id: str, user: str) -> None:
    """GitHub をつないだ（変えた）とき：作業場が空で GitHub に中身があれば取り込み、そうでなければ作業場を写す。"""
    p = _product(product_id)
    if not p.repo:
        _set_state(product_id, status="off", error="", repo="", branch="", remote_sha="")
        return
    _set_state(product_id, repo=p.repo, branch=p.repo_branch or "main", status="pending", error="", remote_sha="")
    with session() as s:  # つなぎ直したら、作業場の記録はすべて送り直す対象にする
        for c in s.execute(select(WorkspaceCommit).where(WorkspaceCommit.product_id == product_id)).scalars():
            c.github_sha = None
        s.commit()

    def run() -> None:
        try:
            if count(product_id) == 0 and remote_head(p):
                import_remote(product_id, user)
            else:
                push(product_id)
        except Exception as e:  # noqa: BLE001
            _set_state(product_id, status="error", error=str(getattr(e, "message", e))[:500])

    threading.Thread(target=run, daemon=True).start()
