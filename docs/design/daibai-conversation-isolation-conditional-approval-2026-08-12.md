# 大白对话隔离方案 — 有条件批准（peer review 合入）

| 字段                     | 内容                                                                       |
| ------------------------ | -------------------------------------------------------------------------- |
| **状态**                 | **Phase 0 P0 已关闭** — 2026-08-12 终验通过；继续验收维持关闭              |
| **日期**                 | 2026-08-12                                                                 |
| **缺陷确认基线（HEAD）** | `ef71b44058f29b319f89a1c8d1674a6cd31ca004`                                 |
| **工作树说明**           | Phase 0 P0 修复与验收文档已按任务归属落地；本结论仅覆盖大白串话 Phase 0 P0 |
| **读者**                 | 平台架构、安全评审、Gateway、员工壳 UI                                     |

---

## 1. 批准结论（强制措辞）

**服务端无授权广播造成确定的数据外发；旧版 UI owner 折叠进一步造成确定的可见串话。服务端定向授权投递是首要修复，UI 匹配修复仅是纵深防御。**

禁止再写成「两个缺陷叠加才构成问题」。拆分如下：

| #        | 判定                                                                                                                    | 性质                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **P0-A** | Gateway `broadcast("chat")` 将含完整回复正文的事件发给全部 WS 客户端（`chat` 不在 `EVENT_SCOPE_GUARDS`）                | **已确认的数据泄露**（即使 UI 不渲染，B 的浏览器已收到 A 的正文）    |
| **P0-B** | HEAD 上 `normalizeChatSessionKeyForMatch` 将任意 `agent:main:employee:<owner>` 归一为 `agent:main:main`，故 alice ≡ bob | **把已泄露数据转化为用户可见串话**（纵深；不能单独当作访问控制边界） |

---

## 2. 对补充建议的逐项批准

| 建议                                               | 批准     | 执行含义                                                                                                                              |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 服务端全量广播单独即 P0                            | **批准** | Phase 0 首项必须是停止向无权连接发送 chat payload                                                                                     |
| UI 折叠因果在 HEAD 成立；工作树可能已有未提交修补  | **批准** | 审计/PR 必须写明证据基线 SHA；勿与 WIP 混谈「现状」                                                                                   |
| UI 修复不得排在服务端止血之前                      | **批准** | 顺序：服务端授权投递 → UI owner 保留 → 全生产点 + 双连接测试                                                                          |
| 「同 userId + 订阅 sessionKey」尚不可作唯一规范    | **批准** | P0 在**发送瞬间**按已解析 owner / group ACL 计算 conn 集合；订阅仅可作后续流量优化                                                    |
| 单一授权投递 API，禁止业务直接 `broadcast("chat")` | **批准** | 统一入口（现名 `broadcastChat` / 目标名可演进为 `emitChatEventToAuthorizedConnections`）；覆盖 delta/final/error/abort/inject/restore |
| sessions.list：区分当前泄露 vs 架构脆弱            | **批准** | 现有 actor 失败 → 空列表属 fail-closed 兜底；仍属高风险架构债（进程打开越权 store），措辞不得等同「已确认实时外发」                   |
| inbound fail-open：managed 拒写，兼容模式保留      | **批准** | `sharedTenantAddressing=true` 且个人工作台：缺身份/tenant **拒写**；单用户兼容模式行为不变                                            |
| Phase 1 路径收敛遵守原子切换                       | **批准** | inventory → quarantine → verified copy/adoption → write freeze → cutover → read-only compatibility → retirement；禁止「直接搬目录」   |

---

## 3. 批准后的 Phase 0 顺序（执行铁律）

1. **服务端**：停止向无权连接发送 chat payload（按 session owner / group ACL 在发送瞬间计算收件人；身份仅来自可信认证上下文）。
2. **UI**：保留 per-owner 键，禁止跨用户折叠（纵深防御）。
3. **全生产点**：所有 chat 事件经单一授权 API；源码扫描不得出现未经封装的 `broadcast("chat")`。
4. **双连接 / 双账号实测**：见 §4 验收矩阵。

连接身份、多标签、重连、切换会话、后台 run、operator 审计权、`nodeSendToSession` 与浏览器投递分离等，按补充建议纳入投递规范；**订阅表不得成为唯一授权依据**。

---

## 4. P0 验收矩阵（批准采纳）

- [x] B 的 WebSocket 原始帧中不存在 A 的 delta / final / error / abort / inject / restore 正文 — 单测：`chat-event-dual-connection.test.ts`（`broadcastChatEvent` → `broadcastToConnIds` 收件人集合）
- [x] `employee:alice ≢ employee:bob` — UI `chat-session-key-match` + 服务端 steward owner 匹配
- [x] 裸 `main` 仅能展开为 hello 下发的本人 `mainSessionKey` — UI `ownStewardSessionKey` / employee 壳不接收全局 `agent:main:main`
- [x] 同一用户两个连接均能收到本人的事件 — `chat-event-dual-connection.test.ts`
- [x] 不同租户相同 userId 不互通 — steward 要求 owner + 权威 resource/run `tenantId` 与 `sessionEnterpriseId`；负向单测 `does not deliver steward events across tenants for the same userId`（`broadcastToConnIds`）
- [x] 相同 groupId、不同 tenant 不互通 — ACL 键 `(tenantId, groupId)`；`resolveCollaborationGroupTenantId(groupId, tenantId?)` 接受权威 context；无 context 双 ownership → null；负向单测 + `does not deliver group events across tenants for the same groupId`
- [x] 组成员可收，非成员不可收，成员移除后立即失效 — 缓存 ACL 重播种后收件人即时收缩
- [x] `chat.history` / `sessions.list` / usage 不打开调用者可见范围外的 store — history ACL；sessions.list/preview per-user store；`sessions.usage` 可见 store；timeseries/logs 先授权再开路径
- [x] managed 身份解析失败时拒写且不触碰 global store — `resolveSessionStorePathForInboundMessage` personal-workbench 拒写 + `tenant-context.test.ts`
- [x] 扫描源码时，不再出现未经封装的 `broadcast("chat")` — `scripts/check-isolation-fail-closed.mjs`

---

## 5. 与当前工作树的关系

**2026-08-12 13:30 / 13:55 / 14:09 验收均曾不通过；下列 14:09 项已修复并复验。**

**14:09 阻断与修复：**

| 阻断                                                          | 修复                                                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveCollaborationGroupTenantId` 裸 groupId 全局 `.find()` | 接受可选权威 `tenantId`；走 `findActiveOwnershipRecord(tenantId, group)`；无 context 时仅唯一 ownership 可解析，双 tenant 歧义 → `null` |
| 缺双 ownership 负向测试                                       | `space-snapshot-tenant.test.ts`：歧义 null、context 命中、context miss 不 fall-through、snapshot 歧义 null                              |
| `chat.test.ts` `stewardMainSessionKey` / `ChatState`          | 字段并入 `ChatState`；`ChatEventState` 从中 Pick                                                                                        |
| 文档提前宣称 P0 关闭                                          | 已撤回；仅在本轮复验后勾选 §4                                                                                                           |

**继续验收（2026-08-12）：通过，维持 Phase 0 P0 关闭。**

- 隔离矩阵 232/233；唯一失败仍为既有 `humanTakeoverObserved`（与串话隔离无关）
- `pnpm lint:gateway:isolation-fail-closed` 通过；任务路径无 TypeScript 诊断
- 跨用户 / 跨租户 / 双连接 / group tenant 歧义 fail-closed 均通过
- 相关提交已落地（`Task: workspace-isolation-wip` / `Agent: cursor-grok`）；任务路径工作区干净
- `.kiro/specs/workspace-isolation-wip/tasks.md` P0 关闭项与本文状态一致

**帧级联调（2026-08-12）：**

- 自动化收件人矩阵：`node scripts/check-isolation-fail-closed.mjs --daibai-frame` → **24/24 PASS**；证据 `docs/design/evidence/daibai-chat-isolation-frame-20260812.summary.json`
- 真人双浏览器 WS 帧抽检：checklist 见该脚本头；**需两名员工账号**，当前环境仅有本机 operator Control UI，未替代完成

**验收边界（强制）：** 本结论**仅批准「大白串话 Phase 0 P0」**。不得据此宣称全仓测试或全仓类型检查通过，也**不构成生产发布批准**。Phase 1 路径收敛须另开原子切换计划。

---

## 6. 签署

| 角色                  | 立场                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| 方案作者盘点          | 问题成立；初稿顺序与「叠加才构成问题」措辞须按本文修订                       |
| Peer 补充建议         | **采纳为执行基线**                                                           |
| 2026-08-12 13:30 验收 | **不通过**（跨租户 steward / group ACL）— 已修复                             |
| 2026-08-12 13:55 验收 | **不通过**（tenant 字段 / 任务范围 tsgo）— 已修复                            |
| 2026-08-12 14:09 验收 | **不通过**（裸 groupId `.find()` 歧义 + chat.test 类型）— **已修复并复验**   |
| 2026-08-12 终验签署   | **通过 — 批准关闭 Phase 0 P0**（232/233；`humanTakeoverObserved` 无关）      |
| 2026-08-12 继续验收   | **通过 — 维持 Phase 0 P0 关闭**（无新隔离阻断；边界见 §5）                   |
| 本文件                | **有条件通过基线执行完毕 — Phase 0 P0 正式关闭（范围仅限大白串话 Phase 0）** |
