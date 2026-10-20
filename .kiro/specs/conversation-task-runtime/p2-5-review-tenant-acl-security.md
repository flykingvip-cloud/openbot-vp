# P2.5 专项评审 — Tenant / ACL 安全

> 被评审设计: `./p2-5-production-integration.md`(§1.3、§1.4、§3、§5、§6)、`./p2-5-admission-package.md`(§2)
> 实施 owner: `kiro-conversation-task-runtime` · 独立 reviewer: `kiro-security-reviewer`(**≠ 实施 owner**)
> 关注点: 服务端身份派生、fail-closed、跨租户/跨会话隔离、tenant 再绑定、allowlist 防篡改、shadow 幂等键安全。
> 状态: **独立评审已签署;经 C1–C7 复核(2026-08-25,基线 `1e948ebf70`/#707)后 CONDITIONAL 已解除 → CLOSED。** 治理: 实施 owner 不得切角色代签。
> 评审基线: v1 初评 `origin/main` = `968b4b739f`;C1–C7 复核基线 = `origin/main` = `1e948ebf70`(#707 设计整改)。所有判据均对照相应 SHA 的真实代码亲验。

## 评审清单(逐项 decision 由独立 reviewer 填写)

| #   | 评审项                         | 判据                                                                                                                                                                                     | 实施自评(证据)                                                                          | 独立 decision    |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------- |
| S1  | 身份仅服务端派生               | 五字段全部来自服务端(§1.3 表)                                                                                                                                                            | `resolveKnowledgeSourceContext`、`employee-workbench-scope.ts`、`MsgContext.SessionKey` | **PASS**         |
| S2  | 拒绝客户端伪造                 | `chat.send`(`ChatSendParamsSchema`)不新增可控身份字段;携带即忽略                                                                                                                         | 设计 §1.3;验收 #6                                                                       | **PASS(附注)**   |
| S3  | 不从文本/ownerId 推导租户      | `tenantId` 不由文本/`ownerId`/参数推导;经 `canonicalTenantId` 规范化                                                                                                                     | 设计 §1.3                                                                               | **PASS(设计层)** |
| S4  | 无租户即 fail-closed           | 渠道入站无可信租户(`deriveSessionTenant` 索引空)=> 跳过                                                                                                                                  | 设计 §1.4;验收 #3                                                                       | **PASS**         |
| S5  | tenant/store 再绑定            | store 打开 `assertTenantStoreBinding`(`acl.ts:72`)+ `meta.tenant_id`;mismatch => `TenantIsolationViolationError`                                                                         | 设计 §3                                                                                 | **PASS**         |
| S6  | 检测二次范围                   | 逐条 `assertDetectionScope`(`acl.ts`),跨会话 fail-closed                                                                                                                                 | 设计 §1.1;验收 #5                                                                       | **PASS**         |
| S7  | 会话授权集合                   | `authorizedConversationIds` 来自服务端可见性;被动单会话最小集 = 当前 SessionKey                                                                                                          | 设计 §1.3;验收 #4                                                                       | **PASS(设计层)** |
| S8  | allowlist 唯一方案             | 服务端持久配置源、默认空、canonical 比对、多实例同源、TTL≤3s、读失败=空、版本化 CAS、actor/time/reason/version 审计、无客户端写入、可即时清空、更新 invalidate                           | 设计 §5;验收 #7/#8                                                                      | **CLOSED**       |
| S9  | allowlist 不与 activation 同开 | 入口断言;P2.5 本就不进入 activation                                                                                                                                                      | 设计 §5                                                                                 | **PASS(设计层)** |
| S10 | shadow 幂等键安全              | `(tenantId, conversationId, messageId, decisionVersion)` 复合 UNIQUE / 原子 create-if-absent;并发多实例仅一条;id 列全宽 tenant-scoped HMAC(非明文);文本 hash 仅索引;不用 `deriveTaskKey` | 设计 §3;验收 #9                                                                         | **CLOSED**       |
| S11 | 跨租户/跨会话不泄漏            | 异常仅拒绝 CTR,不影响聊天、不泄漏数据                                                                                                                                                    | 设计 §8.6                                                                               | **PASS(设计层)** |

## 亲验记录(reviewer 对照真实代码)

- **S1 = 真。** `resolveKnowledgeSourceContext` 定义于 `src/gateway/knowledge/context.ts:81`(清单引用 `context.ts:82`,行漂移 1),在 `dispatchReplyFromConfig` 内以 `ctx.GatewayClient*` 构造的 gatewayClient 调用,租户仅在 gateway 认证态返回。`employee-workbench-scope.ts` 中 `resolveEmployeeWorkbenchActor:591`、`isSessionVisibleToEmployeeActor:792`(与设计精确一致)。身份取自服务端,论断成立。
- **S2 = 真(附小建议)。** `src/gateway/protocol/schema/logs-chat.ts:42` 的 `ChatSendParamsSchema` 现字段中**无** `tenantId`/`authorizedConversationIds`/`employeeScopeAllowed`(已全量核对)。附注:请在实现时确认顶层对象 `additionalProperties` 处理,并保证服务端**永不读取**任何客户端自报身份字段(即便 schema 之外混入也忽略),验收 #6 对此断言。
- **S5 = 真(强证据)。** `acl.ts:72` `assertTenantStoreBinding` 比对 `canonicalTenantId`;`store.ts:301` `openTenantScopedDb` 在打开时校验 `meta.tenant_id`,不匹配/缺失即抛 `TenantIsolationViolationError`(fail-closed)。`ShadowLogBook` 经 `openTenantScopedDb({fileSuffix:".shadow.db"})` 复用同一隔离协议。
- **S6 = 真(行漂移)。** `assertDetectionScope` 实为 `acl.ts:93`(设计引用 `:100`);对非本会话消息 fail-closed。`ConversationTaskAccess` 类型在 `:25`(设计引用 `:8`)。
- **S8 allowlist = 尚无实现(设计-only)。** 模块内无任何 `allowlist` 代码;设计要求“服务端持久配置源 + 版本化 CAS”。CAS 先例真实存在于 `control-plane.ts:293-306`(`state_version` CAS:`BEGIN IMMEDIATE` + `WHERE state_version = observed` + `changes===1`),可作蓝本。
- **S10 幂等键 = 设计要求正确,但现状未落且存在密钥纪元隐患。** `store.ts:455/:553` 已用 `BEGIN IMMEDIATE` + 复合 `ON CONFLICT (…) DO NOTHING`(Candidate/Task),是设计 §3 要 shadow 承接的先例。但**当前 `shadow.ts` 的 `shadow_logs` 表无复合 UNIQUE、`append` 为普通 INSERT、`conversation_id`/`message_id` 落为明文列**;设计要求改为 HMAC 列 + 复合 UNIQUE(属未来实现,自评诚实引用设计而非现状)。`deriveTaskKey` 确为 Task store 键(`canonical.ts`),不被 shadow 复用,论断成立。

## 附加条件 / 阻断项(独立 reviewer 填写)

- **[CONDITIONAL-S10 / C2]** shadow 幂等落地必须:①在 `shadow_logs` 增加复合 UNIQUE `(tenantId, conversationId, messageId, decisionVersion)` 并采用原子 create-if-absent(`BEGIN IMMEDIATE` + `ON CONFLICT DO NOTHING`,承接 `store.ts` 语义);②`conversationId`/`messageId` 以**全宽 tenant-scoped HMAC** 落列(非明文)。此外发现一处设计未覆盖的隐患:`tenantFingerprint` 输出含 `keyId` 且依赖密钥,**密钥轮转后同一 (conversationId,messageId) 的 HMAC 会变**,复合 UNIQUE 真实性列随之改变——即幂等只在**同一密钥纪元内**成立。设计仅冻结了 “TTL 删除后重投=新记录”,未涵盖轮转。**条件**:设计须显式声明 shadow 幂等仅在密钥纪元内成立(轮转如同 TTL 会重置幂等),或将 `keyId`/`decisionVersion` 纳入唯一元组并断言;验收 #9 须新增“密钥轮转后幂等语义”断言,且“并发多实例仅一条”须为真实跨进程/并发用例。
- **[CONDITIONAL-S8 / C4]** allowlist 与异步 runner 均**尚未实现**。**条件**:设计须给出 allowlist **具体持久存储与 schema/版本列**(不能停留在抽象描述);验收 #7(多实例一致 + 版本化 CAS 冲突可检出)须为**真实跨进程**用例(参照 `store-crossproc.test.ts`),#8(读失败=空集合 fail-closed)须覆盖缺失/损坏两态。
- **[附注-S2]** 建议在准入包/设计中明确“身份字段严格拒绝”策略(schema 层拒绝 + 运行时永不读取客户端自报身份),使 “携带即忽略并 fail-closed” 可由验收 #6 明确验证。

## 复核确认(C1–C7,2026-08-25,基线 `1e948ebf70`/#707)

- **S10 → CLOSED**:设计 §3.2 冻结复合 UNIQUE `(conversation_id_hmac, message_id_hmac, decision_version, key_id)` + 原子 create-if-absent(`BEGIN IMMEDIATE` + `ON CONFLICT DO NOTHING`,承接 `store.ts`);`conversationId`/`messageId` 以全宽 tenant-scoped HMAC 落列取代明文;`tenantId` 由 `openTenantScopedDb` + `meta.tenant_id` 隐含并二次校验。§3.3 显式把密钥轮转(`keyId` 纪元)与 TTL 重投均定义为“视为新记录”,并将 `keyId` 纳入唯一元组表达该语义——正是本评审要求的 C2 强化。验收 #9 强化(真实并发多实例仅一条 + 纪元/TTL 语义 + 磁盘无明文 id)。
- **S8 → CLOSED(设计规定 + 验收强制)**:设计 §5 给出具体持久 `tenant_allowlist` schema(`tenant_id_hmac` PK、`enabled`、`actor`、`reason`、`updated_at_ms`、`state_version`)+ 版本化 CAS(仿控制面 `state_version` CAS,已亲验其真实存在于 `control-plane.ts`)+ 默认空/读失败为空 fail-closed + TTL≤3s + invalidate + 无客户端写入。验收 #7/#8 要求真实多实例一致 + 版本冲突 + 读失败为空,不得桩。
- 附注 S2(schema 严格拒绝身份字段)已在设计 §1.3 保留“携带即忽略并 fail-closed”,验收 #6 覆盖;`ChatSendParamsSchema` 无身份字段已亲验。

## 独立签署

- Reviewer id: **`kiro-security-reviewer`**(≠ `kiro-conversation-task-runtime`) · 初评日期: **2026-08-25**(基线 `968b4b7`) · 复核日期: **2026-08-25**(基线 `1e948ebf70`/#707) · IDE/Loom session: `kiro` / `FBDD4864-0261-4D8F-BA68-3C6E627E7059`(reviewer 统一独立 session)
- 逐项结论: S1/S2/S5/S6 = PASS(亲验);S3/S4/S7/S9/S11 = PASS(设计层,须由验收强制);S8/S10 = **CLOSED**(复核后由 CONDITIONAL 解除)。
- 总结论: **条件通过 → CLOSED(2026-08-25 复核)**。服务端派生身份、无租户 fail-closed、tenant/store 再绑定、检测二次范围初评已亲验成立;C2(幂等 HMAC 列 + 密钥纪元语义)与 C4(allowlist 具体 schema + 版本化 CAS + 真实并发测试)经 #707 设计整改后于设计层闭合,余下强制点委派给强化验收(#7/#8/#9/#10)于编码门禁执行。**本项无剩余阻断条件。**
