"""エージェントの Issue と GitHub Issues の同期（人が押したときだけ）。GitHub は呼ばず、手元の偽物で確かめる。"""
import importlib
import itertools
import re

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
VIEWER = {**H, "x-pf-role": "VIEWER"}


class FakeGitHub:
    def __init__(self):
        self.issues: dict[int, dict] = {}
        self.comments: dict[int, list[dict]] = {}
        self.ids = itertools.count(1000)
        self.calls: list[tuple[str, str]] = []

    def call(self, method, path, token, body=None):
        self.calls.append((method, path))
        assert token == "tok"
        if path == "/repos/acme/app/issues" and method == "POST":
            n = len(self.issues) + 1
            self.issues[n] = {"number": n, "title": body["title"], "body": body["body"], "state": "open",
                              "state_reason": None, "html_url": f"https://github.com/acme/app/issues/{n}"}
            self.comments[n] = []
            return self._out(n)
        if m := re.fullmatch(r"/repos/acme/app/issues/(\d+)", path):
            n = int(m.group(1))
            if method == "PATCH":
                keep = ("title", "body", "state", "state_reason")
                self.issues[n].update({k: v for k, v in body.items() if k in keep})
            return self._out(n)
        if m := re.fullmatch(r"/repos/acme/app/issues/(\d+)/comments(\?.*)?", path):
            n = int(m.group(1))
            if method == "POST":
                c = {"id": next(self.ids), "body": body["body"], "user": {"login": "pf-bot"}}
                self.comments[n].append(c)
                return c
            return list(self.comments[n])
        raise AssertionError(f"unexpected {method} {path}")

    def _out(self, n):
        return {**self.issues[n], "comments": len(self.comments[n])}

    def human_comment(self, n, text, login="alice"):
        self.comments[n].append({"id": next(self.ids), "body": text, "user": {"login": login}})

    def human_close(self, n):
        self.issues[n].update(state="closed", state_reason="completed")


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/g.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    from pf_agent import api, code, db, issues

    importlib.reload(db)
    importlib.reload(api)
    gh = FakeGitHub()
    monkeypatch.setattr(code, "call", gh.call)
    monkeypatch.setattr(code, "check_repo", lambda repo, token=None: {"full_name": repo, "default_branch": "main"})
    woke = []
    monkeypatch.setattr(issues, "_wake", lambda product, actor, key, reason: woke.append((key, reason)))
    with TestClient(api.app) as c:
        pid = c.post("/products", headers=H, json={"name": "x", "idea": "y"}).json()["id"]
        yield c, gh, pid, woke


def test_sync_only_when_asked(env):
    c, gh, pid, woke = env
    P = f"/products/{pid}"
    body = {"assignee": "pm_biz", "subject": "価格を決める", "description": "案を3つ"}
    n = c.post(P + "/issues", headers=H, json=body).json()["number"]
    # リポジトリもトークンもない → 押しても理由を返す
    assert c.post(P + f"/issues/{n}/github", headers=H).status_code == 409
    c.put(f"{P}/repo", headers=H, json={"repo": "acme/app"})
    r = c.post(P + f"/issues/{n}/github", headers=H)
    assert r.status_code == 409 and "トークン" in r.json()["detail"]
    c.put("/settings/github", headers=H, json={"token": "tok"})
    # 起票・更新しただけでは GitHub を呼ばない（自動では送らない）
    c.put(P + f"/issues/{n}", headers=H, json={"notes": "急ぎで"})
    # （リポジトリをつなぐと、開発の作業場のコードを写すために git の API は呼ぶ。Issue の API は呼ばない）
    assert [x for x in gh.calls if "/git/" not in x[1]] == []
    assert c.post(P + f"/issues/{n}/github", headers=VIEWER).status_code == 403
    # 押すと GitHub に Issue を作り、これまでの記録をコメントで送る
    r = c.post(P + f"/issues/{n}/github", headers=H).json()
    assert r["created"] and r["github_number"] == 1 and r["pushed"] == 1
    assert gh.issues[1]["title"] == "[PF #1] 価格を決める" and "案を3つ" in gh.issues[1]["body"]
    assert "急ぎで" in gh.comments[1][0]["body"]
    i = c.get(P + f"/issues/{n}", headers=H).json()
    assert i["github"]["url"].endswith("/issues/1") and i["github"]["state"] == "open"
    # 2回目は、送っていないものだけ送る
    assert c.post(P + f"/issues/{n}/github", headers=H).json()["pushed"] == 0
    # GitHub でコメントされ、閉じられた → 取り込み、担当を動かす。こちらから二重に送らない
    gh.human_comment(1, "この価格は高い")
    gh.human_close(1)
    r = c.post(P + f"/issues/{n}/github", headers=H).json()
    assert r["pulled"] == 1 and r["state_from"] == "github" and r["pushed"] == 0
    i = c.get(P + f"/issues/{n}", headers=H).json()
    assert i["status"] == "closed"
    names = [j["author_name"] for j in i["journals"]]
    assert "GitHub @alice" in names and "GitHub" in names
    assert any("この価格は高い" in j["notes"] for j in i["journals"])
    assert not [w for w in woke if "GitHub" in w[1]]  # 閉じた Issue は動かさない
    assert len(gh.comments[1]) == 2
    # こちらで開き直した → GitHub も開く
    c.put(P + f"/issues/{n}", headers=H, json={"status": "in_progress", "notes": "やっぱり続ける"})
    r = c.post(P + f"/issues/{n}/github", headers=H).json()
    assert gh.issues[1]["state"] == "open" and r["pushed"] == 1


def test_sync_many(env):
    c, gh, pid, woke = env
    P = f"/products/{pid}"
    c.put(f"{P}/repo", headers=H, json={"repo": "acme/app"})
    c.put("/settings/github", headers=H, json={"token": "tok"})
    a = c.post(P + "/issues", headers=H, json={"assignee": "pm_biz", "subject": "A"}).json()["number"]
    b = c.post(P + "/issues", headers=H, json={"assignee": "pm_impl", "subject": "B"}).json()["number"]
    st = c.get(P + "/github", headers=H).json()
    assert st["linked"] == 0 and st["open_unlinked"] == 2 and st["token"] == "tenant"
    # つないだものがなければ何もしない。開いている Issue をすべて、を選ぶと送る
    assert c.post(P + "/github/sync", headers=H, json={}).json()["done"] == []
    r = c.post(P + "/github/sync", headers=H, json={"include_open": True}).json()
    assert [x["number"] for x in r["done"]] == [a, b] and r["linked"] == 2
    gh.human_comment(2, "見ました", login="bob")
    r = c.post(P + "/github/sync", headers=H, json={}).json()
    assert sum(x["pulled"] for x in r["done"]) == 1
    assert [w for w in woke if "GitHub" in w[1]] == [("pm_impl", f"Issue #{b} に GitHub でコメント")]
