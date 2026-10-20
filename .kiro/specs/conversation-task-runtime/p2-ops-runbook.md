# ConversationTask Runtime — P2 运维手册(runbook)

> Owner(实施): `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 关联: `./p2-ops-review.md`(O1–O4)、`./p2-security-review.md`(S7/§9/§10/§11)、`./p2-admission-package.md`(§4.B)
> 状态: **P2 运维手册。仅覆盖 P2 范围(Activation Gate + tenant-scoped Task store + 影子观测)。不接 Progress Ledger、不产生真实副作用;`authorization`/`projection` 持续 OFF。**
> 代码:`src/conversation-task/{store,activation,flag-cache,acl,shadow,degrade}.ts`。

## 1. Flag 热读与失效(O1)

- 热读经 `ConversationTaskFlagCache`,TTL=3s(硬上限 5s),config 写入后调用 `invalidate(flag?)` 立即生效。
- 任何读取异常(config 损坏 / 权限不足 / 读超时)一律 **fail-safe-off**:flag 读为关闭。
- `activation`/`projection`/`authorization` 在生产持续 OFF;缓存不会自行将其置 ON。

## 2. Activation 冻结与重开(O2 freeze-read-only)

- `activation=off` ⇒ `runActivationGate` 只计算决策、不写任何任务(`mode="shadow_frozen"`);既有 active 任务可读、不推进、不删除、不通知。
- 观测指标「被冻结任务数」= `frozenActiveTaskCount(store, flags)`(off 时 = active 任务数,on 时 = 0)。
- 重开(`activation=on`)后从冻结点继续:对同一 `(tenantId, conversationId, normalizedGoal, activationEpoch)` 重跑 Gate 返回 `already_active`,幂等、不重复创建、不重复通知。

## 3. 自动降级与人工重开(O3)

- 控制器:`ActivationDegradeController`(**强依赖控制面**,构造时缺 `controlPlane` 即抛错,不允许静默降级为仅记录状态)。阈值:Upgrade Precision < 95% 或 over-upgrade > 5% ⇒ 自动降级(`activation=off`);over-upgrade > 2%、重复任务率 > 1% ⇒ 告警;Reminder 误升级 > 0 ⇒ 告警 + 需 RCA。
- 防抖/滞回:降级为单向转移,控制器**不自动回升**;`evaluate()` 永不把状态改回 `active`。
- 人工重开步骤(全部满足才放行):
  1. 人工确认(`confirmedByHuman: true`);否则 `manual_confirm_required`。
  2. 冷却间隔(默认 10 分钟)已过;否则 `cooldown_active`。
  3. 若发生过 Reminder 误升级,先完成 RCA 并置 `rcaResolved: true`;否则 `reminder_rca_required`。
  - 每次转移带 reason code,供审计。渠道:内部控制通道 + 运维值班。

### 3.1 强制关闭状态 = 持久 + 共享控制面(`ActivationControlPlane`)

- **持久 + 共享**:`SqliteActivationControlPlane` 落**持久 SQLite 单行表**(`<root>/conversation-task/control-plane.db`,WAL + `busy_timeout`),**跨进程共享、进程重启后保持**。降级写 `forceOff`,Activation Gate 读**同一控制面**;`runActivationGate` 的控制面参数**必填**,无法省略绕过。
- **控制面缺失/不确定 ⇒ 默认 OFF**:新建库、状态行缺失、schema 异常、读异常一律初始化并视为 **`forced_off=1` reason=`uninitialized_or_recovered`**。**DB 不存在绝不等于 activation 可用**。
- **首次启动不自动开启**:即使环境 `activation` flag 为 ON,未经受控人工重开前 Gate 始终 `shadow_frozen`。首启激活**必须**走人工重开流程。
- **重开必经 Controller**:唯一出路是 `ActivationDegradeController.requestReopen` → `controlPlane.attemptReopen`,由控制面**基于持久状态**重新校验人工确认 + 控制面自持冷却 + Reminder RCA,并记录操作者与时间。**控制面不暴露公开 `clear()`**。
- **时间仅服务端**:`forceOff` / `attemptReopen` 的公共类型**不含任何时间戳字段**;冷却与时间戳一律取控制面自身注入的服务端时钟。调用方**无法通过伪造未来时间缩短或绕过冷却**。
- **重开为版本化原子 CAS**:`attemptReopen` 读取当前 `state_version`,在 `BEGIN IMMEDIATE` 事务内以 `UPDATE ... WHERE id=1 AND state_version=<observed>` 清除,并要求 `changes===1`;若期间有并发 force-off/reopen 改变了版本,则更新为空操作并返回 `state_changed_retry_required`(**无丢失更新**),调用方须重读后重试。
- **禁止运维直接改库/无条件 clear**:严禁运维直接修改 `control-plane.db`(如手工 `UPDATE forced_off=0`)或以任何无条件方式清除;回升只能经受控重开流程,留审计。
- **多实例/多网关**:所有实例**必须指向同一持久控制面存储**(共享卷)以共享同一关闭状态;`InMemoryActivationControlPlane` **仅供测试**,严禁生产使用。
- **控制面卷缺失 = 阻断告警**:若持久卷/路径不可用,控制面读为 fail-safe-off(activation 关闭),且**必须作为阻断级告警**处理并人工介入,不得静默放行。
- **完整持久状态**:`forcedOff`、`reason`、`degradedAtMs`、`rcaPending`、`stateVersion`、最近人工恢复的 `lastReopenActor` / `lastReopenAtMs` 均持久化;重启不丢降级原因/时间/冷却窗口/RCA pending。
- **验收测试**:`control-plane.test.ts`(首启即 OFF、删库/删行仍 OFF、不可读仍 OFF、仅受控重开可恢复、重开记录操作者、双实例共享、无公开 clear、**服务端时间不可伪造绕过冷却**、**版本化 CAS 陈旧版本→state_changed_retry_required**)+ `degrade.test.ts`(重建 Controller 仍 degraded、重启后仍强制门禁、服务端冷却)+ `store-crossproc.test.ts`(子进程 forceOff/reopen 跨进程可见)。

## 4. Shadow 日志:TTL / 删除 / HMAC 轮换(O4)

- 存储:`ShadowLogBook`,按 `tenantId` 作用域,仅落脱敏字段(reason codes / decision version / 结果 / **keyed HMAC 指纹**),**永不落原文或实体**。
- TTL:默认 30 天(`SHADOW_LOG_DEFAULT_TTL_MS`);对更严格合规租户可**按租户下调** `ttlMs`;`pruneExpired(now)` 清理到期记录。
- 存储持久化:`ShadowLogBook` 落**每租户持久** `<root>/conversation-task/tenant/<fileKey>.shadow.db`(经共享 `openTenantScopedDb` 租户隔离协议:`meta.tenant_id` 打开核对、mismatch/tamper fail-closed),**进程重启后保留**。
- 删除:`deleteByConversation(conversationId)` / `deleteByTenant()`;返回**防篡改删除凭据**,凭据 `digest` = **租户 keyed HMAC-SHA256**(非无密钥 SHA-256),并以 `prevDigest` 组成**哈希链**;`tenantKey` 为哈希、不含原始 tenant 值。凭据可用 `verifyShadowReceipt(receipt, key)` 校验:无密钥无法重算、任一字段被篡改即校验失败。与 S7 purge receipt 对齐,保留期须长于被删除数据。
- 过期密钥拒写:`append` 时若 `isHmacRotationDue(key, now)`(密钥 > 90 天)⇒ **拒写 fail-closed**(`hmac_key_expired`),必须先轮换密钥。

### 4.1 HMAC 密钥轮换(≤ 90 天)

- 指纹 = `hf_<keyId>_<HMAC-SHA256(secret, canonical(tenantId, text))>`;密钥来自 secrets 源的 `TenantHmacKeyProvider`,**不落日志/代码**。
- 到期判定:`isHmacRotationDue(key, now)`(默认 90 天);到期即轮换。
- 轮换即断链:新 `keyId`/`secret` ⇒ 新指纹,旧新日志不可相关联(设计如此)。
- 步骤:①在 secrets 源生成新密钥(新 `keyId`、`issuedAtMs=now`);②更新 provider 使新写入使用新密钥;③旧日志按 TTL 自然过期,不回填;④记录轮换事件(可审计)。

### 4.2 Break-glass(应急)

- 触发条件:疑似密钥泄露或合规要求立即失效。
- 步骤:①立即在 secrets 源轮换/吊销受影响 `keyId`;②对受影响租户执行 `deleteByTenant()` 并保存删除凭据;③记录 break-glass 事件(操作者、时间、原因、受影响 `tenantKey`),凭据保留期长于被删除数据;④事后补 RCA。
- 红线:break-glass 仅在 secrets 层与本模块的删除/轮换范围内操作,**不触及 Progress Ledger、不产生外部副作用**。

## 5. 生产灰度(canary)——需独立发布审批后方可执行

> 详见 `./p2-production-rollout.md`。开启灰度须:发布当刻 `git fetch origin` + `verify-forward-only.sh --candidate $(git rev-parse origin/main)` = allow;从新鲜 `origin/main` 构建;经受控人工重开(非 env 变量);`projection`/`authorization` 保持 OFF。

### 5.1 灰度比例 / 观察窗口 / 停止条件 / 回滚命令

- **范围**:仅内部测试租户或明确 allowlist(可信 `tenantId`);其余租户 Gate 恒 `shadow_frozen`。默认生产流量 **0%**。
- **比例阶梯**:allowlist 内 0% → 单一内部测试租户 → allowlist 5% → 25% → 50% → 100%;每阶前置为上一阶观察窗内无停止条件命中。
- **观察窗口**:每阶 ≥ 24h 或最近 N=200 判定(取更长),滚动核对 §3 指标。
- **停止条件(命中即回滚)**:Upgrade Precision < 95% 或 over-upgrade > 5%(自动 force-off);over-upgrade > 2% / duplicate task rate > 1% / Reminder over-upgrade > 0(告警,评估后决定);控制面不可读 / 卷丢失 / 状态行异常(P0,保持 OFF)。
- **回滚命令(不依赖重新部署;force-off 后全实例即时 `shadow_frozen`)**:
  - 自动:降级控制器越阈即 `controlPlane.forceOff(...)`(持久)。
  - 人工:通过运维工具触发受控 force-off(写持久控制面),**禁止**手工改 SQLite。
  - 恢复:仅经 `ActivationDegradeController.requestReopen`(人工确认 + 服务端冷却 + RCA 解决 + actor),记录 `lastReopenActor` / `lastReopenAtMs` / `stateVersion`。
- **禁止**:通过环境变量临时绕过控制面(env `activation`=ON 也不激活);灰度期间开启 `projection` 或 `authorization`;使用 dirty worktree / 侧分支 / 未合并提交构建。
- **多实例**:所有网关实例必须指向**同一持久控制面数据库**(共享卷),以共享同一 force-off 状态。

## 6. 红线(P2 持续生效)

- 不创建正式 ConversationTask 之外的执行态、不接 `chat.send`、不写 Progress Ledger、不产生真实副作用;`authorization`/`projection` OFF;不实施 Mission;**未打开生产 flag、未部署、未 cutover、未开启灰度流量**;未获独立发布审批不进入生产、不进入 P3–P7。
