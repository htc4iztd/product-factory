"""エージェントのやり取り：掲示板の確認・回答には宛先がすぐ動いて答える／PM 同士の連絡（10分ごと）／
PdM への話しかけは4つの型（質問・相談・合意依頼・終了承認依頼）だけ／期限・時刻は書かない。"""

import importlib
import time

import pytest
from fastapi.testclient import TestClient

H = {"x-pf-internal-token": "t", "x-pf-user": "owner@example.com", "x-pf-tenant": "tenant-a", "x-pf-role": "OWNER"}


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/c.db")
    monkeypatch.setenv("PF_INTERNAL_TOKEN", "t")
    monkeypatch.setenv("PF_LLM", "stub")
    monkeypatch.delenv("K_SERVICE", raising=False)
    from pf_agent import api, db

    importlib.reload(db)
    importlib.reload(api)
    with TestClient(api.app) as c:
        pid = c.post("/products", headers=H, json={"name": "連絡", "idea": "家計簿"}).json()["id"]
        from pf_agent.db import Product, session

        with session() as s:
            p = s.get(Product, pid)
            s.expunge(p)
        yield c, p


def wait_idle(c, pid):
    for _ in range(300):
        js = c.get(f"/jobs?product={pid}", headers=H).json()
        rows = js if isinstance(js, list) else js.get("runs", js.get("items", []))
        if not any(r["status"] in ("queued", "running") for r in rows):
            return
        time.sleep(0.1)
    raise AssertionError("jobs still running")


def thread_of(c, pid, n):
    b = c.get(f"/products/{pid}/board?thread={n}", headers=H).json()
    return b["threads"][0]["posts"]


def test_strip_deadlines():
    from pf_agent.team import strip_deadlines as f

    s = "設計PM様、本日15時までに検証範囲についてご回答をお願いいたします。"
    assert f(s) == "設計PM様、検証範囲についてご回答をお願いいたします。"
    assert f("明日10:30までに返事を") == "返事を" and f("今日中に確認") == "確認"
    assert f("3時間かかる見込み") == "3時間かかる見込み" and f("15時に会議") == "15時に会議"


def test_board_confirm_wakes_recipient(env):
    from pf_agent import team

    c, p = env
    team.ensure(p)
    # 担当同士：手を動かす Issue がなくても、確認を受けたら動いて答える（期限は書き込まれない）
    q = team.post(p, "s01", "s02", "confirm", "本日15時までに市場規模の前提を教えてください")
    assert "15時" not in q["text"]
    assert [x.id for x in team.inbox(p.id, "s02")] == [q["id"]]
    assert team.wakes_from(p.id, "s01", [q]) == ["s02"]
    team.start(p, "u", ["s02"], reason="掲示板")
    wait_idle(c, p.id)
    posts = thread_of(c, p.id, q["thread"])
    assert [(x["sender"], x["intent"]) for x in posts] == [("s01", "confirm"), ("s02", "answer")]
    assert team.inbox(p.id, "s02") == [] and posts[0]["read"]
    # 共有（notice）では起こさない。長くなったスレッドの回答でも起こさない
    n = team.post(p, "s01", "s02", "notice", "共有です")
    assert team.wakes_from(p.id, "s01", [n]) == []
    # 定期実行でも、未読の確認があれば拾う
    q2 = team.post(p, "s03", "s04", "confirm", "競合の一覧を見ましたか")
    import datetime as dt

    from pf_agent.db import TeamAgent, session

    with session() as s:
        for a in s.query(TeamAgent).filter_by(product_id=p.id).all():
            a.next_run_at = None if a.key != "s04" else dt.datetime.now(dt.UTC) - dt.timedelta(minutes=1)
        s.commit()
    assert team.tick()
    wait_idle(c, p.id)
    assert [x["sender"] for x in thread_of(c, p.id, q2["thread"])] == ["s03", "s04"]


def test_pm_sync_every_10_minutes(env):
    from pf_agent import team

    c, p = env
    team.ensure(p)
    v = c.get(f"/products/{p.id}/schedule", headers=H).json()
    assert next(a for a in v["agents"] if a["key"] == "pm_sync")["label"] == "10分ごと"
    # 変化がある（事業 PM がリスクを記録した）→ PM が他の PM に確認を出し、受けた PM はすぐ動いて答える
    # （起こされた PM は定時の状況確認は出さない）
    from pf_agent import pms

    pms.add_note(p.id, "pm_biz", "s05", "risk", "価格の前提が⑨の設計と合っていない")
    team.start(p, "u", ["pm_sync"])
    wait_idle(c, p.id)
    b = c.get(f"/products/{p.id}/board", headers=H).json()["threads"]
    sync = [t for t in b if t["title"].startswith("PM 同士の連絡")]
    assert sync
    posts = sync[0]["posts"]
    asks = [x for x in posts if x["intent"] == "confirm"]
    answers = [x for x in posts if x["intent"] == "answer"]
    assert {x["sender"] for x in asks} <= {"pm_biz", "pm_design", "pm_impl"} and asks
    assert {x["sender"] for x in answers} == {x["recipient"] for x in asks}
    assert not any("定時の状況確認" in t["title"] for t in b)
    # 前回から変化がなければ AI を使わず、何も書かない
    n = sum(len(t["posts"]) for t in c.get(f"/products/{p.id}/board", headers=H).json()["threads"])
    team.start(p, "u", ["pm_sync"])
    wait_idle(c, p.id)
    assert sum(len(t["posts"]) for t in c.get(f"/products/{p.id}/board", headers=H).json()["threads"]) == n


def test_pdm_asks_are_four_kinds(env):
    from pf_agent import asks, assistant, issues

    c, p = env
    # 報告だけ・知らない型・中身の足りない依頼は出さない
    assert asks.send(p, "pm_biz", asks.PdmAsk(kind="report", text="進んでいます")) is None
    assert asks.send(p, "pm_biz", asks.PdmAsk(kind="agree_next", text="進めてよいですか")) is None
    assert asks.send(p, "pm_biz", asks.PdmAsk(kind="approve_done", text="終えてよいですか", issue=99)) is None
    q = asks.send(p, "pm_biz", asks.PdmAsk(kind="question", text="本日15時までに、対象は共働き世帯で確定ですか"))
    assert q["text"].startswith("【質問】対象は共働き世帯で確定ですか") and q["actions"] == []
    # 合意依頼：合意すると PM 宛ての Issue になり、PM が動く
    ask = asks.PdmAsk(kind="agree_next", text="価格調査に進みます", next_action="競合3社の価格を調べる")
    m = asks.send(p, "pm_biz", ask)
    assert m["text"].startswith("【ネクストアクションへの合意依頼】")
    assert m["actions"][0]["after"] == "競合3社の価格を調べる"
    r = assistant.decide("tenant-a", "owner@example.com", m["id"], m["actions"][0]["id"], True)
    assert r["actions"][0]["status"] == "approved"
    wait_idle(c, p.id)
    mine = issues.search(p, assignee="pm_biz")
    assert mine and "合意しました" in mine[-1]["description"]
    # 終了承認依頼：承認で終了、否認で担当に戻す
    i = issues.create(p, "pm_biz", "s01", "アイデアを3つ出す", wake=False)
    d = asks.send(p, "pm_biz", asks.PdmAsk(kind="approve_done", text="#2 を終えてよいですか", issue=i["number"]))
    assistant.decide("tenant-a", "owner@example.com", d["id"], d["actions"][0]["id"], False)
    wait_idle(c, p.id)
    js = issues.get(p, i["number"])["journals"]
    k = next(n for n, j in enumerate(js) if "承認しませんでした" in j["notes"])
    assert any(j["author"] == "s01" for j in js[k + 1:])  # 否認で担当に戻り、担当がすぐ動いた
    j = issues.create(p, "pm_biz", "s02", "市場規模を出す", wake=False)
    d = asks.send(p, "pm_biz", asks.PdmAsk(kind="approve_done", text="終えてよいですか", issue=j["number"]))
    assistant.decide("tenant-a", "owner@example.com", d["id"], d["actions"][0]["id"], True)
    assert issues.get(p, j["number"])["status"] == "closed"
    # 終わった Issue には終了承認依頼を出さない
    assert asks.send(p, "pm_biz", asks.PdmAsk(kind="approve_done", text="終えてよいですか", issue=j["number"])) is None


def test_same_ask_is_not_repeated(env):
    """担当が何人も同じことを上げてきても、PdM に聞くのは1回。PdM が答えたら、また聞ける。"""
    from pf_agent import asks
    from pf_agent.db import AssistantMessage, session

    c, p = env
    texts = [
        "実装担当者（s12、s13、s14）が、設計ドラフト（s06〜s11）を stage_draft から参照できない状況です。"
        "担当者への参照権限付与、または代替の共有方法についてご指示いただけますでしょうか。",
        "実装担当者（s12〜s14）がツール（stage_draft）で設計ドラフト（s09〜s11）を参照できないと報告を受けています。"
        "システム上の参照権限の設定等に問題がないか、ご確認いただけますでしょうか。",
        "実装担当者（s12、s13、s14）が設計ドラフト（s06〜s11）を参照できるよう、システム上の閲覧権限を付与いただくか、"
        "共有用の格納場所をご指示いただけますでしょうか。",
    ]
    sent = [asks.send(p, "pm_design", asks.PdmAsk(kind="consult", text=t)) for t in texts]
    assert sent[0] and sent[1:] == [None, None]
    assert len(asks.open_asks(p.id, "pm_design")) == 1
    # 別のことは聞ける。別の PM は別に聞ける
    assert asks.send(p, "pm_design", asks.PdmAsk(kind="question", text="対象端末はスマホだけで確定ですか"))
    assert asks.send(p, "pm_impl", asks.PdmAsk(kind="consult", text=texts[0]))
    # PdM が設計 PM に返事をしたら、未回答ではなくなる
    with session() as s:
        s.add(AssistantMessage(tenant_id="tenant-a", user="owner@example.com", product_id=p.id, role="pdm", agent="",
                               text="下書きはツールで読めます", context={"responder": "pm_design"}))
        s.commit()
    assert asks.open_asks(p.id, "pm_design") == []


def test_upstream_reads_drafts_when_not_confirmed(env):
    from pf_agent import repo
    from pf_agent import tools as tl

    c, p = env
    repo.set_field(p.id, "s09", "overview", "モノリスで作る", "t", "test")
    out = tl.call(tl.Ctx(product=p, key="s12", tenant="tenant-a"), "upstream", {})
    assert "s09（未確定の下書き）" in out and "モノリスで作る" in out
    ctx = tl.Ctx(product=p, key="s12", tenant="tenant-a")
    assert "モノリスで作る" in tl.call(ctx, "stage_draft", {"stage_id": "s09"})


def test_reply_quotes_the_ask(env):
    """「返事をする」は元の発言を引用して送る。宛先は元の発言の PM になり、問いかけは答えたことになる。"""
    from pf_agent import asks

    c, p = env
    q = asks.send(p, "pm_design", asks.PdmAsk(kind="question", text="対象端末はスマホだけで確定ですか"))
    body = {"path": f"/p/{p.id}", "text": "はい、スマホだけです", "mentions": [], "attachments": []}
    body["reply_to"] = q["id"]
    r = c.post("/assistant/messages", headers=H, json=body).json()
    mine = r["message"]
    assert mine["context"]["reply_to"]["id"] == q["id"] and "スマホだけで確定" in mine["context"]["reply_to"]["text"]
    assert mine["context"]["responder"] == "pm_design" and r["reply"]["agent"] == "pm_design"
    assert "reply_to" not in r["reply"]["context"]  # 引用は PdM の発言にだけ付く
    assert asks.open_asks(p.id, "pm_design") == []
    w = c.get(f"/products/{p.id}/pm/pm_design", headers=H).json()
    assert any(m["role"] == "pdm" and m["text"].startswith("> 【質問】") for m in w["messages"])
    bad = {**body, "reply_to": 99999}
    assert c.post("/assistant/messages", headers=H, json=bad).status_code == 404
