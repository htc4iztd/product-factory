"""チケットと GitHub Issues の同期（GitHub は呼ばず、手元の偽物で確かめる）。"""
import datetime as dt
import importlib
import itertools
import re

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
HOOK = {"x-pf-internal-token": "t"}
MEMBER = {**H, "x-pf-user": "m@example.com", "x-pf-role": "MEMBER"}


class FakeGitHub:
    """Issues とコメントだけを持つ偽の GitHub。updated_at は呼ぶたびに進める。"""

    def __init__(self):
        self.issues: dict[int, dict] = {}
        self.comments: dict[int, list[dict]] = {}
        self.clock = itertools.count(1)
        self.start = dt.datetime.now(dt.UTC) + dt.timedelta(minutes=1)
        self.ids = itertools.count(1000)
        self.calls: list[tuple[str, str]] = []
        self.tokens: list[str | None] = []

    def ts(self):
        # 実際の時刻より後に進める（固定の日付だと、その日を過ぎると「前回より新しい」にならない）
        t = self.start + dt.timedelta(seconds=next(self.clock))
        return t.strftime("%Y-%m-%dT%H:%M:%SZ")

    def issue(self, n, **kw):
        i = self.issues[n]
        i.update(kw, updated_at=self.ts())
        i["comments"] = len(self.comments.get(n, []))
        return dict(i)

    def call(self, method, path, token, body=None):
        self.calls.append((method, path))
        self.tokens.append(token)
        if path == "/user":
            return {"login": "octo"}
        if m := re.fullmatch(r"/repos/acme/app/issues", path):
            n = len(self.issues) + 1
            self.issues[n] = {"number": n, "title": body["title"], "body": body.get("body", ""), "state": "open",
                              "state_reason": None, "html_url": f"https://github.com/acme/app/issues/{n}",
                              "user": {"login": "pf-bot"}, "labels": body.get("labels", [])}
            self.comments[n] = []
            return self.issue(n)
        if m := re.fullmatch(r"/repos/acme/app/issues/(\d+)", path):
            keep = ("title", "body", "state", "state_reason")
            return self.issue(int(m.group(1)), **{k: v for k, v in body.items() if k in keep})
        if m := re.fullmatch(r"/repos/acme/app/issues/(\d+)/comments", path):
            n = int(m.group(1))
            c = {"id": next(self.ids), "body": body["body"], "user": {"login": "pf-bot"},
                 "html_url": f"https://github.com/acme/app/issues/{n}#c", "updated_at": self.ts()}
            self.comments[n].append(c)
            self.issue(n)
            return c
        if m := re.fullmatch(r"/repos/acme/app/issues\?(.*)", path):
            since = dict(p.split("=") for p in m.group(1).split("&")).get("since", "")
            found = [dict(i) for i in self.issues.values() if i["updated_at"] > since]
            return sorted(found, key=lambda i: i["updated_at"])
        if m := re.fullmatch(r"/repos/acme/app/issues/(\d+)/comments\?(.*)", path):
            since = dict(p.split("=") for p in m.group(2).split("&")).get("since", "")
            return [c for c in self.comments[int(m.group(1))] if c["updated_at"] > since]
        raise AssertionError(f"unexpected {method} {path}")

    # GitHub 側の人の操作
    def human_close(self, n):
        self.issue(n, state="closed", state_reason="completed")

    def human_comment(self, n, text, login="alice"):
        self.comments[n].append({"id": next(self.ids), "body": text, "user": {"login": login},
                                 "html_url": f"https://github.com/acme/app/issues/{n}#x", "updated_at": self.ts()})
        self.issue(n)

    def human_new(self, title, body=""):
        n = len(self.issues) + 1
        self.issues[n] = {"number": n, "title": title, "body": body, "state": "open", "state_reason": None,
                          "html_url": f"https://github.com/acme/app/issues/{n}", "user": {"login": "bob"}}
        self.comments[n] = []
        return self.issue(n)


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/f.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    monkeypatch.setenv("PF_WEB_URL", "https://pf.example")
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    from pf_agent import api, code, db
    importlib.reload(db)
    importlib.reload(api)
    gh = FakeGitHub()
    monkeypatch.setattr(code, "call", gh.call)
    monkeypatch.setattr(code, "check_repo",
                        lambda repo, token=None: {"full_name": "acme/app", "default_branch": "main"})
    with TestClient(api.app) as c:
        pid = c.post("/products", headers=H, json={"name": "x", "idea": "y"}).json()["id"]
        c.put(f"/products/{pid}/repo", headers=H, json={"repo": "acme/app"})
        yield c, gh, pid


def test_token_is_per_tenant_and_encrypted(env):
    c, gh, pid = env
    assert c.get("/settings/github", headers=H).json()["source"] == "none"
    assert c.put("/settings/github", headers=MEMBER, json={"token": "x"}).status_code == 403
    r = c.put("/settings/github", headers=H, json={"token": "github_pat_secret_9876"}).json()
    assert r == {"source": "tenant", "hint": "9876", "can_edit": True}
    from pf_agent.db import TenantSecret, session
    with session() as s:
        assert "secret" not in s.get(TenantSecret, ("tenant-a", "github_token")).value_enc
    assert c.post("/settings/github/test", headers=H).json() == {"ok": True, "login": "octo", "source": "tenant"}
    assert gh.tokens[-1] == "github_pat_secret_9876"


def test_build_scope_push_and_pull(env):
    c, gh, pid = env
    base = f"/products/{pid}"
    c.put("/settings/github", headers=H, json={"token": "tok"})
    assert c.put(base + "/github", headers=MEMBER, json={"sync": "build"}).status_code == 403
    st = c.put(base + "/github", headers=H, json={"sync": "build", "import_new": True}).json()
    assert st["sync"] == "build" and st["synced_at"]
    # ⑫ のチケットだけ Issue になる
    t1 = c.post(base + "/tickets", headers=H,
                json={"title": "ログイン画面", "stage_id": "s12", "body": "US-01 を作る"}).json()
    t2 = c.post(base + "/tickets", headers=H, json={"title": "市場調査", "stage_id": "s02"}).json()
    assert t1["external"]["github"]["number"] == 1 and "github" not in (t2["external"] or {})
    issue = gh.issues[1]
    assert issue["title"] == "[TK-1] ログイン画面" and "pf:ticket=" in issue["body"]
    assert "https://pf.example/p/" in issue["body"] and issue["labels"] == ["product-factory", "P2"]
    # PF で完了 → Issue を閉じる。コメントも Issue に出る
    c.patch(base + "/tickets/1", headers=H, json={"status": "done"})
    assert gh.issues[1]["state"] == "closed" and gh.issues[1]["state_reason"] == "completed"
    c.post(base + "/tickets/1/comments", headers=H, json={"body": "直しました"})
    assert "直しました" in gh.comments[1][-1]["body"] and "pf:post=" in gh.comments[1][-1]["body"]
    # 自分の変更は取り込み直さない
    r = c.post(base + "/github/sync", headers=H).json()
    assert r["updated"] == 0 and r["comments"] == 0
    # GitHub で開き直し・題名変更・コメント → PF に戻る
    gh.issue(1, state="open", title="[TK-1] ログイン画面（SSO 対応）")
    gh.human_comment(1, "SSO も要ります DEC-1")
    r = c.post(base + "/github/sync", headers=H).json()
    assert r["updated"] == 1 and r["comments"] == 1
    t = c.get(base + "/tickets/1", headers=H).json()
    assert t["status"] == "todo" and t["title"] == "ログイン画面（SSO 対応）"
    assert t["comments"][-1]["author"] == "github:alice" and t["comments"][-1]["refs"] == ["DEC-1"]
    # GitHub で作られた Issue は「仕分け待ち」のチケットになる
    gh.human_new("決済が落ちる", "再現手順…")
    r = c.post(base + "/github/sync", headers=H).json()
    assert r["created"] == 1
    new = [x for x in c.get(base + "/tickets", headers=H).json() if x["title"] == "決済が落ちる"][0]
    assert new["status"] == "triage" and new["external"]["github"]["number"] == 2
    # 取り込んだ Issue を GitHub で閉じる → 完了
    gh.human_close(2)
    c.post(base + "/github/sync", headers=H)
    assert c.get(base + f"/tickets/{new['number']}", headers=H).json()["status"] == "done"


def test_manual_push_and_webhook(env):
    c, gh, pid = env
    base = f"/products/{pid}"
    c.post(base + "/tickets", headers=H, json={"title": "範囲外のチケット"})
    assert not gh.issues   # 同期は off
    r = c.post(base + "/tickets/1/github", headers=H).json()
    assert r["github"]["number"] == 1
    # 一度起票したチケットは、以後の変更も反映する
    c.patch(base + "/tickets/1", headers=H, json={"title": "題名を変えた"})
    assert gh.issues[1]["title"] == "[TK-1] 題名を変えた"
    # off のプロダクトは webhook でも取り込まない。all にすると取り込む
    w = c.post("/github/webhook", headers=HOOK, json={"event": "issues", "repo": "acme/app"}).json()
    assert w["pulled"] == []
    c.put(base + "/github", headers=H, json={"sync": "all"})
    gh.human_close(1)
    w = c.post("/github/webhook", headers=HOOK, json={"event": "issues", "repo": "acme/app"}).json()
    assert w["pulled"][0]["updated"] == 1
    assert c.get(base + "/tickets/1", headers=H).json()["status"] == "done"
    bad = c.post("/github/webhook", headers={"x-pf-internal-token": "bad"}, json={"event": "issues", "repo": "a/b"})
    assert bad.status_code == 401
