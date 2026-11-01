---
id: field-writing
name: 工程の項目の書き方
kind: reference
description: 項目の値の型（文章・箇条書き・表・図）と、ID でつなぐ決まり
refs: [traceability]
tools: [stage_fields]
---
- 書く前に stage_fields で項目の key・型・列を確かめる。値は項目の型に合わせる（表は列の key を持つ行の配列）。
- 既にある値を消すときは、なぜ消すかを Issue の notes に書く。
- 資料にない数値・事実を作らない。仮置きは「仮：」を付け、何が決まれば確定するかを書く。
- ID を振る表（US-・AC-・FR- など）は、他の工程から参照される。既存の ID は振り直さない。
