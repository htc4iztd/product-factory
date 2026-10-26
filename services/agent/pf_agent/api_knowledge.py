"""社内のオントロジーと、外部情報のリサーチライブラリの API（どちらもテナント全体で共有）。

読むのはテナントの誰でも、書くのは MEMBER 以上。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import ontology, research
from .authz import BASE_ORDER, Caller, caller

router = APIRouter()


def _w(c: Caller) -> None:
    if BASE_ORDER[c.base_role] < BASE_ORDER["MEMBER"]:
        raise HTTPException(403, "閲覧のみの権限では書き込めません")


# ---------------- オントロジー ----------------
class ConceptBody(BaseModel):
    label: str = Field(max_length=200)
    kind: str = "term"
    definition: str = Field(default="", max_length=5000)
    aliases: list[str] = Field(default_factory=list, max_length=30)
    examples: list[str] = Field(default_factory=list, max_length=30)
    status: str | None = None


class RelationBody(BaseModel):
    source: int
    target: int
    type: str
    note: str = Field(default="", max_length=300)


class ImportBody(BaseModel):
    format: str = "turtle"
    text: str = Field(max_length=5_000_000)


@router.get("/ontology")
def get_ontology(c: Caller = Depends(caller)):
    return ontology.graph(c.tenant)


@router.post("/ontology/concepts")
def post_concept(body: ConceptBody, c: Caller = Depends(caller)):
    _w(c)
    return ontology.save_concept(c.tenant, c.user, body.model_dump())


@router.put("/ontology/concepts/{concept_id}")
def put_concept(concept_id: int, body: ConceptBody, c: Caller = Depends(caller)):
    _w(c)
    return ontology.save_concept(c.tenant, c.user, body.model_dump(), concept_id)


@router.delete("/ontology/concepts/{concept_id}")
def del_concept(concept_id: int, c: Caller = Depends(caller)):
    _w(c)
    ontology.delete_concept(c.tenant, c.user, concept_id)
    return {"ok": True}


@router.post("/ontology/relations")
def post_relation(body: RelationBody, c: Caller = Depends(caller)):
    _w(c)
    return ontology.add_relation(c.tenant, c.user, body.source, body.target, body.type, body.note)


@router.delete("/ontology/relations/{relation_id}")
def del_relation(relation_id: int, c: Caller = Depends(caller)):
    _w(c)
    ontology.delete_relation(c.tenant, relation_id)
    return {"ok": True}


@router.post("/ontology/suggest")
def suggest(c: Caller = Depends(caller)):
    _w(c)
    return {"concepts": ontology.suggest(c.tenant, c.user)}


@router.get("/ontology/export")
def export(format: str = "turtle", c: Caller = Depends(caller)):
    body = ontology.export(c.tenant, format)
    media = "text/turtle" if format == "turtle" else "application/ld+json"
    return Response(body, media_type=f"{media}; charset=utf-8")


@router.post("/ontology/import")
def import_(body: ImportBody, c: Caller = Depends(caller)):
    _w(c)
    return ontology.import_(c.tenant, c.user, body.text, body.format)


@router.post("/ontology/context")
def context(body: dict, c: Caller = Depends(caller)):
    """確かめ用：この文章を扱うとき、AI に何が渡るか。"""
    return {"context": ontology.context_for(c.tenant, str(body.get("text", ""))[:50_000])}


# ---------------- リサーチライブラリ ----------------
class LibraryBody(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    instructions: str | None = Field(default=None, max_length=5000)
    use_search: bool | None = None
    feeds: list[str] | None = None
    sites: list[str] | None = None
    issues: list[str] | None = None
    entities: list[str] | None = None
    since: str | None = None


class Filters(BaseModel):
    q: str | None = None
    region: str | None = None
    category: str | None = None
    issue: str | None = None
    entity: str | None = None
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None

    def d(self) -> dict:
        return {
            "q": self.q,
            "region": self.region,
            "category": self.category,
            "issue": self.issue,
            "entity": self.entity,
            "from": self.from_,
            "to": self.to,
        }


class ManualBody(BaseModel):
    url: str = Field(default="", max_length=1000)
    title: str = Field(default="", max_length=500)
    text: str = Field(default="", max_length=500_000)


class AnalyzeBody(BaseModel):
    question: str = Field(default="", max_length=2000)
    filters: Filters = Field(default_factory=Filters)


class MemoBody(BaseModel):
    memo: str = Field(max_length=5000)


def _flt(
    q: str | None,
    region: str | None,
    category: str | None,
    issue: str | None,
    entity: str | None,
    frm: str | None,
    to: str | None,
) -> dict:
    return {"q": q, "region": region, "category": category, "issue": issue, "entity": entity, "from": frm, "to": to}


@router.get("/research")
def list_libraries(c: Caller = Depends(caller)):
    return research.libraries(c.tenant)


@router.post("/research")
def post_library(body: LibraryBody, c: Caller = Depends(caller)):
    _w(c)
    return research.save_library(c.tenant, c.user, body.model_dump())


@router.get("/research/{number}")
def get_library(
    number: int,
    q: str | None = None,
    region: str | None = None,
    category: str | None = None,
    issue: str | None = None,
    entity: str | None = None,
    frm: str | None = None,
    to: str | None = None,
    c: Caller = Depends(caller),
):
    return research.library(
        c.tenant, number, {k: v for k, v in _flt(q, region, category, issue, entity, frm, to).items() if v}
    )


@router.put("/research/{number}")
def put_library(number: int, body: LibraryBody, c: Caller = Depends(caller)):
    _w(c)
    return research.save_library(c.tenant, c.user, body.model_dump(exclude_unset=True), number)


@router.post("/research/{number}/update")
def update(number: int, c: Caller = Depends(caller)):
    _w(c)
    return research.start_update(c.tenant, c.user, number)


@router.post("/research/{number}/articles")
def manual(number: int, body: ManualBody, c: Caller = Depends(caller)):
    _w(c)
    return research.add_manual(c.tenant, c.user, number, body.url, body.text, body.title)


@router.put("/research/articles/{article_number}/memo")
def memo(article_number: int, body: MemoBody, c: Caller = Depends(caller)):
    _w(c)
    return research.set_memo(c.tenant, c.user, article_number, body.memo)


@router.post("/research/{number}/analyze")
def analyze(number: int, body: AnalyzeBody, c: Caller = Depends(caller)):
    _w(c)
    return research.analyze_selection(c.tenant, c.user, number, body.filters.d(), body.question)


@router.post("/research/{number}/issues/refresh")
def refresh_issues(number: int, c: Caller = Depends(caller)):
    _w(c)
    lib = research.library(c.tenant, number)
    return {"rewritten": research.refresh_issue_notes(c.tenant, lib["id"], c.user, force=True)}


@router.get("/research/{number}/facts.csv")
def facts_csv(
    number: int,
    q: str | None = None,
    region: str | None = None,
    category: str | None = None,
    issue: str | None = None,
    entity: str | None = None,
    frm: str | None = None,
    to: str | None = None,
    c: Caller = Depends(caller),
):
    body = research.facts_csv(
        c.tenant, number, {k: v for k, v in _flt(q, region, category, issue, entity, frm, to).items() if v}
    )
    return Response(
        body,
        media_type="text/csv; charset=utf-8",
        headers={"content-disposition": f'attachment; filename="RL-{number}-facts.csv"'},
    )


@router.get("/research/{number}/brief")
def brief(number: int, issue: str | None = None, region: str | None = None, c: Caller = Depends(caller)):
    return {"brief": research.brief(c.tenant, number, {"issue": issue, "region": region})}
