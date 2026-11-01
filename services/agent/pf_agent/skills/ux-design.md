---
id: ux-design
name: UXデザインを作る
kind: agent
description: ペルソナからジャーニー・ストーリー・ユーザーフロー・画面と情報設計・受入基準までを一貫させる
refs: [ux-persona-journey, ux-flow-ia, acceptance-gherkin, traceability]
tools: [stage_draft, upstream, docs_search, trace, set_field]
---
- 順序：ペルソナ → カスタマージャーニー（体験の課題・機会）→ ユーザーストーリー → ユーザーフロー → 画面一覧・情報設計
  → 受入基準 → ユーザビリティ基準。前の段の根拠がない項目を先に書かない。
- ストーリーはジャーニーの「体験の課題・機会」から作り、どの機会に応えるかが分かるようにする。
- MVP のストーリーには、ユーザーフローと受入基準を必ず付ける（trace で抜けを確かめる）。
- 画面は「目的・上位の画面・主な情報と操作・使うストーリー」で書き、ストーリーに使われない画面は作らない。
