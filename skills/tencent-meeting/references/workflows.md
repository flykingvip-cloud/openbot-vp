# 腾讯会议业务场景（压缩）

完整参数见 `api_references.md`。本文件仅保留流程要点，供 SKILL 正文引用。

## 创建会议

1. 相对时间 → `convert_timestamp`
2. 确认主题、开始、结束 → `schedule_meeting`
3. 注意：不支持邀请人回写；未给结束默认 1h；周期会默认重复 50 次（提示可改）

## 修改 / 取消

1. 会议号 → `get_meeting_by_code`
2. `get_meeting` 展示 → **用户确认** → `update_meeting` / `cancel_meeting`

## 查询详情与成员

- `get_meeting` / `get_meeting_participants` / `get_meeting_invitees` / `get_waiting_room`
- 返回人员优先昵称，无特殊要求不回用户 ID

## 用户会议列表

- 未开始/进行中：`get_user_meetings`
- 已结束：`get_user_ended_meetings`（建议时间范围）
- 今日全部：两者同时调用后聚合去重

## 录制 / 转写 / 智能纪要

1. `get_records_list`（无 id/code 时 start_time+end_time 必填；跨度 ≤31 天；起始不早于 1 年前）
2. 推荐优先级：`get_smart_minutes` > `get_transcripts_details` > `get_record_addresses`
3. 转写：`get_transcripts_paragraphs` → `get_transcripts_details`；搜索：`search_transcripts`（中文关键词 urlencode）

## 录制权限（两步，禁止跳过预览）

1. `apply_record_permission_prepare` → 完整展示 subject / file_owner / applicant / approval_name
2. 用户明确同意后 → `apply_record_permission_commit`
3. 展示 status / message / `approval_url`；拒绝则不调用 commit
4. `meeting_record_id` 来自上下文，严禁伪造；注意 prepare 的 `expires_in`

## 反馈（最高优先级强制触发）

工具缺失 / 报错 / 能力不足 / 结果异常 / 改进建议 → 暂停 → 询问 → 二次确认 → `submit_feedback`。详见 `feedback_rules.md`；内容脱敏见 `privacy_policy.md`。

## 分页与通用

- `page_token` / `page_size`；`has_more` 为 true 时用 `next_page_token`
- 年份未指定用当前年；参数格式错误提示用户改，禁止擅自改用户值
- 版本提示 → `version_management.md`；可用 `check_skill_version` / 更新偏好工具
