"""以降の工程の自動開発：ジョブ（スレッドで実行）→ パターンごとのプリプロダクト → 試作 → 採用、ジョブの管理。"""

import importlib
import time

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
OTHER = {**H, "x-pf-tenant": "tenant-b"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/f.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    monkeypatch.delenv("PF_JOB_NAME", raising=False)
    from pf_agent import api, db

    importlib.reload(db)
    importlib.reload(api)
    with TestClient(api.app) as c:
        yield c


def wait(c, job_id, until=("done", "failed", "cancelled"), timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        j = c.get(f"/jobs/{job_id}", headers=H).json()
        if j["status"] in until:
            return j
        time.sleep(0.1)
    raise AssertionError(f"job did not finish: {j}")


def test_autodev_creates_pre_products_and_adopt(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "家計簿", "idea": "共働き世帯の家計簿"}).json()["id"]
    base = f"/products/{pid}"
    assert c.post(base + "/stages/s11/autodev", headers=H, json={}).status_code == 409  # ⑪より後はない
    j = c.post(base + "/stages/s06/autodev", headers=H, json={"count": 2, "hint": "最小限, 体験重視"}).json()
    assert j["kind"] == "autodev" and j["runner"] == "thread"
    assert j["params"]["stages"] == ["s07", "s08", "s09", "s10", "s11"]
    j = wait(c, j["id"])
    assert j["status"] == "done", j
    assert j["progress"]["done"] == j["progress"]["total"] == 1 + 2 * 6
    assert j["usage"]["calls"] == 10 and j["usage"]["by_model"]["stub"]["calls"] == 10  # 2案 × 5ステージ
    assert [x["step"] for x in j["log"]][-1] == "完了"
    ov = c.get(base + "/preproducts", headers=H).json()
    pps = ov["runs"][0]["pre_products"]
    assert [p["key"] for p in pps] == ["PP-2", "PP-1"] and {p["title"] for p in pps} == {"案A：最小限", "案B：体験重視"}
    assert all(p["status"] == "ready" and p["has_prototype"] for p in pps)
    pp = c.get(base + "/preproducts/1", headers=H).json()
    assert set(pp["markdown"]) == {"s07", "s08", "s09", "s10", "s11"} and pp["job"]["id"] == j["id"]
    r = c.get(base + "/preproducts/1/prototype", headers=H)
    assert r.status_code == 200 and "試作：案A：最小限" in r.text
    assert "sandbox allow-scripts" in r.headers["content-security-policy"]
    assert c.get(base + "/preproducts/1", headers=OTHER).status_code == 404
    # 採用すると本線の下書きに入る
    a = c.post(base + "/preproducts/1/adopt", headers=H).json()
    assert a["status"] == "adopted" and a["adopted_by"] == "owner@example.com"
    st = c.get(base + "/stages/s08", headers=H).json()
    assert st["status"] == "in_progress" and st["markdown"] == pp["markdown"]["s08"]
    # ジョブの管理：定義・履歴・使用量
    jl = c.get("/jobs", headers=H).json()
    d = {x["kind"]: x for x in jl["definitions"]}
    assert d["autodev"]["runs"] == 1 and d["autodev"]["runner"] == "thread" and d["deploy"]["status"] == "planned"
    assert jl["runs"][0]["id"] == j["id"] and "log" not in jl["runs"][0]
    assert c.get("/jobs", headers=OTHER).json()["runs"] == []
    # 再実行
    j2 = c.post(base + f"/autodev/{j['id']}/retry", headers=H).json()
    assert wait(c, j2["id"])["status"] == "done"


def test_cancel_and_upstream_change(client, monkeypatch):
    c = client
    from pf_agent import autodev

    pid = c.post("/products", headers=H, json={"name": "x", "idea": "y"}).json()["id"]
    base = f"/products/{pid}"
    gate = {"go": False}
    real = autodev.plan

    def slow_plan(*a, **kw):
        while not gate["go"]:
            time.sleep(0.05)
        return real(*a, **kw)

    monkeypatch.setattr(autodev, "plan", slow_plan)
    j = c.post(base + "/stages/s09/autodev", headers=H, json={"count": 1}).json()
    wait(c, j["id"], until=("running",))
    assert c.post(base + "/stages/s09/autodev", headers=H, json={}).status_code == 409  # 実行中は重ねない
    assert c.post(f"/jobs/{j['id']}/cancel", headers=H).json()["cancel_requested"] is True
    gate["go"] = True
    assert wait(c, j["id"])["status"] == "cancelled"
    # 上流が変わったら、作ったときの版と違うことが分かる
    monkeypatch.setattr(autodev, "plan", real)
    j = c.post(base + "/stages/s09/autodev", headers=H, json={"count": 1}).json()
    wait(c, j["id"])
    assert c.get(base + "/preproducts", headers=H).json()["runs"][0]["upstream_changed"] == []
    assert c.post(base + "/stages/s06/commit", headers=H, json={"force": True}).status_code == 200
    ov = c.get(base + "/preproducts", headers=H).json()
    assert ov["runs"][0]["upstream_changed"] == ["s06"]


def test_cloud_run_job_dispatch(client, monkeypatch):
    """本番の経路（Cloud Run Jobs）：起動できれば実行名を残し、トークンも取れなければ 502 で理由を返す。"""
    c = client
    from pf_agent import db, jobs

    # 書き込む値が列の長さに収まること（SQLite は長さを見ないので、Postgres で初めて落ちるのを防ぐ）
    assert len("cloud-run-job") <= db.JobRun.__table__.c.runner.type.length
    monkeypatch.setenv("PF_JOB_NAME", "pf-autodev")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "demo")
    monkeypatch.setattr(jobs, "_gcp_token", lambda: "tok")
    calls = []

    class Resp:
        def read(self):
            return b'{"metadata": {"name": "projects/demo/locations/x/jobs/pf-autodev/executions/pf-autodev-abc"}}'

    def fake_open(req, timeout=0):
        calls.append((req.full_url, req.data))
        return Resp()

    monkeypatch.setattr(jobs.urllib.request, "urlopen", fake_open)
    pid = c.post("/products", headers=H, json={"name": "x", "idea": "y"}).json()["id"]
    r = c.post(f"/products/{pid}/stages/s02/autodev", headers=H, json={"count": 2, "hint": ""})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["runner"] == "cloud-run-job" and j["execution"].endswith("pf-autodev-abc")
    assert calls[0][0].endswith("/jobs/pf-autodev:run") and j["id"].encode() in calls[0][1]

    def no_token():
        raise OSError("metadata unreachable")

    monkeypatch.setattr(jobs, "_gcp_token", no_token)
    pid = c.post("/products", headers=H, json={"name": "x2", "idea": "y"}).json()["id"]
    r = c.post(f"/products/{pid}/stages/s02/autodev", headers=H, json={"count": 2, "hint": ""})
    assert r.status_code == 502 and "metadata unreachable" in r.json()["detail"]
    assert c.get("/jobs", headers=H).json()["runs"][0]["status"] == "failed"
