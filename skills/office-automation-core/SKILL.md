---
name: office-automation-core
description: >-
  当用户要把重复性知识工作标准化或自动化（例行简报、KPI 检查、报告刷新、PDF/文件批处理、流程审计）时务必使用本技能。
  遇到「例行简报」「自动刷新报告」「KPI 巡检」「PDF 批处理」「流程审计」「干跑自动化」「办公流程标准化」务必使用。
  与 openbot-platform-ops 分工：本技能偏办公流程设计、文件处理与首跑验证；平台数字人/Gateway 定时走 platform-ops。
  不要用于一次性即兴分析（research-core / strategy-core）或未授权的外部系统批量写入。
---

# office-automation-core（办公自动化与流程审计）

把重复办公工序写成可重复、可审计、可干跑的流程：触发 → 输入 → 变换 → 输出 → 通知 → 停止条件。优先简单可重复；过早脚本化会放大坏数据。本技能吸收并取代 merges 中的 `office-automation`。

## 概述

- **例行报告**：触发、输入、变换、输出、受众、频率、owner、停止条件。
- **PDF/文件处理**：保留原件、明确变换、校验页/记录数、检视产物（可协作 nano-pdf）。
- **流程审计**：输入、决策、交接、系统、控制、延迟、失败模式与自动化候选。
- 结构化跟踪 → spreadsheets；报告 → documents / cyber-ppt；技能正文禁止写凭证。

## 前置

1. 确认业务目标：谁在何时需要什么输出、缺了会怎样。
2. 盘点数据源、权限、刷新频率、接收人、现有手工步骤。
3. 标明外部副作用（发邮件、写表、建任务、调 API）；默认需用户授权。
4. 与 `openbot-platform-ops` 划界：平台定时/数字人 → platform-ops；本技能先交流程说明与首跑产物。
5. 确认干跑可行性与沙箱输出目录。

## 流程

1. **写流程卡**（见 `references/workflow-card.md`）：触发、输入、变换、输出、接收人、频率、负责人、停止条件、失败策略。
2. **步骤分级**：R（只读）/ W（写工作区）/ X（外部副作用）。X 紧邻人工审批，除非用户明确授权。
3. **数据契约**：字段、类型、新鲜度、主键、缺数与重复；尽量幂等。
4. **文件/PDF 路径**：原件只读复制；变换后校验页数/记录数；视觉抽检；细节可交 nano-pdf。
5. **流程审计**（见 `references/process-audit.md`）：画交接与控制点；标延迟与失败模式；列出自动化候选与不应自动化项。
6. **变换设计**：先表格/Markdown 可审计中间态，再生成报告。
7. **首跑/干跑**：真实或脱敏样本；记录耗时、缺数、异常；修复后再谈定时。
8. **移交定时**：平台级 cron/数字人把流程卡交给 openbot-platform-ops；本技能不假装已注册调度。

## 输出

```text
output/office-automation/<workflow-id>/
  workflow-card.md
  dry-run-report.md
  process-audit.md        # 可选
  sample-output/
  runbook.md
```

流程卡必含：触发、输入、变换（R/W/X）、输出路径、接收人、频率、负责人、停止条件、重试与幂等、副作用与审批点。

## 边界

- **做**：流程设计、数据契约、PDF/文件批处理设计、流程审计、干跑、runbook、通知草稿。
- **不做**：技能正文存密钥；未授权批量改外部系统；替代 platform-ops 注册平台定时。
- **相邻**：报告排版 → documents / cyber-ppt；登记表 → spreadsheets；一次性调研/战略 → research-core / strategy-core；PDF 精修 → nano-pdf。
- **警告：** 勿使用 Codex artifact 协议 / `agents/openai.yaml`；交付用工作区文件。

## 触发样例

- 「把每周业务简报标准化，先干跑一次」
- 「设计 KPI 日检：缺数怎么处理、谁审批外发」
- 「这批 PDF 提取字段并校验页数，保留原件」
- 「审计报销流程，标出可自动化与必须人工点」

## 参考

- `references/workflow-card.md` — 流程卡与 R/W/X
- `references/failure-modes.md` — 缺数/重复/陈旧/部分失败
- `references/process-audit.md` — 流程审计提纲
- `ATTRIBUTION.md`
