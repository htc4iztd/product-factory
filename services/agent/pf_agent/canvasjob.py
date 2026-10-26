"""プロダクト・キャンバスの絵をジョブで作る（対話でプロダクトを作った直後の表紙など）。"""

from __future__ import annotations

from . import jobs, llmconf
from .db import JobRun, Product, session
from .engine import Engine


def start(product: Product, user: str, kind: str = "concept", note: str = "") -> dict:
    conn = llmconf.resolve(product.tenant_id)
    job_id = jobs.create(
        "canvas", product.tenant_id, product.id, user, {"kind": kind, "note": note}, total=1, model=conn.image_model
    )
    jobs.dispatch(job_id)
    return jobs.run_dict(job_id)


def run(job_id: str) -> None:
    with session() as s:
        j = s.get(JobRun, job_id)
        product = s.get(Product, j.product_id)
        kind, note, user = j.params.get("kind", "concept"), j.params.get("note", ""), j.created_by
    jobs.step(job_id, "絵を描いています", advance=False)
    image_id = Engine.generate_image(product, user, kind, note)
    jobs.step(job_id, f"できました（{image_id}）")


jobs.HANDLERS["canvas"] = run
