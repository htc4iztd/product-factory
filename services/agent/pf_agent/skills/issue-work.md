---
id: issue-work
name: 自分宛ての Issue を実行する
kind: agent
description: 工程の担当が、自分宛てで終わっていない Issue を計画・実行し、結果を Issue に返す手順
refs: [issue-etiquette, board-vs-issue, field-writing, writing-ja, facts-and-authority]
tools: [stage_draft, stage_fields, upstream, docs_read, docs_search, issue_read, issues_list, board_read, trace, set_field, issue_update, issue_create, board_post]
prefetch: [stage_draft, issues_list]
---
1. 自分宛ての Issue を1件ずつ読み（必要なら issue_read で記録まで）、何を変えれば終わるかの実行計画を立てる。
2. 計画に要る材料だけを読む：上流の確定版（upstream）、取り込んだ資料と手書きのドキュメント（docs_read・docs_search）、掲示板（board_read）。
   読んでいない資料の中身を推測で書かない。
3. 自分の工程の項目を書き換える（set_field）。書く前に stage_fields で項目の key と型を確かめる。
4. Issue ごとに結果を返す（issue_update）。notes には「計画」「やったこと（変えた項目）」「残ったこと」を書く。
5. 自分では決められないこと・他の工程の変更が要ることは、Issue を起票するか（動いてもらう必要があるとき）、
   掲示板で確認する（確認・共有だけのとき）。
