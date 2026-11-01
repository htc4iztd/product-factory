"""プラットフォームエージェント：ファクトリーの稼働上の問題を見つけ（AI を使わない）、PdM に知らせ、PdM と話し、
承認された安全な対処だけを実行する。見つからなくなった問題は自動で解決にする。"""

import datetime as dt
import importlib
import time

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
VIEWER = {**H, "x-pf-role": "VIEWER"}
OTHER = {**H, "x-pf-tenant": "tenant-b", "x-pf-user": "b@example.com"}


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


def now():
    return dt.datetime.now(dt.UTC)


def by_title(ws, text):
    return [f for f in ws["findings"] if text in f["title"]]


def fresh_tick():
    from pf_agent.db import SystemBeat, session

    with session() as s:
        b = s.get(SystemBeat, "tick") or SystemBeat(name="tick")
        b.at, b.detail = now(), ""
        s.merge(b)
        s.commit()


def test_detects_and_acts_with_pdm_approval(client):
    from pf_agent.db import AgentIssue, JobRun, SystemBeat, TeamAgent, session

    c = client
    assert (
        by_title(c.get("/platform", headers=H).json(), "一度も来ていません") == []
    )  # プロダクトがなければ問題にしない
    pid = c.post("/products", headers=H, json={"name": "見張り", "idea": "申込の受付"}).json()["id"]
    c.get(f"/products/{pid}/team", headers=H)
    ws = c.get("/platform", headers=H).json()
    assert by_title(ws, "定期実行（tick）が一度も来ていません")[0]["action"]["type"] == "tick"
    fresh_tick()
    ws = c.get("/platform", headers=H).json()
    assert ws["summary"]["open"] == 0 and ws["status"]["products"][0]["name"] == "見張り"

    # 1) LLM の利用上限で担当の実行が失敗し続けている → 重い問題・PdM に知らせる・「もう一度動かす」で対処
    with session() as s:
        for i in range(2):
            s.add(
                JobRun(
                    kind="team",
                    tenant_id="tenant-a",
                    product_id=pid,
                    params={"keys": ["s01"]},
                    status="failed",
                    error="429 RESOURCE_EXHAUSTED",
                    created_by="x",
                    created_at=now() - dt.timedelta(minutes=5 + i),
                )
            )
        # 2) 定期実行（tick）が止まっている
        s.merge(SystemBeat(name="tick", at=now() - dt.timedelta(minutes=30), detail="起動 0"))
        # 3) 予定の時刻を過ぎても動いていない担当
        a = s.query(TeamAgent).filter_by(product_id=pid, key="s02").one()
        a.next_run_at = now() - dt.timedelta(hours=1)
        s.commit()
    ws = c.get("/platform", headers=H).json()
    llm_f = by_title(ws, "利用上限")[0]
    assert llm_f["severity"] == "high" and llm_f["count"] == 2 and llm_f["action"]["type"] == "run_team"
    tick_f = by_title(ws, "定期実行（tick）が止まっています")[0]
    missed = by_title(ws, "予定の時刻を過ぎても")[0]
    assert missed["action"] == {"type": "reschedule", "label": "予定を立て直す", "product_id": pid, "keys": ["s02"]}
    alerts = [m for m in ws["messages"] if m["role"] == "platform" and m["text"].startswith("【要対応】")]
    assert len(alerts) == 4  # 重いものは PdM に知らせる（最初の「一度も来ていません」を含む。同じ問題は二度知らせない）
    c.get("/platform", headers=H)
    assert len([m for m in c.get("/platform", headers=H).json()["messages"] if "【要対応】" in m["text"]]) == 4
    assert c.get(f"/products/{pid}/team", headers=H).json()["platform"]["high"] == 3

    # 閲覧のみの人・別のテナントは対処できない
    assert c.post(f"/platform/findings/{missed['id']}/act", headers=VIEWER).status_code == 403
    assert c.post(f"/platform/findings/{missed['id']}/act", headers=OTHER).status_code == 404
    assert c.get("/platform", headers=OTHER).json()["findings"] == []

    # PdM の承認で実行：予定を立て直す → 次の検知で解決になる
    r = c.post(f"/platform/findings/{missed['id']}/act", headers=H).json()
    assert "予定を立て直しました（1 人）" in r["done"]
    r = c.post(f"/platform/findings/{llm_f['id']}/act", headers=H).json()
    assert "①" in r["done"] or "担当" in r["done"] or "を動かしました" in r["done"]
    wait_idle(c, pid)
    r = c.post(f"/platform/findings/{tick_f['id']}/act", headers=H).json()
    assert r["done"].startswith("定期実行を1回動かしました")
    wait_idle(c, pid)
    ws = c.get("/platform", headers=H).json()
    st = {f["id"]: f["status"] for f in ws["findings"]}
    assert st[missed["id"]] == "resolved" and st[tick_f["id"]] == "resolved"
    assert st[llm_f["id"]] == "resolved"  # 動かし直して成功したので、最後の成功より後の失敗はない
    assert ws["status"]["scheduler"]["healthy"] is True

    # 4) 止めている担当が Issue を抱えている → 「再開する」
    c.put(f"/products/{pid}/team/s03", headers=H, json={"enabled": False})
    with session() as s:
        s.add(
            AgentIssue(
                tenant_id="tenant-a",
                product_id=pid,
                number=99,
                subject="競合を足して",
                author="pm_biz",
                assignee="s03",
                created_at=now() - dt.timedelta(hours=1),
            )
        )
        s.commit()
    ws = c.get("/platform", headers=H).json()
    f = by_title(ws, "止まっているのに Issue を 1 件")[0]
    assert f["action"]["type"] == "enable_agent"
    assert c.post(f"/platform/findings/{f['id']}/act", headers=H).json()["done"].endswith("を再開しました")
    assert next(a for a in c.get(f"/products/{pid}/team", headers=H).json()["agents"] if a["key"] == "s03")["enabled"]
    # 再開した後も拾っていなければ、今度は「拾っていません」として出る
    ws = c.get("/platform", headers=H).json()
    assert by_title(ws, "Issue を拾っていません")


def test_talk_and_manual_status(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "話す", "idea": "x"}).json()["id"]
    c.get(f"/products/{pid}/team", headers=H)
    fresh_tick()
    r = c.post("/platform/talk", headers=H, json={"text": "いま全体はちゃんと動いてる？"}).json()
    assert r["mine"]["role"] == "pdm" and "問題はありません" in r["reply"]["text"]
    assert c.post("/platform/talk", headers=VIEWER, json={"text": "x"}).status_code == 403

    from pf_agent.db import SystemBeat, session

    with session() as s:
        s.merge(SystemBeat(name="tick", at=now() - dt.timedelta(minutes=30), detail=""))
        s.commit()
    r = c.post("/platform/talk", headers=H, json={"text": "何が起きてる？"}).json()
    assert "未解決の問題は 1 件" in r["reply"]["text"] and r["reply"]["proposals"][0]["kind"] == "ops"
    fid = r["reply"]["findings"][0]
    assert c.put(f"/platform/findings/{fid}", headers=H, json={"status": "ack"}).json()["status"] == "ack"
    assert c.get("/platform/summary", headers=H).json()["open"] == 0  # 確かめた問題は印から外す
    assert c.put(f"/platform/findings/{fid}", headers=H, json={"status": "x"}).status_code == 422


def test_platform_avatar(client):
    r = client.get("/avatars/platform", headers=H)
    # 描いていないときも人物のイラスト（ヘッドセットの運用エンジニア）
    assert r.status_code == 200 and "<ellipse" in r.text and "#c7d7ea" in r.text
