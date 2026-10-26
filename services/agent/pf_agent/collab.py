"""チーム：チケット・チャンネルとスレッド・決定記録・会議と議事録・共有ドキュメント。

仕様は会話の中で決まることが多い。ここでは会話（自前・外部）から AI が「決まったこと」を抜き出し、
人が確定したものを決定記録（DEC-n）として残す。決定記録・チケット・ドキュメントは成果物の ID
（US-01 など）と同じ書き方で互いを参照でき、ステージの対話の文脈にも入る。

外部の会話（Google Workspace・Microsoft 365 など）はチャンネルにつないで取り込む。
本文ごと保存する（copy）か、要約と決定だけを残す（summary）かをチャンネルごとに選べる。
"""
from __future__ import annotations

import datetime as dt
import re

from sqlalchemy import func, select

from . import llm, llmconf, ontology, repo
from .db import Channel, Decision, Doc, Meeting, Notice, Post, Product, Ticket, session
from .frameworks import ids_in

TICKET_STATUSES = ("triage", "todo", "doing", "review", "done", "closed")
PRIORITIES = ("P1", "P2", "P3")
DECISION_STATUSES = ("proposed", "confirmed", "rejected", "superseded")
IMPORT_MODES = ("copy", "summary")
PROVIDERS = {"gchat": "Google Chat", "gmail": "Gmail", "meet": "Google Meet", "teams": "Microsoft Teams",
             "outlook": "Outlook", "slack": "Slack", "other": "その他"}
MENTION_RE = re.compile(r"@([\w.+-]+@[\w-]+\.[\w.-]+)")
PREFIX = {"TK": "ticket", "DEC": "decision", "MTG": "meeting", "DOC": "doc"}


class CollabError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _refs(*texts: str) -> list[str]:
    seen: list[str] = []
    for t in texts:
        for r in ids_in(t):
            if r not in seen:
                seen.append(r)
    return seen


def _next(s, model, product_id: str) -> int:
    return (s.execute(select(func.max(model.number)).where(model.product_id == product_id)).scalar() or 0) + 1


def _iso(d: dt.datetime | None) -> str | None:
    return d.isoformat() if d else None


def _notify(s, product: Product, users: list[str], kind: str, text: str, link: str, actor: str) -> None:
    for u in dict.fromkeys(users):
        if u and u != actor:
            s.add(Notice(tenant_id=product.tenant_id, user=u, product_id=product.id, kind=kind,
                         text=text[:300], link=link[:300], actor=actor))


# ---------------- チケット ----------------
def ticket_dict(t: Ticket, comments: int | None = None) -> dict:
    d = {"number": t.number, "key": f"TK-{t.number}", "title": t.title, "body": t.body, "status": t.status,
         "priority": t.priority, "assignee": t.assignee, "stage_id": t.stage_id, "refs": t.refs or [],
         "due": t.due, "source": t.source, "external": t.external, "created_by": t.created_by,
         "created_at": _iso(t.created_at), "updated_at": _iso(t.updated_at)}
    if comments is not None:
        d["comments"] = comments
    return d


def _check_ticket(body: dict) -> None:
    if "status" in body and body["status"] not in TICKET_STATUSES:
        raise CollabError(422, f"状態は {list(TICKET_STATUSES)} のどれか")
    if "priority" in body and body["priority"] not in PRIORITIES:
        raise CollabError(422, f"優先度は {list(PRIORITIES)} のどれか")
    if body.get("due") and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", body["due"]):
        raise CollabError(422, "期日は YYYY-MM-DD で入れてください")


def create_ticket(product: Product, user: str, body: dict, source: dict | None = None) -> dict:
    _check_ticket(body)
    title = str(body.get("title") or "").strip()
    if not title:
        raise CollabError(422, "タイトルを入れてください")
    with session() as s:
        t = Ticket(product_id=product.id, number=_next(s, Ticket, product.id), title=title[:300],
                   body=str(body.get("body") or ""), status=body.get("status") or "todo",
                   priority=body.get("priority") or "P2", assignee=(body.get("assignee") or None),
                   stage_id=body.get("stage_id") or None, due=body.get("due") or None, source=source,
                   refs=_refs(title, body.get("body") or "", " ".join(body.get("refs") or [])), created_by=user)
        s.add(t)
        s.flush()
        if t.assignee:
            _notify(s, product, [t.assignee], "assigned", f"TK-{t.number} {t.title}",
                    f"/p/{product.id}/tickets/{t.number}", user)
        s.commit()
        out = ticket_dict(t, 0)
    repo.log(product.id, t.stage_id, "human", user, "ticket.create", {"ticket": out["key"], "title": title})
    return out


def tickets(product: Product, status: str | None = None) -> list[dict]:
    with session() as s:
        q = select(Ticket).where(Ticket.product_id == product.id)
        if status:
            q = q.where(Ticket.status == status)
        rows = list(s.execute(q.order_by(Ticket.number.desc())).scalars())
        counts = dict(s.execute(select(Post.ticket_id, func.count()).where(
            Post.product_id == product.id, Post.ticket_id.is_not(None)).group_by(Post.ticket_id)).all())
        return [ticket_dict(t, counts.get(t.id, 0)) for t in rows]


def _ticket(s, product: Product, number: int) -> Ticket:
    t = s.execute(select(Ticket).where(Ticket.product_id == product.id, Ticket.number == number)).scalar_one_or_none()
    if t is None:
        raise CollabError(404, f"TK-{number} はありません")
    return t


def ticket(product: Product, number: int) -> dict:
    with session() as s:
        t = _ticket(s, product, number)
        posts = list(s.execute(select(Post).where(Post.ticket_id == t.id).order_by(Post.id)).scalars())
        return {**ticket_dict(t, len(posts)), "comments": [post_dict(p) for p in posts]}


def update_ticket(product: Product, user: str, number: int, body: dict) -> dict:
    _check_ticket(body)
    with session() as s:
        t = _ticket(s, product, number)
        changed = {}
        for k in ("title", "body", "status", "priority", "assignee", "stage_id", "due"):
            if k in body and body[k] != getattr(t, k):
                changed[k] = body[k]
                setattr(t, k, (body[k] or None) if k in ("assignee", "stage_id", "due") else body[k])
        if not t.title.strip():
            raise CollabError(422, "タイトルを入れてください")
        if "refs" in body or "title" in changed or "body" in changed:
            t.refs = _refs(t.title, t.body, " ".join(body.get("refs") or t.refs or []))
        if changed.get("assignee"):
            _notify(s, product, [t.assignee], "assigned", f"TK-{t.number} {t.title}",
                    f"/p/{product.id}/tickets/{t.number}", user)
        s.commit()
        out = ticket_dict(t)
    if changed:
        repo.log(product.id, t.stage_id, "human", user, "ticket.update", {"ticket": out["key"], **changed})
    return out


# ---------------- チャンネルと発言 ----------------
def post_dict(p: Post, replies: int | None = None) -> dict:
    d = {"id": p.id, "channel_id": p.channel_id, "parent_id": p.parent_id, "author": p.author, "body": p.body,
         "refs": p.refs or [], "mentions": p.mentions or [], "source": p.source, "created_at": _iso(p.created_at)}
    if replies is not None:
        d["replies"] = replies
    return d


def channel_dict(c: Channel, posts: int = 0) -> dict:
    return {"id": c.id, "name": c.name, "topic": c.topic, "external": c.external, "posts": posts,
            "created_by": c.created_by, "created_at": _iso(c.created_at)}


def _check_external(ext: dict | None) -> dict | None:
    if not ext:
        return None
    if ext.get("provider") not in PROVIDERS:
        raise CollabError(422, f"つなぐ先は {list(PROVIDERS)} のどれか")
    if ext.get("mode") not in IMPORT_MODES:
        raise CollabError(422, "取り込み方は copy（本文ごと）か summary（要約と決定だけ）")
    return {"provider": ext["provider"], "mode": ext["mode"], "ref": str(ext.get("ref") or "")[:300],
            "url": str(ext.get("url") or "")[:500]}


def channels(product: Product) -> list[dict]:
    with session() as s:
        q = select(Channel).where(Channel.product_id == product.id).order_by(Channel.created_at)
        rows = list(s.execute(q).scalars())
        if not rows:  # 最初の1つは自動で作る
            c = Channel(product_id=product.id, name="全体", topic="このプロダクトの全体の話", created_by="system")
            s.add(c)
            s.commit()
            rows = [c]
        counts = dict(s.execute(select(Post.channel_id, func.count()).where(
            Post.product_id == product.id, Post.parent_id.is_(None)).group_by(Post.channel_id)).all())
        return [channel_dict(c, counts.get(c.id, 0)) for c in rows]


def create_channel(product: Product, user: str, name: str, topic: str, external: dict | None) -> dict:
    name = name.strip().lstrip("#")
    if not name:
        raise CollabError(422, "チャンネル名を入れてください")
    ext = _check_external(external)
    channels(product)  # 「全体」を先に作っておく
    with session() as s:
        if s.execute(select(Channel).where(Channel.product_id == product.id, Channel.name == name)).first():
            raise CollabError(409, f"#{name} は既にあります")
        c = Channel(product_id=product.id, name=name[:80], topic=topic[:300], external=ext, created_by=user)
        s.add(c)
        s.commit()
        out = channel_dict(c)
    repo.log(product.id, None, "human", user, "channel.create", {"channel": name, "external": ext})
    return out


def _channel(s, product: Product, channel_id: str) -> Channel:
    c = s.get(Channel, channel_id)
    if c is None or c.product_id != product.id:
        raise CollabError(404, "チャンネルがありません")
    return c


def channel_posts(product: Product, channel_id: str, limit: int = 200) -> dict:
    with session() as s:
        c = _channel(s, product, channel_id)
        roots = list(s.execute(select(Post).where(Post.channel_id == c.id, Post.parent_id.is_(None))
                               .order_by(Post.id.desc()).limit(limit)).scalars())
        counts = dict(s.execute(select(Post.parent_id, func.count()).where(
            Post.channel_id == c.id, Post.parent_id.is_not(None)).group_by(Post.parent_id)).all())
        return {"channel": channel_dict(c), "posts": [post_dict(p, counts.get(p.id, 0)) for p in reversed(roots)]}


def thread(product: Product, post_id: int) -> dict:
    with session() as s:
        root = s.get(Post, post_id)
        if root is None or root.product_id != product.id or root.parent_id is not None:
            raise CollabError(404, "スレッドがありません")
        replies = list(s.execute(select(Post).where(Post.parent_id == root.id).order_by(Post.id)).scalars())
        decisions = list(s.execute(select(Decision).where(Decision.product_id == product.id)).scalars())
        linked = [decision_dict(d) for d in decisions
                  if (d.source or {}).get("kind") == "thread" and (d.source or {}).get("id") == root.id]
        return {"root": post_dict(root, len(replies)), "replies": [post_dict(p) for p in replies],
                "decisions": linked}


def add_post(product: Product, user: str, body: str, channel_id: str | None = None, parent_id: int | None = None,
             ticket_number: int | None = None, source: dict | None = None) -> dict:
    body = body.strip()
    if not body:
        raise CollabError(422, "本文を入れてください")
    with session() as s:
        ticket_id = None
        link = f"/p/{product.id}/talk"
        if ticket_number is not None:
            t = _ticket(s, product, ticket_number)
            ticket_id, link = t.id, f"/p/{product.id}/tickets/{t.number}"
        else:
            c = _channel(s, product, channel_id or "")
            link = f"/p/{product.id}/talk?c={c.id}"
            if parent_id is not None:
                parent = s.get(Post, parent_id)
                if parent is None or parent.channel_id != c.id or parent.parent_id is not None:
                    raise CollabError(404, "返信先のスレッドがありません")
                link += f"&t={parent.id}"
        mentions = list(dict.fromkeys(MENTION_RE.findall(body)))
        p = Post(product_id=product.id, channel_id=channel_id if ticket_id is None else None, ticket_id=ticket_id,
                 parent_id=parent_id, author=user, body=body, refs=_refs(body), mentions=mentions, source=source)
        s.add(p)
        s.flush()
        _notify(s, product, mentions, "mention", f"{user}：{body[:120]}", link, user)
        s.commit()
        return post_dict(p)


# ---------------- 決定記録 ----------------
def decision_dict(d: Decision) -> dict:
    return {"number": d.number, "key": f"DEC-{d.number}", "title": d.title, "detail": d.detail,
            "rationale": d.rationale, "status": d.status, "stage_id": d.stage_id, "refs": d.refs or [],
            "source": d.source, "proposed_by": d.proposed_by, "decided_by": d.decided_by,
            "decided_at": _iso(d.decided_at), "created_at": _iso(d.created_at)}


def _add_decision(s, product: Product, user: str, title: str, detail: str, rationale: str, refs: list[str],
                  source: dict, stage_id: str | None = None, status: str = "proposed") -> Decision:
    d = Decision(product_id=product.id, number=_next(s, Decision, product.id), title=title[:300], detail=detail,
                 rationale=rationale, status=status, stage_id=stage_id, refs=_refs(title, detail, " ".join(refs)),
                 source=source, proposed_by=user)
    if status == "confirmed":
        d.decided_by, d.decided_at = user, dt.datetime.now(dt.UTC)
    s.add(d)
    s.flush()
    return d


def decisions(product: Product, status: str | None = None) -> list[dict]:
    with session() as s:
        q = select(Decision).where(Decision.product_id == product.id)
        if status:
            q = q.where(Decision.status == status)
        return [decision_dict(d) for d in s.execute(q.order_by(Decision.number.desc())).scalars()]


def create_decision(product: Product, user: str, body: dict) -> dict:
    title = str(body.get("title") or "").strip()
    if not title:
        raise CollabError(422, "何を決めたかを入れてください")
    with session() as s:
        d = _add_decision(s, product, user, title, str(body.get("detail") or ""), str(body.get("rationale") or ""),
                          list(body.get("refs") or []), {"kind": "manual"}, body.get("stage_id") or None,
                          "confirmed" if body.get("confirmed") else "proposed")
        s.commit()
        out = decision_dict(d)
    repo.log(product.id, out["stage_id"], "human", user, "decision.create", {"decision": out["key"], "title": title})
    return out


def decide(product: Product, user: str, number: int, body: dict) -> dict:
    status = body.get("status")
    if status not in DECISION_STATUSES or status == "proposed":
        raise CollabError(422, "confirmed / rejected / superseded のどれか")
    with session() as s:
        q = select(Decision).where(Decision.product_id == product.id, Decision.number == number)
        d = s.execute(q).scalar_one_or_none()
        if d is None:
            raise CollabError(404, f"DEC-{number} はありません")
        for k in ("title", "detail", "rationale", "stage_id"):
            if k in body and body[k] is not None:
                setattr(d, k, body[k] or (None if k == "stage_id" else ""))
        d.refs = _refs(d.title, d.detail, " ".join(body.get("refs") or d.refs or []))
        d.status, d.decided_by, d.decided_at = status, user, dt.datetime.now(dt.UTC)
        s.commit()
        out = decision_dict(d)
    repo.log(product.id, out["stage_id"], "human", user, f"decision.{status}", {"decision": out["key"],
                                                                                 "title": out["title"]})
    ticket_out = None
    if status == "confirmed" and body.get("create_ticket"):
        ticket_out = create_ticket(product, user, {"title": f"{out['key']} を反映：{out['title']}",
                                                   "body": out["detail"], "refs": [out["key"], *out["refs"]],
                                                   "stage_id": out["stage_id"]},
                                   source={"kind": "decision", "id": out["key"]})
    return {**out, "ticket": ticket_out}


def stage_decisions(product_id: str, stage_id: str, draft_ids: list[str]) -> list[dict]:
    """ステージの対話に渡す、確定した決定記録（そのステージ宛て、または下書きの ID に触れるもの）。"""
    with session() as s:
        rows = s.execute(select(Decision).where(Decision.product_id == product_id,
                                                Decision.status == "confirmed")).scalars()
        ids = set(draft_ids)
        return [decision_dict(d) for d in rows if d.stage_id == stage_id or ids & set(d.refs or [])]


# ---------------- 会話から決定と宿題を抜き出す ----------------
def _with_terms(product: Product, text: str) -> str:
    """社内の用語（オントロジー）を前に付ける。記録の本文は後ろに置き、スタブの抜き出しには影響しない。"""
    onto = ontology.context_for(product.tenant_id, text)
    return text if not onto else f"{text}\n\n## 参考：{onto}"

def _apply_extraction(s, product: Product, user: str, ex: llm.Extracted, source: dict) -> dict:
    made_d, made_t = [], []
    for x in ex.decisions:
        d = _add_decision(s, product, f"ai ({user})", x.title, x.detail, x.rationale, x.refs, source)
        made_d.append(decision_dict(d))
    for a in ex.actions:
        t = Ticket(product_id=product.id, number=_next(s, Ticket, product.id), title=a.title[:300],
                   body=a.detail, status="triage", priority="P2", assignee=a.assignee or None,
                   refs=_refs(a.title, a.detail, " ".join(a.refs)), source=source, created_by=f"ai ({user})")
        s.add(t)
        s.flush()
        made_t.append(ticket_dict(t, 0))
    return {"summary": ex.summary, "decisions": made_d, "tickets": made_t}


def extract_thread(product: Product, user: str, post_id: int) -> dict:
    th = thread(product, post_id)
    text = "\n".join(f"{p['author']}: {p['body']}" for p in [th["root"], *th["replies"]])
    ex = llm.extract(llmconf.resolve(product.tenant_id), product.name, "スレッド", _with_terms(product, text))
    with session() as s:
        out = _apply_extraction(s, product, user, ex, {"kind": "thread", "id": post_id})
        s.commit()
    repo.log(product.id, None, "agent", "decision-agent", "decision.extract",
             {"thread": post_id, "decisions": [d["key"] for d in out["decisions"]],
              "tickets": [t["key"] for t in out["tickets"]]})
    return out


# ---------------- 外部の会話の取り込み ----------------
def import_posts(product: Product, user: str, channel_id: str, items: list[dict]) -> dict:
    """外部の会話をチャンネルに取り込む。copy は本文ごと、summary は要約と決定だけを残す。"""
    with session() as s:
        c = _channel(s, product, channel_id)
        ext = c.external
    if not ext:
        raise CollabError(409, "このチャンネルは外部の会話とつながっていません")
    items = [i for i in items if str(i.get("body") or "").strip()][:500]
    if not items:
        raise CollabError(422, "取り込む発言がありません")
    provider = PROVIDERS[ext["provider"]]
    src = {"kind": "external", "provider": ext["provider"], "url": ext.get("url") or None}
    if ext["mode"] == "copy":
        for i in items:
            add_post(product, str(i.get("author") or provider), str(i["body"]), channel_id=channel_id,
                     source={"provider": ext["provider"], "url": i.get("url"), "at": i.get("at")})
        repo.log(product.id, None, "human", user, "channel.import",
                 {"channel": channel_id, "provider": ext["provider"], "mode": "copy", "posts": len(items)})
        return {"mode": "copy", "posts": len(items)}
    text = "\n".join(f"{i.get('author') or '?'}: {i['body']}" for i in items)
    ex = llm.extract(llmconf.resolve(product.tenant_id), product.name, f"{provider} の会話", _with_terms(product, text))
    summary = f"【{provider} の会話の要約（{len(items)}件）】\n{ex.summary}"
    root = add_post(product, "ai", summary, channel_id=channel_id, source=src)
    with session() as s:
        out = _apply_extraction(s, product, user, ex, {"kind": "thread", "id": root["id"], **src})
        s.commit()
    repo.log(product.id, None, "agent", "decision-agent", "channel.import",
             {"channel": channel_id, "provider": ext["provider"], "mode": "summary", "posts": len(items),
              "decisions": [d["key"] for d in out["decisions"]]})
    return {"mode": "summary", "posts": len(items), "summary_post": root["id"], **out}


# ---------------- 会議と議事録 ----------------
def meeting_dict(m: Meeting, full: bool = False) -> dict:
    d = {"number": m.number, "key": f"MTG-{m.number}", "title": m.title, "starts_at": m.starts_at,
         "attendees": m.attendees or [], "source": m.source, "has_minutes": bool(m.minutes.strip()),
         "created_by": m.created_by, "created_at": _iso(m.created_at)}
    if full:
        d.update(agenda=m.agenda, transcript=m.transcript, minutes=m.minutes)
    return d


def meetings(product: Product) -> list[dict]:
    with session() as s:
        rows = s.execute(select(Meeting).where(Meeting.product_id == product.id).order_by(Meeting.number.desc()))
        return [meeting_dict(m) for m in rows.scalars()]


def _meeting(s, product: Product, number: int) -> Meeting:
    q = select(Meeting).where(Meeting.product_id == product.id, Meeting.number == number)
    m = s.execute(q).scalar_one_or_none()
    if m is None:
        raise CollabError(404, f"MTG-{number} はありません")
    return m


def save_meeting(product: Product, user: str, body: dict, number: int | None = None) -> dict:
    with session() as s:
        if number is None:
            title = str(body.get("title") or "").strip()
            if not title:
                raise CollabError(422, "会議名を入れてください")
            m = Meeting(product_id=product.id, number=_next(s, Meeting, product.id), title=title, created_by=user)
            s.add(m)
        else:
            m = _meeting(s, product, number)
        for k in ("title", "starts_at", "agenda", "transcript", "minutes"):
            if k in body and body[k] is not None:
                setattr(m, k, str(body[k]))
        if "attendees" in body and body["attendees"] is not None:
            m.attendees = [a.strip() for a in body["attendees"] if str(a).strip()]
        if "source" in body and body["source"]:
            m.source = {"provider": body["source"].get("provider"), "url": body["source"].get("url")}
        s.commit()
        out = meeting_dict(m, True)
    if number is None:
        repo.log(product.id, None, "human", user, "meeting.create", {"meeting": out["key"], "title": out["title"]})
    return out


def meeting(product: Product, number: int) -> dict:
    with session() as s:
        m = _meeting(s, product, number)
        ds = [decision_dict(d) for d in s.execute(select(Decision).where(Decision.product_id == product.id)).scalars()
              if (d.source or {}).get("kind") == "meeting" and (d.source or {}).get("id") == f"MTG-{m.number}"]
        ts = [ticket_dict(t) for t in s.execute(select(Ticket).where(Ticket.product_id == product.id)).scalars()
              if (t.source or {}).get("kind") == "meeting" and (t.source or {}).get("id") == f"MTG-{m.number}"]
        return {**meeting_dict(m, True), "decisions": ds, "tickets": ts}


def make_minutes(product: Product, user: str, number: int) -> dict:
    with session() as s:
        m = _meeting(s, product, number)
        text = m.transcript.strip()
        title, agenda = m.title, m.agenda
    if not text:
        raise CollabError(409, "文字起こし（会話の記録）を入れてから作ってください")
    ex = llm.extract(llmconf.resolve(product.tenant_id), product.name, f"会議「{title}」",
                     _with_terms(product, (f"## 議題\n{agenda}\n\n" if agenda.strip() else "") + text))
    with session() as s:
        m = _meeting(s, product, number)
        out = _apply_extraction(s, product, user, ex, {"kind": "meeting", "id": f"MTG-{m.number}"})
        lines = [f"# {m.title} 議事録", "", "## 要約", ex.summary or "（なし）", "", "## 決定（確定待ち）"]
        lines += [f"- {d['key']} {d['title']}" for d in out["decisions"]] or ["- （なし）"]
        lines += ["", "## 宿題（チケット・仕分け待ち）"]
        lines += [f"- {t['key']} {t['title']}" + (f"（{t['assignee']}）" if t["assignee"] else "")
                  for t in out["tickets"]] or ["- （なし）"]
        m.minutes = "\n".join(lines) + "\n"
        s.commit()
    repo.log(product.id, None, "agent", "decision-agent", "meeting.minutes",
             {"meeting": f"MTG-{number}", "decisions": [d["key"] for d in out["decisions"]],
              "tickets": [t["key"] for t in out["tickets"]]})
    return meeting(product, number)


# ---------------- 共有ドキュメント ----------------
def doc_dict(d: Doc, full: bool = False) -> dict:
    out = {"number": d.number, "key": f"DOC-{d.number}", "title": d.title, "refs": d.refs or [],
           "updated_by": d.updated_by, "updated_at": _iso(d.updated_at)}
    if full:
        out["body"] = d.body
    return out


def docs(product: Product) -> list[dict]:
    with session() as s:
        rows = s.execute(select(Doc).where(Doc.product_id == product.id).order_by(Doc.updated_at.desc()))
        return [doc_dict(d) for d in rows.scalars()]


def save_doc(product: Product, user: str, body: dict, number: int | None = None) -> dict:
    with session() as s:
        if number is None:
            title = str(body.get("title") or "").strip()
            if not title:
                raise CollabError(422, "タイトルを入れてください")
            d = Doc(product_id=product.id, number=_next(s, Doc, product.id), title=title, updated_by=user)
            s.add(d)
        else:
            d = s.execute(select(Doc).where(Doc.product_id == product.id, Doc.number == number)).scalar_one_or_none()
            if d is None:
                raise CollabError(404, f"DOC-{number} はありません")
        if body.get("title"):
            d.title = str(body["title"])[:300]
        if "body" in body and body["body"] is not None:
            d.body = str(body["body"])
        d.refs, d.updated_by = _refs(d.title, d.body), user
        s.commit()
        out = doc_dict(d, True)
    repo.log(product.id, None, "human", user, "doc.create" if number is None else "doc.update",
             {"doc": out["key"], "title": out["title"]})
    return out


def doc(product: Product, number: int) -> dict:
    with session() as s:
        d = s.execute(select(Doc).where(Doc.product_id == product.id, Doc.number == number)).scalar_one_or_none()
        if d is None:
            raise CollabError(404, f"DOC-{number} はありません")
        return doc_dict(d, True)


# ---------------- 通知 ----------------
def notices(tenant_id: str, user: str, limit: int = 50) -> dict:
    with session() as s:
        rows = list(s.execute(select(Notice).where(Notice.tenant_id == tenant_id, Notice.user == user)
                              .order_by(Notice.id.desc()).limit(limit)).scalars())
        unread = s.execute(select(func.count()).where(Notice.tenant_id == tenant_id, Notice.user == user,
                                                      Notice.read.is_(False))).scalar()
        return {"unread": unread, "items": [{"id": n.id, "kind": n.kind, "text": n.text, "link": n.link,
                                             "actor": n.actor, "read": n.read, "product_id": n.product_id,
                                             "created_at": _iso(n.created_at)} for n in rows]}


def read_notices(tenant_id: str, user: str) -> None:
    with session() as s:
        for n in s.execute(select(Notice).where(Notice.tenant_id == tenant_id, Notice.user == user,
                                                Notice.read.is_(False))).scalars():
            n.read = True
        s.commit()


# ---------------- ID から中身を引く ----------------
def lookup(product: Product, ref: str) -> dict | None:
    """TK-1 / DEC-2 / MTG-3 / DOC-4 の見出し。成果物の ID は web 側でステージへのリンクにする。"""
    m = re.fullmatch(r"([A-Z]{2,4})-(\d+)", ref)
    if not m or m.group(1) not in PREFIX:
        return None
    kind, n = PREFIX[m.group(1)], int(m.group(2))
    model = {"ticket": Ticket, "decision": Decision, "meeting": Meeting, "doc": Doc}[kind]
    with session() as s:
        row = s.execute(select(model).where(model.product_id == product.id, model.number == n)).scalar_one_or_none()
        if row is None:
            return None
        return {"ref": ref, "kind": kind, "title": row.title, "status": getattr(row, "status", None)}
