"""ステージごとのフレームワーク（成果物の型）。

成果物は文章ではなく、項目ごとの値（draft）として持つ。値の型は3つ。
- text：文章（Markdown 可）
- list：箇条書き（文字列の配列）
- table：表（列が決まった行の配列）。rows を決めた表は行の見出しが固定

版の Markdown（下流ステージとLLMへの入力、監査ログのハッシュ）はここで作る。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

from .stages import STAGES, Stage


@dataclass(frozen=True)
class Column:
    key: str
    label: str
    kind: str = "text"      # text | number


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    kind: str               # text | list | table
    hint: str = ""
    required: bool = True
    columns: tuple[Column, ...] = ()
    rows: tuple[str, ...] = ()   # 行の見出しを固定する表（先頭列に入る）


@dataclass(frozen=True)
class Framework:
    view: str               # 画面の描き方：lean_canvas | market | competitors | vpc | business_plan | document
    title: str              # フレームワークの名前
    summary: str            # 何を決めるためのものか（1文）
    fields: tuple[Field, ...]
    prompts: tuple[str, ...] = field(default_factory=tuple)   # チャットの最初に出す問いかけ

    def get(self, key: str) -> Field | None:
        return next((f for f in self.fields if f.key == key), None)


T, L, TB = "text", "list", "table"
REVIEW = Field("review_condition", "見直し条件", T, "どの前提が崩れたらこの分析をやり直すか")

FRAMEWORKS: dict[str, Framework] = {
    "s01": Framework(
        "lean_canvas", "リーンキャンバス", "誰のどんな課題を、どう解いて、どう続けるかを1枚で仮置きする",
        (
            Field("problem", "課題", L, "顧客が抱える上位3つの課題"),
            Field("alternatives", "既存の代替手段", L, "顧客が今その課題をどう片付けているか", required=False),
            Field("customer_segments", "顧客セグメント", L, "課題を持つ人・組織"),
            Field("early_adopters", "アーリーアダプター", L, "最初に使ってくれる具体的な人物像", required=False),
            Field("uvp", "独自の価値提案", T, "一文で言える、選ばれる理由"),
            Field("solution", "ソリューション", L, "課題ごとの解決策（最小限）"),
            Field("channels", "チャネル", L, "顧客に届く経路", required=False),
            Field("revenue", "収益の流れ", L, "誰がいくら、何に払うか", required=False),
            Field("cost", "コスト構造", L, "主な費用", required=False),
            Field("key_metrics", "主要指標", L, "うまくいっているかを測る数値"),
            Field("unfair_advantage", "圧倒的な優位性", T, "簡単に真似されない理由", required=False),
        ),
        ("誰のどんな課題を解きますか？", "その人は今、その課題をどう片付けていますか？",
         "最初に試す範囲（スコープ）は？"),
    ),
    "s02": Framework(
        "market", "市場規模（TAM / SAM / SOM）", "狙う市場の大きさを、推計式と出典付きで見積もる",
        (
            Field("market_size", "市場規模の推計", TB, "値・推計式・出典。出典のない数値は「要確認」",
                  columns=(Column("tier", "区分"), Column("value", "規模"), Column("formula", "推計式"),
                           Column("source", "出典")),
                  rows=("TAM", "SAM", "SOM")),
            Field("segments", "顧客セグメント", TB, "セグメントごとの規模とニーズ",
                  columns=(Column("name", "セグメント"), Column("size", "規模"), Column("needs", "主なニーズ"),
                           Column("priority", "優先度"))),
            Field("trends", "市場の動向", L, "追い風・向かい風", required=False),
            REVIEW,
        ),
        ("対象とする地域・市場は？", "規模を見積もるのに使える公開データはありますか？"),
    ),
    "s03": Framework(
        "competitors", "競合分析とポジショニング", "代替手段と比べた自分の立ち位置を決める",
        (
            Field("competitors", "競合・代替手段", TB, "直接競合・間接競合・代替手段",
                  columns=(Column("name", "名前"), Column("type", "種類"), Column("strength", "強み"),
                           Column("weakness", "弱み"), Column("price", "価格"))),
            Field("axis_x", "ポジショニングの横軸", T, "例：価格（低い ← → 高い）"),
            Field("axis_y", "ポジショニングの縦軸", T, "例：専門性（汎用 ← → 特化）"),
            Field("positions", "ポジション", TB, "各社と自社の位置（-5〜5）",
                  columns=(Column("name", "名前"), Column("x", "横", "number"), Column("y", "縦", "number"))),
            Field("differentiation", "差別化のポイント", L, "競合にない、選ばれる理由"),
            REVIEW,
        ),
        ("既に知っている競合・代替手段は？", "顧客が比べるときに一番気にする軸は何ですか？"),
    ),
    "s04": Framework(
        "vpc", "バリュープロポジションキャンバス", "顧客の片付けたい用事と、提供する価値を対応づける",
        (
            Field("target_customer", "狙う顧客", T, "最初に狙う顧客を一人に絞る"),
            Field("customer_jobs", "顧客の用事（Jobs）", L, "顧客が片付けたいこと"),
            Field("pains", "ペイン", L, "用事を片付けるときの不満・障害・リスク"),
            Field("gains", "ゲイン", L, "顧客が期待する成果・うれしさ"),
            Field("products", "製品・サービス", L, "提供するもの"),
            Field("pain_relievers", "ペインの解消", L, "どのペインをどう減らすか"),
            Field("gain_creators", "ゲインの創出", L, "どのゲインをどう生むか"),
            Field("north_star", "北極星指標", T, "顧客が価値を得たことを表す1つの数値"),
            Field("exit_criteria", "撤退条件", T, "いつ、何がどうなったらやめるか"),
        ),
        ("北極星指標の候補は？", "撤退を判断する条件は？"),
    ),
    "s05": Framework(
        "business_plan", "事業計画（KPIツリー・収益モデル・PL）", "事業として成り立つかを数字で確かめる",
        (
            Field("kpi_tree", "KPIツリー", TB,
                  "親KPIの名前で木にする（最上位は親なし）。分解の式は子KPIの組み立て方（× か +）",
                  columns=(Column("kpi", "KPI"), Column("parent", "親KPI"), Column("relation", "分解の式"),
                           Column("target", "目標値"), Column("measure", "計測方法"))),
            Field("revenue_model", "収益モデル", T, "誰から、何に、いくら、どの頻度で受け取るか"),
            Field("pl", "PL計画（万円）", TB, "粗利と営業利益は自動で計算する",
                  columns=(Column("item", "項目"), Column("y1", "1年目", "number"),
                           Column("y2", "2年目", "number"), Column("y3", "3年目", "number")),
                  rows=("売上", "原価", "販管費")),
            Field("investment", "投資計画", TB, "項目・金額・時期",
                  columns=(Column("item", "項目"), Column("amount", "金額（万円）", "number"),
                           Column("timing", "時期"))),
            REVIEW,
        ),
        ("利用モード（個人／法人）と会計の区切りは？", "最初の1年で見込む顧客数は？"),
    ),
}


def framework(stage: Stage) -> Framework:
    """P1〜P2 は専用のフレームワーク。それ以外は必須の見出しを1項目ずつ持つ文書。"""
    if stage.id in FRAMEWORKS:
        return FRAMEWORKS[stage.id]
    return Framework(
        "document", "見出しごとの文書", f"{stage.name}の成果物を見出しごとに書く",
        tuple(Field(f"sec{i}", h, T) for i, h in enumerate(stage.sections, 1)),
        stage.clarify,
    )


FRAMEWORK_BY_STAGE = {s.id: framework(s) for s in STAGES}


# ---------------- 値の扱い ----------------
def empty_value(f: Field):
    if f.kind == L:
        return []
    if f.kind == TB:
        return [{f.columns[0].key: r} for r in f.rows]
    return ""


def empty_draft(fw: Framework) -> dict:
    return {f.key: empty_value(f) for f in fw.fields}


def is_filled(f: Field, value) -> bool:
    if f.kind == T:
        return bool(str(value or "").strip())
    if f.kind == L:
        return any(str(v).strip() for v in (value or []))
    # 表：行見出し以外のどこかに値がある行が1つ以上
    data_cols = [c.key for c in f.columns[1:]] if f.rows else [c.key for c in f.columns]
    return any(any(str(r.get(k, "")).strip() for k in data_cols) for r in (value or []))


def check(fw: Framework, draft: dict) -> list[str]:
    """更新前の検査（決定的に判定できるものだけ）。空なら合格。"""
    return [f"必須の項目「{f.label}」が空です" for f in fw.fields
            if f.required and not is_filled(f, (draft or {}).get(f.key))]


def coerce(f: Field, value):
    """画面やLLMから来た値を項目の型にそろえる。合わなければ ValueError。"""
    if f.kind == T:
        if isinstance(value, list):
            return "\n".join(str(v) for v in value)
        return str(value or "")
    if f.kind == L:
        if isinstance(value, str):
            value = [v.strip().lstrip("-・*").strip() for v in value.splitlines()]
        if not isinstance(value, list):
            raise ValueError("list が必要です")
        return [str(v).strip() for v in value if str(v).strip()]
    # table
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, list) or not all(isinstance(r, dict) for r in value):
        raise ValueError("表は行（オブジェクト）の配列で渡してください")
    keys = [c.key for c in f.columns]
    rows = [{k: _cell(f, k, r.get(k, "")) for k in keys} for r in value]
    if f.rows:
        # 行見出しは固定。見出しが一致する行の値だけを採る
        by = {str(r.get(keys[0], "")): r for r in rows}
        rows = [dict(by.get(h, {}), **{keys[0]: h}) for h in f.rows]
        rows = [{k: r.get(k, "") for k in keys} for r in rows]
    return rows


def _cell(f: Field, key: str, v):
    col = next(c for c in f.columns if c.key == key)
    if col.kind == "number" and v not in ("", None):
        try:
            n = float(str(v).replace(",", ""))
            return int(n) if n.is_integer() else n
        except ValueError:
            return str(v)
    return "" if v is None else str(v)


# ---------------- Markdown ----------------
def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def pl_rows(rows: list[dict]) -> list[dict]:
    """PL に粗利・営業利益を足した表示用の行。"""
    by = {r.get("item"): r for r in rows or []}
    out = list(rows or [])
    gross = {"item": "粗利"}
    op = {"item": "営業利益"}
    for y in ("y1", "y2", "y3"):
        g = _num(by.get("売上", {}).get(y)) - _num(by.get("原価", {}).get(y))
        gross[y] = round(g, 1)
        op[y] = round(g - _num(by.get("販管費", {}).get(y)), 1)
    return out + [gross, op]


def to_markdown(stage: Stage, fw: Framework, draft: dict) -> str:
    lines = [f"# {stage.no} {stage.name}（{fw.title}）", ""]
    for f in fw.fields:
        v = (draft or {}).get(f.key)
        lines.append(f"## {f.label}")
        if f.kind == T:
            lines.append(str(v or "").strip() or "（未記入）")
        elif f.kind == L:
            lines += [f"- {x}" for x in v or []] or ["（未記入）"]
        else:
            rows = pl_rows(v) if (stage.id == "s05" and f.key == "pl") else (v or [])
            if not rows:
                lines.append("（未記入）")
            else:
                lines.append("| " + " | ".join(c.label for c in f.columns) + " |")
                lines.append("|" + "---|" * len(f.columns))
                for r in rows:
                    lines.append("| " + " | ".join(str(r.get(c.key, "")).replace("|", "／").replace("\n", " ")
                                                  for c in f.columns) + " |")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


EMPTY = "（未記入）"


def _parse_table(f: Field, body: list[str]) -> list[dict]:
    rows = [ln.strip() for ln in body if ln.strip().startswith("|")]
    if not rows:
        return []
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    header, data = cells[0], [c for c in cells[1:] if not all(set(x) <= set("-: ") for x in c)]
    # 見出しの名前で列を対応づける。合わない列は並び順で対応づける
    by_label = {c.label: c.key for c in f.columns}
    keys = [by_label.get(h) or (f.columns[i].key if i < len(f.columns) else None) for i, h in enumerate(header)]
    return [{k: v for k, v in zip(keys, row, strict=False) if k} for row in data]


def from_markdown(fw: Framework, markdown: str) -> tuple[dict, list[str]]:
    """to_markdown の逆。「## 項目名」ごとに本文を読み、項目の型にそろえて返す。

    返り値は（読めた項目の値, 注意）。文書にない項目は返さない（＝変更しない）。
    """
    sections: dict[str, list[str]] = {}
    order: list[str] = []
    cur = None
    for line in markdown.splitlines():
        if line.startswith("## "):
            cur = line[3:].strip()
            sections[cur] = []
            order.append(cur)
        elif line.startswith("# ") and cur is None:
            continue    # 文書の題名
        elif cur is not None:
            sections[cur].append(line)
    by_label = {f.label: f for f in fw.fields}
    values: dict = {}
    notes: list[str] = []
    for label in order:
        f = by_label.get(label)
        if f is None:
            notes.append(f"見出し「{label}」は項目にないため反映しませんでした")
            continue
        body = sections[label]
        text = "\n".join(body).strip()
        if text == EMPTY:
            text, body = "", []
        try:
            if f.kind == T:
                values[f.key] = coerce(f, text)
            elif f.kind == L:
                items = [ln for ln in body if ln.strip() and ln.strip() != EMPTY]
                values[f.key] = coerce(f, "\n".join(items))
            else:
                values[f.key] = coerce(f, _parse_table(f, body))
        except (ValueError, TypeError) as e:
            notes.append(f"「{label}」を読めませんでした（{e}）")
    for f in fw.fields:
        if f.label not in sections:
            notes.append(f"見出し「{f.label}」がないため、その項目は変えていません")
    return values, notes


def spec(fw: Framework) -> list[dict]:
    """画面とLLMに渡す項目の定義。"""
    return [{"key": f.key, "label": f.label, "kind": f.kind, "hint": f.hint, "required": f.required,
             "columns": [{"key": c.key, "label": c.label, "kind": c.kind} for c in f.columns],
             "rows": list(f.rows)} for f in fw.fields]
