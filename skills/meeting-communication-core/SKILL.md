---
name: meeting-communication-core
description: >-
  当用户需要准备会议、整理纪要/行动项，或起草会务相关邮件与干系人沟通时务必使用本技能。
  覆盖议程、预读、纪要、决策日志、行动登记、跟进草稿、邮件起草。
  遇到「写议程」「会议纪要」「转写整理」「行动项」「决议表」「会后跟进」「会议邮件」务必使用。
  若环境已装 meeting-notes-specialist，按 MERGE-PLAN 单权威，禁止平行两套会议技能同时当权威。
  不要用于正式 DOCX/PPTX 排版主交付（分别走 documents / cyber-ppt）；起草≠发送。
---

# meeting-communication-core（会议与沟通闭环）

把会议从「开完再说」变成可执行闭环：议程 → 纪要 → 决议 → 行动项 → 跟进/邮件草稿。交付落在工作区 Markdown/表格；正式文件再转 documents / spreadsheets / cyber-ppt。本技能吸收并取代 merges 中的 `meeting-action-manager`。

## 概述

- **会前**：目标、必决事项、参会人、预读与时间盒。
- **会中/会后**：忠实提取决议、行动、未决、风险与停车场议题。
- **沟通**：跟进草稿与邮件——请求行动、语境、截止与语气对收件人清晰。
- OpenBot 交付 = 工作区文件；未经授权不发消息、不建日历。

## 前置

1. 确认会议目标、必决清单、参会人角色、时长与背景材料路径。
2. 拿到笔记或转写；缺原文时声明「仅据摘要/记忆」，勿假装完整转写。
3. 确认输出形态：纪要 Markdown、行动表、跟进/邮件草稿。
4. 敏感内容：默认「可分发版」；机密进「内部附录」并征得同意再扩发。
5. 若存在 `meeting-notes-specialist`：按 MERGE-PLAN 单权威。

## 流程

1. **框定会议**：一句话成功标准（「会结束时必须决定 X」）。
2. **写议程**：按决策与讨论结果组织；每项含目的、输入、期望产出、时间盒、主讲人。
3. **预读包**：必读/选读与「开会前须知」；缺材料标红。
4. **纪要提取**：
   - 忠实原意；区分已决 / 倾向 / 待决。
   - 抽出：决议、行动项、未决、风险、停车场。
   - 勿把沉默当同意；勿把试探写成承诺。
5. **行动项规范化**（见 `references/action-schema.md`）：负责人、截止、验收、依赖；缺失写「未指派/未定期」。
6. **决策日志**：决议陈述 + 依据摘要 + 反对意见 + 生效条件。
7. **邮件/跟进草稿**：行动表、下次检查点、明确请求；**不发送**。改日历/建任务需集成与明示授权。
8. **正式文件**：Word/Excel/PPT 移交 documents / spreadsheets / cyber-ppt。

## 输出

```text
output/meetings/<meeting-id>/
  agenda.md
  minutes.md
  decisions.md
  actions.md              # 或 actions.xlsx
  follow-up-draft.md
  email-drafts/           # 可选
  internal-notes.md
```

行动表列：`ID | 行动 | 负责人 | 截止日期 | 状态 | 验收 | 依赖 | 来源摘录`。

纪要顺序：一句摘要 → 决议 → 行动表 → 未决/风险 → 停车场。

## 边界

- **做**：议程、预读、纪要、决策日志、行动登记、跟进与邮件草稿。
- **不做**：未授权外发/建会；伪造出席或决议；把闲聊当承诺。
- **重叠**：与 `meeting-notes-specialist` 冲突时按 MERGE-PLAN；已取代 `meeting-action-manager`。
- **相邻**：版式精修 → documents；看板 → spreadsheets；咨询 PPT → cyber-ppt。
- **警告：** 勿使用 Codex artifact API / `openai.yaml`；交付用工作区文件。

## 触发样例

- 「根据这段转写整理会议纪要和行动项」
- 「写明天评审会的议程和预读清单」
- 「起草会后跟进邮件，先别发出去」
- 「把决议和 owner/due date 拉成一张表」

## 参考

- `references/action-schema.md` — 行动项字段与状态
- `references/minutes-template.md` — 纪要骨架
- `references/email-draft.md` — 会议相关邮件要点
- `ATTRIBUTION.md`
