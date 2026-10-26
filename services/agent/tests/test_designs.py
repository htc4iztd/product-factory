"""⑨⑩⑪の設計書の構造：ER図・処理仕様（CRUD マトリクス）・状態遷移・構成図の形をそろえ、文書にし、
昔の見出しだけの下書きを引き継ぐ。"""

import importlib

import pytest
from fastapi.testclient import TestClient

from pf_agent import designs as dz
from pf_agent import frameworks as fx

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/d.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    from pf_agent import api, db
    importlib.reload(db)
    importlib.reload(api)
    with TestClient(api.app) as c:
        yield c


def test_er_relations_by_name_and_cardinality():
    v = dz.coerce_er({"entities": [{"name": "注文", "physical": "ORDERS", "attrs": [{"name": "注文ID", "pk": "true"}]},
                                   {"name": "明細"}, {"name": ""}],
                      "relations": [{"source": "ORDERS", "target": "明細", "card": "1：n"},
                                    {"source": "注文", "target": "ない"}]})
    assert [e["id"] for e in v["entities"]] == ["E1", "E2"] and v["entities"][0]["attrs"][0]["pk"] is True
    assert v["relations"] == [{"id": "R1", "source": "E1", "target": "E2", "card": "1:N", "label": ""}]


def test_specs_crud_direction_ids_and_matrix():
    specs = dz.coerce_specs(json_specs := [
        {"name": "登録", "io": [{"kind": "テーブル", "name": "orders", "crud": "cr"},
                                {"kind": "テーブル", "name": "在庫", "crud": "u"}, {"kind": "???", "name": "画面A"}],
         "steps": "1. 受ける\n2. 書く"},
        {"id": "PR-01", "name": "参照", "io": [{"kind": "テーブル", "name": "注文", "crud": "R"}]},
    ])
    assert json_specs and [p["id"] for p in specs] == ["PR-02", "PR-01"]
    io = specs[0]["io"]
    assert [x["dir"] for x in io] == ["入出力", "出力", "入力"] and io[0]["crud"] == "CR" and io[2]["kind"] == "その他"
    assert specs[0]["steps"] == ["受ける", "書く"]
    er = dz.coerce_er({"entities": [{"name": "注文", "physical": "ORDERS"}]})
    m = dz.crud_matrix(specs, er)
    # 物理名で書いたテーブルもエンティティの名前にまとめる。モデルにないテーブルは後ろに足す
    assert m["tables"] == ["注文", "在庫"]
    assert m["rows"][0]["cells"] == {"注文": "CR", "在庫": "U"} and m["rows"][1]["cells"] == {"注文": "R"}


def test_states_and_graph_drop_dangling():
    st = dz.coerce_states({"target": "申込", "states": [{"name": "受付", "kind": "initial"}, {"name": "完了"}],
                           "transitions": [{"source": "受付", "target": "完了", "event": "OK"},
                                           {"source": "受付", "target": "なし"}]})
    assert st[0]["states"][0]["id"] == "S1" and st[0]["transitions"] == [
        {"id": "T1", "source": "S1", "target": "S2", "event": "OK", "guard": "", "action": ""}]
    g = dz.coerce_graph({"nodes": [{"label": "LB", "kind": "edge", "x": 10.4}, {"label": "DB", "kind": "???"}],
                         "edges": [{"source": "LB", "target": "DB", "label": "5432"},
                                   {"source": "LB", "target": "LB"}]})
    assert g["nodes"][0]["x"] == 10 and g["nodes"][1]["kind"] == "compute" and len(g["edges"]) == 1


def test_legacy_sections_move_to_overview():
    d = fx.upgrade("s10", {"sec1": "Cloud Run に置く", "sec4": "月1万円", "sec2": ""})
    assert d["overview"] == "### 構成\nCloud Run に置く\n\n### 月額コスト見積\n月1万円"
    assert "sec1" not in d and d["architecture"] == {"nodes": [], "edges": []}


def test_app_design_draft_and_markdown(client):
    c = client
    pid = c.post("/products", headers=H, json={"name": "設計", "idea": "申込の受付"}).json()["id"]
    st = c.post(f"/products/{pid}/stages/s09/chat", headers=H, json={"message": "下書きを作って"}).json()
    msg = st["chat"][-1]
    for p in msg["proposals"]:
        r = c.post(f"/products/{pid}/stages/s09/proposals", headers=H,
                   json={"message_id": msg["id"], "proposal_id": p["id"], "accept": True})
        assert r.status_code == 200, r.text
    st = r.json()
    assert st["framework"]["view"] == "app_design" and st["missing"] == []
    assert st["draft"]["data_model"]["entities"][0]["name"] == "利用者"
    md = st["markdown"]
    assert "erDiagram" in md and "stateDiagram-v2" in md and "### CRUD マトリクス" in md
    assert "| PR-02 申込を確認する |  | RU |" in md
    # 画面から ER 図を書き換える（位置も残る）
    er = st["draft"]["data_model"]
    er["entities"][0]["x"] = 120
    st = c.put(f"/products/{pid}/stages/s09/draft", headers=H, json={"field": "data_model", "value": er}).json()
    assert st["draft"]["data_model"]["entities"][0]["x"] == 120
    # 文書からは図を変えない
    r = c.put(f"/products/{pid}/stages/s09/markdown", headers=H, json={"markdown": st["markdown"]}).json()
    assert any("図のエディタ" in n for n in r["notes"])
    # 構成図と月額の合計
    st = c.put(f"/products/{pid}/stages/s10/draft", headers=H,
               json={"field": "cost", "value": [{"item": "DB", "monthly": "12,000"},
                                                {"item": "実行", "monthly": 3000}]}).json()
    assert "| 合計 |  |  | 15000 |" in st["markdown"]
