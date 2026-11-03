"""⑥のプロトタイプ：画面の移り方まで操作できる、1つの HTML。

- 保存先は⑥の「UI デザイン」の proto（{html, comments, source, at}）。画面ごとの pages とは別に持つ。
- 作り方は3つ：画面（pages）からまとめる（画面側で組む）・AI に作らせる（ジョブ。できたら設計PM が承認依頼を出す）・
  HTML を取り込む。直すのは、コメントを AI に送る（チャットの ui_proto：edits で一部だけ書き換える）か、コードを直接。
- HTML は script を含むので、画面では隔離した枠（sandbox="allow-scripts"、同じオリジンにしない）の中だけで動かす。
"""
from __future__ import annotations

import datetime as dt
import json
import re

from . import frameworks as fx
from . import jobs, llm, llmconf, repo
from .db import JobRun, Product, session


class ProtoError(ValueError):
    pass


def _now() -> str:
    return dt.datetime.now(dt.UTC).isoformat(timespec="seconds")


def get(product_id: str) -> dict:
    ui = repo.draft(product_id, "s06").get("ui") or {}
    return ui.get("proto") or {"html": "", "comments": [], "source": "edit", "at": ""}


def save(product_id: str, user: str, html: str | None = None, comments: list | None = None,
         source: str | None = None, by: str = "edit") -> dict:
    """プロトタイプだけを書き換える（画面ごとの pages はそのまま）。渡さなかったものは今のまま。"""
    ui = dict(repo.draft(product_id, "s06").get("ui") or {"pages": []})
    cur = ui.get("proto") or {"html": "", "comments": [], "source": "edit", "at": ""}
    nxt = {
        "html": cur.get("html", "") if html is None else html,
        "comments": cur.get("comments", []) if comments is None else comments,
        "source": source or cur.get("source") or "edit",
        "at": _now() if html is not None else cur.get("at", ""),
    }
    ui["proto"] = nxt
    repo.set_field(product_id, "s06", "ui", ui, user, by)
    return (repo.draft(product_id, "s06").get("ui") or {}).get("proto") or nxt


def apply_edits(html: str, edits: list[dict]) -> str:
    """一部だけの書き換え：old はいまの HTML にちょうど1回出てくる文字列。"""
    out = html
    for i, e in enumerate(edits, 1):
        old, new = str(e.get("old") or ""), str(e.get("new") or "")
        if not old:
            raise ProtoError(f"{i} 件目の書き換えに、元の文字列がありません")
        n = out.count(old)
        if n != 1:
            where = "見つかりません" if n == 0 else f" {n} 回出てきます"
            raise ProtoError(f"{i} 件目の書き換えの元の文字列が、プロトタイプに{where}"
                             "（プロトタイプが変わった可能性があります）")
        out = out.replace(old, new, 1)
    return out


def check(html: str) -> str:
    h = (html or "").strip()
    if not h:
        raise ProtoError("プロトタイプの HTML が空です")
    if len(h) > fx.PROTO_MAX:
        raise ProtoError("プロトタイプの HTML が大きすぎます（1.5MB まで）")
    if not re.search(r"<(html|body|div|main|section)\b", h, re.I):
        raise ProtoError("HTML になっていません")
    return h


def mark_applied(comments: list[dict]) -> list[dict]:
    return [{**c, "status": "applied"} if c.get("status") == "sent" else c for c in comments or []]


# ---------------- AI に作らせる（ジョブ） ----------------
PROMPT = """あなたは UX デザイナーです。⑥UXデザインで決めたことから、関係者がブラウザで触って確かめられる
「動くモックアップ」を、1つの HTML ファイルとして書いてください。

## 形
- 1つの HTML（<!doctype html> から </html> まで）。CSS と JavaScript はすべて中に書く。外部の script・画像は使わない
  （フォントだけ Google Fonts を使ってよい）。
- 広い画面では、左に案内（プロダクト名・「モックアップ・架空のデータ」の札・シナリオの切り替え・
  画面の一覧（段階ごとの見出しつき）・いまの画面の「設計メモ」（目的と、なぜこうしたか））、
  中央に端末の枠（スマホなら幅 390px・高さ 800px ほど、角丸）を置く。
  狭い画面（760px 以下）では、端末が画面いっぱいになり、案内は上に小さく出る（画面の一覧は select にする）。
- 画面は JavaScript の状態（いまの画面・入力・選んだもの）で描く。端末の中のボタン・通知・リンクを押すと次の画面へ移る。
  左の一覧からも好きな画面へ飛べる。戻る操作（前の画面へ）も入れる。
- 押したものが分かる動き（押した時の縮み・画面の移り変わり（進む・戻る）・下から出るシート・完了のチェック・数値の
  カウントアップなど）を入れる。prefers-reduced-motion では動きを止める。
- ボタン・リンクには data-go="移り先の画面の id" を付ける（JS の click 処理で読む）。
- 色は CSS 変数で定義し、ダーク表示（prefers-color-scheme: dark）も用意する。
- 文言と数値は、このプロダクトらしい具体的なものにする（架空でよい。実在の会社・人・サービスの名前は使わない）。

## 中身の決め方
- 画面は「画面一覧」の画面を使う（id は SC-xx を小文字にしたものなど、短い英数字）。
- シナリオは「ユーザーフロー」から作る（フローごとに、通る画面の順番）。
- 設計メモは、画面一覧の目的・主な情報と操作と、関係するストーリー・ジャーニーの機会から書く。
- すでに描いた画面（HTML）があれば、その見た目と文言をできるだけ引き継ぐ。
{note}
## 材料
{material}

HTML だけを出力してください（説明やコードブロックの記号は付けない）。"""


def material(product: Product) -> str:
    d = repo.draft(product.id, "s06")
    parts = [f"# プロダクト：{product.name}\n{(product.idea or '')[:1500]}"]
    labels = {"personas": "ペルソナ", "journeys": "カスタマージャーニー", "stories": "ユーザーストーリー",
              "userflows": "ユーザーフロー", "screens": "画面一覧"}
    for k, lab in labels.items():
        rows = d.get(k) or []
        if isinstance(rows, list) and rows:
            parts.append(f"## {lab}\n" + "\n".join(
                "- " + "・".join(f"{a}：{b}" for a, b in r.items() if str(b or "").strip())
                for r in rows[:60] if isinstance(r, dict)))
    pages = (d.get("ui") or {}).get("pages") or []
    if pages:
        parts.append("## すでに描いた画面（HTML。部品集のクラス pf-* を使っている）\n" + "\n".join(
            f"### {p['name']}（{p.get('screen') or '-'}）\n```html\n{p['html'][:4000]}\n```" for p in pages[:20]))
    return "\n\n".join(parts)[:60000]


def start(product: Product, user: str, note: str = "") -> dict:
    conn = llmconf.resolve(product.tenant_id)
    job_id = jobs.create("ui_proto", product.tenant_id, product.id, user, {"note": note[:2000]}, total=1,
                         model=conn.chat_model, tasks=[{"id": "write", "name": "プロトタイプを書く", "deps": []}])
    jobs.dispatch(job_id)
    return jobs.run_dict(job_id)


STUB_TEMPLATE = """<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>__NAME__ モックアップ</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{--bg:#eceae6;--ink:#22201c;--accent:#e0602c;--screen:#fffdfa}
body{margin:0;font-family:sans-serif;background:var(--bg);color:var(--ink)}
.app{display:grid;grid-template-columns:280px auto;gap:32px;justify-content:center;padding:24px}
.steps button{display:block;width:100%;text-align:left;border:0;background:none;padding:6px 8px}
.steps button[aria-current]{background:#fff;box-shadow:inset 3px 0 0 var(--accent)}
.device{width:390px;height:800px;border-radius:48px;background:#1d1c1a;padding:12px}
.screen{height:100%;border-radius:38px;background:var(--screen);padding:40px 20px;box-sizing:border-box}
.btn{display:block;width:100%;border:0;border-radius:99px;padding:14px;background:var(--accent);color:#fff}
</style></head><body><div class="app"><aside><span>モックアップ・架空のデータ</span><h1>__NAME__</h1>
<ol class="steps" id="steps"></ol><section><h2 id="why-title"></h2><p id="why-text"></p></section>
<button id="back">前の画面へ</button></aside>
<div class="device"><div class="screen" id="view"></div></div></div>
<script>const SC=__DATA__;let cur=SC[0].id;const hist=[];
const $=(id)=>document.getElementById(id);
function go(id,back){if(!back&&id!==cur)hist.push(cur);cur=id;render();}
function render(){const s=SC.find(x=>x.id===cur);
$('view').innerHTML='<h2>'+s.name+'</h2><p>'+s.why+'</p>'
  +'<button class="btn" data-go="'+s.next+'">次へ</button>';
$('why-title').textContent=s.name;$('why-text').textContent=s.why;
$('steps').innerHTML=SC.map(x=>'<li><button data-go="'+x.id+'"'
  +(x.id===cur?' aria-current="step"':'')+'>'+x.name+'</button></li>').join('');}
document.addEventListener('click',e=>{const t=e.target.closest('[data-go]');if(t)go(t.dataset.go);
if(e.target.id==='back'&&hist.length)go(hist.pop(),true);});render();</script></body></html>"""


def _stub_html(product: Product) -> str:
    """スタブ：画面一覧から、押すと移る最小のプロトタイプを組む（AI の代わり）。"""
    d = repo.draft(product.id, "s06")
    screens = [r for r in d.get("screens") or [] if isinstance(r, dict) and str(r.get("id") or "").strip()][:20]
    if not screens:
        screens = [{"id": "SC-01", "name": "ホーム", "purpose": "はじめの画面"},
                   {"id": "SC-02", "name": "詳細", "purpose": "中身を見る"}]
    ids = [re.sub(r"[^a-z0-9]", "", str(r["id"]).lower()) or f"s{i}" for i, r in enumerate(screens)]
    data = [{"id": ids[i], "name": str(r.get("name") or r["id"]), "why": str(r.get("purpose") or ""),
             "next": ids[(i + 1) % len(ids)]} for i, r in enumerate(screens)]
    esc = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    name = re.sub(r"[<>&]", "", product.name)
    return STUB_TEMPLATE.replace("__NAME__", name).replace("__DATA__", esc)


def _strip(text: str) -> str:
    t = (text or "").strip()
    t = re.sub(r"^```[a-zA-Z]*\n", "", t)
    t = re.sub(r"\n```\s*$", "", t)
    i = t.lower().find("<!doctype")
    if i < 0:
        i = t.lower().find("<html")
    return t[i:] if i > 0 else t


def run(job_id: str) -> None:
    from . import assistant

    with session() as s:
        j = s.get(JobRun, job_id)
        product = s.get(Product, j.product_id)
        s.expunge(product)
        note, user = (j.params or {}).get("note", ""), j.created_by
    conn = llmconf.resolve(product.tenant_id)
    jobs.step(job_id, "⑥の内容からプロトタイプを書いています", advance=False)
    with jobs.task(job_id, "write"):
        if conn.provider == "stub":
            html = _stub_html(product)
        else:
            prompt = PROMPT.format(note=f"\n## PdM からの注文\n{note}\n" if note.strip() else "",
                                   material=material(product))
            html = _strip(llm._wrap(lambda: llm._text(conn, conn.chat_model, prompt)))
        html = check(html)
        jobs.set_task(job_id, "write", detail=f"{len(html):,} 文字")
    cur = get(product.id)
    act = {
        "id": job_id[:12], "type": "ui_proto", "status": "pending", "by": "pm_design",
        "title": "UI のプロトタイプを" + ("作り直す" if cur.get("html") else "作る"),
        "before": fx.ui_text(cur.get("html", ""), 400) or "（まだありません）",
        "after": fx.ui_text(html, 400), "reason": "⑥の画面一覧・ユーザーフローから組みました",
        "preview": {"doc": html} if len(html) <= 400_000 else None,
        "args": {"html": html, "edits": [], "source": "ai"},
    }
    assistant.notify(product.tenant_id, product.id, "pm_design",
                     "（設計PM）⑥の内容から、画面の移り方まで操作できるプロトタイプを作りました。下見を確かめて承認すると、"
                     "⑥の UI のプロトタイプに入ります。",
                     context={"kind": "ui", "label": "⑥UXデザインの UI", "stage_id": "s06"}, actions=[act])
    jobs.step(job_id, "できました。チャットで承認すると反映されます")
    _ = user


jobs.HANDLERS["ui_proto"] = run
