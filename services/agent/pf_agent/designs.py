"""設計書の構造を持つ項目（⑨アプリケーション設計・⑩インフラ設計で使う）。

表や文章では表しにくい設計を、図にも表にもできる形で持つ。
- er：概念データモデル（エンティティ・属性・PK/FK・リレーション）
- states：状態遷移（対象ごとの状態と、イベント・条件つきの遷移）
- specs：処理仕様（処理の概要・手順・入出力と CRUD・パラメータ・呼び出す部品・設定値）。
  CRUD マトリクスとデータフロー図はここから作る（別に持たない）
- graph：構成図（リソースと、ゾーン・通信）
"""
from __future__ import annotations

import json
import re

ER, ST, SP, GR = "er", "states", "specs", "graph"
KINDS = (ER, ST, SP, GR)

CARDS = ("1:1", "1:N", "N:1", "N:M")
STATE_KINDS = ("initial", "normal", "final")
SPEC_KINDS = ("画面", "API", "バッチ", "常駐", "共通部品", "その他")
IO_KINDS = ("画面", "テーブル", "ファイル", "外部システム", "API", "メール", "その他")
IO_DIRS = ("入力", "出力", "入出力")
PARAM_DIRS = ("リクエスト", "レスポンス")
NODE_KINDS = {
    "user": "利用者", "client": "端末・ブラウザ", "edge": "CDN・LB・ゲートウェイ", "compute": "サーバー・VM",
    "container": "コンテナ", "function": "関数", "db": "データベース", "storage": "ストレージ", "cache": "キャッシュ",
    "queue": "キュー・メッセージ", "ai": "AI・モデル", "monitoring": "監視・ログ", "network": "ネットワーク",
    "external": "外部システム",
}

# LLM に渡す形の説明（proposals の value に入れる JSON）
FORMATS = {
    ER: '{entities: [{id, name: 論理名, physical: 物理名, note, attrs: [{name: 論理名, physical: 物理名, type: 型, '
        'pk: true|false, fk: "参照先エンティティ名.属性" か空, required: true|false, note}]}], '
        'relations: [{source: エンティティ名, target: エンティティ名, card: 1:1|1:N|N:1|N:M, label}]}',
    ST: '[{target: 状態を持つもの（例：注文）, states: [{id, name, kind: initial|normal|final, note}], '
        'transitions: [{source: 状態のid, target: 状態のid, event: きっかけ, guard: 条件, action: そのときの処理}]}]',
    SP: '[{id: PR-01, name: 処理名, kind: 画面|API|バッチ|常駐|共通部品|その他, '
        'component: 担うコンポーネント（CP-xx かクラス名）, trigger: 起動のしかた, fr: 機能要求ID, '
        'summary: 処理の概要, steps: [主な処理を順に], constraints: 制限・前提, '
        'io: [{dir: 入力|出力|入出力, kind: 画面|テーブル|ファイル|外部システム|API|メール|その他, '
        'name: 名前（テーブルは概念データモデルのエンティティ名）, '
        'crud: テーブルなら C/R/U/D の組み合わせ（例 "RU"）, format: 形式, note}], '
        'params: [{dir: リクエスト|レスポンス, name: 物理名, label: 項目名, type, required: 必須|任意, note}], '
        'calls: [{name: 部品名, cls: クラス・モジュール, method, args}], settings: [{key, note}]}]',
    GR: '{nodes: [{id, label, kind: ' + "|".join(NODE_KINDS) + ', '
        'zone: 置き場所（例：パブリック / プライベート / 外部）, note}], '
        'edges: [{source: ノードid, target: ノードid, label: 通信（プロトコル・ポート・内容）}]}',
}


def _load(value):
    if isinstance(value, str):
        value = json.loads(value) if value.strip() else None
    return value


def _s(v) -> str:
    return "" if v is None else str(v).strip()


def _b(v) -> bool:
    if isinstance(v, str):
        return v.strip().lower() in ("true", "1", "yes", "y", "○", "〇", "はい", "pk", "必須")
    return bool(v)


def _pos(d: dict, out: dict) -> dict:
    """画面で置いた位置は残す。"""
    for k in ("x", "y"):
        if isinstance(d.get(k), (int, float)):
            out[k] = round(d[k])
    return out


def _ids(items: list[dict], prefix: str) -> list[dict]:
    used: set[str] = set()
    for i, it in enumerate(items, 1):
        v = it.get("id") or ""
        if not v or v in used:
            n = i
            while f"{prefix}{n}" in used or any(x.get("id") == f"{prefix}{n}" for x in items):
                n += 1
            v = f"{prefix}{n}"
        it["id"] = v
        used.add(v)
    return items


# ---------------- 形をそろえる ----------------
def coerce_er(value) -> dict:
    value = _load(value) or {}
    if isinstance(value, list):     # エンティティだけの配列で来た場合
        value = {"entities": value}
    if not isinstance(value, dict):
        raise ValueError("概念データモデルは {entities, relations} で渡してください")
    ents = []
    for e in value.get("entities") or []:
        if not isinstance(e, dict) or not _s(e.get("name")):
            continue
        attrs = [{"name": _s(a.get("name")), "physical": _s(a.get("physical")), "type": _s(a.get("type")),
                  "pk": _b(a.get("pk")), "fk": _s(a.get("fk")), "required": _b(a.get("required")),
                  "note": _s(a.get("note"))}
                 for a in e.get("attrs") or [] if isinstance(a, dict) and (_s(a.get("name")) or _s(a.get("physical")))]
        ents.append(_pos(e, {"id": _s(e.get("id")), "name": _s(e.get("name")), "physical": _s(e.get("physical")),
                             "note": _s(e.get("note")), "attrs": attrs}))
    ents = _ids(ents, "E")
    ref = {}
    for e in ents:
        for k in (e["id"], e["name"], e["physical"]):
            if k:
                ref.setdefault(k, e["id"])
    rels, seen = [], set()
    for r in value.get("relations") or []:
        if not isinstance(r, dict):
            continue
        src, dst = ref.get(_s(r.get("source"))), ref.get(_s(r.get("target")))
        if not src or not dst or (src, dst, _s(r.get("label"))) in seen:
            continue
        seen.add((src, dst, _s(r.get("label"))))
        card = _s(r.get("card")).upper().replace("：", ":")
        rels.append({"id": _s(r.get("id")), "source": src, "target": dst,
                     "card": card if card in CARDS else "1:N", "label": _s(r.get("label"))})
    return {"entities": ents, "relations": _ids(rels, "R")}


def coerce_states(value) -> list[dict]:
    value = _load(value) or []
    if isinstance(value, dict):
        value = [value]
    if not isinstance(value, list):
        raise ValueError("状態遷移はオブジェクトの配列で渡してください")
    out = []
    for i, m in enumerate(value):
        if not isinstance(m, dict):
            continue
        states = [_pos(s, {"id": _s(s.get("id")), "name": _s(s.get("name")) or _s(s.get("id")),
                           "kind": _s(s.get("kind")) if _s(s.get("kind")) in STATE_KINDS else "normal",
                           "note": _s(s.get("note"))})
                  for s in m.get("states") or [] if isinstance(s, dict) and (_s(s.get("name")) or _s(s.get("id")))]
        states = _ids(states, "S")
        ref = {}
        for s in states:
            ref.setdefault(s["id"], s["id"])
            ref.setdefault(s["name"], s["id"])
        trans = []
        for t in m.get("transitions") or []:
            if not isinstance(t, dict):
                continue
            src, dst = ref.get(_s(t.get("source"))), ref.get(_s(t.get("target")))
            if src and dst:
                trans.append({"id": _s(t.get("id")), "source": src, "target": dst, "event": _s(t.get("event")),
                              "guard": _s(t.get("guard")), "action": _s(t.get("action"))})
        out.append({"target": _s(m.get("target")) or f"対象{i + 1}", "states": states, "transitions": _ids(trans, "T")})
    return out


def _crud(v) -> str:
    v = _s(v).upper()
    return "".join(c for c in "CRUD" if c in v)


def coerce_specs(value) -> list[dict]:
    value = _load(value) or []
    if not isinstance(value, list):
        raise ValueError("処理仕様はオブジェクトの配列で渡してください")
    out = []
    for p in value:
        if not isinstance(p, dict) or not _s(p.get("name")):
            continue
        io = []
        for x in p.get("io") or []:
            if not isinstance(x, dict) or not _s(x.get("name")):
                continue
            kind = _s(x.get("kind")) if _s(x.get("kind")) in IO_KINDS else "その他"
            crud = _crud(x.get("crud")) if kind == "テーブル" else ""
            d = _s(x.get("dir"))
            if d not in IO_DIRS:    # テーブルは CRUD から向きを決める（R は入力、C/U/D は出力）
                d = "入力" if not crud or crud == "R" else "入出力" if "R" in crud else "出力"
            io.append({"dir": d, "kind": kind, "name": _s(x.get("name")), "crud": crud,
                       "format": _s(x.get("format")), "note": _s(x.get("note"))})
        params = [{"dir": _s(x.get("dir")) if _s(x.get("dir")) in PARAM_DIRS else "リクエスト",
                   "name": _s(x.get("name")), "label": _s(x.get("label")), "type": _s(x.get("type")),
                   "required": "必須" if _b(x.get("required")) else "任意", "note": _s(x.get("note"))}
                  for x in p.get("params") or [] if isinstance(x, dict) and (_s(x.get("name")) or _s(x.get("label")))]
        calls = [{"name": _s(x.get("name")), "cls": _s(x.get("cls")), "method": _s(x.get("method")),
                  "args": _s(x.get("args"))}
                 for x in p.get("calls") or [] if isinstance(x, dict) and (_s(x.get("name")) or _s(x.get("cls")))]
        settings = [{"key": _s(x.get("key")), "note": _s(x.get("note"))}
                    for x in p.get("settings") or [] if isinstance(x, dict) and _s(x.get("key"))]
        steps = p.get("steps") or []
        if isinstance(steps, str):
            steps = steps.splitlines()
        out.append({"id": _s(p.get("id")), "name": _s(p.get("name")),
                    "kind": _s(p.get("kind")) if _s(p.get("kind")) in SPEC_KINDS else "その他",
                    "component": _s(p.get("component")), "trigger": _s(p.get("trigger")), "fr": _s(p.get("fr")),
                    "summary": _s(p.get("summary")),
                    "steps": [re.sub(r"^\s*(\d+[.)．]|[-・*])\s*", "", str(s)).strip() for s in steps if _s(s)],
                    "constraints": _s(p.get("constraints")), "io": io, "params": params, "calls": calls,
                    "settings": settings})
    used: set[str] = {p["id"] for p in out if re.fullmatch(r"PR-\d+", p["id"])}
    seen: set[str] = set()
    n = 1
    for p in out:
        if not re.fullmatch(r"PR-\d+", p["id"]) or p["id"] in seen:
            while f"PR-{n:02d}" in used:
                n += 1
            p["id"] = f"PR-{n:02d}"
            used.add(p["id"])
        seen.add(p["id"])
    return out


def coerce_graph(value) -> dict:
    value = _load(value) or {}
    if not isinstance(value, dict):
        raise ValueError("構成図は {nodes, edges} で渡してください")
    nodes = [_pos(n, {"id": _s(n.get("id")), "label": _s(n.get("label")),
                      "kind": _s(n.get("kind")) if _s(n.get("kind")) in NODE_KINDS else "compute",
                      "zone": _s(n.get("zone")), "note": _s(n.get("note"))})
             for n in value.get("nodes") or [] if isinstance(n, dict) and _s(n.get("label"))]
    nodes = _ids(nodes, "N")
    ref = {}
    for n in nodes:
        ref.setdefault(n["id"], n["id"])
        ref.setdefault(n["label"], n["id"])
    edges = []
    for e in value.get("edges") or []:
        if not isinstance(e, dict):
            continue
        src, dst = ref.get(_s(e.get("source"))), ref.get(_s(e.get("target")))
        if src and dst and src != dst:
            edges.append({"id": _s(e.get("id")), "source": src, "target": dst, "label": _s(e.get("label"))})
    return {"nodes": nodes, "edges": _ids(edges, "L")}


COERCE = {ER: coerce_er, ST: coerce_states, SP: coerce_specs, GR: coerce_graph}


def empty(kind: str):
    return {"entities": [], "relations": []} if kind == ER else {"nodes": [], "edges": []} if kind == GR else []


def filled(kind: str, v) -> bool:
    if kind == ER:
        return bool((v or {}).get("entities"))
    if kind == GR:
        return bool((v or {}).get("nodes"))
    if kind == ST:
        return any(m.get("states") for m in v or [])
    return bool(v)


# ---------------- CRUD マトリクス ----------------
def crud_matrix(specs: list[dict], er: dict | None) -> dict:
    """処理 × テーブルの CRUD。列は概念データモデルのエンティティの順、その後にモデルにないテーブル。"""
    ents = (er or {}).get("entities") or []
    alias = {}
    for e in ents:
        for k in (e["name"], e.get("physical")):
            if k:
                alias[k.lower()] = e["name"]
    tables = [e["name"] for e in ents]
    rows = []
    for p in specs or []:
        cells: dict[str, str] = {}
        for x in p.get("io") or []:
            if x.get("kind") != "テーブル":
                continue
            name = alias.get(x["name"].lower(), x["name"])
            if name not in tables:
                tables.append(name)
            cells[name] = "".join(c for c in "CRUD" if c in cells.get(name, "") + x.get("crud", ""))
        rows.append({"id": p["id"], "name": p["name"], "cells": cells})
    return {"tables": tables, "rows": rows}


# ---------------- Markdown（下流ステージと LLM が読む） ----------------
def _q(t: str) -> str:
    return (t or "").replace('"', "'").replace("\n", " ")


def _mid(t: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "_", t) or "x"


def _table(head: list[str], rows: list[list]) -> list[str]:
    if not rows:
        return []
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(str(c).replace("|", "／").replace("\n", " ") for c in r) + " |" for r in rows]
    return out


def md_er(v: dict) -> list[str]:
    ents = v.get("entities") or []
    if not ents:
        return []
    names = {e["id"]: e for e in ents}
    lines = ["```mermaid", "erDiagram"]
    sym = {"1:1": "||--||", "1:N": "||--o{", "N:1": "}o--||", "N:M": "}o--o{"}
    for r in v.get("relations") or []:
        a, b = names[r["source"]], names[r["target"]]
        lines.append(f'  {_mid(a["physical"] or a["id"])} {sym[r["card"]]} {_mid(b["physical"] or b["id"])} '
                     f': "{_q(r["label"]) or "関連"}"')
    for e in ents:
        lines.append(f'  {_mid(e["physical"] or e["id"])}["{_q(e["name"])}"] {{')
        for a in e["attrs"]:
            key = " PK" if a["pk"] else " FK" if a["fk"] else ""
            lines.append(f'    {_mid(a["type"] or "string")} {_mid(a["physical"] or a["name"])}{key} "{_q(a["name"])}"')
        lines.append("  }")
    lines += ["```", ""]
    for e in ents:
        lines.append(f"### {e['name']}" + (f"（{e['physical']}）" if e["physical"] else ""))
        if e["note"]:
            lines.append(e["note"])
        lines += _table(["属性", "物理名", "型", "PK", "FK", "必須", "説明"],
                        [[a["name"], a["physical"], a["type"], "○" if a["pk"] else "", a["fk"],
                          "○" if a["required"] else "", a["note"]] for a in e["attrs"]])
        lines.append("")
    return lines


def md_states(v: list[dict]) -> list[str]:
    lines: list[str] = []
    for m in v or []:
        names = {s["id"]: s for s in m["states"]}
        lines += [f"### {m['target']}の状態遷移", "```mermaid", "stateDiagram-v2"]
        for s in m["states"]:
            lines.append(f'  state "{_q(s["name"])}" as {_mid(s["id"])}')
            if s["kind"] == "initial":
                lines.append(f"  [*] --> {_mid(s['id'])}")
            if s["kind"] == "final":
                lines.append(f"  {_mid(s['id'])} --> [*]")
        for t in m["transitions"]:
            lab = t["event"] + (f" [{t['guard']}]" if t["guard"] else "") + (f" / {t['action']}" if t["action"] else "")
            lines.append(f"  {_mid(t['source'])} --> {_mid(t['target'])}" + (f" : {_q(lab)}" if lab else ""))
        lines += ["```"]
        lines += _table(["状態", "説明"], [[s["name"], s["note"]] for s in m["states"]])
        lines.append("")
        lines += _table(["遷移元", "遷移先", "イベント", "条件", "処理"],
                        [[names[t["source"]]["name"], names[t["target"]]["name"], t["event"], t["guard"], t["action"]]
                         for t in m["transitions"]])
        lines.append("")
    return lines


def md_specs(v: list[dict], er: dict | None = None) -> list[str]:
    lines: list[str] = []
    for p in v or []:
        lines.append(f"### {p['id']} {p['name']}（{p['kind']}）")
        meta = [("コンポーネント", p["component"]), ("起動", p["trigger"]), ("機能要求", p["fr"])]
        lines += [f"- {k}：{x}" for k, x in meta if x]
        if p["summary"]:
            lines += ["", p["summary"]]
        if p["steps"]:
            lines += ["", "主な処理："] + [f"{i}. {s}" for i, s in enumerate(p["steps"], 1)]
        if p["constraints"]:
            lines += ["", f"制限・前提：{p['constraints']}"]
        if p["io"]:
            lines += ["", "入出力："] + _table(["向き", "種類", "名前", "CRUD", "形式", "説明"],
                                            [[x["dir"], x["kind"], x["name"], x["crud"], x["format"], x["note"]]
                                             for x in p["io"]])
        if p["params"]:
            lines += ["", "パラメータ："] + _table(["区分", "物理名", "項目名", "型", "必須", "説明"],
                                              [[x["dir"], x["name"], x["label"], x["type"], x["required"], x["note"]]
                                               for x in p["params"]])
        if p["calls"]:
            lines += ["", "呼び出す部品："] + _table(["部品", "クラス・モジュール", "メソッド", "引数"],
                                              [[x["name"], x["cls"], x["method"], x["args"]] for x in p["calls"]])
        if p["settings"]:
            lines += ["", "設定値："] + _table(["キー", "用途"], [[x["key"], x["note"]] for x in p["settings"]])
        lines.append("")
    m = crud_matrix(v, er)
    if m["tables"] and m["rows"]:
        lines += ["### CRUD マトリクス"] + _table(["処理"] + m["tables"],
                                              [[f"{r['id']} {r['name']}"] + [r["cells"].get(t, "") for t in m["tables"]]
                                               for r in m["rows"]]) + [""]
    return lines


def md_graph(v: dict) -> list[str]:
    nodes = v.get("nodes") or []
    if not nodes:
        return []
    lines = ["```mermaid", "flowchart LR"]
    zones: dict[str, list[dict]] = {}
    for n in nodes:
        zones.setdefault(n["zone"], []).append(n)
    for zi, (z, ns) in enumerate(zones.items()):
        if z:
            lines.append(f'  subgraph Z{zi}["{_q(z)}"]')
        for n in ns:
            lines.append(f'    {_mid(n["id"])}["{_q(n["label"])}<br/>{NODE_KINDS[n["kind"]]}"]')
        if z:
            lines.append("  end")
    for e in v.get("edges") or []:
        lab = f'|"{_q(e["label"])}"|' if e["label"] else ""
        lines.append(f"  {_mid(e['source'])} -->{lab} {_mid(e['target'])}")
    lines += ["```", ""]
    lines += _table(["ノード", "種類", "置き場所", "説明"],
                    [[n["label"], NODE_KINDS[n["kind"]], n["zone"], n["note"]] for n in nodes])
    return lines


def markdown(kind: str, v, draft: dict) -> list[str]:
    if kind == ER:
        return md_er(v or {})
    if kind == ST:
        return md_states(v or [])
    if kind == GR:
        return md_graph(v or {})
    er = next((x for x in (draft or {}).values() if isinstance(x, dict) and "entities" in x), None)
    return md_specs(v or [], er)


# ---------------- AI が使えないとき（スタブ）の見本 ----------------
def stub(kind: str):
    if kind == ER:
        return {"entities": [
            {"id": "E1", "name": "利用者", "physical": "USERS", "attrs": [
                {"name": "利用者ID", "physical": "user_id", "type": "bigint", "pk": True, "required": True},
                {"name": "氏名", "physical": "name", "type": "varchar", "required": True}]},
            {"id": "E2", "name": "申込", "physical": "APPLICATIONS", "attrs": [
                {"name": "申込ID", "physical": "application_id", "type": "bigint", "pk": True, "required": True},
                {"name": "利用者ID", "physical": "user_id", "type": "bigint", "fk": "利用者.利用者ID",
                 "required": True},
                {"name": "状態", "physical": "status", "type": "varchar", "required": True}]}],
            "relations": [{"source": "利用者", "target": "申込", "card": "1:N", "label": "申し込む"}]}
    if kind == ST:
        return [{"target": "申込", "states": [
            {"id": "S1", "name": "受付", "kind": "initial"}, {"id": "S2", "name": "確認中"},
            {"id": "S3", "name": "完了", "kind": "final"}, {"id": "S4", "name": "取消", "kind": "final"}],
            "transitions": [{"source": "S1", "target": "S2", "event": "担当者が確認を始める"},
                            {"source": "S2", "target": "S3", "event": "確認OK", "action": "利用者に通知"},
                            {"source": "S2", "target": "S4", "event": "取消", "guard": "完了前"}]}]
    if kind == SP:
        return [{"id": "PR-01", "name": "申込を受け付ける", "kind": "API", "component": "CP-01",
                 "trigger": "画面から呼ぶ", "fr": "FR-01", "summary": "申込を検証して登録する",
                 "steps": ["入力を検証する", "利用者を確かめる", "申込を登録する", "受付メールを送る"],
                 "io": [{"kind": "画面", "name": "申込画面", "dir": "入力"},
                        {"kind": "テーブル", "name": "利用者", "crud": "R"},
                        {"kind": "テーブル", "name": "申込", "crud": "C"},
                        {"kind": "メール", "name": "受付メール", "dir": "出力"}],
                 "params": [{"dir": "リクエスト", "name": "user_id", "label": "利用者ID", "type": "number",
                             "required": "必須"}],
                 "calls": [{"name": "メール送信", "cls": "Mailer", "method": "send", "args": "宛先, 本文"}]},
                {"id": "PR-02", "name": "申込を確認する", "kind": "画面", "component": "CP-02",
                 "trigger": "担当者の操作", "summary": "申込を確認して状態を変える",
                 "steps": ["申込を読む", "状態を更新する"],
                 "io": [{"kind": "テーブル", "name": "申込", "crud": "RU"}]}]
    return {"nodes": [{"id": "N1", "label": "利用者", "kind": "user", "zone": "外部"},
                      {"id": "N2", "label": "ロードバランサ", "kind": "edge", "zone": "パブリック"},
                      {"id": "N3", "label": "アプリ", "kind": "container", "zone": "プライベート"},
                      {"id": "N4", "label": "データベース", "kind": "db", "zone": "プライベート"}],
            "edges": [{"source": "N1", "target": "N2", "label": "HTTPS 443"},
                      {"source": "N2", "target": "N3", "label": "HTTP 8080"},
                      {"source": "N3", "target": "N4", "label": "PostgreSQL 5432"}]}
