"""ペルソナ・スキル（直結と参照）・ツール：既定はリポジトリ、テナントが画面で変える。
読み込むのは直結するスキルと参照を辿ったものだけ（上限つき）。使えるツールは「割り当て ∩ スキルの宣言 ∩ 役割」。
読むツールは AI が呼び、書くツールは最後の出力に入れてコードが検証してから実行する。"""

import importlib
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
MEMBER = {**H, "x-pf-role": "MEMBER"}
OTHER = {**H, "x-pf-tenant": "tenant-b"}


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
    for _ in range(200):
        js = c.get(f"/jobs?product={pid}", headers=H).json()
        rows = js if isinstance(js, list) else js.get("runs", js.get("items", []))
        if not any(r["status"] in ("queued", "running") for r in rows):
            return
        time.sleep(0.1)
    raise AssertionError("jobs still running")


def agent(cat, key):
    return next(a for a in cat["agents"] if a["key"] == key)


def test_catalog_defaults_and_ux_designer(client):
    cat = client.get("/agent-catalog", headers=H).json()
    assert [a["key"] for a in cat["agents"]][:4] == ["platform", "pm_biz", "pm_design", "pm_impl"]
    assert len(cat["agents"]) == 18
    ux = agent(cat, "s06")
    assert ux["name"] == "⑥UXデザイン担当" and ux["persona"]["title"] == "UXデザイナー"
    assert ux["skills"] == ["issue-work", "ux-design"]
    lo = ux["loadout"]
    assert {"ux-persona-journey", "ux-flow-ia", "acceptance-gherkin", "traceability"} <= set(lo["ref_skills"])
    assert lo["prefetch"] == ["stage_draft", "issues_list"] and "set_field" in lo["writes"] and lo["warnings"] == []
    # 役割で使えるツールが違う（プラットフォームは工程に書けない）
    pf = agent(cat, "platform")["loadout"]
    assert pf["reads"] == ["factory_status", "findings"] and pf["writes"] == ["propose_fix"]
    sk = {s["id"]: s for s in cat["skills"]}
    assert sk["ux-design"]["kind"] == "agent" and sk["ux-design"]["used_by"] == ["s06"]
    assert "issue-work" in sk["writing-ja"]["referenced_by"]
    assert {t["name"] for t in cat["tools"] if t["kind"] == "write"} >= {"set_field", "issue_update", "propose_fix"}


def test_profile_edit_and_tool_grant_limits_writes(client):
    c = client
    # 管理者だけが変えられる。テナントごとに別
    assert c.put("/agent-profiles/s01", headers=MEMBER, json={"persona": {"tone": "x"}}).status_code == 403
    r = c.put("/agent-profiles/s01", headers=H, json={"persona": {"tone": "敬語で丁寧に"}}).json()
    assert r["persona"]["tone"] == "敬語で丁寧に" and r["persona"]["title"] == "アイディエーター"
    assert r["customized"]["persona"] and not r["customized"]["tools"]
    assert agent(c.get("/agent-catalog", headers=OTHER).json(), "s01")["persona"]["tone"] != "敬語で丁寧に"
    # 役割に合わないツール・ないスキルは割り当てられない
    assert c.put("/agent-profiles/s01", headers=H, json={"tools": ["factory_status"]}).status_code == 422
    assert c.put("/agent-profiles/s01", headers=H, json={"skills": ["nope"]}).status_code == 422
    # 書き込みのツールを外すと、スキルが宣言していても使えない（警告が出る）→ 実行しても工程に書き込まない
    tools = [t for t in agent(c.get("/agent-catalog", headers=H).json(), "s01")["tools"] if t != "set_field"]
    c.put("/agent-profiles/s01", headers=H, json={"tools": tools})
    lo = agent(c.get("/agent-catalog", headers=H).json(), "s01")["loadout"]
    assert "set_field" not in lo["writes"] and any("set_field" in w for w in lo["warnings"])
    pid = c.post("/products", headers=H, json={"name": "道具", "idea": "申込の受付"}).json()["id"]
    c.post(f"/products/{pid}/pm/pm_biz/talk", headers=H, json={"text": "①の下書きを作って", "stage_id": "s01"})
    wait_idle(c, pid)
    i = c.get(f"/products/{pid}/issues/1", headers=H).json()
    assert i["status"] in ("resolved", "closed")  # Issue は返す（issue_update は割り当てたまま）
    st = c.get(f"/products/{pid}/stages/s01", headers=H).json()
    assert not any(str(v or "").strip() for v in st["draft"].values() if not isinstance(v, (list, dict)))
    # 既定に戻す
    r = c.put("/agent-profiles/s01", headers=H, json={"reset": True}).json()
    assert r["persona"]["tone"] != "敬語で丁寧に" and "set_field" in r["tools"]


def test_skills_create_override_refs_and_limits(client):
    c = client
    body = {"name": "用語集", "kind": "reference", "body": "締め＝月末の集計", "refs": [], "tools": []}
    assert c.put("/skills/glossary", headers=H, json=body).json()["source"] == "custom"
    ux = {
        "name": "私たちの UX",
        "kind": "agent",
        "body": "用語集の言葉で書く",
        "refs": ["glossary", "ux-flow-ia"],
        "tools": ["stage_draft", "set_field"],
        "prefetch": ["stage_draft"],
    }
    assert c.put("/skills/my-ux", headers=H, json=ux).status_code == 200
    c.put("/agent-profiles/s06", headers=H, json={"skills": ["issue-work", "my-ux"]})
    lo = agent(c.get("/agent-catalog", headers=H).json(), "s06")["loadout"]
    assert lo["agent_skills"] == ["issue-work", "my-ux"] and "glossary" in lo["ref_skills"]
    assert "ux-persona-journey" not in lo["ref_skills"]  # 割り当てていないスキルの参照は読まない
    # 輪になる参照・ないツール・使わない prefetch・ID の形は拒む
    assert c.put("/skills/glossary", headers=H, json={**body, "refs": ["my-ux"]}).status_code == 422
    assert c.get("/agent-catalog", headers=H).json()["skills"]  # 拒んだあとも壊れていない
    assert next(s for s in c.get("/agent-catalog", headers=H).json()["skills"] if s["id"] == "glossary")["refs"] == []
    assert c.put("/skills/x1", headers=H, json={**body, "tools": ["nope"]}).status_code == 422
    assert c.put("/skills/x1", headers=H, json={**body, "prefetch": ["upstream"]}).status_code == 422
    assert c.put("/skills/Bad_ID", headers=H, json=body).status_code == 422
    # 使われているスキルは消せない。標準の上書きは消すと標準に戻る
    assert c.delete("/skills/glossary", headers=H).status_code == 409
    assert (
        c.put("/skills/writing-ja", headers=H, json={**body, "name": "書き方（社内）"}).json()["source"] == "override"
    )
    assert c.delete("/skills/writing-ja", headers=H).status_code == 200
    sk = {s["id"]: s for s in c.get("/agent-catalog", headers=H).json()["skills"]}
    assert sk["writing-ja"]["source"] == "builtin" and sk["writing-ja"]["name"] == "日本語の書き方"
    assert c.delete("/skills/issue-work", headers=H).status_code == 404  # 標準スキルそのものは消せない
    # 参照の深さの上限：a→b→c→d→e は d までは読まない（深さ3まで）
    for x, nxt in (("e1", []), ("d1", ["e1"]), ("c1", ["d1"]), ("b1", ["c1"]), ("a1", ["b1"])):
        c.put(f"/skills/{x}", headers=H, json={**body, "name": x, "refs": nxt})
    c.put("/skills/top", headers=H, json={**body, "name": "top", "kind": "agent", "refs": ["a1"]})
    c.put("/agent-profiles/s02", headers=H, json={"skills": ["top"]})
    lo = agent(c.get("/agent-catalog", headers=H).json(), "s02")["loadout"]
    assert lo["ref_skills"] == ["a1", "b1", "c1"] and any("d1" in w for w in lo["warnings"])


def test_tool_loop_reads_then_final_output(client, monkeypatch):
    """AI（ここでは偽の Claude）が読むツールを呼び、結果を受けて最後の出力を作る。割り当てていないツールは拒む。"""
    from pf_agent import agentrun, llm, team
    from pf_agent.db import Product, session
    from pf_agent.llmconf import Conn

    c = client
    pid = c.post("/products", headers=H, json={"name": "呼ぶ", "idea": "申込の受付"}).json()["id"]
    c.get(f"/products/{pid}/team", headers=H)
    with session() as s:
        p = s.get(Product, pid)
        s.expunge(p)
    calls = []

    def block(**kw):
        return SimpleNamespace(**kw, model_dump=lambda: {k: v for k, v in kw.items()})

    class Messages:
        def create(self, **kw):
            calls.append(kw)
            n = len(calls)
            if n == 1:
                return SimpleNamespace(
                    stop_reason="tool_use",
                    usage=None,
                    content=[
                        block(type="tool_use", id="t1", name="stage_fields", input={"stage_id": "s06"}),
                        block(type="tool_use", id="t2", name="factory_status", input={}),
                    ],
                )
            return SimpleNamespace(stop_reason="end_turn", usage=None, content=[block(type="text", text="準備完了")])

        def parse(self, **kw):
            calls.append(kw)
            out = kw["output_format"](
                report=team.ReportOut(health="green", progress=50, summary="s", blockers=[], next=[]),
                changes=[],
                issue_updates=[],
                new_issues=[],
                posts=[],
            )
            return SimpleNamespace(parsed_output=out, stop_reason="end_turn", usage=None)

    monkeypatch.setattr(llm, "_anthropic", lambda conn: SimpleNamespace(messages=Messages()))
    conn = Conn("anthropic", "claude-test", "claude-test", "", "env", api_key="k")
    prep = agentrun.prepare("tenant-a", p, "s06")
    assert prep.prefetched.startswith("### stage_draft")
    out = agentrun.think(conn, prep, "やること", team.turn_schema(prep.lo.writes))
    assert out.report.progress == 50
    tools_sent = [t["name"] for t in calls[0]["tools"]]
    assert "stage_fields" in tools_sent and "factory_status" not in tools_sent and "set_field" not in tools_sent
    results = calls[1]["messages"][-1]["content"]
    assert "カスタマージャーニー" in results[0]["content"]  # ⑥ の項目の定義を読めた
    assert "割り当てられていません" in results[1]["content"]
    final = calls[2]["messages"][0]["content"]
    assert "## ツールで読んだもの" in final and "### stage_fields" in final
    assert "stage_fields" in prep.summary()
