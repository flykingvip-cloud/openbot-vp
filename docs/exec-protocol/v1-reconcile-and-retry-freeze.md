# 执行协议 v1 对账入口与重试规则冻结（隔离剖面补件）

- 日期：2026-11-11
- 基准 head：`47c71027ac56efb5d62abe78e3ec14e9539ab67b`
- 适用范围：仅隔离验证剖面 `exec-protocol-v1-isolation`
- 本补件是本阶段编码与验收依据。Owner 尚未对本补件做单独签收；签收须在独立复审与跨机验收之后申请。
- 现有端口、超时和租约数值仅属于隔离验证剖面，不自动成为生产配置。
- 不授权修改生产 A/B/C，不开放裸露的执行接口，不放行宿主变更、生产迁移、回源或生产 ledger。

## 1. 对 head 47c71027 的复审结论（实现约束）

### 1.1 并发重复提交

A′/B′ 提交路径必须按 `tenantId` + 幂等键串行。同一租户、同一幂等键的并发重复提交只允许产生一个任务、一次执行。进程内实现可继续使用 `KeyedLock`，但不得把进程内串行化宣传为跨进程幂等保证。

### 1.2 串行化范围包含租户边界

锁键必须包含租户，例如 `${tenantId}\0${idempotencyKey}`。不同租户使用相同幂等键时不得互相阻塞，也不得共用幂等索引。

### 1.3 持久化写队列失败不得留下错误成功状态

`FileExecStore` 若先改内存再 `persist()`，一旦落盘失败，必须回滚该次内存变更并向调用方抛错。HTTP/API 不得在落盘失败后返回 200/201 成功，也不得让后续查询读到未落盘的成功或终态。

### 1.4 单写入者 / 单进程假设

`KeyedLock` 与 `persistChain` 都是进程内机制，只在「同一存储目录由单个服务进程写入」时有效。必须明确声明：

- 当前隔离实现只支持单进程写入；
- 第二实例在 `load()` 时必须被拒绝，不得同时打开同一存储目录；
- 进程内串行化不是跨进程幂等保证。

排他锁在进程正常退出或崩溃后必须可回收（不得因残留锁文件永久锁死目录）。本隔离实现使用存储目录内的 Unix 域套接字 `store.lock.sock`：绑定成功即持有写入权，进程退出后内核释放；若套接字文件残留但无法连接，允许回收后重新绑定。

## 2. 传输重试规则（取代歧义表述）

原冻结「含首次共 3 次」同时列出 `200/400/800ms` 三次退避，容易被读成还存在第四次尝试。现统一为：

| 项 | 隔离剖面取值 | 含义 |
| --- | --- | --- |
| 传输尝试次数 `maxTransportRetries` | `3` | 最多 3 次尝试，含首次，即最多 2 次重试 |
| 等待序列 `transportBackoffMs` | `[200, 400]` | 在失败之后、下一次尝试之前等待；长度必须等于 `maxTransportRetries - 1` |

尝试时间线：

1. 立即进行第 1 次尝试；
2. 若第 1 次失败且可重试，等待 200ms 后进行第 2 次；
3. 若第 2 次失败且可重试，等待 400ms 后进行第 3 次；
4. 没有第 4 次尝试，因此不存在 800ms 等待。

仅 `status` / `cancel` / `artifact` 可按上述序列重试；`submit` 不得自动重试。环境变量 `OPENBOT_EXEC_PROTOCOL_TRANSPORT_BACKOFF_MS` 在隔离剖面下为 `200,400`。必须有测试直接验证尝试次数与等待序列。这些数值不自动成为生产配置。

## 3. result_unconfirmed 对账入口

普通状态机保持：`result_unconfirmed` 没有自动出边，取消/重提/自动回放不得把它改写成终态。离开该状态只能通过对账入口，且必须满足下列规则。

### 3.1 权威写入与同步

- A′ 是客户端可见对账结论的权威写入者，包括是否离开 `result_unconfirmed`。
- B′ 是执行现场证据的权威写入者（执行日志、成果字节、探针、本地执行态）。
- A′ 在本地原子提交结论后，调用 B′ 的同步入口写入同一结论。B′ 不得重新执行原任务，任何一端都不得通过直接修改存储文件完成对账。
- 若 B′ 不可达：A′ 仅在本地已持有并通过完整性与交付校验的成果副本时，才可以确认 `succeeded`；否则不得确认成功。确认 `cancelled` 必须有 B′ 已进入 `cancelled` 的证据，不能只依据「取消请求已发送」或本地 `cancelRequestedAtMs`。若仍无法确认，结论只能是 `remain_unconfirmed`，状态继续保持 `result_unconfirmed`，禁止强行结案。
- B′ 同步时：若本地仍为 `result_unconfirmed`，应用同一结论（确认成功仍须通过成果完整性校验）；若已是相同终态则幂等返回；若终态冲突则 `EXEC_CONFLICT`，不得覆盖。
- A′ 已提交的终态结论不被随后从 B′ 拉回的状态覆盖。

### 3.2 接口

对外对账只打 A′：

- 方法与路径：`POST /v1/tasks/reconcile`
- 只有获授权的对账角色可以操作：租约 `roles` 必须包含 `"reconcile"`，否则 `EXEC_UNAUTHORIZED`。普通执行租约默认不含该角色。租约 token 格式不变（`exec1_` + 64 位小写十六进制）。

B′ 同步入口仅供 A′ 使用，不作为对外对账角色入口：

- 方法与路径：`POST /v1/tasks/reconcile-apply`
- 使用 A′→B′ 已有的执行租约即可，不要求 `reconcile` 角色，避免对账角色直接操作 B′。仍须通过合法租约校验。

请求字段（A′ 对账与 B′ 同步使用同一核心字段）：

| 字段 | 规则 |
| --- | --- |
| `exec-api-version` | 必须为 `1` |
| `tenantId` | 必填，且与租约租户范围一致 |
| `taskId` | 必填 |
| `expectedStateVersion` | 必填，正整数；必须等于当前任务的 `stateVersion` |
| `reconcileRequestId` | 必填；字符集与幂等键相同：`[A-Za-z0-9._:-]`，长度 16–128；在租户内唯一标识一次对账请求 |
| `conclusion` | `succeeded` \| `failed` \| `cancelled` \| `remain_unconfirmed` |
| `reason` | 必填，1–512 个字符 |
| `evidenceRef` | 必填，见第 3.5 节 |

成功响应 HTTP 200，正文为任务响应，并包含 `stateVersion` 以及对账摘要：`reconcileRequestId`、操作人、时间、原状态、新状态、结论、理由。

### 3.3 状态版本与原子条件更新

每条任务具有 `stateVersion`：创建时为 `1`，每次成功持久化的任务变更递增 1。对账必须使用原子条件更新：仅当存储中的 `stateVersion` 等于 `expectedStateVersion` 时才写入，否则 `EXEC_CONFLICT`，不改变状态。过期或冲突的结论一律拒绝。

### 3.4 对账请求幂等

按 `tenantId` + `reconcileRequestId` 建索引。重复提交同一对账请求（相同 `taskId`、`conclusion`、证据关键字段以及当时使用的 `expectedStateVersion`）必须返回原结论，不得重新执行，不得再写一条互相矛盾的结论。同一 `reconcileRequestId` 但关键字段冲突则 `EXEC_CONFLICT`。

### 3.5 允许的结论与证据

普通 `transitionState` 不得把 `result_unconfirmed` 迁出。对账模块使用单独的转换函数，且只允许：

- 当前状态必须是 `result_unconfirmed`（对其他非终态或终态调用对账结案一律 `EXEC_CONFLICT`）；
- `remain_unconfirmed`：状态保持 `result_unconfirmed`，记录审计，不视为结案；
- `succeeded` / `failed` / `cancelled`：仅在证据满足时进入对应终态。

**确认成功 `succeeded`**

- `evidenceRef.kind` 必须是 `artifact-verified`，并提供 `artifactId`、`sha256`、`byteCount`。
- 不得绕过成果完整性与交付校验。A′ 必须已经持有该成果字节且校验通过，或先从 B′ 拉取、校验通过后再落入 A′ 本地，然后才能写入 `succeeded`。
- 若没有已校验副本，且 B′ 不可达或校验失败：不得确认成功。不可达返回 `EXEC_UNREACHABLE`，校验失败返回 `EXEC_CHECKSUM_MISMATCH`。状态保持 `result_unconfirmed`。

**确认取消 `cancelled`**

- `evidenceRef.kind` 必须是 `b-cancelled-confirmed`。
- 必须证明 B′ 已确认进入 `cancelled`（向 B′ 查询得到 `cancelled`，或 A′ 已持久化且可核对的 B′ 确认记录）。
- 仅有「取消请求已发送」或本地 `cancelRequestedAtMs` 不足，必须拒绝或保持 `result_unconfirmed`，不得写入 `cancelled`。

**确认失败 `failed`**

- `evidenceRef.kind` 必须是 `b-failed-confirmed`。
- 必须证明 B′ 已确认 `failed` 或 `timeout`，且不存在未校验却当作已交付的成功成果。
- 若已发生外部副作用（`sideEffectApplied`）且 B′ 并未确认失败，不得强行结为 `failed`。

**结果仍无法确认 `remain_unconfirmed`**

- `evidenceRef.kind` 可为 `operator-note`。
- 保存操作记录后，状态必须仍为 `result_unconfirmed`。禁止用该结论强行结案。

### 3.6 审计字段

每次对账（含 `remain_unconfirmed` 与幂等重放所依据的首次记录）必须保存：操作人（租约 `subject`）、时间、原状态、新状态、理由、`evidenceRef`、`reconcileRequestId`、变更前后的 `stateVersion`。审计通过协议接口写入存储，禁止直接编辑存储文件。

### 3.7 禁止事项

- 对账不得重新执行原任务：B′ `executionsStarted` 不得增加，不得再次调用执行器。
- 对账不得直接修改存储文件。
- 对账不得把终态改回 `result_unconfirmed`，也不得改写已有终态。

## 4. 本补件落地范围

允许在同一草稿 PR #272 中实现上述冻结。实现完成后须附：对账入口与负向测试、单写入者/跨进程存储约束证据、统一重试序列测试、以及独立复审报告。跨机验收证据在隔离双机资源就绪并另批变更单（如需安装软件或改防火墙）之后提交，本阶段先提交双机环境方案。
