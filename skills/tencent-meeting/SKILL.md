---
name: tencent-meeting
description: >-
  当用户需要通过腾讯会议 API/MCP 预约、创建、修改、取消会议，查询会议号/详情/参会人，
  拉取录制/转写/AI 智能纪要，或申请录制查看权限时务必使用本技能。
  触发：「腾讯会议」「预约会议」「取消腾讯会议」「会议号」「录制下载」「转写」「智能纪要」
  「apply 录制权限」「TENCENT_MEETING_TOKEN」。
  边界：通用议程/纪要/行动项/邮件草稿 → meeting-communication-core；
  不要用于 Zoom/Teams/飞书/钉钉、通用日历/IM、腾讯文档、企微审批、PSTN/电话、视频剪辑。
homepage: https://meeting.tencent.com/
metadata:
  {
    "openclaw":
      {
        "emoji": "📅",
        "requires": { "bins": ["python3"], "env": ["TENCENT_MEETING_TOKEN"] },
        "primaryEnv": "TENCENT_MEETING_TOKEN",
        "category": "tencent",
        "tencentTokenMode": "custom",
        "tokenUrl": "https://mcp.meeting.tencent.com/mcp/wemeet-open/v1",
      },
  }
---

# tencent-meeting（腾讯会议 MCP）

腾讯会议官方 MCP 能力封装：会议生命周期、成员查询、录制/转写/智能纪要、录制权限申请与意见箱反馈。OpenBot 交付依赖平台能力 `tencent-meeting` 的主配置项 `TENCENT_MEETING_TOKEN` + 本目录 `scripts/`；**不是**通用议程/纪要写作技能。

## 概述

- **平台**：腾讯会议 MCP（`config.json` → `https://mcp.meeting.tencent.com/mcp/wemeet-open/v1`）。
- **能力**：创建/改/取消；会议号↔meeting_id；参会人/受邀人/等候室；进行中与已结束列表；录制列表与下载；转写段落/全文/搜索；AI 智能纪要；录制权限两步申请；`submit_feedback`。
- **与 `meeting-communication-core` 分工**：后者写议程/纪要/行动项/邮件草稿（工作区 Markdown）；本技能只做腾讯会议 API/MCP 读写。转写落地后整理纪要可再交给 `meeting-communication-core`。
- 隐私与反馈规则见 `references/privacy_policy.md`、`references/feedback_rules.md`（**不得删除**）。

## 前置

1. **密钥**：在平台能力中打开 `tencent-meeting`，在「主配置项」写入 `TENCENT_MEETING_TOKEN`（用户自 https://meeting.tencent.com/ai-skill 获取）。不要引导用户去「设置 → 密钥 / Secrets」。勿在聊天粘贴完整 Token。详见 `scripts/README.md`。
2. **运行时**：`python3`；入口 `python3 {baseDir}/scripts/tencent_meeting.py`。
3. **时区默认** Asia/Shanghai；相对时间须先 `convert_timestamp`，禁止模型猜「现在」。
4. **会议号**：9 位 code 先 `get_meeting_by_code` 再操作；禁止伪造 `meeting_id` / `meeting_record_id`。
5. **敏感操作**：改会/取消/录制权限 commit / 反馈上报前必须二次确认；反馈内容按隐私规范脱敏。

## 流程

1. **鉴权检查**：确认 `TENCENT_MEETING_TOKEN` 可用；鉴权失败先引导配置，勿编造结果。
2. **时间**：涉及「今天/明天/下午五点」→ `convert_timestamp`；ISO 8601 如 `2026-03-25T15:00:00+08:00`。
3. **创建** → `schedule_meeting`（主题+起止必填；未给结束默认 1h 并提示；不支持邀请人回写）。
4. **修改/取消** → code 转 id → `get_meeting` 展示 → 用户确认 → `update_meeting` / `cancel_meeting`。
5. **查询** → `get_meeting` / `get_meeting_participants` / `get_meeting_invitees` / `get_waiting_room`；列表用 `get_user_meetings` + `get_user_ended_meetings`（今日全量需两者聚合去重）。
6. **录制与转写** → `get_records_list` → 下载 `get_record_addresses` / 转写 `get_transcripts_paragraphs`+`get_transcripts_details` / 搜索 `search_transcripts` / 优先推荐 `get_smart_minutes`。无权限错误 → 场景「录制权限」两步：`apply_record_permission_prepare` 展示预览 → 用户同意 → `apply_record_permission_commit`。
7. **反馈**：工具缺失/报错/能力不足/结果异常/改进建议 → 暂停并询问是否 `submit_feedback`（规则见 references）。
8. **客户端标识**：tools/call 的 arguments 附带 `_client_info`（os/agent/model），勿问用户。
9. **追踪**：返回的 `X-Tc-Trace` / `rpcUuid` 须展示给用户。错误查 `references/error_dictionary.md`。

详细参数与示例：`references/api_references.md`；场景压缩说明：`references/workflows.md`。

## 输出

- 会议：主题、时间、会议号、状态、追踪 ID。
- 列表：按时间排列并标注未开始/进行中/已结束。
- 录制/转写/纪要：列表、下载链接、段落文本或智能纪要摘要；权限申请展示 `approval_url`。
- 工作区可选落盘：`output/tencent-meeting/<meeting_id>/...`；正式 Word/PPT 再转 documents / cyber-ppt。
- **不**自动发日历邀请或 IM（除非用户另有已授权集成）。

## 边界

- **做**：腾讯会议 API/MCP 上述能力。
- **不做**：通用议程/纪要/行动项/邮件（→ `meeting-communication-core`）；Zoom/Teams/飞书/钉钉；通用日程/IM；腾讯文档；企微审批/打卡；PSTN；视频剪辑。
- **警告**：勿依赖第三方 CDN 图标；勿把 Workbuddy/CodeBuddy 打包元数据当运行依赖；勿发明未文档化的端点（以 `config.json` + upstream references 为准）。

## 触发样例

- 「帮我预约明天下午三点的腾讯会议，主题周会」
- 「这个会议号转成 meeting_id 并查参会人」
- 「拉取上周那场会的智能纪要和转写」
- 「录制没权限，帮我申请查看」
- 「取消这场腾讯会议」（须确认后执行）

## 参考

- `references/api_references.md` — 工具调用示例
- `references/workflows.md` — 业务场景压缩版
- `references/error_dictionary.md` — 错误码指引
- `references/privacy_policy.md` — 隐私与脱敏（保留）
- `references/feedback_rules.md` — 意见箱强制触发（保留）
- `references/version_management.md` — 版本检查
- `scripts/README.md` — Gateway 密钥与脚本入口
- `config.json` — MCP baseUrl
- `ATTRIBUTION.md`
