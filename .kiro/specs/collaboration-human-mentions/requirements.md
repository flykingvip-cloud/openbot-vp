# Requirements: Collaboration Human Mentions

## Goal

协作小组对话区支持同时 `@真人` 与 `@机器人`，并完成协议、服务端校验、真人通知与测试闭环。禁止把真人 `userId` 伪装成 `agentId`。

## Acceptance

1. `@` 候选同时包含当前小组活跃真人、活跃机器人与「所有人」。
2. 排除当前发送者、invited/removed/inactive、非本组成员。
3. `@机器人` 保持既有参与行为；`@真人` 不触发机器人代答，并生成持久化 mention 通知。
4. 旧 `{ agentId }` payload 向后兼容；新 payload 使用可判别 `target`。
5. 历史消息正确高亮真人/机器人；removed 成员 muted 显示原名。

## Non-goals

- 不新建平行于机器人 mention journal 的人类 journal 语义。
- 不在 UI 默认展示邮箱等敏感标识。
