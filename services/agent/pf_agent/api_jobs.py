"""ジョブ（定義・走行状況・履歴・取り消し）と、自動開発・プリプロダクトの API。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import agents, autodev, cycles, ghsync, imports, issues, jobs, meetings, platform_agent, pms, reports, team
from .api_collab import _p
from .authz import Caller, caller
from .stages import STAGE_BY_ID

router = APIRouter()
P = "/products/{product_id}"


class ImportBody(BaseModel):
    filename: str = Field(min_length=1, max_length=300)
    content_b64: str = Field(min_length=1, max_length=28_000_000)
    mode: str = "propose"
    stages: list[str] = Field(default_factory=list, max_length=14)


@router.post(P + "/imports")
def start_import(product_id: str, body: ImportBody, c: Caller = Depends(caller)):
    return imports.start(_p(c, product_id, True), c.user, body.filename, body.content_b64, body.mode, body.stages)


@router.get(P + "/imports")
def list_imports(product_id: str, c: Caller = Depends(caller)):
    return imports.list_docs(_p(c, product_id))


class ReadersBody(BaseModel):
    readers: list[str] = Field(default_factory=list, max_length=20)


@router.put(P + "/imports/{doc_id}/readers")
def set_import_readers(product_id: str, doc_id: int, body: ReadersBody, c: Caller = Depends(caller)):
    return imports.set_readers(_p(c, product_id, True), doc_id, body.readers)


@router.get(P + "/imports/{doc_id}")
def get_import(product_id: str, doc_id: int, c: Caller = Depends(caller)):
    return imports.get(_p(c, product_id), doc_id)


class ReportBody(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    audience: str = Field(default="", max_length=300)
    purpose: str = Field(default="", max_length=4000)
    selection: list[dict] = Field(min_length=1, max_length=14)
    source: str = "latest"
    slides: int = Field(default=8, ge=3, le=30)


class ReportEdit(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    data: dict | None = None


@router.get(P + "/report-sources")
def report_sources(product_id: str, c: Caller = Depends(caller)):
    return reports.sources(_p(c, product_id))


@router.get(P + "/reports")
def list_reports(product_id: str, c: Caller = Depends(caller)):
    return reports.list_reports(_p(c, product_id))


@router.post(P + "/reports")
def create_report(product_id: str, body: ReportBody, c: Caller = Depends(caller)):
    return reports.create(_p(c, product_id, True), c.user, body.title, body.audience, body.purpose, body.selection,
                          body.source, body.slides)


@router.get(P + "/reports/{number}")
def get_report(product_id: str, number: int, c: Caller = Depends(caller)):
    return reports.get(_p(c, product_id), number)


@router.put(P + "/reports/{number}")
def edit_report(product_id: str, number: int, body: ReportEdit, c: Caller = Depends(caller)):
    return reports.update(_p(c, product_id, True), number, body.title, body.data)


@router.post(P + "/reports/{number}/regenerate")
def regenerate_report(product_id: str, number: int, c: Caller = Depends(caller)):
    return reports.regenerate(_p(c, product_id, True), c.user, number)


@router.delete(P + "/reports/{number}")
def delete_report(product_id: str, number: int, c: Caller = Depends(caller)):
    reports.delete(_p(c, product_id, True), number)
    return {"ok": True}


class AgentBody(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    task: str | None = None
    instruction: str | None = Field(default=None, max_length=4000)
    stages: list[str] | None = Field(default=None, max_length=14)
    params: dict | None = None
    cron: str | None = Field(default=None, max_length=100)
    timezone: str | None = Field(default=None, max_length=40)
    enabled: bool | None = None


class DecideBody(BaseModel):
    action: str
    picks: list[int] | None = None
    reason: str = Field(default="", max_length=1000)


class ReplyBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.get(P + "/agents")
def agents_overview(product_id: str, c: Caller = Depends(caller)):
    return agents.overview(_p(c, product_id))


@router.post(P + "/agents")
def create_agent(product_id: str, body: AgentBody, c: Caller = Depends(caller)):
    return agents.create(_p(c, product_id, True), c.user, body.model_dump())


@router.put(P + "/agents/{number}")
def edit_agent(product_id: str, number: int, body: AgentBody, c: Caller = Depends(caller)):
    return agents.edit(_p(c, product_id, True), number, body.model_dump())


@router.delete(P + "/agents/{number}")
def delete_agent(product_id: str, number: int, c: Caller = Depends(caller)):
    agents.delete(_p(c, product_id, True), number)
    return {"ok": True}


@router.post(P + "/agents/{number}/run")
def run_agent(product_id: str, number: int, c: Caller = Depends(caller)):
    return agents.run_now(_p(c, product_id, True), c.user, number)


@router.get(P + "/agent-findings")
def agent_findings(product_id: str, status: str | None = None, c: Caller = Depends(caller)):
    return agents.findings(_p(c, product_id), status)


@router.post(P + "/agent-findings/{fid}/decide")
def decide_finding(product_id: str, fid: int, body: DecideBody, c: Caller = Depends(caller)):
    return agents.decide(_p(c, product_id, True), c.user, fid, body.action, body.picks, body.reason)


@router.post(P + "/agent-findings/{fid}/reply")
def reply_finding(product_id: str, fid: int, body: ReplyBody, c: Caller = Depends(caller)):
    return agents.reply(_p(c, product_id, True), c.user, fid, body.text)


class TeamAgentBody(BaseModel):
    mission: str | None = Field(default=None, max_length=4000)
    cron: str | None = Field(default=None, max_length=100)
    enabled: bool | None = None


class TeamRunBody(BaseModel):
    keys: list[str] = Field(default_factory=list, max_length=20)


class TalkBody(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    stage_id: str | None = None
    meeting_id: int | None = None
    attachments: list[int] = Field(default_factory=list, max_length=5)


class IssueBody(BaseModel):
    assignee: str | None = Field(default=None, max_length=12)
    subject: str | None = Field(default=None, max_length=300)
    description: str = Field(default="", max_length=8000)
    tracker: str = "task"
    priority: str | None = None
    status: str | None = None
    done_ratio: int | None = Field(default=None, ge=0, le=100)
    due_date: str | None = Field(default=None, max_length=10)
    notes: str = Field(default="", max_length=8000)
    stage_id: str | None = None


@router.get(P + "/team")
def team_overview(product_id: str, c: Caller = Depends(caller)):
    return {**team.overview(_p(c, product_id)), "beats": team.beats(), "platform": platform_agent.summary(c.tenant)}


@router.put(P + "/team/{key}")
def edit_team_agent(product_id: str, key: str, body: TeamAgentBody, c: Caller = Depends(caller)):
    return team.edit_agent(_p(c, product_id, True), key, body.mission, body.cron, body.enabled)


@router.post(P + "/team/run")
def run_team(product_id: str, body: TeamRunBody, c: Caller = Depends(caller)):
    p = _p(c, product_id, True)
    return {"job_id": team.start(p, c.user, body.keys or list(team.KEYS))}


@router.get(P + "/board")
def get_board(product_id: str, agent: str | None = None, intent: str | None = None, q: str | None = None,
              thread: int | None = None, c: Caller = Depends(caller)):
    return team.board(_p(c, product_id), agent, intent, q, thread)


# PdM が話せるのは PM だけ
@router.get(P + "/pm/{pm}")
def pm_workspace(product_id: str, pm: str, c: Caller = Depends(caller)):
    return pms.workspace(_p(c, product_id), pm)


@router.get(P + "/pm-messages")
def pm_messages(product_id: str, pm: str | None = None, stage_id: str | None = None, meeting_id: int | None = None,
                c: Caller = Depends(caller)):
    return pms.messages(_p(c, product_id), pm, stage_id, meeting_id)


@router.post(P + "/pm/{pm}/talk")
def pm_talk(product_id: str, pm: str, body: TalkBody, c: Caller = Depends(caller)):
    return pms.talk(_p(c, product_id, True), c.user, pm, body.text, body.stage_id, body.meeting_id, body.attachments)


@router.get(P + "/issues")
def list_issues(product_id: str, assignee: str | None = None, author: str | None = None, status: str | None = None,
                open_only: bool = False, stage: str | None = None, c: Caller = Depends(caller)):
    return issues.search(_p(c, product_id), assignee, author, status, open_only, stage)


@router.post(P + "/issues")
def create_issue(product_id: str, body: IssueBody, c: Caller = Depends(caller)):
    return issues.create(_p(c, product_id, True), c.user, body.assignee or "", body.subject or "", body.description,
                         tracker=body.tracker, priority=body.priority or "normal", stage_id=body.stage_id,
                         due_date=body.due_date)


@router.get(P + "/issues/{number}")
def get_issue(product_id: str, number: int, c: Caller = Depends(caller)):
    return issues.get(_p(c, product_id), number)


@router.put(P + "/issues/{number}")
def update_issue(product_id: str, number: int, body: IssueBody, c: Caller = Depends(caller)):
    return issues.update(_p(c, product_id, True), c.user, number, notes=body.notes, status=body.status,
                         assignee=body.assignee, priority=body.priority, done_ratio=body.done_ratio,
                         due_date=body.due_date, subject=body.subject)


class NextCycleBody(BaseModel):
    strategy: str = Field(min_length=1, max_length=8000)
    directives: dict[str, str] = Field(default_factory=dict)  # PM ごとの追加指示 {pm_biz: ...}
    notes: str = Field(default="", max_length=8000)  # このサイクルのレビューの所見
    label: str = Field(default="", max_length=60)  # 計画にないサイクルを始めるときの位置付け


class PlanItem(BaseModel):
    label: str = Field(max_length=60)
    purpose: str = Field(default="", max_length=2000)
    exit: str = Field(default="", max_length=1000)


class PlanBody(BaseModel):
    items: list[PlanItem] = Field(max_length=12)


# サイクルとプロダクトレビュー
@router.get(P + "/cycle")
def get_cycle(product_id: str, c: Caller = Depends(caller)):
    return cycles.state(_p(c, product_id))


@router.get(P + "/review")
def get_review(product_id: str, c: Caller = Depends(caller)):
    p = _p(c, product_id)
    return {**cycles.state(p), "deliverables": cycles.deliverables(p)}


@router.post(P + "/review/start")
def start_review(product_id: str, c: Caller = Depends(caller)):
    return cycles.start_review(_p(c, product_id, True), c.user)


@router.post(P + "/review/next")
def next_cycle(product_id: str, body: NextCycleBody, c: Caller = Depends(caller)):
    return cycles.start_next(_p(c, product_id, True), c.user, body.strategy, body.directives, body.notes, body.label)


@router.put(P + "/cycle-plan")
def put_cycle_plan(product_id: str, body: PlanBody, c: Caller = Depends(caller)):
    return cycles.set_plan(_p(c, product_id, True), c.user, [x.model_dump() for x in body.items])


class GithubSyncBody(BaseModel):
    numbers: list[int] | None = Field(default=None, max_length=500)
    include_open: bool = False


# GitHub Issues との同期は、人が押したときだけ（自動では動かない）
@router.get(P + "/github")
def github_status(product_id: str, c: Caller = Depends(caller)):
    return ghsync.status(_p(c, product_id))


@router.post(P + "/github/sync")
def github_sync(product_id: str, body: GithubSyncBody, c: Caller = Depends(caller)):
    return ghsync.sync_many(_p(c, product_id, True), c.user, body.numbers, body.include_open)


@router.post(P + "/issues/{number}/github")
def github_sync_issue(product_id: str, number: int, c: Caller = Depends(caller)):
    return ghsync.sync_issue(_p(c, product_id, True), c.user, number)


@router.get(P + "/meetings-daily")
def list_daily_meetings(product_id: str, c: Caller = Depends(caller)):
    return meetings.list_meetings(_p(c, product_id))


@router.post(P + "/meetings-daily")
def start_daily_meeting(product_id: str, c: Caller = Depends(caller)):
    return meetings.start(_p(c, product_id, True), c.user)


@router.get(P + "/meetings-daily/{mid}")
def get_daily_meeting(product_id: str, mid: int, c: Caller = Depends(caller)):
    return meetings.get(_p(c, product_id), mid)


@router.post(P + "/meetings-daily/{mid}/close")
def close_daily_meeting(product_id: str, mid: int, c: Caller = Depends(caller)):
    return meetings.close(_p(c, product_id, True), mid)


class AutodevBody(BaseModel):
    count: int = Field(default=3, ge=1, le=4)
    hint: str = Field(default="", max_length=500)


@router.post(P + "/stages/{stage_id}/autodev")
def start_autodev(product_id: str, stage_id: str, body: AutodevBody, c: Caller = Depends(caller)):
    return autodev.start(_p(c, product_id, True), c.user, stage_id, body.count, body.hint)


@router.get(P + "/preproducts")
def list_preproducts(product_id: str, c: Caller = Depends(caller)):
    return autodev.overview(_p(c, product_id))


@router.get(P + "/preproducts/{number}")
def get_preproduct(product_id: str, number: int, c: Caller = Depends(caller)):
    return autodev.variant(_p(c, product_id), number)


@router.get(P + "/preproducts/{number}/prototype")
def get_prototype(product_id: str, number: int, c: Caller = Depends(caller)):
    page = autodev.prototype_html(_p(c, product_id), number)
    # 生成した HTML は、別の場所（iframe の sandbox）で、通信なしで動かす
    return Response(page, media_type="text/html; charset=utf-8", headers={
        "content-security-policy": "sandbox allow-scripts allow-forms allow-modals; default-src 'none'; "
                                   "script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
                                   "img-src data:; font-src data:",
        "x-content-type-options": "nosniff", "cache-control": "private, no-store"})


@router.post(P + "/preproducts/{number}/adopt")
def adopt(product_id: str, number: int, c: Caller = Depends(caller)):
    return autodev.adopt(_p(c, product_id, True), c.user, number)


@router.get(P + "/preproducts/{number}/stages/{stage_id}")
def preproduct_stage(product_id: str, number: int, stage_id: str, c: Caller = Depends(caller)):
    _stage(stage_id)
    return autodev.variant_stage(_p(c, product_id), number, stage_id)


@router.post(P + "/preproducts/{number}/stages/{stage_id}/adopt")
def adopt_preproduct_stage(product_id: str, number: int, stage_id: str, c: Caller = Depends(caller)):
    _stage(stage_id)
    return autodev.adopt_stage(_p(c, product_id, True), c.user, number, stage_id)


def _stage(stage_id: str) -> None:
    if stage_id not in STAGE_BY_ID:
        raise HTTPException(404, "ステージがありません")


@router.post(P + "/autodev/{job_id}/retry")
def retry(product_id: str, job_id: str, c: Caller = Depends(caller)):
    return autodev.retry(_p(c, product_id, True), c.user, job_id)


# ---------------- ジョブ ----------------
@router.get("/jobs")
def list_jobs(kind: str | None = None, product: str | None = None, c: Caller = Depends(caller)):
    return {"definitions": jobs.definitions(c.tenant), "runs": jobs.history(c.tenant, kind, product)}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, c: Caller = Depends(caller)):
    return jobs.get(job_id, c.tenant)


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, c: Caller = Depends(caller)):
    if c.base_role == "VIEWER":
        raise HTTPException(403, "閲覧のみの権限では取り消せません")
    return jobs.cancel(job_id, c.tenant, c.user)


# ---------------- プラットフォームエージェント（テナント全体。PdM と直接話す） ----------------
def _write(c: Caller) -> None:
    from .authz import BASE_ORDER

    if BASE_ORDER[c.base_role] < BASE_ORDER["MEMBER"]:
        raise HTTPException(403, "閲覧のみの権限では操作できません")


@router.get("/platform")
def platform_workspace(c: Caller = Depends(caller)):
    return platform_agent.workspace(c.tenant)


@router.get("/platform/summary")
def platform_summary(c: Caller = Depends(caller)):
    return platform_agent.summary(c.tenant)


class PlatformTalkBody(BaseModel):
    text: str = Field(min_length=1, max_length=8000)


@router.post("/platform/talk")
def platform_talk(body: PlatformTalkBody, c: Caller = Depends(caller)):
    _write(c)
    return platform_agent.talk(c.tenant, c.user, body.text)


@router.post("/platform/findings/{finding_id}/act")
def platform_act(finding_id: int, c: Caller = Depends(caller)):
    _write(c)
    return platform_agent.act(c.tenant, c.user, finding_id)


class FindingStatusBody(BaseModel):
    status: str


@router.put("/platform/findings/{finding_id}")
def platform_finding_status(finding_id: int, body: FindingStatusBody, c: Caller = Depends(caller)):
    _write(c)
    return platform_agent.set_status(c.tenant, finding_id, body.status)


# ---------------- ペルソナ・スキル・ツール（テナントで共通の配役） ----------------
def _admin(c: Caller) -> None:
    from .authz import BASE_ORDER

    if BASE_ORDER[c.base_role] < BASE_ORDER["ADMIN"]:
        raise HTTPException(403, "ペルソナ・スキル・ツールを変えられるのは管理者だけです")


@router.get("/agent-catalog")
def agent_catalog(c: Caller = Depends(caller)):
    from . import personas
    from . import tools as tl
    from .team import name_of

    profs = personas.profiles(c.tenant)
    sk = personas.skills(c.tenant)
    used: dict[str, list[str]] = {}
    for k, p in profs.items():
        for s in p["skills"]:
            used.setdefault(s, []).append(k)
    return {
        "agents": [
            {
                **p,
                "name": name_of(k),
                "role": "platform" if k == "platform" else "pm" if k.startswith("pm_") else "stage",
                "loadout": personas.loadout_dict(personas.loadout(c.tenant, k)),
            }
            for k, p in profs.items()
        ],
        "skills": [
            {
                **s,
                "used_by": used.get(s["id"], []),
                "referenced_by": [x["id"] for x in sk.values() if s["id"] in x["refs"]],
            }
            for s in sk.values()
        ],
        "tools": tl.catalog(),
        "persona_fields": personas.PERSONA_FIELDS,
        "limits": {"depth": personas.MAX_DEPTH, "refs": personas.MAX_REFS, "chars": personas.MAX_CHARS},
    }


class ProfileBody(BaseModel):
    persona: dict[str, str] | None = None
    skills: list[str] | None = Field(default=None, max_length=20)
    tools: list[str] | None = Field(default=None, max_length=40)
    reset: bool = False


@router.put("/agent-profiles/{key}")
def put_agent_profile(key: str, body: ProfileBody, c: Caller = Depends(caller)):
    from . import personas

    _admin(c)
    return personas.save_profile(c.tenant, c.user, key, body.persona, body.skills, body.tools, body.reset)


class SkillBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: str = "reference"
    description: str = Field(default="", max_length=2000)
    refs: list[str] = Field(default_factory=list, max_length=20)
    tools: list[str] = Field(default_factory=list, max_length=30)
    prefetch: list[str] = Field(default_factory=list, max_length=10)
    body: str = Field(default="", max_length=8000)


@router.put("/skills/{skill_id}")
def put_skill(skill_id: str, body: SkillBody, c: Caller = Depends(caller)):
    from . import personas

    _admin(c)
    return personas.save_skill(c.tenant, c.user, {"id": skill_id, **body.model_dump()})


@router.delete("/skills/{skill_id}")
def delete_skill(skill_id: str, c: Caller = Depends(caller)):
    from . import personas

    _admin(c)
    personas.delete_skill(c.tenant, skill_id)
    return {"ok": True}


# ---------------- 定期実行の予定（画面では cron を見せずに選ぶ） ----------------
@router.get(P + "/schedule")
def get_schedule(product_id: str, c: Caller = Depends(caller)):
    from . import schedule

    return schedule.view(_p(c, product_id))


class ScheduleBody(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=20)
    cron: str | None = Field(default=None, max_length=100)
    enabled: bool | None = None


@router.put(P + "/schedule")
def put_schedule(product_id: str, body: ScheduleBody, c: Caller = Depends(caller)):
    from . import schedule

    return schedule.bulk(_p(c, product_id, True), body.keys, body.cron, body.enabled)


class PreviewBody(BaseModel):
    cron: str = Field(min_length=1, max_length=100)


@router.post("/schedule/preview")
def preview_schedule(body: PreviewBody, c: Caller = Depends(caller)):
    from . import schedule

    return schedule.preview(body.cron)


@router.get("/schedule-overview")
def schedule_overview(c: Caller = Depends(caller)):
    from . import schedule

    return {"products": schedule.overview(c.tenant), "platform": schedule.platform_setting(c.tenant)}


class PlatformEveryBody(BaseModel):
    every_min: int


@router.put("/platform/schedule")
def put_platform_schedule(body: PlatformEveryBody, c: Caller = Depends(caller)):
    from . import schedule

    _write(c)
    return schedule.set_platform_every(c.tenant, body.every_min)


# ---------------- ファクトリー全体で1つのチャット ----------------
class AssistantBody(BaseModel):
    path: str = Field(default="/", max_length=500)
    text: str = Field(min_length=1, max_length=8000)
    mentions: list[dict] = Field(default_factory=list, max_length=10)
    attachments: list[int] = Field(default_factory=list, max_length=5)
    material: str = Field(default="", max_length=40000)  # 発言に添える材料（リサーチのまとめなど。画面には出さない）
    reply_to: int | None = None  # 返事をする元の発言（引用して送る）


@router.post("/assistant/messages")
def assistant_send(body: AssistantBody, c: Caller = Depends(caller)):
    from . import assistant

    _write(c)
    return assistant.send(
        c.tenant, c.user, body.path, body.text, body.mentions, body.attachments, body.material, body.reply_to
    )


@router.get("/assistant/messages")
def assistant_feed(after: int = 0, limit: int = 80, product: str = "", c: Caller = Depends(caller)):
    from . import assistant

    if product:
        _p(c, product)
    return assistant.feed(c.tenant, c.user, min(max(limit, 1), 200), after, product or None)


class ApproveBody(BaseModel):
    approve: bool


@router.post("/assistant/messages/{message_id}/actions/{action_id}")
def assistant_decide(message_id: int, action_id: str, body: ApproveBody, c: Caller = Depends(caller)):
    from . import assistant

    _write(c)
    return assistant.decide(c.tenant, c.user, message_id, action_id, body.approve)


@router.get("/assistant/mentions")
def assistant_mentions(product: str = "", c: Caller = Depends(caller)):
    from . import assistant

    p = _p(c, product) if product else None
    return assistant.mention_choices(p)


# ---------------- ダッシュボードで承認する案 ----------------
@router.get(P + "/approvals")
def get_approvals(product_id: str, c: Caller = Depends(caller)):
    from . import approvals

    return approvals.pending(_p(c, product_id))


class ApprovalBody(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=100)
    accept: bool


@router.post(P + "/approvals")
def decide_approvals(product_id: str, body: ApprovalBody, c: Caller = Depends(caller)):
    from . import approvals

    return approvals.decide(_p(c, product_id, True), c.user, body.keys, body.accept)


# ---------------- フレームワークのライブラリと、工程ごとの組み合わせ ----------------
@router.get("/frameworks")
def get_frameworks(c: Caller = Depends(caller)):
    from . import fwlib

    return {"frameworks": list(fwlib.library(c.tenant).values()), "kinds": fwlib.KINDS}


class FrameworkBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(default="", max_length=60)
    description: str = Field(default="", max_length=2000)
    stages: list[str] = Field(default_factory=list, max_length=14)
    blocks: list[dict] = Field(min_length=1, max_length=30)


@router.put("/frameworks/{fw_id}")
def put_framework(fw_id: str, body: FrameworkBody, c: Caller = Depends(caller)):
    from . import fwlib

    _admin(c)
    return fwlib.save(c.tenant, c.user, fw_id, body.model_dump())


@router.delete("/frameworks/{fw_id}")
def delete_framework(fw_id: str, c: Caller = Depends(caller)):
    from . import fwlib

    _admin(c)
    fwlib.delete(c.tenant, fw_id)
    return {"ok": True}


@router.get(P + "/stages/{stage_id}/frameworks")
def get_stage_frameworks(product_id: str, stage_id: str, c: Caller = Depends(caller)):
    from . import fwlib

    p = _p(c, product_id)
    items, custom = fwlib.attached(p.id, stage_id)
    return {"items": items, "customized": custom, "suggested": [
        f["id"] for f in fwlib.library(c.tenant).values() if stage_id in (f.get("stages") or [])]}


class StageFrameworksBody(BaseModel):
    items: list[dict] = Field(default_factory=list, max_length=20)


@router.put(P + "/stages/{stage_id}/frameworks")
def put_stage_frameworks(product_id: str, stage_id: str, body: StageFrameworksBody, c: Caller = Depends(caller)):
    from . import fwlib

    return {"items": fwlib.set_attached(_p(c, product_id, True), c.user, stage_id, body.items)}
