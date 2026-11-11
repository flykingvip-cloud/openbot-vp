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

| 项                                 | 隔离剖面取值 | 含义                                                                   |
| ---------------------------------- | ------------ | ---------------------------------------------------------------------- |
| 传输尝试次数 `maxTransportRetries` | `3`          | 最多 3 次尝试，含首次，即最多 2 次重试                                 |
| 等待序列 `transportBackoffMs`      | `[200, 400]` | 在失败之后、下一次尝试之前等待；长度必须等于 `maxTransportRetries - 1` |

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

| 字段                   | 规则                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `exec-api-version`     | 必须为 `1`                                                                             |
| `tenantId`             | 必填，且与租约租户范围一致                                                             |
| `taskId`               | 必填                                                                                   |
| `expectedStateVersion` | 必填，正整数；必须等于当前任务的 `stateVersion`                                        |
| `reconcileRequestId`   | 必填；字符集与幂等键相同：`[A-Za-z0-9._:-]`，长度 16–128；在租户内唯一标识一次对账请求 |
| `conclusion`           | `succeeded` \| `failed` \| `cancelled` \| `remain_unconfirmed`                         |
| `reason`               | 必填，1–512 个字符                                                                     |
| `evidenceRef`          | 必填，见第 3.5 节                                                                      |

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

## 5. 补件：A→B 持久对账同步、版本归属与诊断探针（隔离剖面）

- 日期：2026-11-11
- 本节省为对第 3 节的补充，不改写已签收的隔离端口、超时或租约数值。
- 隔离剖面仍为：bind `127.0.0.1`，端口 `18790`，connect 3000 / request 5000 / execution 60000 ms；传输最多 3 次尝试，等待 `[200, 400]`；这些数值不自动成为生产配置。

### 5.1 持久待同步记录与原子提交

A′ 在本地提交对账结论时，必须把结论（任务新状态、审计、对账索引）和一条待同步记录写在**同一次** `persist` / 同一存储事务中。若落盘失败，两者都不出现，任务保持提交前状态。

待同步记录持久化在 A′ 存储中。A′ 重启后必须从存储恢复，而不是只依赖内存队列。隔离测试与服务启动路径调用明确的调度钩子 `resumePendingReconcileSyncs()`（`loadAndReconcile()` 会先执行它）。每一次调用最多进行一轮传输突发：最多 3 次尝试，失败后等待 200ms 再 400ms。

### 5.2 同步状态（操作人可见）

`result_unconfirmed` 在尚未提交对账结论前仍然准确，且不是成功。提交结论之后，操作人必须能区分「结论已提交」与「B 已确认同步」：

| 同步状态 `reconcileSyncState`       | 含义                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| （无；`conclusionCommitted=false`） | 尚未在 A′ 提交对账结论，任务若仍为 `result_unconfirmed` 则保持该状态 |
| `pending_sync`                      | A′ 已提交结论（`conclusionCommitted=true`），B′ 尚未确认 apply       |
| `synced`                            | B′ 已确认同步（`bSyncConfirmed=true`）                               |
| `sync_conflict`                     | 永久冲突，进入人工处理（`needsHuman=true`），不再自动重试            |

上述字段出现在 A′ 的任务查询响应与对账响应中。`结论已提交` ≠ `B 已确认同步`。

任务状态与同步状态独立：例如 A′ 已把任务写成 `succeeded` 且 `reconcileSyncState=pending_sync`。

### 5.3 重试、冲突与同步期间的禁令

- 断链或暂时不可达：按现有传输重试策略重试 A′→B′ 的 `POST /v1/tasks/reconcile-apply`。该调用是幂等的，因此允许使用与 `status` / `cancel` / `artifact` 相同的 3 次尝试与 `[200, 400]` 等待。`submit` 仍不得自动重试。
- 一轮突发用尽后，记录保持 `pending_sync`，允许随后在重启或 `resumePendingReconcileSyncs()` 中再试。持续运行期间的自动恢复以第 5.7 节为准：连通恢复后不得再依赖进程重启或人工调用该钩子才能处理 `pending_sync`。
- 永久冲突（版本/前置条件/身份冲突，重试也不会成功，包括 `EXEC_CONFLICT`、`EXEC_CHECKSUM_MISMATCH`、`EXEC_UNAUTHORIZED`、`EXEC_REVOKED`、`EXEC_VERSION_UNSUPPORTED`）进入 `sync_conflict`，不得无限重试。
- 未完成同步前（以及已提交关闭性结论后）：不得重新执行原任务；拒绝与已提交结论冲突的对账或状态变更。`remain_unconfirmed` 不是关闭性结论，随后仍可用**新的** `reconcileRequestId` 提交关闭性结论。

### 5.4 B′ 幂等与版本归属

B′ 端幂等身份为 `reconcileRequestId` **加上**结论摘要 `conclusionDigest`（`taskId` + `conclusion` + 证据关键字段的稳定 SHA-256）。同一请求 ident 且同一摘要则幂等返回，不得二次执行或重复产生副作用。同一 `reconcileRequestId` 但摘要冲突则 `EXEC_CONFLICT`。

**版本归属：** A′ 的 `stateVersion` 与 B′ 的 `stateVersion` 各自独立递增，**禁止互相比较**，也不得用一方的版本对另一方做 CAS。对账请求中的 `expectedStateVersion` 只表示操作人请求在 **A′** 上的条件更新身份；A′ 把它原样放入 apply 载荷仅作请求身份，B′ 不得把它与 `B.stateVersion` 比较。B′ 按**本地**前置条件与对账身份拒绝过期、冲突或越序更新：本地须为 `result_unconfirmed`（或已是相同终态则幂等）；若本地已应用另一关闭性对账，则拒绝新的冲突/越序 apply。

成功确认仍不得绕过成果完整性。确认取消仍不得只依据「取消请求已发送」。`remain_unconfirmed` 保持未确认并记入审计。对账不得重新执行原任务，测试除通过文档化的崩溃/半写辅助函数注入撕毁文件外，不得直接改存储文件。

### 5.5 单写入者锁的文件系统范围

`store.lock.sock` 单写入者栅栏只在本地 POSIX 文件系统上验证（隔离测试会记录 `df -T` / `findmnt`）。**未在 NFS、SMB 或其他共享/网络文件系统上验证，在完成验证前不得用于这类文件系统。** 残留套接字仅在探测确认持有者已不存在时才可回收；不得删除仍存活实例的锁。写入中断后的恢复不得只覆盖「正常 `close()` 后再打开」。

### 5.6 incrementProbe（仅诊断）

`incrementProbe` / 存储中的 `probes` 计数只用于隔离剖面的合成副作用诊断（证明断线不重放）。它**不参与**任务状态、配额或成功/失败判定。那些判定只使用任务状态、`sideEffectApplied` 和成果校验。探针持久化失败或延迟不得单独把任务标为成功或失败，也不得单独消耗配额。

### 5.7 隔离剖面持续同步恢复调度器（本轮补件）

- 日期：2026-11-11
- 本节是对第 5.1 / 5.3 节「重启或人工调用 `resumePendingReconcileSyncs()`」路径的补充，**不改写**已签收的隔离 bind、端口、超时、租约，以及每轮传输突发「最多 3 次尝试、等待 200ms 再 400ms」的数值。这些数值仍不自动成为生产配置。本节也**不是**生产 mTLS 或运维冻结。

**所有权与生命周期**

A′ 控制面持有一个有界、可停止的后台调度器 `ReconcileSyncScheduler`。`AControlServer.start()` 在 `loadAndReconcile()`（其中仍会先执行一轮 `resumePendingReconcileSyncs()`，以便重启后立即从持久记录恢复）之后启动该调度器；`AControlServer.stop()` 在关闭监听与存储前先 `stop()` 调度器。`stop()` 后不再发起新的后台突发，并等待已开始的突发结束。

**连通恢复后的自动重试**

一轮传输突发用尽且记录仍为 `pending_sync` 时，调度器按下面的突发间隔退避安排下一轮，**无需进程重启，也无需人工或测试代码再次调用 `resumePendingReconcileSyncs()`**。`resumePendingReconcileSyncs()` 保留为：启动/重启钩子，以及操作人强制立即再试一轮的入口。永久冲突不走该入口的自动重试。

**突发间隔、最长恢复时间与告警**

| 项                           | 隔离剖面取值                                                                                                                  | 说明                                                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 突发间隔退避                 | `1000, 2000, 4000, 8000, 15000` ms，其后封顶 `15000` ms                                                                       | 按该记录已完成的突发次数取下一档；与每轮内部的 `200, 400` ms 传输等待相互独立                                                                                                                                           |
| 调度轮询 / 唤醒上界          | `250` ms                                                                                                                      | 到期后至多再等一个 tick；任一突发成功视为通路可能已恢复，立即唤醒其他到期记录                                                                                                                                           |
| 最长恢复时间（SLO / 告警界） | 自 `committedAtMs` 起 `300000` ms（5 分钟）                                                                                   | 超时后发出 `recovery_window_exceeded` 告警；记录保持 `pending_sync`，**不**因此改为 `sync_conflict`。在进程仍运行且调度器未 stop 的前提下，封顶退避的自动重试继续进行，以便较晚恢复的通路仍能无需重启或人工钩子完成同步 |
| 告警阈值                     | `pending_sync` 超过 `60000` ms 发 `pending_sync_stale`；剩余窗口 ≤ `30000` ms 且尚未耗尽发 `recovery_window_nearly_exhausted` | 告警本身不发起重试，也不处理或清除永久冲突                                                                                                                                                                              |
| 并发与速率                   | 同一记录同一时刻只允许一轮突发；后台最多 `2` 路并发 `reconcile-apply` 突发，其余到期记录排队                                  | 操作人调用的对账提交或 `resumePendingReconcileSyncs()` 不受该全局并发上限限制，但仍与后台突发共用「同一记录不重叠」锁                                                                                                   |
| 永久冲突                     | `sync_conflict` / `needsHuman` 不得自动重试，也不得因告警被重试                                                               | 人工入口：`listHumanReconcileConflicts()` 列出待处理记录；调度器不得自动清除这些字段                                                                                                                                    |

连通恢复后，完成同步的延迟上界为：当前可能尚未结束的一轮传输突发（最多 3 次尝试，含连接/请求超时及 `200, 400` ms 等待）再加上至多 `15000` ms 的突发间隔与一个 `250` ms tick。
