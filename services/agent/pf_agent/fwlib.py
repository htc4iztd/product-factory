"""フレームワークのライブラリと、工程ごとの組み合わせ。

- 工程には、基本のフレームワーク（frameworks.FRAMEWORKS。①リーンキャンバス・②TAM/SAM/SOM など）に加えて、
  ライブラリのフレームワーク（PEST・ファイブフォース・SWOT・BMC…）をいくつでも足せる。足したものは必須にもできる
- フレームワークは「部品（blocks）」の組み合わせで定義する。部品の種類は text・list・table・matrix（2×2）・
  positioning（ポジショニング図）・diagram（ノードと線の図）。部品は 12 列の格子に配置する（layout）
- 標準のライブラリはコード（このファイル）。テナントは画面のエディタで独自のフレームワークを作る・標準を上書きする
- 工程の項目（Field）として合成する：基本の項目の後ろに、足したフレームワークの部品が「<フレームワーク id>.<部品 key>」
  の key で並ぶ。下書き・承認・AI・Markdown・下流はすべてこの合成した定義で扱う
"""

from __future__ import annotations

import re
import time

from sqlalchemy import select

from . import frameworks as fx
from .db import FrameworkDef, Product, StageFrameworkSet, session
from .stages import STAGE_BY_ID

KINDS = {
    "text": "文章",
    "list": "箇条書き",
    "table": "表",
    "matrix": "2×2 の象限",
    "positioning": "ポジショニング図",
    "diagram": "図（ノードと線）",
}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,30}$")


class FrameworkError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _b(key, label, kind="list", hint="", x=0, y=0, w=6, h=1, columns=None, rows=None, **cfg):
    out = {"key": key, "label": label, "kind": kind, "hint": hint, "layout": {"x": x, "y": y, "w": w, "h": h}}
    if columns:
        out["columns"] = [
            {
                "key": c[0],
                "label": c[1],
                "kind": c[2] if len(c) > 2 else "text",
                "options": list(c[3]) if len(c) > 3 else [],
            }
            for c in columns
        ]
    if rows:
        out["rows"] = list(rows)
    out.update(cfg)
    return out


FACTOR = (("factor", "要因"), ("effect", "機会／脅威", "text", ("機会", "脅威", "両方")), ("source", "根拠・出典"))
FORCE = (("factor", "要因"), ("power", "強さ", "text", ("弱い", "中", "強い")), ("source", "根拠"))

LIBRARY: dict[str, dict] = {
    "pest": {
        "name": "PEST 分析",
        "category": "外部環境",
        "stages": ["s02", "s04"],
        "description": "政治・経済・社会・技術の4つの面から、事業に効くマクロ環境の変化を洗い出す",
        "blocks": [
            _b("politics", "政治（Politics）", "table", "法規制・税制・政策・規制緩和", 0, 0, 6, 1, FACTOR),
            _b("economy", "経済（Economy）", "table", "景気・物価・為替・金利・可処分所得", 6, 0, 6, 1, FACTOR),
            _b("society", "社会（Society）", "table", "人口動態・ライフスタイル・価値観", 0, 1, 6, 1, FACTOR),
            _b("technology", "技術（Technology）", "table", "新しい技術・普及・代替技術", 6, 1, 6, 1, FACTOR),
            _b("implication", "事業への示唆", "text", "機会と脅威から何をするか", 0, 2, 12, 1),
        ],
    },
    "five-forces": {
        "name": "ファイブフォース分析",
        "category": "業界構造",
        "stages": ["s02", "s03"],
        "description": "業界の収益性を決める5つの力（競合・新規参入・代替品・買い手・売り手）の強さを見る",
        "blocks": [
            _b(
                "new_entrants",
                "新規参入の脅威",
                "table",
                "参入障壁（規模・規制・ブランド・切替コスト）",
                4,
                0,
                4,
                1,
                FORCE,
            ),
            _b("suppliers", "売り手の交渉力", "table", "供給者の集中度・代替のしやすさ", 0, 1, 4, 1, FORCE),
            _b("rivalry", "業界内の競争", "table", "競合の数・成長率・差別化の度合い", 4, 1, 4, 1, FORCE),
            _b("buyers", "買い手の交渉力", "table", "顧客の集中度・価格への敏感さ・切替コスト", 8, 1, 4, 1, FORCE),
            _b("substitutes", "代替品の脅威", "table", "別の手段で同じ用事が片づくか", 4, 2, 4, 1, FORCE),
            _b("attractiveness", "業界の魅力度と打ち手", "text", "5つの力を踏まえた結論", 0, 3, 12, 1),
        ],
    },
    "three-c": {
        "name": "3C 分析",
        "category": "外部環境",
        "stages": ["s02", "s04"],
        "description": "顧客・競合・自社の3つの視点から、成功の鍵（KSF）を見つける",
        "blocks": [
            _b("customer", "顧客・市場（Customer）", "list", "市場の規模・ニーズ・購買行動", 0, 0, 4, 1),
            _b("competitor", "競合（Competitor）", "list", "競合の強み・弱み・戦略", 4, 0, 4, 1),
            _b("company", "自社（Company）", "list", "自社の強み・弱み・資源", 8, 0, 4, 1),
            _b("ksf", "成功の鍵（KSF）", "text", "3つから導く勝ち筋", 0, 1, 12, 1),
        ],
    },
    "stp": {
        "name": "STP 分析",
        "category": "市場の選び方",
        "stages": ["s02", "s04"],
        "description": "市場を切り分け（Segmentation）、狙う先を選び（Targeting）、立ち位置を決める（Positioning）",
        "blocks": [
            _b(
                "segments",
                "セグメンテーション",
                "table",
                "切り口ごとのセグメントと魅力度",
                0,
                0,
                12,
                1,
                (
                    ("segment", "セグメント"),
                    ("criteria", "切り口"),
                    ("size", "規模"),
                    ("growth", "成長性"),
                    ("fit", "自社との適合", "text", ("高", "中", "低")),
                ),
            ),
            _b("targeting", "ターゲティング", "text", "どのセグメントをなぜ狙うか", 0, 1, 6, 1),
            _b(
                "positioning",
                "ポジショニング",
                "text",
                "〈ターゲット〉にとって〈価値〉を提供する〈カテゴリ〉。〈競合〉と違い〈理由〉",
                6,
                1,
                6,
                1,
            ),
        ],
    },
    "swot": {
        "name": "SWOT 分析",
        "category": "戦略",
        "stages": ["s03", "s04"],
        "description": "内部の強み・弱みと、外部の機会・脅威を4つの象限に整理する",
        "blocks": [
            _b(
                "swot",
                "SWOT",
                "matrix",
                "",
                0,
                0,
                12,
                2,
                quadrants=["強み（Strengths）", "弱み（Weaknesses）", "機会（Opportunities）", "脅威（Threats）"],
                axes={
                    "x": {"label": "", "low": "プラス", "high": "マイナス"},
                    "y": {"label": "", "low": "外部", "high": "内部"},
                },
            ),
        ],
    },
    "tows": {
        "name": "クロス SWOT（TOWS）",
        "category": "戦略",
        "stages": ["s04"],
        "description": "SWOT を掛け合わせて、4つの方向の戦略を出す",
        "blocks": [
            _b(
                "tows",
                "戦略の方向",
                "matrix",
                "",
                0,
                0,
                12,
                2,
                quadrants=[
                    "強み×機会（SO：伸ばす）",
                    "弱み×機会（WO：補う）",
                    "強み×脅威（ST：守る）",
                    "弱み×脅威（WT：避ける）",
                ],
            ),
        ],
    },
    "vrio": {
        "name": "VRIO 分析",
        "category": "競争優位",
        "stages": ["s03", "s04"],
        "description": "自社の経営資源が、持続する競争優位になるかを4つの問いで判定する",
        "blocks": [
            _b(
                "resources",
                "経営資源の判定",
                "table",
                "経済価値・希少性・模倣困難性・組織",
                0,
                0,
                12,
                1,
                (
                    ("resource", "経営資源"),
                    ("value", "経済価値（V）", "text", ("はい", "いいえ")),
                    ("rarity", "希少性（R）", "text", ("はい", "いいえ")),
                    ("inimitability", "模倣困難性（I）", "text", ("はい", "いいえ")),
                    ("organization", "組織（O）", "text", ("はい", "いいえ")),
                    ("result", "判定", "text", ("持続的な優位", "一時的な優位", "同等", "劣位")),
                ),
            ),
        ],
    },
    "errc": {
        "name": "戦略キャンバスと ERRC",
        "category": "競争優位",
        "stages": ["s03", "s04"],
        "description": "業界の競争要因ごとに自社と競合の水準を比べ（価値曲線）、"
        "取り除く・減らす・増やす・付け加えるを決める",
        "blocks": [
            _b(
                "curve",
                "価値曲線（1〜5）",
                "table",
                "競争要因ごとの水準",
                0,
                0,
                12,
                1,
                (
                    ("factor", "競争要因"),
                    ("self", "自社", "number"),
                    ("rival1", "競合A", "number"),
                    ("rival2", "競合B", "number"),
                ),
            ),
            _b(
                "errc",
                "ERRC グリッド",
                "matrix",
                "",
                0,
                1,
                12,
                2,
                quadrants=["取り除く（Eliminate）", "増やす（Raise）", "減らす（Reduce）", "付け加える（Create）"],
            ),
        ],
    },
    "positioning-map": {
        "name": "ポジショニングマップ",
        "category": "競争優位",
        "stages": ["s03"],
        "description": "顧客が選ぶ理由になる2つの軸で、自社と競合の位置を描く",
        "blocks": [
            _b(
                "map",
                "ポジショニングマップ",
                "positioning",
                "★は自社",
                0,
                0,
                12,
                3,
                axes={
                    "x": {"label": "価格", "low": "安い", "high": "高い"},
                    "y": {"label": "手間", "low": "かかる", "high": "かからない"},
                },
            ),
            _b("reading", "読み取れること", "text", "空いている位置・狙う位置", 0, 3, 12, 1),
        ],
    },
    "value-chain": {
        "name": "バリューチェーン分析",
        "category": "競争優位",
        "stages": ["s03", "s04"],
        "description": "価値を生む活動ごとに、強み・弱み・コストを見る",
        "blocks": [
            _b(
                "activities",
                "活動",
                "table",
                "",
                0,
                0,
                12,
                1,
                (
                    ("type", "種類", "text", ("主活動", "支援活動")),
                    ("activity", "活動"),
                    ("strength", "強み"),
                    ("issue", "課題"),
                    ("cost", "コストの大きさ", "text", ("大", "中", "小")),
                ),
            ),
        ],
    },
    "ansoff": {
        "name": "アンゾフの成長マトリクス",
        "category": "戦略",
        "stages": ["s04"],
        "description": "製品（既存・新規）×市場（既存・新規）で、成長の方向を整理する",
        "blocks": [
            _b(
                "growth",
                "成長の方向",
                "matrix",
                "",
                0,
                0,
                12,
                2,
                quadrants=[
                    "市場浸透（既存×既存）",
                    "新製品開発（新規製品×既存市場）",
                    "新市場開拓（既存製品×新規市場）",
                    "多角化（新規×新規）",
                ],
                axes={
                    "x": {"label": "製品", "low": "既存", "high": "新規"},
                    "y": {"label": "市場", "low": "新規", "high": "既存"},
                },
            ),
            _b("choice", "選ぶ方向と理由", "text", "", 0, 2, 12, 1),
        ],
    },
    "marketing-mix": {
        "name": "4P（マーケティング・ミックス）",
        "category": "マーケティング",
        "stages": ["s04", "s05"],
        "description": "製品・価格・流通・販促の4つを一貫させる",
        "blocks": [
            _b("product", "製品（Product）", "list", "", 0, 0, 6, 1),
            _b("price", "価格（Price）", "list", "", 6, 0, 6, 1),
            _b("place", "流通（Place）", "list", "", 0, 1, 6, 1),
            _b("promotion", "販促（Promotion）", "list", "", 6, 1, 6, 1),
        ],
    },
    "bmc": {
        "name": "ビジネスモデルキャンバス",
        "category": "ビジネスモデル",
        "stages": ["s04", "s05"],
        "description": "誰に何をどう届け、どう稼ぐかを9つの要素で1枚にまとめる",
        "blocks": [
            _b("partners", "キーパートナー", "list", "", 0, 0, 2, 2),
            _b("activities", "主要活動", "list", "", 2, 0, 2, 1),
            _b("resources", "キーリソース", "list", "", 2, 1, 2, 1),
            _b("value", "価値提案", "list", "", 4, 0, 4, 2),
            _b("relationships", "顧客との関係", "list", "", 8, 0, 2, 1),
            _b("channels", "チャネル", "list", "", 8, 1, 2, 1),
            _b("segments", "顧客セグメント", "list", "", 10, 0, 2, 2),
            _b("cost", "コスト構造", "list", "", 0, 2, 6, 1),
            _b("revenue", "収益の流れ", "list", "", 6, 2, 6, 1),
        ],
    },
    "stakeholder-map": {
        "name": "ステークホルダーマップ",
        "category": "ビジネスモデル",
        "stages": ["s02", "s04", "s07"],
        "description": "関係者と、お金・モノ・情報の流れを図にする",
        "blocks": [
            _b(
                "map",
                "関係者と流れ",
                "diagram",
                "ノードに関係者、線にお金・モノ・情報の流れ",
                0,
                0,
                12,
                3,
                node_kinds=["自社", "顧客", "パートナー", "競合", "規制・行政"],
            ),
        ],
    },
    "unit-economics": {
        "name": "ユニットエコノミクス",
        "category": "収益性",
        "stages": ["s05"],
        "description": "顧客1人あたりの採算（LTV と CAC）を見る",
        "blocks": [
            _b(
                "metrics",
                "指標",
                "table",
                "前提と計算を書く",
                0,
                0,
                12,
                1,
                (("metric", "指標"), ("value", "値"), ("basis", "前提・計算")),
                rows=["顧客単価（月）", "粗利率", "月次解約率", "LTV", "CAC", "LTV / CAC", "CAC 回収期間（月）"],
            ),
        ],
    },
    "break-even": {
        "name": "損益分岐点分析",
        "category": "収益性",
        "stages": ["s05"],
        "description": "固定費と変動費から、黒字になる売上・顧客数を出す",
        "blocks": [
            _b(
                "items",
                "前提と結果",
                "table",
                "",
                0,
                0,
                12,
                1,
                (("item", "項目"), ("value", "値"), ("basis", "前提・計算")),
                rows=[
                    "固定費（月）",
                    "変動費率",
                    "単価",
                    "損益分岐点の売上（月）",
                    "損益分岐点の顧客数",
                    "到達の見込み時期",
                ],
            ),
        ],
    },
    "scenario": {
        "name": "シナリオ・感度分析",
        "category": "収益性",
        "stages": ["s05"],
        "description": "楽観・標準・悲観で前提を変えたときの結果を比べる",
        "blocks": [
            _b(
                "cases",
                "シナリオ",
                "table",
                "",
                0,
                0,
                12,
                1,
                (("variable", "前提・結果"), ("optimistic", "楽観"), ("base", "標準"), ("pessimistic", "悲観")),
                rows=["顧客数（1年後）", "単価", "解約率", "売上（1年目）", "営業利益（1年目）"],
            ),
            _b("sensitivity", "効きの大きい前提", "text", "どの前提が崩れると結果が大きく変わるか", 0, 1, 12, 1),
        ],
    },
    "okr": {
        "name": "OKR",
        "category": "戦略",
        "stages": ["s04"],
        "description": "目指す姿（Objective）と、達成を測る主要な結果（Key Results）",
        "blocks": [
            _b(
                "okr",
                "目標と主要な結果",
                "table",
                "",
                0,
                0,
                12,
                1,
                (("objective", "目標（O）"), ("kr", "主要な結果（KR）"), ("target", "目標値"), ("due", "期限")),
            ),
        ],
    },
}

# 新しいプロダクト（まだ組み合わせを変えていない工程）に最初から足しておくもの（必須にはしない）
DEFAULT_ATTACH = {
    "s02": ["pest", "five-forces"],
    "s03": ["errc", "vrio"],
    "s04": ["swot", "tows", "ansoff"],
    "s05": ["unit-economics", "break-even"],
}


# ---------------- ライブラリ ----------------
def _tenant_defs(tenant: str) -> dict[str, dict]:
    with session() as s:
        rows = list(s.execute(select(FrameworkDef).where(FrameworkDef.tenant_id == tenant)).scalars())
    return {
        r.fw_id: {
            "name": r.name,
            "category": r.category,
            "description": r.description,
            "stages": r.stages or [],
            "blocks": r.blocks or [],
            "source": "override" if r.fw_id in LIBRARY else "custom",
            "updated_by": r.updated_by,
        }
        for r in rows
    }


def library(tenant: str) -> dict[str, dict]:
    out = {k: {**v, "source": "builtin"} for k, v in LIBRARY.items()}
    out.update(_tenant_defs(tenant))
    return {k: {"id": k, **v} for k, v in out.items()}


def _clean_blocks(blocks: list) -> list[dict]:
    if not isinstance(blocks, list) or not blocks:
        raise FrameworkError(422, "部品を1つ以上入れてください")
    out, keys = [], set()
    for b in blocks[:30]:
        key, kind = str(b.get("key") or "").strip(), str(b.get("kind") or "")
        if not KEY_RE.match(key) or key in keys:
            raise FrameworkError(422, f"部品の key「{key}」は英小文字・数字・_ で、重ならないようにしてください")
        if kind not in KINDS:
            raise FrameworkError(422, f"部品の種類「{kind}」はありません（{'・'.join(KINDS)}）")
        label = str(b.get("label") or "").strip()
        if not label:
            raise FrameworkError(422, f"部品「{key}」の見出しが空です")
        keys.add(key)
        lay = b.get("layout") or {}
        w = max(1, min(12, int(lay.get("w") or 6)))
        c = {
            "key": key,
            "label": label[:120],
            "kind": kind,
            "hint": str(b.get("hint") or "")[:300],
            "layout": {
                "x": max(0, min(12 - w, int(lay.get("x") or 0))),
                "y": max(0, int(lay.get("y") or 0)),
                "w": w,
                "h": max(1, min(6, int(lay.get("h") or 1))),
            },
        }
        if kind == "table":
            cols = [x for x in b.get("columns") or [] if str(x.get("key") or "").strip() and str(x.get("label") or "")]
            if not cols:
                raise FrameworkError(422, f"表「{label}」の列を1つ以上入れてください")
            c["columns"] = [
                {
                    "key": str(x["key"])[:30],
                    "label": str(x["label"])[:60],
                    "kind": "number" if x.get("kind") == "number" else "text",
                    "options": [str(o)[:40] for o in x.get("options") or []][:12],
                }
                for x in cols[:12]
            ]
            if b.get("rows"):
                c["rows"] = [str(r)[:80] for r in b["rows"] if str(r).strip()][:40]
        if kind == "matrix":
            q = [str(x)[:60] for x in (b.get("quadrants") or [])][:4]
            c["quadrants"] = q + [f"象限{i + 1}" for i in range(len(q), 4)]
        if kind in ("matrix", "positioning"):
            ax = b.get("axes") or {}
            c["axes"] = {
                k: {
                    "label": str((ax.get(k) or {}).get("label", ""))[:40],
                    "low": str((ax.get(k) or {}).get("low", "低"))[:20],
                    "high": str((ax.get(k) or {}).get("high", "高"))[:20],
                }
                for k in ("x", "y")
            }
        if kind == "diagram":
            c["node_kinds"] = [str(x)[:30] for x in b.get("node_kinds") or []][:12]
        out.append(c)
    return out


def save(tenant: str, user: str, fw_id: str, body: dict) -> dict:
    if not ID_RE.match(fw_id or ""):
        raise FrameworkError(422, "id は英小文字・数字・ハイフンで2〜41文字にしてください")
    name = str(body.get("name") or "").strip()
    if not name:
        raise FrameworkError(422, "名前が空です")
    blocks = _clean_blocks(body.get("blocks") or [])
    stages = [x for x in body.get("stages") or [] if x in STAGE_BY_ID]
    with session() as s:
        r = s.execute(
            select(FrameworkDef).where(FrameworkDef.tenant_id == tenant, FrameworkDef.fw_id == fw_id)
        ).scalar_one_or_none()
        if r is None:
            r = FrameworkDef(tenant_id=tenant, fw_id=fw_id)
            s.add(r)
        r.name, r.category = name[:200], str(body.get("category") or "")[:60]
        r.description, r.stages, r.blocks, r.updated_by = (
            str(body.get("description") or "")[:2000],
            stages,
            blocks,
            user,
        )
        s.commit()
    invalidate()
    return library(tenant)[fw_id]


def delete(tenant: str, fw_id: str) -> None:
    with session() as s:
        r = s.execute(
            select(FrameworkDef).where(FrameworkDef.tenant_id == tenant, FrameworkDef.fw_id == fw_id)
        ).scalar_one_or_none()
        if r is None:
            raise FrameworkError(404, "そのフレームワークはテナントにありません（標準のものは消せません）")
        s.delete(r)
        s.commit()
    invalidate()


# ---------------- 工程の組み合わせ ----------------
def attached(product_id: str, stage_id: str) -> tuple[list[dict], bool]:
    """（足したフレームワーク [{id, required}], 既定から変えたか）。"""
    with session() as s:
        r = s.execute(
            select(StageFrameworkSet).where(
                StageFrameworkSet.product_id == product_id, StageFrameworkSet.stage_id == stage_id
            )
        ).scalar_one_or_none()
        if r is not None:
            return list(r.items or []), True
    return [{"id": x, "required": False} for x in DEFAULT_ATTACH.get(stage_id, [])], False


def set_attached(product: Product, user: str, stage_id: str, items: list[dict]) -> list[dict]:
    if stage_id not in STAGE_BY_ID:
        raise FrameworkError(404, "その工程はありません")
    lib = library(product.tenant_id)
    clean, seen = [], set()
    for it in items[:20]:
        fid = str(it.get("id") or "")
        if fid not in lib:
            raise FrameworkError(422, f"フレームワーク {fid} はありません")
        if fid not in seen:
            seen.add(fid)
            clean.append({"id": fid, "required": bool(it.get("required"))})
    with session() as s:
        r = s.execute(
            select(StageFrameworkSet).where(
                StageFrameworkSet.product_id == product.id, StageFrameworkSet.stage_id == stage_id
            )
        ).scalar_one_or_none()
        if r is None:
            r = StageFrameworkSet(product_id=product.id, stage_id=stage_id)
            s.add(r)
        r.items, r.updated_by = clean, user
        s.commit()
    invalidate()
    return clean


def _field(fid: str, fw: dict, b: dict, required: bool) -> fx.Field:
    cols = tuple(
        fx.Column(c["key"], c["label"], c.get("kind", "text"), tuple(c.get("options") or []))
        for c in b.get("columns") or []
    )
    cfg = {k: b[k] for k in ("quadrants", "axes", "node_kinds", "layout") if k in b}
    return fx.Field(
        f"{fid}.{b['key']}",
        f"{fw['name']}：{b['label']}",
        b["kind"],
        b.get("hint", ""),
        required=required,
        columns=cols,
        rows=tuple(b.get("rows") or ()),
        group=fid,
        config=cfg,
    )


_cache: dict[tuple[str, str], tuple[float, fx.Framework]] = {}
TTL = 5.0


def invalidate() -> None:
    _cache.clear()


def of(product_id: str | None, stage_id: str) -> fx.Framework:
    """プロダクトのこの工程の定義（基本の項目＋足したフレームワーク）。product_id がなければ基本だけ。"""
    core = fx.FRAMEWORK_BY_STAGE[stage_id]
    if not product_id:
        return core
    hit = _cache.get((product_id, stage_id))
    if hit and time.monotonic() - hit[0] < TTL:
        return hit[1]
    with session() as s:
        p = s.get(Product, product_id)
        tenant = p.tenant_id if p else ""
    lib = library(tenant) if tenant else {k: {"id": k, **v} for k, v in LIBRARY.items()}
    items, _ = attached(product_id, stage_id)
    fields, parts = list(core.fields), []
    for it in items:
        fw = lib.get(it["id"])
        if fw is None:
            continue
        fields += [_field(it["id"], fw, b, bool(it.get("required"))) for b in fw["blocks"]]
        parts.append(
            {
                "id": it["id"],
                "name": fw["name"],
                "category": fw.get("category", ""),
                "description": fw.get("description", ""),
                "required": bool(it.get("required")),
                "blocks": fw["blocks"],
            }
        )
    merged = fx.Framework(core.view, core.title, core.summary, tuple(fields), core.prompts, tuple(parts))
    _cache[(product_id, stage_id)] = (time.monotonic(), merged)
    return merged
