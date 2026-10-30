# OpenBot default capability P0

第一批：八类能力矩阵、上下文开关与运行时一致、builtin 记忆剩余闭环。不合并，不部署。

## Agents

- cursor-grok-default-capability · role: owner · scope: P0 context flags/engine and builtin memory continuity gaps · paths: src/conversations/flags.ts, src/conversations/flags.test.ts, src/context-engine/legacy.ts, src/context-engine/types.ts, src/context-engine/registry.ts, src/context-engine/legacy.default-capability.test.ts, src/memory/collaboration-index-scope.ts, src/memory/collaboration-index-scope.test.ts, src/memory/manager.ts, src/memory/manager-sync-ops.ts, src/memory/search-manager.ts, src/memory/manager.collab-continuity.test.ts, src/memory/search-manager.managed-tool-profile.test.ts, docs/design/evidence/openbot-default-capability-matrix-2026-10-30.md, .kiro/specs/openbot-default-capability-p0/\*\* · since: 2026-10-30

## Takeover note

`openbot-conversation-lifecycle:codex-conversation-lifecycle` 仍为 active，`lastSignalAt` 为 2026-07-16。工作区在基线上是干净的，没有该任务的未提交 WIP。本任务只登记上面的精确路径，不接收 `src/conversations/**`、`package.json`、`.github/workflows/ci.yml` 或 UI。

`conversation-lifecycle-memory-search-dataplane` 对 `src/memory/search-manager.ts` 的 lander 信号停在 2026-08-25，同样没有脏 WIP。本 PR 只增加 managed continuity profile 的 fail-closed，以及把 caller 身份传给 builtin manager。

## Checklist

- [x] 能力矩阵写入 `docs/design/evidence/openbot-default-capability-matrix-2026-10-30.md` — cursor-grok-default-capability
- [x] P0-A：无 env + 默认配置产生 budgetTrace；显式开关；env 覆盖 config；afterTurn 投影被下一轮消费并在新引擎实例中仍在 — cursor-grok-default-capability
- [x] P0-B：小组文件 add/modify/delete 不强制 sync；跨租户同名组隔离；撤权后旧 manager 无 snippet；FTS-only 降级报告；managed 工具路径 fail-closed — cursor-grok-default-capability
- [ ] P1-C 至 P2-H：本批不做

## 验收回退修复（A/B）

- [x] A: toolCall/toolResult 单元裁剪 + assemble 后 sanitize（context-assemble / legacy / attempt）
- [x] B: INDEX_CACHE_PENDING epoch 撤权，过期 pending 不发布
- 状态：部分验证；交新 SHA 由验收方复验，不自行宣告 P0 通过

## 第二轮回退

- [x] 过期 pending orphan 跟踪 + closeAll 释放 SQLite
- [x] runEmbeddedAttempt 真实边界配对测试
- check/build 证据随本轮提交
