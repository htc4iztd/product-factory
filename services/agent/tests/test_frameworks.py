"""フレームワーク：工程は基本の項目に、ライブラリのフレームワーク（PEST・ファイブフォース・SWOT…）を足して組み合わせる。
部品は text・list・table・matrix・positioning・diagram。テナントは独自のフレームワークを作り、標準を上書きできる。"""

import importlib

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}
MEMBER = {**H, "x-pf-role": "MEMBER"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/t.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    monkeypatch.delenv("K_SERVICE", raising=False)
    from pf_agent import api, db, fwlib

    importlib.reload(db)
    importlib.reload(api)
    fwlib.invalidate()
    with TestClient(api.app) as c:
        yield c


def test_library_and_stage_composition(client):
    c = client
    lib = {f["id"]: f for f in c.get("/frameworks", headers=H).json()["frameworks"]}
    for k in (
        "pest",
        "five-forces",
        "three-c",
        "stp",
        "swot",
        "tows",
        "vrio",
        "errc",
        "positioning-map",
        "value-chain",
        "ansoff",
        "marketing-mix",
        "bmc",
        "stakeholder-map",
        "unit-economics",
        "break-even",
        "scenario",
        "okr",
    ):
        assert k in lib, k
    assert {b["kind"] for f in lib.values() for b in f["blocks"]} >= {
        "text",
        "list",
        "table",
        "matrix",
        "positioning",
        "diagram",
    }
    pid = c.post("/products", headers=H, json={"name": "組み合わせ", "idea": "家計簿"}).json()["id"]
    st = c.get(f"/products/{pid}/stages/s02", headers=H).json()
    assert [p["id"] for p in st["framework"]["parts"]] == ["pest", "five-forces"]  # 既定で足してある（必須ではない）
    keys = [f["key"] for f in st["framework"]["fields"]]
    assert "pest.politics" in keys and "five-forces.rivalry" in keys
    assert not any("PEST" in m for m in st["missing"])
    # SWOT を必須で足す → 必須の抜けに出る
    r = c.put(
        f"/products/{pid}/stages/s02/frameworks",
        headers=MEMBER,
        json={"items": [{"id": "pest"}, {"id": "swot", "required": True}]},
    )
    assert r.status_code == 200
    st = c.get(f"/products/{pid}/stages/s02", headers=H).json()
    assert [p["id"] for p in st["framework"]["parts"]] == ["pest", "swot"]
    assert any("SWOT 分析：SWOT" in m for m in st["missing"])
    assert (
        c.put(f"/products/{pid}/stages/s02/frameworks", headers=H, json={"items": [{"id": "nope"}]}).status_code == 422
    )
    # 象限・ポジショニング・図の値をそろえて入れる。Markdown にも出る
    c.put(
        f"/products/{pid}/stages/s02/draft",
        headers=H,
        json={"field": "swot.swot", "value": {"q1": ["ブランド", " "], "q3": "規制緩和\n共働きの増加"}},
    )
    st = c.get(f"/products/{pid}/stages/s02", headers=H).json()
    assert st["draft"]["swot.swot"] == {"q1": ["ブランド"], "q2": [], "q3": ["規制緩和", "共働きの増加"], "q4": []}
    assert not any("SWOT" in m for m in st["missing"])
    md = st["markdown"]
    assert "## SWOT 分析：SWOT" in md and "### 機会（Opportunities）" in md and "- 規制緩和" in md
    c.put(
        f"/products/{pid}/stages/s02/frameworks",
        headers=H,
        json={"items": [{"id": "positioning-map"}, {"id": "stakeholder-map"}]},
    )
    c.put(
        f"/products/{pid}/stages/s02/draft",
        headers=H,
        json={"field": "positioning-map.map", "value": {"items": [{"name": "自社", "x": 120, "y": 40, "self": True}]}},
    )
    c.put(
        f"/products/{pid}/stages/s02/draft",
        headers=H,
        json={
            "field": "stakeholder-map.map",
            "value": {
                "nodes": [{"id": "a", "label": "自社"}, {"id": "b", "label": "顧客"}],
                "edges": [{"source": "a", "target": "b", "label": "価値"}, {"source": "a", "target": "zz"}],
            },
        },
    )
    d = c.get(f"/products/{pid}/stages/s02", headers=H).json()
    assert d["draft"]["positioning-map.map"]["items"][0]["x"] == 100  # 0〜100 に収める
    assert d["draft"]["stakeholder-map.map"]["edges"] == [{"source": "a", "target": "b", "label": "価値"}]
    assert "-->|価値| b" in d["markdown"] and "| ★自社 | 100 | 40 |" in d["markdown"]


def test_custom_framework_editor_and_agents(client):
    from pf_agent import team, tools
    from pf_agent.db import Product, session

    c = client
    body = {
        "name": "リスク評価",
        "category": "社内",
        "description": "社内の様式",
        "stages": ["s07"],
        "blocks": [
            {
                "key": "risks",
                "label": "リスク",
                "kind": "table",
                "layout": {"x": 0, "y": 0, "w": 8, "h": 1},
                "columns": [
                    {"key": "risk", "label": "リスク"},
                    {"key": "level", "label": "影響", "options": ["大", "中", "小"]},
                ],
            },
            {
                "key": "map",
                "label": "発生×影響",
                "kind": "matrix",
                "quadrants": ["高×大", "高×小"],
                "layout": {"x": 8, "y": 0, "w": 9, "h": 2},
            },
        ],
    }
    assert c.put("/frameworks/risk-review", headers=MEMBER, json=body).status_code == 403
    f = c.put("/frameworks/risk-review", headers=H, json=body).json()
    assert f["source"] == "custom" and f["blocks"][1]["quadrants"] == ["高×大", "高×小", "象限3", "象限4"]
    assert f["blocks"][1]["layout"] == {"x": 3, "y": 0, "w": 9, "h": 2}  # 12 列からはみ出さない
    bad = {**body, "blocks": [{"key": "x", "label": "x", "kind": "chart"}]}
    assert c.put("/frameworks/risk-review", headers=H, json=bad).status_code == 422
    assert c.put("/frameworks/Bad", headers=H, json=body).status_code == 422
    pid = c.post("/products", headers=H, json={"name": "独自", "idea": "家計簿"}).json()["id"]
    c.put(
        f"/products/{pid}/stages/s07/frameworks", headers=H, json={"items": [{"id": "risk-review", "required": True}]}
    )
    sf = c.get(f"/products/{pid}/stages/s07/frameworks", headers=H).json()
    assert sf["customized"] and "risk-review" in sf["suggested"]
    # 担当（スタブ）は足したフレームワークの項目も埋める。AI のツールも足した項目を読む
    with session() as s:
        p = s.get(Product, pid)
        s.expunge(p)
    out = team._stub_turn(p, "s07", [])
    assert {"risk-review.risks", "risk-review.map"} <= {ch.field for ch in out.changes}
    assert "リスク評価：発生×影響" in tools.call(tools.Ctx(p, "s07", "tenant-a"), "stage_fields", {})
    # 標準を上書き → 消すと標準に戻る。標準そのものは消せない
    c.put("/frameworks/pest", headers=H, json={**body, "name": "PEST（社内版）"})
    lib = {x["id"]: x for x in c.get("/frameworks", headers=H).json()["frameworks"]}
    assert lib["pest"]["source"] == "override" and lib["pest"]["name"] == "PEST（社内版）"
    assert c.delete("/frameworks/pest", headers=H).status_code == 200
    assert {x["id"]: x for x in c.get("/frameworks", headers=H).json()["frameworks"]}["pest"]["name"] == "PEST 分析"
    assert c.delete("/frameworks/pest", headers=H).status_code == 404
