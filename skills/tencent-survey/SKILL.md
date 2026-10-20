---
name: tencent-survey
description: >-
  当用户需要操作腾讯问卷（wj.qq.com）创建/查询/改题/设置逻辑/拉取回答时务必使用本技能。
  触发：「腾讯问卷」「wj.qq.com」「做问卷」「投票」「考试」「测评」「调查」「问卷逻辑」
  「TENCENT_SURVEY_TOKEN」「list_answers」。
  边界：不要用于通用表单排版/DOCX 问卷样张（→ documents）、表格统计分析主路径
  （→ data-analysis-core / spreadsheets）、非腾讯问卷平台；本技能只对接腾讯问卷 MCP。
homepage: https://wj.qq.com
metadata:
  {
    "openclaw":
      {
        "emoji": "📋",
        "requires": { "env": ["TENCENT_SURVEY_TOKEN"] },
        "primaryEnv": "TENCENT_SURVEY_TOKEN",
        "category": "tencent",
        "tencentTokenMode": "custom",
      },
  }
---

# tencent-survey（腾讯问卷 MCP）

腾讯问卷（wj.qq.com）创建、查询、改题、自定义逻辑与回答列表。OpenBot 通过 Gateway 密钥 `TENCENT_SURVEY_TOKEN`（或 `setup.sh` OAuth 设备流）鉴权；与 office 文档/表格核心技能无平行重叠。

## 概述

- **平台**：腾讯问卷 MCP（API 基址默认 `https://wj.qq.com`，见 `scripts/setup.sh` / `setup.sh`）。
- **能力**：`get_survey`、`create_survey`、`update_question`、`update_logic`、`list_answers`；可选 `check_skill_update`。
- **场景码**：调查(1)、考试(3)、测评(6)、投票(8)。
- **与 office cores**：问卷文案版式精修 → `documents`；回答数据深度分析/制表 → `data-analysis-core` / `spreadsheets`；本技能只做腾讯问卷平台 API。

## 前置

1. **密钥**：优先 Gateway 注入 `TENCENT_SURVEY_TOKEN`（前缀 `wjpt_`，约 70 字符，绑定单一团队）。勿在聊天粘贴完整 Token。详见 `scripts/README.md`、`references/auth.md`。
2. **会话首次调用前鉴权**（`${SKILL_DIR}` = 本技能目录）：
   - 有 Token：`TENCENT_SURVEY_TOKEN=xxx bash "${SKILL_DIR}/setup.sh" wj_check_and_start_auth` → 期望 `READY`
   - 无 Token：同命令；若 `AUTH_REQUIRED:<url>` 展示链接后执行 `bash "${SKILL_DIR}/setup.sh" wj_wait_auth`
3. 调用优先级：MCP 原生工具 → 否则 `mcporter call tencent-survey.<tool> --args '{...}'`；Schema 冲突以 `mcporter list tencent-survey` 为准。
4. URL：`https://wj.qq.com/s2/{survey_id}/{hash}` → 路径第二段为 `survey_id`。

## 流程

1. **鉴权**（见前置）；同会话成功后不重复，除非 `invalid_token` / `token expired` / `missing_token`。
2. **查看**：`get_survey(survey_id=...)` → 解析 `pages → questions → options`；展示前清理 title 中 HTML。
3. **创建**：判定 scene → 按 DSL 组织 `text`（必填）→ `create_survey` → 拼投放链 `wj.qq.com/s2/{survey_id}/{hash}`。语法见 `references/create_survey.md`。
4. **改题**：先 `get_survey` 取真实 `question_id`（禁止自造）→ DSL 只写该题 → `update_question`。
5. **逻辑**：取 `survey_dsl.code` 与题/选项 ID → 编写 DSL（ID 用反引号）→ `update_logic`（**整体覆盖**，追加须先读旧 code）。见 `references/update_logic.md`。
6. **回答**：`list_answers`；若 `list.length == per_page` 用 `last_answer_id` 游标翻页直到不足一页。
7. **版本（可选）**：每日可 `check_skill_update`；有更新遵循返回 `instruction` 或提示用户。
8. **写操作**：`create_survey` 非幂等（每次新建）；`update_question` 覆盖原题。

## 输出

- 问卷结构摘要：标题、scene、题目列表、投放链接。
- 逻辑更新：确认 `survey_dsl` 已生效（可再 `get_survey`）。
- 回答：`total` + 明细或汇总；大数据量建议落工作区再交 `spreadsheets` / `data-analysis-core`。
- 错误：对照下表与 `references/auth.md`；付费能力无权限引导 https://wj.qq.com/pricing 。

| 错误码                                              | 处理                      |
| --------------------------------------------------- | ------------------------- |
| `missing_token` / `invalid token` / `token expired` | 重跑 setup / 重新授权     |
| `invalid_token_prefix`                              | 确认 `wjpt_` 前缀         |
| `claim_error`                                       | 问卷不属于当前 Token 团队 |
| `invalid_text_format`                               | 检查 DSL                  |
| `survey_not_editable`                               | 可能需先暂停回收          |
| `paid_function_trial_no_permission`                 | 引导升级                  |

## 边界

- **做**：腾讯问卷 MCP 查询/创建/改题/逻辑/回答列表。
- **不做**：通用纸质/DOCX 问卷排版主交付（→ `documents`）；跨平台表单（金数据/问卷星等）；把回答当深度 BI（分析主路径 → `data-analysis-core`）；伪造 `survey_id` / `question_id`。
- **警告**：勿依赖 Workbuddy 打包元数据；勿把第三方 CDN 图标当必需；勿发明未文档化端点（以上游 `setup.sh` / references 为准）。

## 触发样例

- 「用腾讯问卷做一个员工满意度调查」
- 「这个 wj.qq.com 链接里的问卷帮我看看题目」
- 「第 3 题改成多选，并加跳题逻辑」
- 「看看投票收了多少份回答」
- 「做个考试卷 scene=3」

## 参考

- `references/auth.md` — 鉴权与 Token
- `references/get_survey.md` / `create_survey.md` / `update_question.md` / `update_logic.md` / `list_answers.md`
- `scripts/README.md` — Gateway 密钥与 setup 用法
- `setup.sh`（技能根）— 与 `scripts/setup.sh` 同内容，兼容 `${SKILL_DIR}/setup.sh`
- `LICENSE` — MIT (Copyright Tencent)
- `ATTRIBUTION.md`
