"""Stage and phase definitions (設計書 3章).

工程の順序・ゲート・入力関係はここでコードとして固定する。LLMには各ステージの
中身（成果物の文章）だけを任せる。
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Stage:
    id: str                 # "s01" .. "s14"
    no: str                 # "①"
    name: str
    phase: str              # "P1" ..
    artifact: str           # 成果物の名前
    sections: tuple[str, ...]   # 成果物に必須の見出し（事前監査で検査する）
    inputs: tuple[str, ...] = ()  # 上流ステージ id
    skip_in_poc: bool = False
    clarify: tuple[str, ...] = ()  # 確認質問（選択肢なしの初期版）
    review_condition: bool = False  # 「見直し条件」を必須にするか（②③⑤）


@dataclass(frozen=True)
class Phase:
    id: str
    name: str
    gate: str | None        # フェーズ末の審査
    gate_question: str | None
    stages: tuple[str, ...] = field(default_factory=tuple)


STAGES: tuple[Stage, ...] = (
    Stage("s01", "①", "アイディエーション", "P1", "idea-brief",
          ("課題", "対象顧客", "解決仮説", "初期スコープ"),
          clarify=("誰のどんな課題を解きますか？", "最初に試す範囲（スコープ）は？")),
    Stage("s02", "②", "市場分析", "P1", "market",
          ("市場規模の推計式", "出典", "顧客セグメント", "見直し条件"),
          inputs=("s01",), skip_in_poc=True, review_condition=True,
          clarify=("対象とする地域・市場は？",)),
    Stage("s03", "③", "競合分析", "P1", "competitors",
          ("競合・代替手段", "比較軸", "位置づけ", "見直し条件"),
          inputs=("s01", "s02"), skip_in_poc=True, review_condition=True,
          clarify=("既に知っている競合・代替手段は？",)),
    Stage("s04", "④", "プロダクト戦略", "P2", "strategy",
          ("狙う顧客", "価値提案", "差別化", "北極星指標", "撤退条件"),
          inputs=("s01", "s02", "s03"),
          clarify=("北極星指標の候補は？", "撤退を判断する条件は？")),
    Stage("s05", "⑤", "事業計画書", "P2", "business-plan",
          ("KPIツリー", "収益モデル", "PL/BS/CS計画", "投資額", "見直し条件"),
          inputs=("s02", "s03", "s04"), review_condition=True,
          clarify=("利用モード（個人／法人）と会計の区切りは？",)),
    Stage("s06", "⑥", "プロダクト仕様", "P3", "product-spec",
          ("ペルソナ", "ユーザーストーリー", "受入基準", "画面モック"),
          inputs=("s04", "s05"),
          clarify=("最初のリリースで必須のストーリーは？",)),
    Stage("s07", "⑦", "業務要求定義", "P3", "business-req",
          ("to-be業務フロー", "業務ルール", "役割"),
          inputs=("s06",),
          clarify=("人が行う業務（問合せ・決済・審査など）はありますか？",)),
    Stage("s08", "⑧", "システム要求定義", "P3", "system-req",
          ("機能要求", "非機能要求", "外部接続"),
          inputs=("s06", "s07"),
          clarify=("性能・可用性・コスト上限の目安は？",)),
    Stage("s09", "⑨", "アプリケーション設計", "P3", "app-design",
          ("設計方針", "コンポーネント", "概念データモデル", "処理仕様", "状態遷移", "API契約", "ユニット分割"),
          inputs=("s08",),
          clarify=("使いたい言語・フレームワークは？",)),
    Stage("s10", "⑩", "インフラ設計", "P3", "infra-design",
          ("設計方針", "構成図", "リソース", "環境", "通信要件", "IaC方針", "月額コスト見積"),
          inputs=("s08", "s09"),
          clarify=("配置するクラウドは？",)),
    Stage("s11", "⑪", "運用方式設計", "P3", "ops-design",
          ("運用方針・体制", "運用スケジュール", "起動・停止", "監視項目", "SLO", "障害対応", "バックアップ・リカバリ",
           "バッチ運用", "ログ運用", "セキュリティ運用", "CI/CD", "AI機能の評価方式"),
          inputs=("s08", "s09", "s10"),
          clarify=("障害時に誰へ通知しますか？",)),
    Stage("s12", "⑫", "コーディング", "P4", "units",
          ("ユニット一覧", "プルリクエスト"),
          inputs=("s09", "s10", "s11"),
          clarify=("コード生成の方式（外部エージェント／ADK自前）は？",)),
    Stage("s13", "⑬", "テスト", "P4", "test-report",
          ("結合テスト結果", "受入テスト結果", "受入基準の網羅表"),
          inputs=("s06", "s12"),
          clarify=("受入テストで特に確認したい基準は？",)),
    Stage("s14", "⑭", "リリース", "P5", "release",
          ("デプロイ記録", "監視設定", "AI評価設定"),
          inputs=("s11", "s13"),
          clarify=("公開日時と公開範囲は？",)),
)

STAGE_BY_ID = {s.id: s for s in STAGES}

PHASES: tuple[Phase, ...] = (
    Phase("P1", "探索", "G1", "作る価値があるか", ("s01", "s02", "s03")),
    Phase("P2", "事業定義", "G2", "事業として成り立つか", ("s04", "s05")),
    Phase("P3", "要求・設計", "G3", "この版で作り始めてよいか",
          ("s06", "s07", "s08", "s09", "s10", "s11")),
    Phase("P4", "構築", "G4", "出してよいか", ("s12", "s13")),
    Phase("P5", "リリース", None, None, ("s14",)),
)

PHASE_BY_ID = {p.id: p for p in PHASES}

# 状態（設計書 6.2）
NOT_STARTED = "not_started"
IN_PROGRESS = "in_progress"
AWAITING_APPROVAL = "awaiting_approval"
REVISING = "revising"
COMPLETED = "completed"
SKIPPED = "skipped"
NEEDS_RECHECK = "needs_recheck"
STATUSES = (NOT_STARTED, IN_PROGRESS, AWAITING_APPROVAL, REVISING,
            COMPLETED, SKIPPED, NEEDS_RECHECK)

APPROVE = "Approve"
REQUEST_CHANGES = "Request Changes"
ACCEPT_AS_IS = "Accept as-is"
DECISIONS = (APPROVE, REQUEST_CHANGES, ACCEPT_AS_IS)


def downstream_of(stage_id: str) -> list[str]:
    """stage_id を（直接・間接に）参照する下流ステージ。変更伝播（4.3）で使う。"""
    out: list[str] = []
    frontier = [stage_id]
    while frontier:
        cur = frontier.pop()
        for s in STAGES:
            if cur in s.inputs and s.id not in out:
                out.append(s.id)
                frontier.append(s.id)
    return sorted(out)
