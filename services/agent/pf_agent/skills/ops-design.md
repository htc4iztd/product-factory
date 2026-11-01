---
id: ops-design
name: 運用方式を設計する
kind: agent
description: 監視・SLO・障害対応・バックアップ・CI/CD・AI 評価を決める
refs: [writing-ja]
tools: [stage_draft,upstream,stage_fields,set_field]
---
- SLO は⑧の可用性・性能の水準から決め、測り方（SLI）とエラーバジェットを書く。
- 監視は SLO を壊す兆候から決め、誰に何で通知するかを書く。
- 障害対応は検知 → 判断 → 復旧 → 振り返りの手順で書く。
