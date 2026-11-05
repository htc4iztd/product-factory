"""開発の作業場：エージェントが書くコードの原本をファクトリーの中に持ち、変更の記録と差分を残す。
GitHub をつなぐと写す（作業場 → GitHub の一方向）。GitHub 側に作業場にない変更があれば止め、取り込んでから送り直す。"""

import importlib
import time

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/t.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    monkeypatch.delenv("K_SERVICE", raising=False)
    from pf_agent import api, db

    importlib.reload(db)
    importlib.reload(api)
    with TestClient(api.app) as c:
        yield c


def wait_idle(c, pid):
    for _ in range(300):
        js = c.get(f"/jobs?product={pid}", headers=H).json()
        rows = js if isinstance(js, list) else js.get("runs", js.get("items", []))
        if not any(r["status"] in ("queued", "running") for r in rows):
            return
        time.sleep(0.1)
    raise AssertionError("jobs still running")


def make(c):
    pid = c.post("/products", headers=H, json={"name": "作業場", "idea": "家計簿"}).json()["id"]
    wait_idle(c, pid)
    return pid


def test_commit_diff_and_tree(client):
    from pf_agent import workspace as ws

    pid = make(client)
    c1 = ws.commit(pid, "⑫コーディング担当", "最初の画面", [{"path": "src/app.py", "content": "print('a')\n"},
                                                    {"path": "./README.md", "content": "# x\n"}], unit="UN-01")
    assert c1["number"] == 1 and {f["path"] for f in c1["files"]} == {"src/app.py", "README.md"}
    assert ws.commit(pid, "x", "同じ中身", [{"path": "src/app.py", "content": "print('a')\n"}]) is None
    c2 = ws.commit(pid, "⑫コーディング担当", "直した", [{"path": "src/app.py", "content": "print('b')\n"}],
                   deletes=["README.md"], unit="UN-01")
    full = ws.get_commit(pid, c2["number"])
    assert "-print('a')" in full["patch"] and "+print('b')" in full["patch"] and "--- a/README.md" in full["patch"]
    assert [f["op"] for f in full["files"]] == ["modify", "delete"]
    t = ws.tree(pid)
    assert {e["path"] for e in t["entries"]} == {"src", "src/app.py"} and ws.read(pid, "src/app.py") == "print('b')\n"
    for bad in ("../x", "/etc/passwd", ".git/config", "a//b", "x/"):
        with pytest.raises(ws.WorkspaceError):
            ws.commit(pid, "x", "y", [{"path": bad, "content": "z"}])
    with pytest.raises(ws.WorkspaceError):
        ws.commit(pid, "x", "y", [{"path": "big.txt", "content": "a" * (ws.MAX_FILE + 1)}])
    # IDE が読む API も作業場を読む
    tree = client.get(f"/products/{pid}/code/tree", headers=H).json()
    assert tree["source"] == "workspace"
    assert client.get(f"/products/{pid}/code/file?path=src/app.py", headers=H).content == b"print('b')\n"
    v = client.get(f"/products/{pid}/workspace", headers=H).json()
    assert v["files"] == 1 and [x["number"] for x in v["commits"]] == [2, 1] and v["sync"]["status"] == "off"
    assert client.get(f"/products/{pid}/workspace/commits/2", headers=H).json()["patch"]


def order(pid, subject):
    """実装PM から⑫の担当に Issue を出す（工程の担当は Issue を受けて動く）。"""
    from pf_agent import db, issues

    with db.session() as s:
        p = s.get(db.Product, pid)
        s.expunge(p)
    issues.create(p, "pm_impl", "s12", subject, "⑨のユニット分割に沿って作る")


def test_coding_agent_writes_code(client):
    """⑫の担当は、⑨のユニット分割に沿って、まだ作っていないユニットのコードを作業場に書く（変更の記録が残る）。"""
    from pf_agent import repo
    from pf_agent import workspace as ws

    c = client
    pid = make(c)
    repo.set_field(pid, "s09", "units", [{"id": "UN-01", "name": "締め処理", "scope": "PR-01"},
                                         {"id": "UN-02", "name": "レシート読み取り", "scope": "PR-02"}],
                   "owner@example.com", "human")
    order(pid, "UN-01 を作る")
    c.post(f"/products/{pid}/team/run", headers=H, json={"keys": ["s12"]})
    wait_idle(c, pid)
    v = c.get(f"/products/{pid}/workspace", headers=H).json()
    first = [x for x in v["commits"] if x["unit"] == "UN-01"]
    assert first and first[0]["author"] == "⑫コーディング担当" and v["files"] >= 2
    assert "UN-01" in ws.read(pid, "README.md")
    units = {u["id"]: u["commits"] for u in v["units"]}
    assert units["UN-01"] >= 1
    order(pid, "UN-02 を作る")
    c.post(f"/products/{pid}/team/run", headers=H, json={"keys": ["s12"]})
    wait_idle(c, pid)
    units = {u["id"]: u["commits"] for u in c.get(f"/products/{pid}/workspace", headers=H).json()["units"]}
    assert units["UN-02"] >= 1


class FakeGitHub:
    """GitHub の Git Data API のまね（ブランチの先頭・コミット・ツリー）。"""

    def __init__(self):
        self.commits = {}  # sha -> {"tree": {path: content}, "parents": [...]}
        self.head = ""
        self.n = 0

    def _sha(self):
        self.n += 1
        return f"{self.n:040x}"

    def human_commit(self, files):
        tree = dict(self.commits[self.head]["tree"]) if self.head else {}
        tree.update(files)
        sha = self._sha()
        self.commits[sha] = {"tree": tree, "parents": [self.head] if self.head else []}
        self.head = sha

    def call(self, method, path, token, body=None):
        from pf_agent import code

        if method == "GET" and "/git/ref/heads/" in path:
            if not self.head:
                raise code.CodeError(404, "空")
            return {"object": {"sha": self.head}}
        if method == "PUT" and "/contents/" in path:
            import base64

            self.human_commit({path.split("/contents/")[1]: base64.b64decode(body["content"]).decode()})
            return {}
        if method == "GET" and "/git/commits/" in path:
            sha = path.rsplit("/", 1)[1]
            return {"tree": {"sha": "t:" + sha}}
        if method == "POST" and path.endswith("/git/trees"):
            base = dict(self.commits[body["base_tree"][2:]]["tree"])
            for e in body["tree"]:
                if e.get("content") is None and "sha" in e:
                    base.pop(e["path"], None)
                else:
                    base[e["path"]] = e["content"]
            key = self._sha()
            self.commits["tree:" + key] = {"tree": base}
            return {"sha": "tree:" + key}
        if method == "POST" and path.endswith("/git/commits"):
            sha = self._sha()
            self.commits[sha] = {"tree": self.commits[body["tree"]]["tree"], "parents": body["parents"]}
            return {"sha": sha}
        if method == "PATCH" and "/git/refs/heads/" in path:
            assert self.commits[body["sha"]]["parents"] == [self.head]  # 早送りだけ（上書きしない）
            self.head = body["sha"]
            return {}
        raise AssertionError((method, path))

    def tree(self, repo, branch, token=None):
        t = self.commits[self.head]["tree"] if self.head else {}
        return {"entries": [{"path": p, "type": "file", "size": len(v)} for p, v in t.items()]}

    def read_file(self, repo, branch, path, token=None):
        return self.commits[self.head]["tree"][path].encode()


def test_github_copy_diverge_and_import(client, monkeypatch):
    from pf_agent import code, db
    from pf_agent import workspace as ws

    pid = make(client)
    gh = FakeGitHub()
    monkeypatch.setattr(code, "call", gh.call)
    monkeypatch.setattr(code, "tree", gh.tree)
    monkeypatch.setattr(code, "read_file", gh.read_file)
    monkeypatch.setattr(ws, "push_later", lambda pid: None)  # 裏で送らない（試験では順に呼ぶ）
    ws.commit(pid, "⑫", "最初", [{"path": "src/a.py", "content": "a\n"}, {"path": "README.md", "content": "# r\n"}])
    with db.session() as s:
        p = s.get(db.Product, pid)
        p.repo, p.repo_branch = "acme/kakeibo", "main"
        s.commit()
    # 空のリポジトリに、作業場をはじめて写す
    st = ws.push(pid)
    assert st["status"] == "ok" and st["unpushed"] == 0
    assert gh.commits[gh.head]["tree"] == {"src/a.py": "a\n", "README.md": "# r\n"}
    # 作業場を続けて更新 → 送る（消したファイルは GitHub からも消える）
    ws.commit(pid, "⑫", "直した", [{"path": "src/a.py", "content": "b\n"}], deletes=["README.md"])
    assert ws.sync_state(pid)["unpushed"] == 1
    ws.push(pid)
    assert gh.commits[gh.head]["tree"] == {"src/a.py": "b\n"}
    # 人が GitHub で直接コミット → 作業場から送ると止まる（上書きしない）
    gh.human_commit({"docs/note.md": "人が書いた\n"})
    ws.commit(pid, "⑫", "さらに", [{"path": "src/b.py", "content": "c\n"}])
    st = ws.push(pid)
    assert st["status"] == "diverged" and "docs/note.md" not in {e["path"] for e in ws.tree(pid)["entries"]}
    # 取り込む → 作業場に GitHub の変更が入り、作業場の変更は送られる
    r = ws.import_remote(pid, "owner@example.com")
    assert r["commit"]["source"] == "github" and ws.read(pid, "docs/note.md") == "人が書いた\n"
    st = ws.push(pid)
    assert st["status"] == "ok" and st["unpushed"] == 0
    assert gh.commits[gh.head]["tree"] == {"src/a.py": "b\n", "src/b.py": "c\n", "docs/note.md": "人が書いた\n"}
    # 作業場は GitHub につないだあとも、原本として読める
    assert ws.read(pid, "src/b.py") == "c\n"
