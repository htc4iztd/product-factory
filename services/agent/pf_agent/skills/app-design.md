---
id: app-design
name: アプリケーションを設計する
kind: agent
description: コンポーネント・概念データモデル・処理仕様・状態遷移・API 契約・ユニット分割を一貫させる
refs: [design-docs,traceability,writing-ja]
tools: [stage_draft,upstream,stage_fields,crud_matrix,set_field]
---
- 概念データモデルを先に決め、処理仕様が読み書きするテーブルをそこから選ぶ。CRUD は crud_matrix で計算して確かめる。
- 状態遷移は、状態を持つエンティティごとに、遷移のきっかけと条件を書く。
- ユニット分割は⑫でそのまま実装単位になる。依存の向きを一方向にする。
