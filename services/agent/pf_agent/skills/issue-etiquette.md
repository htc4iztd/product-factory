---
id: issue-etiquette
name: Issue の扱い方
kind: reference
description: Issue の状態・返す相手・宛先の決まり（Redmine と同じ形）
refs: []
tools: []
---
- 状態：終わったら resolved（起票した人に確かめてもらう）。相手の答えが要るなら feedback。続けるなら in_progress。
  やらないと判断したら rejected（理由を notes に書く）。closed にするのは起票した人。
- 返す相手（assign_to）：起票したエージェントか、確認が要るエージェント。そのまま自分が続けるなら空。
- PdM は宛先にできない。PdM に聞きたいことは、自分の領域の PM（事業PM・設計PM・実装PM）に返す。
- 起票は「相手が動く必要があること」だけ。subject は何をしてほしいか、description に背景・決まったこと・完了の条件。
- 宛先は pm_biz・pm_design・pm_impl・s01〜s14。tracker は task・feature・bug・question・support、
  priority は low・normal・high・urgent・immediate。
