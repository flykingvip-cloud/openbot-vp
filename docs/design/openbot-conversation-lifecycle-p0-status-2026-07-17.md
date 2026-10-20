# Conversation Lifecycle 实施状态（P0 + P1 核心）

Date: 2026-07-17  
Plan: [openbot-conversation-lifecycle-implementation-plan-2026-07-16.md](./openbot-conversation-lifecycle-implementation-plan-2026-07-16.md)  
Branch: `release/candidate-20260712` (openbot-rc)

## 结论

方案可实施，且与现有 Session/JSONL/CW2 边界一致。  
已落地 **P0 域库 + Purge FSM + Gateway `conversations.*` 注册** + **LegacyContextEngine budget/projection 钩子** + **SDK `resolveSourceLifecycleSelector`**。  
仍待：`chat.history`/`sessions.list` 投影接线、`chat.restore` deny watermark、CogniWeave 四生命周期 API、员工端面板 mount（CL-P1-03）、retention cron / CI job。

## P0 已交付

| ID       | 内容                                                                               | 路径                                                                       |
| -------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| CL-P0-01 | ConversationRecord / Binding / ID / lazy mapping                                   | `src/conversations/types.ts`, `ids.ts`, `lazy-mapping.ts`, `validation.ts` |
| CL-P0-02 | Catalog repository + SQLite（Data Root `.meta/conversations`）                     | `src/conversations/catalog/*`                                              |
| CL-P0-03 | TenantContext fail-closed、ACL、Retention 默认策略                                 | `tenant-context.ts`, `acl.ts`, `retention.ts`                              |
| CL-P0-04 | MemorySourceIdentity + SDK `resolveSourceLifecycleSelector`（四生命周期 API 仍待） | `ids.ts` + `packages/cogniweave-sdk`                                       |
| CL-P0-05 | Purge FSM                                                                          | `src/conversations/purge/fsm.ts`                                           |
| CL-P0-06 | Deny watermark / revoke outbox 库代码（runtime 接线仍待）                          | `memory-recall-deny.ts` + `src/memory/recall-deny-filter.ts`               |

## P1 已交付 / 部分交付

| ID       | 内容                                                | 路径                                                                    | 状态                     |
| -------- | --------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------ |
| CL-P1-01 | Gateway handlers + 注册 / scopes                    | `server-methods/conversations.ts` + `server-methods.ts` / list / scopes | ✅ 已注册                |
| CL-P1-01 | 原子 archive/restore（checksum 校验后才改 Catalog） | `src/conversations/archive-ops.ts`                                      | ✅                       |
| CL-P1-01 | `sessions.list` Conversation 投影（lazy backfill）  | `server-methods/sessions.ts`                                            | ⏳ 未接线                |
| CL-P1-02 | `chat.history` cursor 库                            | `history-cursor.ts`                                                     | ✅ 库；⏳ 未接 `chat.ts` |
| CL-P1-03 | 员工端控制器 / 面板 / wire                          | `ui/.../conversations*`                                                 | ✅ 未 mount              |

### RPC 一览

| Method                                                    | Scope          |
| --------------------------------------------------------- | -------------- |
| conversations.list / get                                  | operator.read  |
| conversations.create / rename / close / archive / restore | operator.write |

### 行为要点

- 同一机器人可 `create` 两个独立 conversation（独立 sessionKey + sessionId + transcript）。
- Archive：先复制并 checksum，失败则 Catalog 不变；不调用 `sessions.delete`。
- Restore：复用原 conversationId / bindingId / sessionId。
- 用户 `rename` → `titleSource=USER`（后续 AUTO 不得覆盖）。
- History cursor 不编码文件路径；`conversationId`+`sessionKey` 同时出现时校验 binding 一致。

## 测试

```bash
OPENBOT_TEST_PROFILE=low pnpm test src/conversations src/context-engine/legacy.budget.test.ts
# domain + legacy budget/projection + v12 gaps
```

## P1-03 / CogniWeave 联动（本轮）

| 项                | 路径                                     | 状态                         |
| ----------------- | ---------------------------------------- | ---------------------------- |
| 员工端对话面板    | `ui/.../workbench-conversation-panel.ts` | ✅ 组件；⏳ 未挂 stage shell |
| Controller        | `ui/src/ui/controllers/conversations.ts` | ✅                           |
| Wire              | `conversation-lifecycle-wire.ts`         | ✅ 未接 render-model         |
| i18n en/zh        | `frontstage.workbench.conversations.*`   | ⏳                           |
| CogniWeave bridge | `cogniweave-bridge.ts`                   | ✅ 库；⏳ manager 四 API     |

## P2 最小交付

| 项                     | 路径                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| Context Budget Planner | `src/conversations/context-budget.ts`                                        |
| Message assemble       | `src/conversations/context-assemble.ts`                                      |
| Runtime 接线           | `LegacyContextEngine.assemble`（`OPENBOT_CONVERSATION_CONTEXT_PLANNER=1`）   |
| Projection rule worker | `projection.ts` + `afterTurn`（`OPENBOT_CONVERSATION_PROJECTION=1`，默认关） |
| Flags                  | env / `flags.ts` rollout                                                     |

## P3 交付

| 项                                    | 路径                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------- | ------- |
| SharedTaskContext schema + 文件 store | `shared-task-context.ts`（Data Root `.meta/conversations/shared-task`）    |
| Execution binding 聚合                | `collaboration-bindings.ts`                                                |
| 注入文本                              | `shared-task-inject.ts`                                                    |
| Gateway                               | `conversations.bindings.attachExecution` / `lineage.get` / `sharedTask.get | update` |

## P4 交付

| 项                  | 路径                                                   |
| ------------------- | ------------------------------------------------------ |
| Search（ACL→rank）  | `search.ts` + `conversations.search`                   |
| Memory admission    | `memory-admission.ts`                                  |
| Retention evaluator | `retention-worker.ts` + `conversations.retention.scan` |
| Export manifest     | `export-ops.ts` + `conversations.export`               |
| Purge 服务路径      | `requestPurgeService` + `conversations.purge`          |

## 测试（P1–P4）

```bash
pnpm exec vitest run src/conversations/ src/context-engine/legacy.budget.test.ts
# 54 passed
```

## 五项收尾 + 三项可选（均已完成）

| 项                             | 实现                                                                      |
| ------------------------------ | ------------------------------------------------------------------------- |
| Shared Task → agent prompt     | `shared-task-runtime.ts` + `attempt.ts`                                   |
| 全文/语义索引                  | `search-index.ts` + FTS5                                                  |
| Cold 物理迁移                  | `cold-migrate.ts`                                                         |
| Purge 真删除                   | `purge/real-adapters.ts`                                                  |
| openbotPath 迁移               | `source-identity-migration.ts`                                            |
| **Projection 持久化 + 默认开** | `projection-store.ts`；flag 默认 on；`LegacyContextEngine.afterTurn` 写盘 |
| **真 embedding 模型**          | `conversation-embeddings.ts` → `createEmbeddingProvider`；失败回退 hash   |
| **Retention 系统 cron**        | `retention-cron.ts`；gateway `server-cron` 注册 job + 拦截 tick           |
| **Enterprise 托管 plane**      | `managed-planes.ts`：按租户 live root 枚举；每 plane 独立 catalog/cold    |

### 配置 / 环境变量

| 变量                                                       | 作用                                          |
| ---------------------------------------------------------- | --------------------------------------------- |
| `OPENBOT_CONVERSATION_PROJECTION=0`                        | 关闭 projection                               |
| `OPENBOT_CONVERSATION_SEMANTIC_SEARCH=1`                   | 开启语义检索                                  |
| `OPENBOT_CONVERSATION_EMBEDDING_PROVIDER`                  | openai / voyage / auto / …                    |
| `OPENBOT_CONVERSATION_EMBEDDING_MODEL`                     | 模型 id                                       |
| `OPENBOT_CONVERSATION_EMBEDDING_HASH=1`                    | 强制 hash fallback                            |
| `OPENBOT_CONVERSATION_RETENTION_ENFORCE=1`                 | 扫描时真正改 tier / 冷迁移                    |
| `OPENBOT_CONVERSATION_RETENTION_EVERY_MS`                  | cron 间隔（默认 6h）                          |
| `OPENBOT_CONVERSATION_RETENTION_CRON=0`                    | 不注册系统 cron job                           |
| `OPENBOT_DATA_MODE=managed`                                | 托管 SaaS 模式                                |
| `OPENBOT_MULTITENANT=1`                                    | 共享网关多租户（枚举 `OPENBOT_TENANTS_ROOT`） |
| `OPENBOT_TENANTS_ROOT`                                     | 租户卷根（默认 `CONFIG_DIR/tenants`）         |
| `OPENBOT_DEFAULT_TENANT_ID`                                | 单租户托管进程默认 tenant                     |
| `OPENBOT_CONVERSATION_RETENTION_TENANT_IDS`                | 逗号分隔 allow-list（可选）                   |
| `OPENBOT_CONVERSATION_ROLLOUT_TENANT_IDS`                  | 租户灰度 allow-list（CSV）                    |
| `OPENBOT_CONVERSATION_ROLLOUT_TENANT_BLOCKLIST`            | 租户黑名单                                    |
| `OPENBOT_CONVERSATION_ROLLOUT_PERCENT`                     | 0–100 哈希分桶 canary                         |
| `OPENBOT_CONVERSATION_ROLLOUT_PRINCIPAL_IDS` / `_SEAT_IDS` | 试点 principal / seat                         |

生产灰度配置与行为说明见 [conversation flags rollout](./openbot-conversation-flags-rollout-2026-07-17.md)。CI：`pnpm test:conversation-lifecycle`。

## 红线遵守情况

- 无 `conversation_message` 双写
- Catalog 唯一副本在 Data Root
- Archive ≠ Forget；Restore 不重新 ingest
- Purge 在 legal hold 下拒绝
