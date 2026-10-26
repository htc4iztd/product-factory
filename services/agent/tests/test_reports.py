"""報告資料：工程の企画情報から範囲を選び、ジョブでスライドの構成を作り、付録に表を付け、画面で直す。"""

import importlib
import time

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
VIEWER = {**H, "x-pf-role": "VIEWER"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/r.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    from pf_agent import api, db
    importlib.reload(db)
    importlib.reload(api)
    with TestClient(api.app) as c:
        yield c


def wait(c, pid, n):
    for _ in range(100):
        r = c.get(f"/products/{pid}/reports/{n}", headers=H).json()
        if r["status"] in ("done", "failed"):
            return r
        time.sleep(0.1)
    raise AssertionError(r)


def test_report_from_selected_fields(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "報告", "idea": "申込の受付"}).json()["id"]
    rows = [{"name": f"作業{i}", "level": "作業"} for i in range(15)]
    c.put(f"/products/{pid}/stages/s07/draft", headers=H, json={"field": "business_map", "value": rows})
    c.put(f"/products/{pid}/stages/s05/draft", headers=H,
          json={"field": "pl", "value": [{"item": "売上", "y1": 100}, {"item": "原価", "y1": 40}]})
    src = c.get(f"/products/{pid}/report-sources", headers=H).json()
    s07 = next(s for s in src if s["id"] == "s07")
    assert next(f for f in s07["fields"] if f["key"] == "business_map")["filled"] is True and s07["version"] is None
    body = {"title": "経営会議向け", "audience": "役員", "purpose": "続けるか決める",
            "selection": [{"stage": "s07", "fields": ["business_map", "rules"]}, {"stage": "s05", "fields": ["pl"]}]}
    assert c.post(f"/products/{pid}/reports", headers=VIEWER, json=body).status_code == 403
    r = c.post(f"/products/{pid}/reports", headers=H, json=body).json()
    assert r["key"] == "RP-1"
    r = wait(c, pid, 1)
    assert r["status"] == "done", r
    slides = r["data"]["slides"]
    content = [s for s in slides if s["kind"] == "content"]
    tables = [s for s in slides if s["kind"] == "table"]
    assert [s["sources"] for s in content] == [["s07"], ["s05"]]
    # 15行の業務一覧は 12行ずつに分け、PL は粗利・営業利益を足す。空の業務ルールは付録にしない
    assert [t["title"] for t in tables] == ["⑦業務要求定義：業務一覧（1）", "⑦業務要求定義：業務一覧（2）",
                                            "⑤事業計画書：PL計画（万円）"]
    assert len(tables[0]["table"]["rows"]) == 12 and tables[2]["table"]["rows"][-1][0] == "営業利益"
    assert r["data"]["basis"] == {"s07": "下書き", "s05": "下書き"}
    job = c.get(f"/jobs/{r['job_id']}", headers=H).json()
    assert [t["status"] for t in job["tasks"]] == ["done", "done", "done"]
    # 画面で直す
    slides[0]["title"] = "業務は15の作業に分かれる"
    edit = {"title": "経営会議向け（改）", "data": {"slides": slides}}
    r = c.put(f"/products/{pid}/reports/1", headers=H, json=edit).json()
    assert r["title"] == "経営会議向け（改）" and r["data"]["slides"][0]["title"] == "業務は15の作業に分かれる"
    assert r["data"]["basis"]["s07"] == "下書き"
    assert c.get(f"/products/{pid}/reports", headers=H).json()[0]["key"] == "RP-1"
    # 作り直し・削除
    assert c.post(f"/products/{pid}/reports/1/regenerate", headers=H).json()["status"] in ("queued", "running", "done")
    wait(c, pid, 1)
    assert c.delete(f"/products/{pid}/reports/1", headers=H).json() == {"ok": True}
    assert c.get(f"/products/{pid}/reports/1", headers=H).status_code == 404


def test_report_rejects_bad_selection(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "報告", "idea": "x"}).json()["id"]
    r = c.post(f"/products/{pid}/reports", headers=H, json={"title": "x", "selection": [{"stage": "s99"}]})
    assert r.status_code == 422
