# ConversationTask Runtime — P2.5 生产集成设计(shadow-only,修订版)

> Owner(实施): `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 关联: `./p2-5-admission-package.md`、`./p2-admission-package.md`、`./p2-production-rollout.md`、`./p2-ops-runbook.md`、`./p2-rollback-drill.md`
> 状态: **`P2 implementation = ACCEPTED` · `main landing = ACCEPTED` (PR #680, `4ef2a43534`) · `P2.5 design = C1-C7 CLOSED (independent re-review confirmed, PR #715)` · `P2.5 implementation = IN PROGRESS (shadow-only, §5 APPROVED WITH CONDITIONS AC1-AC8)` · `production integration = NOT IMPLEMENTED (wiring pending)` · `production rollout = NOT APPROVED`**。
> 本文件仅为**设计**。未获书面 P2.5 编码准入前,不得改 `src/gateway/**`、`src/config/**`、`src/channels/**`、`ui/**`、`deploy/**`;不开任何生产 flag;不部署。
> 修订说明:v2 按独立评审收紧——P2.5 **完全不进入 Activation 层**、重写线上质量指标、冻结 shadow 幂等键/异步资源合同/唯一 allowlist/隐私合同。**v3(本版)按 #701 独立评审(CONDITIONAL ×4,reviewer `kiro-gateway-reviewer`,基线 `968b4b7`)逐条闭合 C1–C7,见 §11。独立 reviewer 已于 #715 复核确认 C1–C7 CLOSED,REVISION 已解除,设计层冻结。注:此仅为**设计层**再评审;shadow-only **实现**(PR #728)的独立再评审属另一轮门禁,尚未完成。**
> 代码锚点约定:引用以**符号名**为准,行号为 `968b4b7`/`3c4b0d6` 时点近似值(main 会推进);实现者以符号解析,不得以行号漂移为由跳过。

## 0. 范围与红线

- P2.5 只交付**设计 + 评审**;不写 gateway 运行代码、不接线、不开 flag、不部署、不 cutover。
- 获批后首个实现**仅允许 shadow-only 接线**:`detection`/`qualification` 在内部 allowlist 下计算并写 tenant-HMAC 影子日志 + 发射有界指标。
- **P2.5 根本不进入 Activation 层**。明确禁止 P2.5 调用:
  - `runActivationGate`(`src/conversation-task/activation.ts`)
  - `openTaskStore` 及任何 Candidate / ConversationTask 写入(`src/conversation-task/store.ts`)
  - Progress Ledger 写入
  - Agent / Mission 启动
  - 任何通知或外部副作用、任何改变 `chat.send` 的行为
- 控制面 force-off 属 Activation 层机制,在 P2.5 中**不是**回滚动作(见 §7.4、§9)。
- 模块现状:`src/conversation-task/**` 已在 `origin/main`(#680),全仓目录外零引用,greenfield 接入。

## 1. Gateway 调用边界与冻结运行链

### 1.1 冻结的 P2.5 唯一运行链

```text
authenticated server context
  -> trusted tenant derivation      (resolveKnowledgeSourceContext / deriveSessionTenant;无可信租户 => 跳过)
  -> employee/workbench scope        (employee-workbench-scope.ts,服务端判断)
  -> conversation ACL                (会话可见性 + authorizedConversationIds)
  -> detection secondary scope       (assertDetectionScope,逐条二次校验)
  -> detection                       (detectTurn,纯计算)
  -> qualification                   (qualifyTurn,纯计算)
  -> tenant-HMAC shadow log          (ShadowLogBook,§3 幂等键 + §6 隐私)
  -> bounded metrics emission        (§7 有界指标;§4 异步资源合同)
  -> stop
```

**链在 `stop` 结束。绝不延伸到 activation gate、Task store、Candidate/Task、Ledger、Agent 或任何副作用。**

### 1.2 唯一调用点

所有内置渠道(telegram/discord/slack/signal/imessage/web-whatsapp/line)、扩展渠道(`extensions/*` 经 `src/plugins/runtime/runtime-channel.ts`)与 gateway webchat 都汇聚于 `MsgContext` 回复管线。冻结的唯一被动 shadow 观测调用点:

- **`dispatchReplyFromConfig`**(`src/auto-reply/reply/dispatch-from-config.ts`,`dispatchReplyFromConfig`≈:114),镜像该函数内既有的 fire-and-forget `message_received` 钩子先例(≈:208-227),在 `getReplyFromConfig`(≈:426)之外旁路运行,**不参与回复计算**。单点接入使全部渠道共享同一安全边界。

### 1.3 身份只能来自服务端

`ConversationTaskAccess`(`src/conversation-task/acl.ts`,`ConversationTaskAccess`≈:25)必须由服务端组装:

| 字段                        | 唯一可信来源                                                                                                                       | 禁止来源                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `tenantId`                  | `resolveKnowledgeSourceContext(client).tenantId`(`gateway/knowledge/context.ts`≈:81)或 `deriveSessionTenant((channel, accountId))` | 消息文本、`ownerId`、请求参数 |
| `requesterId`               | 认证主体 `GatewayClient.platformUserId`/`user`,由服务端 stamp 到 `MsgContext`(`chat.ts` 身份注入 ≈:2593-2595 与 ≈:3919-3921)       | 客户端自报                    |
| `conversationId`            | 当前已授权会话 `MsgContext.SessionKey`(`src/routing/session-key.ts`)                                                               | 客户端提交                    |
| `authorizedConversationIds` | 服务端可见性(`employee-workbench-scope.ts`:`isSessionVisibleToEmployeeActor`);被动单会话最小集 = `{ 当前 SessionKey }`             | 客户端提交                    |
| `employeeScopeAllowed`      | 服务端权限(`resolveEmployeeWorkbenchActor`)                                                                                        | 客户端提交                    |

- `chat.send` 参数模式(`ChatSendParamsSchema`,`src/gateway/protocol/schema/logs-chat.ts`≈:42)**不得**新增 `tenantId`/`authorizedConversationIds`/`employeeScopeAllowed` 等客户端可控字段;携带即忽略并 fail-closed。
- `tenantId` 不得从文本/`ownerId`/参数推导;经 `canonicalTenantId` 规范化。

### 1.4 无可信租户即 fail-closed

真实渠道入站 `MsgContext` 不携带 gateway 认证身份;`resolveKnowledgeSourceContext` 仅对 gateway 认证态返回租户,渠道消息租户须经 `deriveSessionTenant`(`src/gateway/session-tenant-derivation.ts`,Phase 3 前索引基本为空)。**无可信 `tenantId` 一律跳过 shadow**,与 `assertConversationTaskAccess`(`acl.ts`,`assertConversationTaskAccess`≈:42)对空租户抛错一致。

## 2. Shadow-only 被动接线

- flag 值:`detection`/`qualification` = ON(仅内部 allowlist);`activation`/`projection`/`authorization` = **OFF**。入口断言 `isShadowModeOnly`(`feature.ts`),任一 forbidden flag ON 即 fail-closed 跳过。
- **flag 配置源(C3,冻结)**:detection/qualification 的开关**不得**依赖纯环境变量。现状 `feature.ts`/`flag-cache.ts` 读 `process.env`,运行中不可热改、多实例不一致。P2.5 生产接线必须从**与 §5 allowlist 同一个服务端持久、可热加载、多实例一致的配置源**读取(env 仅作离线/测试回退),经短 TTL 缓存 + 更新即 invalidate。回滚(§9)对该配置源置 OFF 即时生效、无需重新部署。
- 被动性:钩子(1)不触碰 `dispatcher`/`routeReply`;(2)不修改 `ctx`(同引用传入 `getReplyFromConfig`);(3)自带 try/catch,异常不冒泡进管线 rethrow;(4)以 §4 异步 runner 调度,不 `await` 进主回复时序;(5)只调用纯计算 `detectTurn`/`qualifyTurn`(`MsgContext` → `ConversationTurnInput` 只读副本)+ 写 §3 定义的生产 shadow 记录。
- **绝不**:调用 `runActivationGate`;`openTaskStore` 写路径;创建 Candidate/Task;写 Ledger;启动 Agent;改 `chat.send` 内容/时序/错误语义。
- 观测失败不影响聊天;shadow 存储失败 fail-safe + 脱敏告警(见 §8)。

## 3. Shadow 记录构造与幂等键(冻结)

### 3.1 生产 shadow 记录不得复用无密钥指纹(C1)

- 现状:`fingerprintText` 定义于 `replay.ts`(`fingerprintText`≈:44,无密钥 FNV-1a),`replay.evaluateTurn` 以它填充 `ShadowDecisionLog.inputFingerprint`(赋值处 `replay.ts`≈:75);`ShadowLogBook.append` 将整条记录以 `log_json` 持久化(`shadow.ts`,`append`≈:238,列 `log_json`≈:113)。
- 生产 shadow 记录构造器**必须**:移除 `inputFingerprint` 字段,或改为 keyed `tenantFingerprint`;**禁止**任何无密钥 `fingerprintText` 进入 `log_json` 或任何落库/指标字段。**验收 #10 强化**:断言 `log_json` 内不含无密钥指纹(无 `fp_`/keyless 指纹)。

### 3.2 业务幂等键与原子性(C2)

业务唯一键:

```text
(tenantId, conversationId, messageId, decisionVersion, keyId)
```

- `decisionVersion` = `CONVERSATION_TASK_DECISION_VERSION`(`types.ts`);`keyId` = 当前 tenant-HMAC 密钥纪元标识(见下"密钥纪元")。
- 现状:`shadow.ts` 的 `shadow_logs` 以**明文** `conversation_id`/`message_id` 落列(`append`≈:252-257),且**无**复合 UNIQUE。生产实现**必须**:
  - 新增**复合 UNIQUE** `(conversation_id_hmac, message_id_hmac, decision_version, key_id)` + **原子 create-if-absent**(`BEGIN IMMEDIATE` + `ON CONFLICT DO NOTHING`,承接 `store.ts` 语义);
  - `conversationId`/`messageId` 以**全宽 tenant-scoped HMAC**(`tenantFingerprint`)落列,取代明文;`tenantId` 由 tenant-scoped DB(`openTenantScopedDb` + `meta.tenant_id` 绑定)隐含并二次校验;
  - 保证:重复投递只保留**一条**;**并发多实例**写入仍只一条(约束在存储层强制,不靠进程判断);消息文本 hash **仅作索引**,不作唯一真实性;
  - **不得用 `deriveTaskKey` 模拟 shadow 幂等**(那是 Task store 的键)。

### 3.3 密钥纪元与 TTL 语义(C2)

- **密钥纪元**:幂等仅在**同一 HMAC 密钥纪元(`keyId`)内**成立;密钥轮转 => `keyId` 变化 => 视为新纪元(等同 TTL 重置幂等)。`keyId` 纳入唯一元组即显式表达该语义。
- **TTL 重投**:TTL(`SHADOW_LOG_DEFAULT_TTL_MS`)清理后同一元组再投递,**视为新记录**(TTL 是留存策略而非幂等窗口)。
- 两条语义都必须在实现与测试中显式断言(**验收 #9 强化**:真实并发多实例仅一条 + 密钥轮转/TTL 重置语义 + 磁盘无明文 id)。

## 4. 异步资源合同(fire-and-forget shadow runner)

冻结(现状:runner **尚未实现**,以下为实现契约):

- **单例 runner + 数据库连接生命周期**:进程内单例,复用**单一** tenant-scoped 连接句柄;**禁止每消息新建连接**。
- **有界队列**:固定容量上限;禁止无限队列、无限挂起 Promise。
- **最大并发数**:固定上限。
- **唯一超载策略**:队列满时统一采用 **drop-new** 或 **drop-old** 之一(实现二选一并冻结,不混用);drop 计入 `queue_dropped` 指标 + 达阈告警。
- **单项执行超时**:每次 shadow 计算/写入设超时,超时即放弃该项并计指标。
- **统一 rejected promise 捕获**:所有 fire-and-forget 经统一封装(仿 `fireAndForgetHook`),不产生 unhandled rejection。
- **shutdown drain**:gateway 关停时 drain 有上限;超时后**安全丢弃**剩余项,不无限等待。
- **测试须为真实用例(C4)**:参照 `store-crossproc.test.ts`,给出**真实跨进程/并发/关停**证明,不得单进程桩。**验收 #12/#13**:慢 SQLite 不拖慢回复;队列满不阻塞聊天;无 unhandled rejection;shutdown 有界;多渠道共享同一 runner。

## 5. Tenant allowlist(唯一方案:服务端持久配置源,C4 具体化)

冻结为**服务端持久配置源**(现状:**尚未实现**;以下为实现契约):

- **持久存储 schema**(建议,tenant-scoped 或平台级持久库):
  ```text
  tenant_allowlist(
    tenant_id_hmac TEXT PRIMARY KEY,   -- canonical tenantId 的 tenant-scoped HMAC,不落明文
    enabled        INTEGER NOT NULL,    -- 1=在灰度
    actor          TEXT NOT NULL,       -- 变更操作者(服务端身份)
    reason         TEXT NOT NULL,
    updated_at_ms  INTEGER NOT NULL,    -- server time
    state_version  INTEGER NOT NULL     -- 版本化 CAS
  )
  ```
- 默认**空集合**;读取失败/缺失 => 空集合(fail-closed,视为不在灰度)。
- 仅内部测试租户;以 **canonical tenantId**(`canonicalTenantId`)比对(比对用 HMAC 列,不落明文)。
- **多实例读取同一权威配置**(持久共享,非各进程内存态);热读 **TTL ≤ 3s**;更新即 **invalidate**。
- 变更记录 **actor、server time、reason、version**;**版本化 CAS** 更新(仿控制面 `state_version` CAS)。
- **客户端无写入入口**;回滚可**立即清空**(§9)。
- **allowlist 绝不与 activation 同开**(P2.5 不进入 activation;入口再断言)。
- **测试须为真实用例(C4)**:多实例一致 + 版本冲突 + 读失败为空(**验收 #7/#8**)。

## 6. 隐私合同(收紧)

- 文本指纹**只能**用 `tenantFingerprint`(**tenant-scoped keyed HMAC**);**禁止**用无密钥 `fingerprintText`(`replay.ts`)作生产替代(仅供离线,见 §3.1 C1)。
- **禁止**明文 `tenantId`/`conversationId`/`messageId` 进入日志、指标标签或 shadow 落库列;需要关联时各自使用 **tenant-scoped HMAC**(§3.2)。
- **缺失密钥契约级 fail-closed(C5)**:`TenantHmacKeyProvider` 契约必须规定——密钥**缺失时必须抛错**(绝不返回空/undefined secret)。密钥**缺失**(不仅过期 `HMAC_KEY_MAX_AGE_MS`)或 provider 失败:**不写 shadow**,**不得**降级为无密钥 hash 或明文。**验收 #11 强化**:覆盖**缺失**用例(非仅过期)。
- 指标/日志只允许:HMAC 指纹、reason codes(`REASON`)、类别标签、布尔/计数;无原文、实体、密钥、明文 id。

## 7. 指标与告警(三类合同)

线上**没有实时 gold**,普通生产消息**不得**直接计入 Upgrade Precision。

### 7.1 实时运行指标(可即时采集,脱敏计数)

- shadow invocation / success / failure
- classification distribution(类别分布)
- tenant/scope rejection(`assertTenantStoreBinding`/`assertDetectionScope` 抛错计数)
- HMAC failure(含**缺失**与过期,§6 C5)
- shadow persistence failure
- duplicate shadow delivery(命中 §3 复合 UNIQUE 冲突计数)
- queue depth / drop(§4)
- processing latency

### 7.2 延迟人工标注质量指标

- 从**脱敏抽样队列**取样;**双人或仲裁标注**;记录 `label version`。
- 以 `prediction_at_t` 对照 `gold_after_review`;**达到最小样本量后**才计算 Upgrade Precision / over-upgrade / reminder over-upgrade。
- 未达最小样本量:**不得**产出质量结论,**不得**触发基于质量的自动动作。

### 7.3 离线回归指标

- 冻结数据集 + 盲测集(`evaluateDataset`/`runEvaluation`/`runBlindEvaluation`);**不得冒充生产实时指标**。

### 7.4 P2.5 专属告警与自动响应(C7)

P2.5 是 shadow-only、不进入 activation,因此**必须有独立于 Activation 阶段的告警规范**(不复用 Activation force-off 语义)。在 `./p2-ops-runbook.md` 新增 P2.5 小节或独立告警表,至少含:

| 触发                            | 阈值(达最小样本量) | 渠道        | 责任人            | 升级              | 自动响应                                   |
| ------------------------------- | ------------------ | ----------- | ----------------- | ----------------- | ------------------------------------------ |
| shadow persistence failure 激增 | 运维定阈           | P1 告警渠道 | 值班运维          | 15min 未处理升 P0 | 停 shadow 写入 + 清 allowlist              |
| HMAC failure(缺失/过期)         | > 0                | P1          | 值班运维 + 安全   | 升安全负责人      | 停 shadow 写入                             |
| tenant/scope rejection 异常     | 运维定阈           | P1          | 值班运维 + 安全   | 升安全            | 清 allowlist                               |
| queue drop 超阈                 | §4 定阈            | P2          | 值班运维          | —                 | 降载/清 allowlist                          |
| 延迟标注质量 < 阈(达样本量)     | 见 §7.2            | P1          | 实施 owner + 运维 | 升专家            | 清 allowlist + detection/qualification OFF |

P2.5 阈值异常的**唯一自动响应链**(非 activation force-off):

```text
1. 清空 allowlist
2. detection / qualification OFF(§2 配置源)
3. 停止 shadow 写入
4. 脱敏告警(按上表渠道/责任人/升级)
```

- 控制面 force-off 仍作为 Activation 阶段(P3+)的独立机制存在,与 P2.5 正交。

### 7.5 从 P2.5 移除/延期(属 Activation/TaskStore 阶段)

`duplicate task rate`、`Candidate CAS conflict`、`Task CAS conflict`、`state_changed_retry_required` 均**移出 P2.5 线上指标**,延至 Activation/Task Store 阶段。

## 8. 失败隔离(实现须证明)

1. CTR 抛异常 → 聊天按原行为完成(钩子 try/catch)。
2. SQLite locked/corrupt/unavailable → 不影响聊天(store 错误隔离在钩子内)。
3. HMAC key 缺失/过期/provider 失败 → 不写 shadow,聊天正常(§6 C5)。
4. 指标系统不可用 → 不阻断聊天(有界 runner + fire-and-forget)。
5. 队列满 → 按唯一 drop 策略丢弃 + 计指标,**不阻塞聊天**(§4)。
6. 跨租户/跨会话异常 → 仅拒绝 CTR,不泄漏数据、不影响聊天。

## 9. 即时回滚(冻结顺序,不需重新部署)

```text
1. detection OFF        (§2 配置源热改)
2. qualification OFF
3. allowlist 清空(回默认空集合,§5 invalidate)
4. 验证 shadow 写入停止(ShadowLogBook 无新写、persistence 无新增)
5. 验证 chat.send 行为无变化(内容/时序/错误语义与接线前一致)
```

- 回滚**不需重新部署**:flag 配置源(TTL ≤ 3s)+ allowlist(invalidate)均运行时热读。
- P2.5 回滚**不依赖** activation force-off(activation 未进入)。**验收 #16 强化**:针对**真实配置源**证明"回滚即停写、无需重新部署"。

## 10. 声明

- 本文件为设计;`P2.5 design = C1-C7 CLOSED (re-review confirmed #715)`。四项独立评审条件已闭合确认 + 已获书面 §5 P2.5 编码准入(APPROVED WITH CONDITIONS,AC1-AC8),**仅 shadow-only 实现正在进行**;`activation`/`projection`/`authorization` 保持 OFF,未接 gateway 单点(dispatch-from-config.ts 单行插入待其分区 owner 应用),未部署,`production rollout = NOT APPROVED`。
- 合入主干 ≠ 已上线 ≠ activation 批准。验收测试要求与准入门禁见 `./p2-5-admission-package.md`。

## 11. C1–C7 闭合映射(#701 独立评审)

| 条件 | 评审要点                               | 本设计闭合处                                                                            | 状态                |
| ---- | -------------------------------------- | --------------------------------------------------------------------------------------- | ------------------- |
| C1   | 无密钥指纹不得落库                     | §3.1(移除/改 keyed `tenantFingerprint`,禁 `fingerprintText` 入 `log_json`)+ §6;验收 #10 | 已整改(设计),待复核 |
| C2   | shadow 幂等 + 去明文                   | §3.2(复合 UNIQUE + 原子 create-if-absent + HMAC id 列)+ §3.3(keyId 纪元)+ §6;验收 #9    | 已整改(设计),待复核 |
| C3   | flag 热配置源                          | §2(detection/qualification 改用 §5 同源持久热配置,非纯 env);验收 #16                    | 已整改(设计),待复核 |
| C4   | allowlist/runner 具体化 + 真实并发测试 | §5(持久 schema + 版本 CAS)+ §4(资源合同);验收 #7/#9/#12/#13 真实跨进程                  | 已整改(设计),待复核 |
| C5   | 缺失密钥契约级 fail-closed             | §6(`TenantHmacKeyProvider` 缺失必抛错、不降级);验收 #11 覆盖缺失                        | 已整改(设计),待复核 |
| C6   | 锚点刷新                               | 全文改为符号名 + `968b4b7`/`3c4b0d6` 近似行号 + 约定说明;§1 各锚点已校准                | 已整改(设计),待复核 |
| C7   | P2.5 专属告警                          | §7.4(独立告警表 + 唯一自动响应链,区别于 activation force-off)                           | 已整改(设计),待复核 |

> 以上均为**设计层**闭合;实现与验收测试须在获书面 P2.5 编码准入后落地。**四项 CONDITIONAL 的解除以独立 reviewer 复核确认为准,实施 owner 不得自行标记闭合。**
