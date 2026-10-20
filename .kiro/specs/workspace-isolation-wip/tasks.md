# Workspace isolation WIP (shared tree)

## Agents

- cursor-grok · role: owner · scope: Phase 0 大白对话串话止血 + Phase 1 路径原子切换（inventory 证据 + A*employee steward cutover 试点） · paths: ui/src/ui/chat-session-key-match.ts, ui/src/ui/chat-session-key-match*.test.ts, ui/src/ui/controllers/chat.ts, ui/src/ui/controllers/chat.test.ts, ui/src/ui/controllers/daibai.ts, ui/src/ui/capability/view-state.ts, src/gateway/chat-event-isolation.ts, src/gateway/chat-event-isolation.test.ts, src/gateway/chat-event-dual-connection.test.ts, src/gateway/chat-session-interest.ts, src/gateway/chat-group-acl-cache.ts, src/gateway/server-chat.ts, src/gateway/server-chat.agent-events.test.ts, src/gateway/server-methods/chat.ts, src/gateway/chat-abort.ts, src/gateway/server.impl.ts, src/gateway/server/ws-types.ts, src/gateway/server-methods/types.ts, src/gateway/server/ws-connection/message-handler.ts, src/gateway/webchat-client-platform-identity.ts, src/gateway/server-methods/sessions.ts, src/gateway/server-methods/sessions.preview-scope.test.ts, src/gateway/server-methods/usage.ts, src/gateway/server-methods/usage.sessions-usage.test.ts, src/gateway/server-methods/chat._.test.ts, src/gateway/tenant-context.ts, src/gateway/tenant-context.test.ts, src/gateway/collaboration-learning/snapshot-types.ts, src/gateway/collaboration-learning/shared.ts, src/gateway/collaboration-learning/space-store.ts, src/gateway/collaboration-learning/space-snapshot-tenant.test.ts, src/gateway/workspace-inventory/**, src/gateway/workspace-cutover/**, src/gateway/workspace-resolver/steward-write.ts, src/gateway/workspace-resolver/steward-write.test.ts, src/gateway/workspace-resolver/builders.ts, src/gateway/workspace-resolver/index.ts, src/agents/builtin-steward/employee-isolation.ts, src/agents/builtin-steward/employee-isolation.test.ts, scripts/check-isolation-fail-closed.mjs, docs/design/evidence/daibai-chat-isolation-frame-_.summary.json, docs/design/evidence/workspace-inventory-phase1-\_.summary.json, docs/design/daibai-conversation-isolation-conditional-approval-2026-08-12.md, docs/design/workspace-path-atomic-cutover-phase1-2026-08-12.md · since: 2026-08-12
- cursor-composer · role: owner · scope: Group/steward workspace file wiring, deliverable save scope, collaboration read-model alignment, isolation audit evidence · paths: .kiro/specs/workspace-isolation-wip/\*\*, docs/design/workspace-directory-isolation-audit-2026-08-10.md, docs/design/evidence/workspace-isolation-20260810-001.summary.json, scripts/audit/workspace-isolation-probe.mjs, src/gateway/server-methods/group-workspace-file.ts, src/gateway/server-methods/spaces.list-scope.test.ts, src/shared/preview-artifact/resolve-preview-artifact.ts, ui/src/ui/wiring/group-workspace-file.ts, ui/src/ui/wiring/group-workspace-file.test.ts, ui/src/ui/wiring/deliverable-save.ts, ui/src/ui/wiring/deliverable-save.test.ts, ui/src/ui/controllers/group-workspace-file.ts, ui/src/ui/controllers/group-workspace-file.test.ts, ui/src/ui/controllers/spaces.ts, ui/src/ui/capability/spaces/facade.ts, ui/src/ui/ports/employee/controllers/workbench-collaboration-read-model.ts, ui/src/ui/ports/employee/controllers/workbench-collaboration-read-model.node.test.ts, ui/src/ui/ports/employee/views/workbench-shell-model.ts, ui/src/ui/ports/employee/views/workbench-stage-collaboration.ts, ui/src/ui/ports/employee/views/workbench-stage-collaboration.node.test.ts · since: 2026-08-12

> **Out of scope (other owners / CONFLICT):** `src/gateway/server-methods/spaces.ts`, `src/gateway/server-methods/usage.ts`, `src/gateway/server-methods/steward-workspace-file.ts`, `.loom/registry.yaml` (register only).

## Tasks

- [x] Fix group-workspace-file tests for blob/iframe preview parity with main — cursor-composer
- [x] A1: Scoped build + test green for cluster A paths — cursor-composer
- [x] A2: Gateway group workspace path normalization tests (fail-closed traversal) — cursor-composer
- [x] C: WeChat official operational execution layer tests — cursor-composer
- [x] G: Gate 0 security profile registered under data-governance-v2-p0 — cursor-data-governance
- [x] Phase 0 大白串话止血：UI 禁止跨用户 employee 键等价；chat 事件按 platformUserId 定向投递；sessions.list 优先 per-user store — cursor-grok
- [x] Peer 补充合入：有条件批准文档 + 强制措辞（服务端外发为首要 / UI 纵深）；abort 去掉裸 broadcast("chat") 回退 — cursor-grok
- [x] P0 矩阵推进：group ACL 缓存投递、interest 注册、裸 broadcast 静态门禁、managed inbound 拒写、双连接收件人单测 — cursor-grok
- [x] P0 矩阵推进：usage timeseries/logs 授权后开路径；sessions.preview 仅开 caller store — cursor-grok
- [x] P0 阻断修复：steward 资源/run tenant 边界 + group ACL `(tenantId,groupId)` + 跨租户负向 `broadcastToConnIds` 单测 — cursor-grok
- [x] P0 关闭：终验通过并批准关闭 Phase 0 P0（tenant 歧义 fail-closed + ChatState 类型 + §4 全勾）— cursor-grok
- [x] 继续验收：维持 Phase 0 P0 关闭；边界仅限大白串话 Phase 0（非全仓/非生产发布）— cursor-grok
- [x] 联调（自动化帧级收件人）：`scripts/check-isolation-fail-closed.mjs --daibai-frame` 24/24 + evidence `docs/design/evidence/daibai-chat-isolation-frame-20260812.summary.json` — cursor-grok
- [ ] 联调（真人双浏览器 WS 帧）：pending — 需两名员工账号各自登录后按 probe 脚本头 checklist 抽检
- [x] Phase 1.0：书面原子切换计划 `docs/design/workspace-path-atomic-cutover-phase1-2026-08-12.md` + 只读 inventory 脱敏证据 — cursor-grok
- [x] Phase 1.0 闸门：quarantine/duplicates/脱敏/SHA + inventory 单测绿 — cursor-grok
- [x] Phase 1.1：仅 A_employee steward 走 cutover 至 `resolver_write_cutover` + 写路径门禁 — cursor-grok
- [x] Phase 1 验收：旧根不可写 + isolation fail-closed / daibai-frame 仍通过 — cursor-grok
