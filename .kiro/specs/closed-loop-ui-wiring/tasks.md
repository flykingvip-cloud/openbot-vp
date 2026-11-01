# Tasks：结果否定按钮与诊断对照

## Agents

- cursor-closed-loop-490b · role: owner · scope: subject-scoped reject button and enterprise diagnosis rows · paths: src/gateway/method-scopes.ts, src/gateway/server-methods.ts, src/gateway/server-methods/task-outcome-reject.ts, src/gateway/server-methods/task-outcome-reject.pack.ts, src/gateway/server-methods/packs/manifest.ts, src/diagnosis/task-outcome-evidence.ts, src/task-outcome/closed-loop-ui-wiring.test.ts, ui/src/ui/views/chat.ts, ui/src/ui/app-render.ts, ui/src/ui/chat/task-outcome-reject.ts, ui/src/ui/ports/diagnosis/diagnosis-panel.ts, ui/src/ui/ports/enterprise/diagnosis/enterprise-diagnosis-surface.ts, ui/src/ui/ports/enterprise/diagnosis/diagnosis-task-outcome-rows.ts · since: 2026-11-01

## Tasks

- [x] 1. `task.outcome.rejectResult` 移出 `operator.write`，`operator.admin` 不再放行。只有带 platformUserId 的连接进入 handler，subject 与企业租户仍要匹配。 — cursor-closed-loop-490b
- [x] 2. 聊天任务卡仅在服务端带齐 taskId、agentId、outcomeVersion 时显示「结果不符合要求」。 — cursor-closed-loop-490b
- [x] 3. 企业诊断详情显示关联任务、版本、处理和复验。没有记录时写「尚未处理」和「未复验」。 — cursor-closed-loop-490b
- [ ] 4. 自动处理、原场景复验、大白通知。不在本期。 — cursor-closed-loop-490b
