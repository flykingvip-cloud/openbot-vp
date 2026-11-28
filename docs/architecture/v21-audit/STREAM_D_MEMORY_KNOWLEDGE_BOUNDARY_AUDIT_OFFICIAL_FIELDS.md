# Stream D：Memory & Knowledge Boundary（官方第 7 节 10 字段）

- 日期：2026-11-27，时区 Asia/Shanghai (CST, UTC+8)
- 性质：官方 10 字段审计，不是 Wave-V21-0 正式验收，也不是 v2.1 基线签认。
- 外加项：核查 `packages/cogniweave-sdk` `/v1/*` **14 组路由**的租户隔离与撤权失效缺口；交付《OpenBot 本地知识模块向 SDK 委派收口清单》，与既有 Space Pre-v7 B2-2 **124** 项实审完全对齐（`knowledge.ts` 77 + `knowledge-governance.ts` 7 + `vault-sync.ts` 40；官方 8 动作：`read / upload / update / delete / manage_members / manage_permissions / archive / transfer_ownership`）。计数复用已接受矩阵与 P0/P1 补充包，**不发明新计数**。
- 124 矩阵原文：`/workspace/kb-sdk-align/gate3-b22-handover/B2_2_124_TRANSITIVE_REVIEW_MATRIX.md`（已接受 SHA-256 `1a12baa08c05a5913177a95492f3614261b70f09f79faf660b09607ed594a08c`，基线 94/30/0）。补充计数见 `gate3-p0-closeout/PARTIALS_STATUS_AND_UPDATED_COUNTS.md`（111 / 13 / 0）。Exit Gate 3/4 仍为 NOT_MET。

官方 10 项字段（原文）同 Stream A。

## CogniWeave `/v1/*` 14 组路由

路由集中在 `packages/cogniweave-sdk/src/rest/node-server.ts` 的 `routeEnvelope`（Python 客户端 `packages/cogniweave-sdk/python/cogniweave_sdk/client.py` 对应同一组路径）。14 组为：

| # | 方法与路径 | 服务入口（`service.ts`） | 1. 文件路径与代码入口 | 6. 租户隔离 / 撤权观察 |
|---|---|---|---|---|
| 1 | POST `/v1/tasks/frame` | `handleFrameTask` | `node-server.ts:99` | 主要用请求体 `request.scope`，路由层不强制租户头 |
| 2 | POST `/v1/reason` | `handleReason` | `:102` | 同上 |
| 3 | POST `/v1/reason/debug` | `handleReasonDebug` | `:105` | 同上 |
| 4 | POST `/v1/ingest` | `handleIngest` | `:108` | 见 service；非统一租户强制 |
| 5 | POST `/v1/distill` | `handleDistill` | `:111` | 见 service |
| 6 | POST `/v1/write-back` | `handleWriteBack` | `:114` | 见 service |
| 7 | GET `/v1/atoms/:id/trace` | `handleTraceAtom` | pathname 匹配段 | 使用可选 `parseScopeFromHeaders` |
| 8 | GET `/v1/atoms/:id/evidence-refs` | `handleGetEvidenceRefs` | 同上 | 可选 scope 头 |
| 9 | GET `/v1/packages/:id/trace` | `handleTracePackage` | 同上 | 可选 scope 头 |
| 10 | GET `/v1/reasoning-sessions/:id/trace` | `handleTraceReasoningSession` | 同上 | 可选 scope 头 |
| 11 | POST `/v1/evidence/resolve` | `handleResolveEvidence` | `:138` | `request.scope ?? parseScopeFromHeaders`，均可缺省 |
| 12 | POST `/v1/repair/indexes` | `handleRepairIndexes` | `:141` | **未见**强制 scope/租户参数 |
| 13 | POST `/v1/rebuild/from-truth` | `handleRebuildFromTruth` | `:144` | **未见**强制 scope/租户参数 |
| 14 | GET `/v1/journals/:id` | `handleGetWriteJournal` | journal 匹配段 | 可选 scope 头 |

`parseScopeFromHeaders`（`service.ts:58-75`）只识别 `x-cogniweave-workspace-id` / `project-id` / `agent-id` / `visibility`；**全缺则返回 `undefined`，并不失败关闭**。没有 `tenant_id` 头，也 **没有** `/v1/revoke`、`invalidate`、`purge` 或与 `RevocationPurgeReceipt` 四通道对等的撤权路由。这与此前交接所述「Live CogniWeave `/v1` 撤权接线未实现」一致，本轮由实码再次确认。

| 字段 | 本专项落点 |
|---|---|
| 1. 文件路径与代码入口 | `packages/cogniweave-sdk/src/rest/node-server.ts`、`service.ts`、Python `client.py` |
| 2. 核心对象与数据表/存储文件 | CogniWeave engine 记忆原子/包/期刊（REST 服务背后）；非 OpenBot Semantic Object 写主 |
| 3. API / RPC / Event 契约 | 上表 14 组 `/v1/*`；scope 头可选 |
| 4. 当前权威写主 | Agent 记忆写主在 CogniWeave；企业知识写主不在此包 |
| 5. 已实现且稳定功能 | 14 组 REST 路由与客户端已存在，并有 `node-server.test.ts` / `service.test.ts`（本轮未重跑） |
| 6. 仅有接口/原型/默认关闭/Fail-Closed 功能 | 租户强制隔离不足；撤权/失效路由缺失；repair/rebuild 未见强制 scope |
| 7. 已完成的测试证据 | 树内 REST 单测存在；本轮未重跑，不写通过数 |
| 8. 未覆盖的测试场景 | 跨租户读取失败关闭、四通道撤权回执、缺 scope 头时的强制拒绝 |
| 9. 与另一仓库的重复点 | 不得让 CogniWeave 承担企业知识库写主；不得与 Knowledge SDK Resource Registry 双写记忆 |
| 10. 保留/扩展/迁移/废弃裁定 | **保留** CogniWeave 为 Agent 记忆；扩展撤权契约前保持不接入生产知识桥；记忆注册/撤权属后续 Stream D 接线，本波次不改生产路径 |

## OpenBot 本地知识模块

详见同包 `OPENBOT_LOCAL_KNOWLEDGE_DELEGATION_TO_SDK.md`。分类原则：保留 UI shell + 向 SDK 委派；过渡期禁止双写；规划退役。124 项计数不在本文件重算。
