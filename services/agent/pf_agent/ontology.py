"""社内情報のオントロジー：社内の用語・組織・役割・業務・システムと、その関係（テナント全体で1つ）。

AI は、扱う文章に出てくる語（名前か別名）に関係する部分だけを、その都度前提として受け取る（context_for）。
書き出し・読み込みは SKOS（W3C の語彙の標準）で、JSON-LD と Turtle を使う。
"""

from __future__ import annotations

import re

from pydantic import BaseModel
from sqlalchemy import select

from . import llm, llmconf, repo
from .db import Concept, Decision, Doc, Product, Relation, session

KINDS = {
    "term": "用語",
    "org": "組織",
    "role": "役割",
    "process": "業務プロセス",
    "system": "システム",
    "other": "その他",
}
REL_TYPES = {
    "is_a": "〜の一種",
    "part_of": "〜の一部",
    "owned_by": "〜が担当",
    "uses": "〜を使う",
    "precedes": "〜の前に行う",
    "related": "関係する",
}
NS = "https://product-factory.dev/ns#"


class OntologyError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def concept_dict(c: Concept) -> dict:
    return {
        "id": c.id,
        "label": c.label,
        "kind": c.kind,
        "definition": c.definition,
        "aliases": c.aliases or [],
        "examples": c.examples or [],
        "status": c.status,
        "source": c.source,
        "updated_by": c.updated_by,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def graph(tenant: str) -> dict:
    with session() as s:
        cs = list(s.execute(select(Concept).where(Concept.tenant_id == tenant).order_by(Concept.label)).scalars())
        rs = list(s.execute(select(Relation).where(Relation.tenant_id == tenant)).scalars())
    return {
        "concepts": [concept_dict(c) for c in cs],
        "relations": [
            {"id": r.id, "source": r.source_id, "target": r.target_id, "type": r.type, "note": r.note} for r in rs
        ],
        "kinds": KINDS,
        "relation_types": REL_TYPES,
    }


def _clean(body: dict) -> dict:
    label = str(body.get("label") or "").strip()
    if not label:
        raise OntologyError(422, "名前を入れてください")
    kind = body.get("kind") or "term"
    if kind not in KINDS:
        raise OntologyError(422, f"種類は {list(KINDS)} のどれか")

    def as_list(v):
        return [x.strip() for x in (v or []) if str(x).strip()][:30]

    return {
        "label": label[:200],
        "kind": kind,
        "definition": str(body.get("definition") or "")[:5000],
        "aliases": as_list(body.get("aliases")),
        "examples": as_list(body.get("examples")),
    }


def save_concept(tenant: str, user: str, body: dict, concept_id: int | None = None) -> dict:
    v = _clean(body)
    with session() as s:
        dup = s.execute(
            select(Concept).where(Concept.tenant_id == tenant, Concept.label == v["label"])
        ).scalar_one_or_none()
        if dup is not None and dup.id != concept_id:
            raise OntologyError(409, f"「{v['label']}」は既にあります")
        if concept_id is None:
            c = Concept(tenant_id=tenant, updated_by=user, **v)
            s.add(c)
        else:
            c = s.get(Concept, concept_id)
            if c is None or c.tenant_id != tenant:
                raise OntologyError(404, "ありません")
            for k, val in v.items():
                setattr(c, k, val)
            c.updated_by = user
        if body.get("status") in ("active", "proposed"):
            c.status = body["status"]
        s.commit()
        out = concept_dict(c)
    repo.log(None, None, "human", user, "ontology.save", {"concept": out["label"]}, tenant_id=tenant)
    return out


def delete_concept(tenant: str, user: str, concept_id: int) -> None:
    with session() as s:
        c = s.get(Concept, concept_id)
        if c is None or c.tenant_id != tenant:
            raise OntologyError(404, "ありません")
        for r in s.execute(
            select(Relation).where((Relation.source_id == concept_id) | (Relation.target_id == concept_id))
        ).scalars():
            s.delete(r)
        label = c.label
        s.delete(c)
        s.commit()
    repo.log(None, None, "human", user, "ontology.delete", {"concept": label}, tenant_id=tenant)


def add_relation(tenant: str, user: str, source: int, target: int, rtype: str, note: str = "") -> dict:
    if rtype not in REL_TYPES:
        raise OntologyError(422, f"関係は {list(REL_TYPES)} のどれか")
    if source == target:
        raise OntologyError(422, "同じものどうしはつなげません")
    with session() as s:
        for cid in (source, target):
            c = s.get(Concept, cid)
            if c is None or c.tenant_id != tenant:
                raise OntologyError(404, "ありません")
        r = Relation(tenant_id=tenant, source_id=source, target_id=target, type=rtype, note=note[:300])
        s.add(r)
        s.commit()
        return {"id": r.id, "source": source, "target": target, "type": rtype, "note": r.note}


def delete_relation(tenant: str, relation_id: int) -> None:
    with session() as s:
        r = s.get(Relation, relation_id)
        if r is None or r.tenant_id != tenant:
            raise OntologyError(404, "ありません")
        s.delete(r)
        s.commit()


# ---------------- AI に渡す ----------------
def context_for(tenant: str, text: str, limit: int = 30) -> str:
    """文章に出てくる語（名前・別名）の概念と、その周り1段の関係を Markdown にする。なければ空。"""
    if not text:
        return ""
    with session() as s:
        cs = list(s.execute(select(Concept).where(Concept.tenant_id == tenant, Concept.status == "active")).scalars())
        if not cs:
            return ""
        rs = list(s.execute(select(Relation).where(Relation.tenant_id == tenant)).scalars())
    by_id = {c.id: c for c in cs}
    hit = [c for c in cs if any(n and n in text for n in [c.label, *(c.aliases or [])])][:limit]
    if not hit:
        return ""
    ids = {c.id for c in hit}
    lines = []
    for c in hit:
        alias = f"（別名：{'、'.join(c.aliases)}）" if c.aliases else ""
        lines.append(f"- **{c.label}**［{KINDS.get(c.kind, c.kind)}］{alias}：{c.definition or '定義なし'}")
        for r in rs:
            if r.source_id == c.id and r.target_id in by_id:
                lines.append(f"  - {REL_TYPES[r.type]}：{by_id[r.target_id].label}")
            elif r.target_id == c.id and r.source_id in by_id and r.source_id not in ids:
                lines.append(f"  - {by_id[r.source_id].label} が「{REL_TYPES[r.type]}」としてつながる")
    return "社内で使う言葉の意味と関係（社内のオントロジー）。この意味で読み、この言葉で書く。\n" + "\n".join(lines)


# ---------------- 候補を出す ----------------
class Candidate(BaseModel):
    label: str
    kind: str
    definition: str
    aliases: list[str]


class Candidates(BaseModel):
    concepts: list[Candidate]


def suggest(tenant: str, user: str) -> list[dict]:
    """決定記録とドキュメントから、まだ登録していない社内の用語の候補を AI に出させる（status=proposed）。"""
    with session() as s:
        pids = [p.id for p in s.execute(select(Product).where(Product.tenant_id == tenant)).scalars()]
        if not pids:
            return []
        ds = s.execute(
            select(Decision).where(Decision.product_id.in_(pids)).order_by(Decision.id.desc()).limit(100)
        ).scalars()
        docs = s.execute(select(Doc).where(Doc.product_id.in_(pids)).order_by(Doc.id.desc()).limit(30)).scalars()
        text = "\n".join([f"{d.title}：{d.detail}" for d in ds] + [f"# {d.title}\n{d.body[:4000]}" for d in docs])
        known = {c.label for c in s.execute(select(Concept).where(Concept.tenant_id == tenant)).scalars()}
    if not text.strip():
        return []
    conn = llmconf.resolve(tenant)
    if conn.provider == "stub":
        labels = list(dict.fromkeys(re.findall(r"「([^」]{2,30})」", text)))
        found = [Candidate(label=x, kind="term", definition="", aliases=[]) for x in labels]
    else:
        prompt = (
            "次は社内の決定記録とドキュメントです。社内に特有の用語・組織名・役割・業務プロセス・システム名を挙げ、"
            "文中から読み取れる範囲で定義を書いてください。一般的な言葉は入れない。推測で定義を作らない。"
            f"kind は {list(KINDS)} のどれか。\n\n既に登録済み：{'、'.join(sorted(known)) or 'なし'}\n\n"
            f"## 本文\n{text[-50000:]}"
        )
        found = llm._json(conn, conn.summary_model, prompt, Candidates).concepts
    out = []
    with session() as s:
        for f in found:
            if f.label in known or not f.label.strip():
                continue
            c = Concept(
                tenant_id=tenant,
                label=f.label[:200],
                kind=f.kind if f.kind in KINDS else "term",
                definition=f.definition,
                aliases=f.aliases[:10],
                status="proposed",
                source={"kind": "suggest"},
                updated_by=f"ai ({user})",
            )
            s.add(c)
            known.add(f.label)
            s.flush()
            out.append(concept_dict(c))
        s.commit()
    return out


# ---------------- 書き出し・読み込み（SKOS） ----------------
def _graph_rdf(tenant: str):
    from rdflib import RDF, Graph, Literal, Namespace, URIRef
    from rdflib.namespace import SKOS

    pf = Namespace(NS)
    g = Graph()
    g.bind("skos", SKOS)
    g.bind("pf", pf)
    data = graph(tenant)
    uri = {c["id"]: URIRef(f"urn:pf:concept:{c['id']}") for c in data["concepts"]}
    for c in data["concepts"]:
        u = uri[c["id"]]
        g.add((u, RDF.type, SKOS.Concept))
        g.add((u, SKOS.prefLabel, Literal(c["label"], lang="ja")))
        for a in c["aliases"]:
            g.add((u, SKOS.altLabel, Literal(a, lang="ja")))
        if c["definition"]:
            g.add((u, SKOS.definition, Literal(c["definition"], lang="ja")))
        for e in c["examples"]:
            g.add((u, SKOS.example, Literal(e, lang="ja")))
        g.add((u, pf.kind, Literal(c["kind"])))
    for r in data["relations"]:
        pred = {"is_a": SKOS.broader, "related": SKOS.related}.get(r["type"], pf[r["type"]])
        g.add((uri[r["source"]], pred, uri[r["target"]]))
    return g


def export(tenant: str, fmt: str) -> str:
    if fmt not in ("turtle", "json-ld"):
        raise OntologyError(422, "形式は turtle か json-ld")
    return _graph_rdf(tenant).serialize(format=fmt)


def import_(tenant: str, user: str, text: str, fmt: str) -> dict:
    from rdflib import RDF, Graph, Namespace
    from rdflib.namespace import SKOS

    if fmt not in ("turtle", "json-ld"):
        raise OntologyError(422, "形式は turtle か json-ld")
    pf = Namespace(NS)
    g = Graph()
    try:
        g.parse(data=text, format=fmt)
    except Exception as e:  # noqa: BLE001  読めない内容はそのまま伝える
        raise OntologyError(422, f"読み込めません：{str(e)[:200]}") from None
    created = updated = rels = 0
    ids = {}
    with session() as s:
        existing = {c.label: c for c in s.execute(select(Concept).where(Concept.tenant_id == tenant)).scalars()}
        for u in g.subjects(RDF.type, SKOS.Concept):
            label = str(g.value(u, SKOS.prefLabel) or "").strip()
            if not label:
                continue
            kind = str(g.value(u, pf.kind) or "term")
            vals = {
                "kind": kind if kind in KINDS else "term",
                "definition": str(g.value(u, SKOS.definition) or ""),
                "aliases": sorted(str(a) for a in g.objects(u, SKOS.altLabel)),
                "examples": sorted(str(a) for a in g.objects(u, SKOS.example)),
            }
            c = existing.get(label)
            if c is None:
                c = Concept(tenant_id=tenant, label=label, updated_by=user, **vals)
                s.add(c)
                existing[label] = c
                created += 1
            else:
                for k, v in vals.items():
                    setattr(c, k, v)
                c.updated_by = user
                updated += 1
            s.flush()
            ids[u] = c.id
        have = {
            (r.source_id, r.target_id, r.type)
            for r in s.execute(select(Relation).where(Relation.tenant_id == tenant)).scalars()
        }
        preds = {SKOS.broader: "is_a", SKOS.related: "related", **{pf[k]: k for k in REL_TYPES}}
        for p, rtype in preds.items():
            for a, b in g.subject_objects(p):
                if a in ids and b in ids and (ids[a], ids[b], rtype) not in have:
                    s.add(Relation(tenant_id=tenant, source_id=ids[a], target_id=ids[b], type=rtype))
                    have.add((ids[a], ids[b], rtype))
                    rels += 1
        s.commit()
    repo.log(
        None,
        None,
        "human",
        user,
        "ontology.import",
        {"created": created, "updated": updated, "relations": rels},
        tenant_id=tenant,
    )
    return {"created": created, "updated": updated, "relations": rels}
