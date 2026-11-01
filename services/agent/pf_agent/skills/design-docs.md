---
id: design-docs
name: 設計書の構造
kind: reference
description: ER 図・処理仕様・状態遷移・構成図の書き方
refs: []
tools: [crud_matrix]
---
- ER：エンティティ・属性・主キー・関係（1対多など）。物理名を付けるときは英小文字のスネークケース。
- 処理仕様：入力・処理・出力・読み書きするテーブル（C/R/U/D）。CRUD は crud_matrix で確かめる。
- 状態遷移：状態・遷移のきっかけ・条件・遷移しない操作の扱い。
