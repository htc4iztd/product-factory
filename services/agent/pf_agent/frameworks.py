"""ステージごとのフレームワーク（成果物の型）。

成果物は文章ではなく、項目ごとの値（draft）として持つ。値の型は3つ。
- text：文章（Markdown 可）
- list：箇条書き（文字列の配列）
- table：表（列が決まった行の配列）。rows を決めた表は行の見出しが固定
- flows：スイムレーン型の業務フロー（業務ごとに、レーン・ノード・矢印）
- er / states / specs / graph：設計書の構造（designs.py）。ER図・状態遷移・処理仕様・構成図

版の Markdown（下流ステージとLLMへの入力、監査ログのハッシュ）はここで作る。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

from . import designs as dz
from .stages import STAGES, Stage


@dataclass(frozen=True)
class Column:
    key: str
    label: str
    kind: str = "text"      # text | number
    options: tuple[str, ...] = ()   # 選択肢（画面では選択欄にする）


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    kind: str               # text | list | table
    hint: str = ""
    required: bool = True
    columns: tuple[Column, ...] = ()
    rows: tuple[str, ...] = ()   # 行の見出しを固定する表（先頭列に入る）
    id_prefix: str = ""          # 先頭列を ID にする表（空なら US-01 のように自動で振る）


@dataclass(frozen=True)
class Framework:
    view: str               # 画面の描き方：lean_canvas | market | competitors | vpc | business_plan | document
    title: str              # フレームワークの名前
    summary: str            # 何を決めるためのものか（1文）
    fields: tuple[Field, ...]
    prompts: tuple[str, ...] = field(default_factory=tuple)   # チャットの最初に出す問いかけ

    def get(self, key: str) -> Field | None:
        return next((f for f in self.fields if f.key == key), None)


T, L, TB, FL = "text", "list", "table", "flows"
ER, ST, SP, GR = dz.ER, dz.ST, dz.SP, dz.GR
# フローのノードの種類
NODE_TYPES = {"start": "開始", "task": "作業", "decision": "判断", "system": "システム処理", "end": "終了"}
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
    "s07": Framework(
        "business_req", "業務要求定義（業務一覧・業務フロー）",
        "誰がどの業務を、どんな流れとルールで行うか（to-be）を決める",
        (
            Field("business_map", "業務一覧", TB,
                  "業務領域 → 業務 → 作業 の階層で並べる。上位業務の名前で親子をつなぐ",
                  columns=(Column("name", "業務名"), Column("parent", "上位業務"), Column("level", "階層"),
                           Column("kind", "種類"), Column("actor", "主担当"), Column("trigger", "きっかけ"),
                           Column("output", "アウトプット"), Column("frequency", "頻度"),
                           Column("change", "as-isからの変化"))),
            Field("flows", "業務フロー", FL,
                  "業務ごとのスイムレーン図。レーンは担当（人・部署・システム）、ノードは開始・作業・判断・システム処理・終了"),
            Field("rules", "業務ルール", TB, "業務の判断基準・制約",
                  columns=(Column("rule", "ルール"), Column("business", "対象業務"), Column("detail", "内容"),
                           Column("basis", "根拠"))),
            Field("roles", "役割", TB, "担当ごとの責任と関わる業務",
                  columns=(Column("role", "役割"), Column("responsibility", "責任"), Column("businesses", "関わる業務"),
                           Column("headcount", "体制・人数"))),
            Field("exceptions", "例外とイレギュラー", TB, "通常の流れから外れるケースと対応", required=False,
                  columns=(Column("business", "業務"), Column("case", "ケース"), Column("handling", "対応"))),
        ),
        ("人が行う業務（問合せ・決済・審査など）はありますか？", "業務の担当（人・部署・外部・システム）は誰ですか？",
         "今のやり方（as-is）から変わる業務はどれですか？"),
    ),
    "s06": Framework(
        "product_spec", "プロダクト仕様（ストーリーマップ・受入基準）",
        "誰が何をできるようにするかを、ストーリーと受入基準で決める",
        (
            Field("personas", "ペルソナ", TB, "代表的な利用者。①の顧客と④の狙う顧客から",
                  columns=(Column("name", "名前"), Column("profile", "属性"), Column("goal", "目的"),
                           Column("pain", "困りごと"), Column("context", "使う場面"))),
            Field("stories", "ユーザーストーリー", TB,
                  "行動 → ステップ の順に並べる。ストーリーは「〈誰〉として〈何〉をしたい。〈なぜ〉」",
                  columns=(Column("id", "ID"), Column("activity", "行動"), Column("step", "ステップ"),
                           Column("story", "ストーリー"), Column("persona", "ペルソナ"),
                           Column("release", "リリース", options=("MVP", "次", "後で"))),
                  id_prefix="US"),
            Field("acceptance", "受入基準", TB, "ストーリーごとに Given / When / Then で書く",
                  columns=(Column("id", "ID"), Column("story", "ストーリーID"), Column("given", "前提（Given）"),
                           Column("when", "操作（When）"), Column("then", "結果（Then）")),
                  id_prefix="AC"),
            Field("screens", "画面一覧", TB, "画面と、それを使うストーリー",
                  columns=(Column("id", "ID"), Column("name", "画面名"), Column("purpose", "目的"),
                           Column("stories", "ストーリーID")),
                  id_prefix="SC"),
        ),
        ("最初のリリースで必須のストーリーは？", "ストーリーの受入基準で、特に外せない条件は？"),
    ),
    "s08": Framework(
        "system_req", "システム要求定義（機能・非機能・外部接続）",
        "作るシステムが満たすべきことを、IDでストーリーとつなげて決める",
        (
            Field("functional", "機能要求", TB, "どのストーリー・業務を支える機能か",
                  columns=(Column("id", "ID"), Column("name", "機能"), Column("detail", "内容"),
                           Column("stories", "ストーリーID"), Column("business", "業務"),
                           Column("priority", "優先度", options=("Must", "Should", "Could", "Won't"))),
                  id_prefix="FR"),
            Field("nonfunctional", "非機能要求", TB, "IPA 非機能要求グレードの6分類ごとに水準（0〜5）と目標を決める",
                  columns=(Column("category", "分類"), Column("level", "水準", options=("0", "1", "2", "3", "4", "5")),
                           Column("requirement", "要求"), Column("target", "目標値・指標")),
                  rows=("可用性", "性能・拡張性", "運用・保守性", "移行性", "セキュリティ",
                        "システム環境・エコロジー")),
            Field("interfaces", "外部接続", TB, "つなぐ相手とやり取り", required=False,
                  columns=(Column("id", "ID"), Column("partner", "相手"), Column("method", "方式"),
                           Column("data", "データ"), Column("direction", "向き", options=("送る", "受ける", "双方向")),
                           Column("frequency", "頻度")),
                  id_prefix="IF"),
        ),
        ("性能・可用性・コスト上限の目安は？", "個人情報や決済など、扱いに注意が要るデータは？"),
    ),
    "s13": Framework(
        "test_report", "テスト（受入基準の網羅）", "⑥の受入基準を1つずつ確かめ、出してよいかの根拠を残す",
        (
            Field("coverage", "受入基準の網羅表", TB, "⑥の受入基準を取り込み、結果と証跡を入れる",
                  columns=(Column("ac", "受入基準ID"), Column("story", "ストーリーID"), Column("criterion", "基準"),
                           Column("result", "結果", options=("未実施", "合格", "不合格", "保留")),
                           Column("evidence", "証跡"), Column("note", "メモ"))),
            Field("test_cases", "テストケース", TB, "機能要求・受入基準ごとの確認手順", required=False,
                  columns=(Column("id", "ID"), Column("target", "対象（FR/AC）"), Column("steps", "手順"),
                           Column("expected", "期待結果"),
                           Column("result", "結果", options=("未実施", "合格", "不合格", "保留"))),
                  id_prefix="TC"),
            Field("summary", "結果のまとめ", T, "残っている不合格・保留と、出してよいかの判断材料"),
        ),
        ("受入テストで特に確認したい基準は？",),
    ),
    "s09": Framework(
        "app_design", "アプリケーション設計（データモデル・処理仕様・状態遷移）",
        "⑧の機能要求を、どの部品が・どのデータを・どう処理するかまで落とす",
        (
            Field("overview", "設計方針", T, "アーキテクチャの型、言語・フレームワーク、層の分け方"),
            Field("components", "コンポーネント", TB, "画面・API・バッチ・共通部品など、処理を担う単位",
                  columns=(Column("id", "ID"), Column("name", "名前"),
                           Column("kind", "種類", options=("画面", "API", "バッチ", "常駐", "共通部品", "外部連携")),
                           Column("module", "クラス・モジュール"), Column("responsibility", "責務"),
                           Column("fr", "機能要求ID")),
                  id_prefix="CP"),
            Field("data_model", "概念データモデル", ER, "エンティティ・属性（PK/FK）・リレーション"),
            Field("specs", "処理仕様", SP,
                  "処理ごとに概要・主な処理・入出力（テーブルは CRUD）・パラメータ・呼び出す部品。"
                  "CRUD マトリクスとデータフロー図はここから作る"),
            Field("states", "状態遷移", ST, "状態を持つもの（注文・申込など）ごとの状態とイベント", required=False),
            Field("apis", "API契約", TB, "外部・画面から呼ばれる API", required=False,
                  columns=(Column("id", "ID"),
                           Column("method", "メソッド", options=("GET", "POST", "PUT", "PATCH", "DELETE")),
                           Column("path", "パス"), Column("summary", "内容"), Column("request", "リクエスト"),
                           Column("response", "レスポンス"), Column("auth", "認可")),
                  id_prefix="API"),
            Field("units", "ユニット分割", TB, "⑫で1つずつ作る単位。コンポーネント・処理の ID で範囲を書く",
                  columns=(Column("id", "ID"), Column("name", "ユニット"), Column("scope", "範囲（CP/PR）"),
                           Column("depends", "依存するユニット"), Column("done", "完成の条件")),
                  id_prefix="UN"),
        ),
        ("使いたい言語・フレームワークは？", "状態を持つデータ（注文・申込など）はありますか？"),
    ),
    "s10": Framework(
        "infra_design", "インフラ設計（構成図・リソース・環境・コスト）",
        "どこに、何を、どうつないで置くかとその費用を決める",
        (
            Field("overview", "設計方針", T, "クラウド、リージョン、可用性とコストの考え方"),
            Field("architecture", "構成図", GR, "利用者から外部システムまで、リソースと通信を置き場所（ゾーン）ごとに"),
            Field("resources", "リソース", TB, "構成図のリソースのサービス・性能・冗長化",
                  columns=(Column("id", "ID"), Column("name", "リソース"), Column("service", "サービス"),
                           Column("spec", "性能・サイズ"), Column("env", "環境"), Column("redundancy", "冗長化"),
                           Column("note", "備考")),
                  id_prefix="RS"),
            Field("environments", "環境", TB, "環境ごとの目的と違い",
                  columns=(Column("env", "環境"), Column("purpose", "目的"), Column("place", "アカウント・URL"),
                           Column("difference", "本番との違い")),
                  rows=("開発", "検証", "本番")),
            Field("network", "通信要件", TB, "どこからどこへ、何で通信するか", required=False,
                  columns=(Column("source", "通信元"), Column("target", "通信先"), Column("protocol", "プロトコル"),
                           Column("port", "ポート"), Column("purpose", "用途"))),
            Field("iac", "IaC方針", T, "構成をコードで持つ方法と、変更の流れ"),
            Field("cost", "月額コスト見積", TB, "合計は自動で計算する",
                  columns=(Column("item", "項目"), Column("service", "サービス"), Column("basis", "算定の前提"),
                           Column("monthly", "月額（円）", "number"))),
        ),
        ("配置するクラウドとリージョンは？", "止まってよい時間（可用性の目標）は？"),
    ),
    "s11": Framework(
        "ops_design", "運用方式設計（監視・SLO・障害対応・定常運用）", "動かし続けるための監視・対応・定常作業を決める",
        (
            Field("overview", "運用方針・体制", T, "運用の時間帯、体制、役割、エスカレーションの考え方"),
            Field("schedule", "運用スケジュール", TB, "業務と運用・基盤の処理がいつ動くか", required=False,
                  columns=(Column("name", "処理"), Column("kind", "区分", options=("業務", "運用・基盤")),
                           Column("timing", "タイミング"), Column("window", "時間帯"), Column("owner", "担当"))),
            Field("startstop", "起動・停止", TB, "起動・停止のきっかけと手順", required=False,
                  columns=(Column("target", "対象"), Column("trigger", "きっかけ"), Column("method", "方法"),
                           Column("order", "順序"), Column("note", "備考"))),
            Field("monitoring", "監視項目", TB, "何を、どの閾値で、誰に知らせるか",
                  columns=(Column("category", "分類",
                                  options=("ハードウェア", "ソフトウェア", "業務", "サービス", "性能", "データベース",
                                           "セキュリティ", "ネットワーク", "AI")),
                           Column("target", "対象"), Column("metric", "監視内容"), Column("threshold", "閾値"),
                           Column("interval", "間隔"), Column("notify", "通知先"), Column("action", "対応"))),
            Field("slo", "SLO", TB, "利用者から見た品質の目標",
                  columns=(Column("service", "対象"), Column("sli", "指標（SLI）"), Column("target", "目標"),
                           Column("window", "期間"), Column("budget", "エラーバジェットの使い方"))),
            Field("incident", "障害対応", TB, "重大度ごとの定義・連絡・初動",
                  columns=(Column("level", "重大度"), Column("definition", "定義"), Column("notify", "連絡先"),
                           Column("response", "初動の目標時間"), Column("escalation", "エスカレーション")),
                  rows=("S1（全面停止）", "S2（一部停止）", "S3（軽微）")),
            Field("backup", "バックアップ・リカバリ", TB, "何を、どの頻度で、どこまで戻せるか", required=False,
                  columns=(Column("target", "対象"), Column("method", "方式"), Column("frequency", "頻度"),
                           Column("retention", "保管期間"), Column("rpo", "RPO"), Column("rto", "RTO"),
                           Column("restore", "復旧手順"))),
            Field("batch", "バッチ運用", TB, "定時に動く処理と失敗時の扱い", required=False,
                  columns=(Column("job", "ジョブ"), Column("schedule", "スケジュール"), Column("depends", "前提"),
                           Column("on_failure", "失敗時"), Column("rerun", "再実行"))),
            Field("logs", "ログ運用", TB, "ログの種類・保管・使い道", required=False,
                  columns=(Column("kind", "ログ"), Column("place", "保管場所"), Column("retention", "保管期間"),
                           Column("rotation", "ローテーション"), Column("use", "使い道"))),
            Field("security_ops", "セキュリティ運用", TB, "定期的なセキュリティ作業", required=False,
                  columns=(Column("item", "作業"), Column("frequency", "頻度"), Column("method", "方法"),
                           Column("owner", "担当"))),
            Field("cicd", "CI/CD", T, "ビルド・テスト・デプロイの流れと承認"),
            Field("ai_eval", "AI機能の評価方式", T, "AI 機能の品質をどう測り続けるか（AI 機能がなければ「なし」）",
                  required=False),
        ),
        ("障害時に誰へ通知しますか？", "運用する時間帯（24時間か、業務時間だけか）は？"),
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
    if f.kind in dz.KINDS:
        return dz.empty(f.kind)
    if f.kind == FL:
        return []
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
    if f.kind == FL:
        return any(fl.get("nodes") for fl in (value or []))
    if f.kind in dz.KINDS:
        return dz.filled(f.kind, value)
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
    if f.kind == FL:
        return _coerce_flows(value)
    if f.kind in dz.KINDS:
        return dz.COERCE[f.kind](value)
    # table
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, list) or not all(isinstance(r, dict) for r in value):
        raise ValueError("表は行（オブジェクト）の配列で渡してください")
    keys = [c.key for c in f.columns]
    rows = [{k: _cell(f, k, r.get(k, "")) for k in keys} for r in value]
    if f.id_prefix:
        rows = _assign_ids(f, rows)
    if f.rows:
        # 行見出しは固定。見出しが一致する行の値だけを採る
        by = {str(r.get(keys[0], "")): r for r in rows}
        rows = [dict(by.get(h, {}), **{keys[0]: h}) for h in f.rows]
        rows = [{k: r.get(k, "") for k in keys} for r in rows]
    return rows


def _assign_ids(f: Field, rows: list[dict]) -> list[dict]:
    """ID 列が空の行と重複した行に、次の番号を振る（US-01, US-02 …）。中身が空の行は捨てる。"""
    key = f.columns[0].key
    rows = [r for r in rows if any(str(v).strip() for k, v in r.items() if k != key)]
    used: set[str] = set()
    for r in rows:
        rid = str(r.get(key, "")).strip()
        r[key] = rid if rid and rid not in used else ""
        used.add(r[key])
    n = 1
    for r in rows:
        if not r[key]:
            while f"{f.id_prefix}-{n:02d}" in used:
                n += 1
            r[key] = f"{f.id_prefix}-{n:02d}"
            used.add(r[key])
    return rows


def ids_in(text) -> list[str]:
    """「US-01, US-03」のような書き方から ID を取り出す。"""
    import re
    return re.findall(r"[A-Z]{2,4}-\d+", str(text or ""))


def _coerce_flows(value) -> list[dict]:
    """業務フローの形をそろえる。

    [{business, lanes: [名], nodes: [{id, type, label, lane, x}], edges: [{id, source, target, label}]}]
    """
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, list) or not all(isinstance(x, dict) for x in value):
        raise ValueError("フローはオブジェクトの配列で渡してください")
    out = []
    for i, fl in enumerate(value):
        lanes = [str(x).strip() for x in fl.get("lanes") or [] if str(x).strip()] or ["担当"]
        nodes, seen = [], set()
        for j, n in enumerate(fl.get("nodes") or []):
            nid = str(n.get("id") or f"n{j + 1}")
            if nid in seen:
                continue
            seen.add(nid)
            lane = n.get("lane", 0)
            if isinstance(lane, str) and not lane.lstrip("-").isdigit():
                lane = lanes.index(lane) if lane in lanes else 0   # レーン名で来た場合
            lane = min(max(int(lane), 0), len(lanes) - 1)
            try:
                x = float(n.get("x", 40 + j * 200))
            except (TypeError, ValueError):
                x = 40 + j * 200
            nodes.append({"id": nid, "type": n.get("type") if n.get("type") in NODE_TYPES else "task",
                          "label": str(n.get("label") or ""), "lane": lane, "x": round(x)})
        edges = []
        for k, e in enumerate(fl.get("edges") or []):
            src, dst = str(e.get("source") or ""), str(e.get("target") or "")
            if src in seen and dst in seen and src != dst:
                edge = {"id": str(e.get("id") or f"e{k + 1}"), "source": src, "target": dst,
                        "label": str(e.get("label") or "")}
                # 画面で選んだ接続点（左右上下）は残す
                for h in ("sourceHandle", "targetHandle"):
                    if e.get(h) in ("l", "r", "t", "b"):
                        edge[h] = e[h]
                edges.append(edge)
        out.append({"business": str(fl.get("business") or f"業務{i + 1}"), "lanes": lanes, "nodes": nodes,
                    "edges": edges})
    return out


def flows_mermaid(flows: list[dict]) -> list[str]:
    """フローを Mermaid の flowchart にする（下流ステージとLLMが読むため）。"""
    shape = {"start": ('(["', '"])'), "end": ('(["', '"])'), "decision": ('{"', '"}'),
             "system": ('[["', '"]]'), "task": ('["', '"]')}
    lines: list[str] = []
    for fl in flows:
        lines += [f"### {fl['business']}", "```mermaid", "flowchart LR"]
        for li, lane in enumerate(fl["lanes"]):
            lines.append(f'  subgraph L{li}["{lane}"]')
            for n in sorted((n for n in fl["nodes"] if n["lane"] == li), key=lambda n: n["x"]):
                a, b = shape[n["type"]]
                label = (n["label"] or NODE_TYPES[n["type"]]).replace('"', "'")
                lines.append(f"    {n['id']}{a}{label}{b}")
            lines.append("  end")
        for e in fl["edges"]:
            mid = f'|"{e["label"]}"|' if e["label"] else ""
            lines.append(f"  {e['source']} -->{mid} {e['target']}")
        lines += ["```", ""]
    return lines


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


def cost_rows(rows: list[dict]) -> list[dict]:
    """月額コストに合計を足した表示用の行。"""
    return list(rows or []) + [{"item": "合計", "monthly": round(sum(_num(r.get("monthly")) for r in rows or []))}]


# 文章の見出しだけで作っていた頃の項目（sec1, sec2 …）の名前。型を持たせた後も、書いた中身は設計方針に引き継ぐ
LEGACY_SECTIONS = {
    "s09": ("コンポーネント", "ドメインモデル", "API契約", "ユニット分割"),
    "s10": ("構成", "環境", "IaC方針", "月額コスト見積"),
    "s11": ("CI/CD", "監視項目", "SLO", "障害対応", "AI機能の評価方式"),
}


def upgrade(stage_id: str, draft: dict | None) -> dict:
    """古い形の下書きを今の項目にそろえる（足りない項目は空で足し、昔の見出しの文章は先頭の文章項目へ）。"""
    fw = FRAMEWORK_BY_STAGE[stage_id]
    d = dict(draft or {})
    old = [(k, v) for k, v in d.items() if fw.get(k) is None and k.startswith("sec") and str(v or "").strip()]
    if old and stage_id in LEGACY_SECTIONS:
        names = LEGACY_SECTIONS[stage_id]
        head = next((f for f in fw.fields if f.kind == T), None)
        if head is not None and not str(d.get(head.key) or "").strip():
            parts = []
            for k, v in sorted(old, key=lambda kv: int(kv[0][3:]) if kv[0][3:].isdigit() else 99):
                i = int(k[3:]) - 1 if k[3:].isdigit() else -1
                parts.append(f"### {names[i] if 0 <= i < len(names) else k}\n{str(v).strip()}")
            d[head.key] = "\n\n".join(parts)
    for k in [k for k in d if fw.get(k) is None and k.startswith("sec")]:
        d.pop(k)
    for f in fw.fields:
        if f.key not in d:
            d[f.key] = empty_value(f)
    return d


def to_markdown(stage: Stage, fw: Framework, draft: dict) -> str:
    lines = [f"# {stage.no} {stage.name}（{fw.title}）", ""]
    if stage.id in LEGACY_SECTIONS:
        draft = upgrade(stage.id, draft)
    for f in fw.fields:
        v = (draft or {}).get(f.key)
        lines.append(f"## {f.label}")
        if f.kind == T:
            lines.append(str(v or "").strip() or "（未記入）")
        elif f.kind == L:
            lines += [f"- {x}" for x in v or []] or ["（未記入）"]
        elif f.kind == FL:
            lines += flows_mermaid(v or []) or ["（未記入）"]
        elif f.kind in dz.KINDS:
            lines += dz.markdown(f.kind, v, draft) or ["（未記入）"]
        else:
            rows = (pl_rows(v) if (stage.id == "s05" and f.key == "pl")
                    else cost_rows(v) if (stage.id == "s10" and f.key == "cost" and v) else (v or []))
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
        if f.kind == FL or f.kind in dz.KINDS:
            where = "フローエディタ" if f.kind == FL else "図のエディタ"
            notes.append(f"「{label}」は文書からは変えられません（キャンバスの{where}で編集してください）")
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
        if f.label not in sections and f.kind != FL and f.kind not in dz.KINDS:
            notes.append(f"見出し「{f.label}」がないため、その項目は変えていません")
    return values, notes


def spec(fw: Framework) -> list[dict]:
    """画面とLLMに渡す項目の定義。"""
    return [{"key": f.key, "label": f.label, "kind": f.kind, "hint": f.hint, "required": f.required,
             "columns": [{"key": c.key, "label": c.label, "kind": c.kind, "options": list(c.options)}
                         for c in f.columns],
             "rows": list(f.rows), "id_prefix": f.id_prefix} for f in fw.fields]
