# ConversationTask Runtime — P2.5 生产集成准入包

> Owner(实施): `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 关联: `./p2-5-production-integration.md`(设计)、`./p2-admission-package.md`、`./p2-production-rollout.md`、`./p2-ops-runbook.md`、`./p2-rollback-drill.md`
> 状态: **`P2 implementation = ACCEPTED` · `main landing = ACCEPTED` (PR #680, `4ef2a43534`) · `P2.5 design = C1-C7 CLOSED (independent re-review confirmed 2026-08-25)` · `四项 review = CONDITIONAL → CLOSED` · `expert coding admission (§5) = APPROVED WITH CONDITIONS (shadow-only, authority kiro-p2-5-authority, 2026-08-25)` · `production integration = NOT IMPLEMENTED` · `production rollout = NOT APPROVED`**。
> 本准入包仅为**设计 + 评审申请**。未获书面 P2.5 编码准入前,不得改 `src/gateway/**`、`src/config/**`、`src/channels/**`、`ui/**`、`deploy/**`;不开任何生产 flag;不部署。
> 修订说明:按独立评审意见收紧——P2.5 **完全不进入 Activation 层、不打开 TaskStore**;线上质量指标改为三类合同;新增 shadow 幂等键、异步资源合同、唯一 allowlist 方案、隐私合同与对应验收用例。**#701 独立评审判 CONDITIONAL ×4 并提 C1–C7;实施 owner 已在设计层逐条整改(见 `./p2-5-production-integration.md` §11 闭合映射);独立 reviewer 已于 2026-08-25(基线 `1e948ebf70`,#715)复核确认 C1–C7 CLOSED,CONDITIONAL ×4 与 REVISION APPLIED 状态均已解除。注:此仅为**设计层**再评审;shadow-only **实现**的独立再评审属另一轮门禁,尚未完成。**

## 0. 结论摘要

- P2.5 = 生产集成**准备**:仅产出集成设计(`./p2-5-production-integration.md`)、本准入包与四项专项评审;不写 gateway 运行代码、不接线、不开 flag、不部署。
- 冻结运行链在 `bounded metrics emission -> stop` 结束:**P2.5 不进入 Activation 层、不调用 `runActivationGate`、不 `openTaskStore`、不创建 Candidate/Task、不写 Ledger、不启 Agent、不产生副作用**。
- 唯一 shadow 观测调用点:`dispatchReplyFromConfig`(`src/auto-reply/reply/dispatch-from-config.ts:114`),镜像既有 fire-and-forget `message_received` 钩子先例。
- 身份只能服务端派生;客户端不得提交 `tenantId`/`authorizedConversationIds`/`employeeScopeAllowed`;渠道入站无可信租户即 fail-closed 跳过。
- 模块 greenfield 接入(全仓目录外零引用)。

## 1. P2.5 编码批准后的预期范围(即使获批也仅此)

获书面 P2.5 编码准入后,**首个且唯一允许的实现是 shadow-only 接线**:

- 允许:`detection` / `qualification` 在**内部 allowlist** 下计算 + 写 tenant-HMAC 影子日志(`ShadowLogBook`,§3 幂等键 + 隐私合同)+ 发射有界指标(经 §4 异步 runner)。
- 允许改动范围(获批后):在 `dispatchReplyFromConfig` 单点接入一个**被动、fire-and-forget、自带 try/catch、有界队列**的 shadow runner;新增服务端持久 allowlist 读取;新增有界指标发射点;读取相关 flag/allowlist 配置。

**仍然禁止(获批后也禁止):**

- 进入 Activation 层 / 调用 `runActivationGate`;
- `openTaskStore` 或任何 Candidate / 正式 ConversationTask 写入;
- `activation`/`projection`/`authorization` = ON;
- 写 Progress Ledger;
- 启动 Agent / Mission;
- 任何通知或外部副作用;
- 改变 `chat.send` 响应内容/时序/错误语义;
- 用普通 `fingerprintText` 或明文 id 落日志/指标;
- UI 宣称任务已激活;
- 生产 cutover;进入 P3。

## 2. 验收测试要求(设计要求后续实现至少覆盖)

获批实现必须随附下列可执行验收测试(fail 即不得合并接线):

**边界(P2.5 不越层)**

1. **P2.5 从不调用 Activation Gate**:接线路径静态/运行时均不触达 `runActivationGate`。
2. **P2.5 从不打开 TaskStore**:不调用 `openTaskStore`,不创建 Candidate/Task,不写 Ledger。

**身份与 ACL** 3. **未授权 tenant 不执行 shadow**:不在 allowlist / 无可信租户 => 跳过,无影子写入。4. **未授权 conversation 不执行 shadow**:`assertConversationTaskAccess` / 可见性判断拒绝 => 跳过。5. **跨会话消息拒绝**:`assertDetectionScope` 对非本会话消息 fail-closed。6. **客户端伪造 tenant/requester/scope 无效**:请求携带 `tenantId`/`authorizedConversationIds`/`employeeScopeAllowed` 一律忽略,身份仍取服务端来源。

**Allowlist** 7. **allowlist 多实例一致 + 版本冲突**:多实例读同一权威配置;并发更新经版本化 CAS,冲突可检出。8. **allowlist 读取失败为空**:读失败/缺失 => 空集合,不进入 shadow。

**Shadow 幂等 / 隐私 / 异步** 9. **Shadow 复合幂等键并发写唯一**:`(tenantId, conversationId, messageId, decisionVersion, keyId)` 复合 UNIQUE(`conversationId`/`messageId` 以 tenant-scoped HMAC 落列,非明文)+ 原子 create-if-absent;并发多实例仅一条记录;**不使用 `deriveTaskKey`**;密钥纪元(`keyId`)变化与 TTL 删除后重投均视为新记录(显式断言)。10. **Shadow 数据不含原文/明文 id**:落盘只有 tenant-scoped HMAC 指纹 + 结构化字段,无原文/实体/密钥/明文 `tenantId`/`conversationId`/`messageId`。11. **tenant-HMAC key 缺失/过期不降级**:key 缺失/过期/provider 失败 => 不写 shadow,**不降级为无密钥 hash 或明文**;聊天正常。12. **队列满时聊天正常**:有界队列满按唯一 drop 策略丢弃 + 计指标,不阻塞聊天。13. **shutdown drain 有界**:关停 drain 有上限,超时安全丢弃,不无限等待;无 unhandled rejection。

**被动性 / 回滚 / 渠道一致** 14. **detection/qualification OFF 时完全无行为差异**:flag OFF => `chat.send` 内容/时序/错误语义与接线前逐字节一致(黄金对照)。15. **CTR 异常不影响聊天**:shadow 抛错 / 慢 SQLite => 聊天照常完成、不被拖慢。16. **回滚后停止所有 shadow 写入**:按 `./p2-5-production-integration.md` §9 回滚后,`ShadowLogBook` 无新写入,无需重新部署。17. **全部内置 + 扩展消息渠道共享相同安全边界**:单点接入 `dispatchReplyFromConfig`;用至少一个内置 + 一个扩展渠道用例证明。

**线上质量指标合同** 18. **线上质量指标只使用已标注样本**:Upgrade Precision 等只由延迟人工标注样本(`prediction_at_t` vs `gold_after_review`)计算,不用普通生产消息实时计算。19. **未达最小样本量不触发质量结论**:样本不足时不产出质量结论、不触发基于质量的自动动作。

## 3. 准入门禁(全部满足方可申请书面 P2.5 编码准入)

1. ✅ **集成设计**(`./p2-5-production-integration.md`)—— C1–C7 由实施 owner 于 #707 设计层整改(设计 §11 闭合映射),并由独立 reviewer 于 2026-08-25(基线 `1e948ebf70`)复核确认全部 CLOSED(§4.1.1)。设计层视为冻结。
2. ✅ 准入包 + 验收测试要求(本文件 §1/§2,19 项)—— 已按 §4.1 强化 #7/#9/#10/#11/#12/#13/#16;独立评审确认可测且充分。
3. ✅ **四项独立专项评审签署 + 复核已完成(2026-08-25)**(§4):四项结论均由 **条件通过(CONDITIONAL)→ CLOSED**(独立 reviewer 复核确认,非实施 owner 自述)。§4.1 C1–C7 全部闭合。
4. ✅ **专家书面 P2.5 编码准入**(§5)—— **APPROVED WITH CONDITIONS**(authority `kiro-p2-5-authority`,2026-08-25;见 §5.1)。仅解锁 §1 shadow-only 接线;合并仍以 §5.1 AC1–AC7 为门槛。

门禁 1–4 已满足(§5 有条件批准)。据此**可开始且仅可开始** §1 shadow-only 接线实现(须在新分支随附 §2/§4.1 验收测试、经独立再评审后合入);**仍不得**开启 activation/projection/authorization、写 Ledger/创建 Task、改 `chat.send`、部署或进入生产灰度(`production rollout = NOT APPROVED`)。

## 4. 四项专项评审(索引与签署状态)

评审详情见各评审文件;签署由独立 reviewer(≠ 实施 owner)填入。**四项独立评审已签署(初评 2026-08-25,结论均为 条件通过 CONDITIONAL);实施 owner 于 #707 设计层整改 C1–C7 后,独立 reviewer 于 2026-08-25 复核(基线 `1e948ebf70`)确认全部条件 CLOSED,CONDITIONAL 已解除。**

| 评审            | 文件                                   | 关注点                                              | 独立 reviewer(id)        | 签署状态                                   |
| --------------- | -------------------------------------- | --------------------------------------------------- | ------------------------ | ------------------------------------------ |
| Gateway 集成    | `./p2-5-review-gateway-integration.md` | 单点接入、被动性、不改 chat.send、渠道一致性        | `kiro-gateway-reviewer`  | ✅ 已签署 · **CLOSED(条件已闭合复核通过)** |
| Tenant/ACL 安全 | `./p2-5-review-tenant-acl-security.md` | 服务端身份、fail-closed、跨租户/跨会话、再绑定      | `kiro-security-reviewer` | ✅ 已签署 · **CLOSED(条件已闭合复核通过)** |
| 隐私与日志      | `./p2-5-review-privacy-logging.md`     | 脱敏、指纹、无明文 tenantId/原文/密钥               | `kiro-privacy-reviewer`  | ✅ 已签署 · **CLOSED(条件已闭合复核通过)** |
| 运维与告警      | `./p2-5-review-ops-alerting.md`        | 指标采集/窗口/基数、告警/升级、自动 force-off、回滚 | `kiro-ops-reviewer`      | ✅ 已签署 · **CLOSED(条件已闭合复核通过)** |

> 治理:实施 owner **不得**切角色代签任一评审(承接 P2 治理更正)。四项评审由独立 reviewer 签署并复核,Loom 独立 reviewer session `FBDD4864-0261-4D8F-BA68-3C6E627E7059`(owner/agent 均 ≠ 实施 agent `kiro-conversation-task-runtime`)。初评亲验基线 `origin/main = 968b4b739f`;C1–C7 复核亲验基线 `origin/main = 1e948ebf70`(#707)。CONDITIONAL 的解除由独立 reviewer 复核确认(非实施 owner 自述)。设计文档实质内容由实施 owner 整改,reviewer 仅签核/复核。

### 4.1 附加条件(回写准入包 · 全部为编码准入前必须闭合项)

四项评审均为**条件通过**,下列条件在**开始任何 gateway 接线代码之前**必须由实施 owner 在设计与验收中闭合;闭合前 §5 不得批准。

- **C1(隐私 P1/P4、Gateway G6)— 无密钥指纹不得落库。** `ShadowDecisionLog.inputFingerprint` 现由 `replay.evaluateTurn` 以无密钥 `fingerprintText` 填充,`ShadowLogBook.append` 经 `JSON.stringify(log_json)` 持久化。生产 shadow 日志构造器必须移除该字段或改为 keyed `tenantFingerprint`;禁止生产路径复用 `fingerprintText`。**验收 #10 强化**:断言 `log_json` 内无 `fp_` 无密钥指纹。
- **C2(安全 S10、隐私 P2/P4)— shadow 幂等与去明文。** `shadow_logs` 须新增复合 UNIQUE `(tenantId, conversationId, messageId, decisionVersion)` + 原子 create-if-absent(`BEGIN IMMEDIATE` + `ON CONFLICT DO NOTHING`,承接 `store.ts`);`conversationId`/`messageId` 以全宽 tenant-scoped HMAC 落列(现为明文)。并须显式声明 shadow 幂等仅在**密钥纪元内**成立(密钥轮转如同 TTL 重置幂等),或将 `keyId`/`decisionVersion` 纳入唯一元组。**验收 #9/#10 强化**:并发多实例仅一条(真实并发用例)+ 密钥轮转语义断言 + 磁盘无明文 id。
- **C3(Gateway、运维 O9)— flag 热配置源。** detection/qualification flag 现为纯环境变量(`feature.ts`/`flag-cache.ts` 读 `process.env`),运行中 gateway 无法不重启热改,亦不满足多实例一致。须改为与 §5 allowlist 同等严格的运行时可热加载、多实例一致配置源。**验收 #16 强化**:针对真实 flag 源证明“回滚即停写、无需重新部署”。
- **C4(安全 S8、运维 O7)— allowlist/异步 runner 具体化 + 真实并发测试。** 二者当前**均未实现**;设计须给出 allowlist 具体持久存储与 schema/版本列。**验收 #7/#9/#12/#13 强化**:须为真实跨进程/并发/关停用例(参照 `store-crossproc.test.ts`),不得为单进程桩。
- **C5(隐私 P5)— 缺失密钥契约级 fail-closed。** “不写 shadow、不降级”须由 key provider 契约保证:缺失时**必须抛错**(绝不返回空 secret)。**验收 #11 强化**:覆盖**缺失**用例(不仅过期)。
- **C6(四项 · 行号漂移,建议但要求刷新)。** 设计/清单锚点因 main 推进漂移,须刷新到 `968b4b7`:`chat.ts` dispatch `:2615/:3824`→`:2636/:3950`、`platformUserId` `:3793-3799`→ 实际 `2595/3921`(原引用指向无关的附件错误代码);`acl.ts` `:8`→`:25`、`:100`→`:93`;`message_received` `:197-227`→`:207-227`;`context.ts:82`→`gateway/knowledge/context.ts:81`;`templating.ts:15`→`:14`。语义均已亲验一致。
- **C7(运维 O10)— P2.5 专属告警。** `p2-ops-runbook.md` 为 Activation 阶段导向,未给出 P2.5 的告警渠道/责任人/升级阶梯;须为 shadow-only 阶段补充独立告警规范(或在 runbook 新增 P2.5 小节),与 Activation force-off 区分。

#### 4.1.1 整改状态(实施 owner 整改 · 独立 reviewer 复核确认)

实施 owner `kiro-conversation-task-runtime` 于 #707 在**设计层**逐条整改 C1–C7(闭合处见 `./p2-5-production-integration.md` §11)。独立 reviewer 于 2026-08-25 对照修订设计 + 真实代码(基线 `1e948ebf70`)逐条复核确认:

| 条件 | 设计闭合处                                  | reviewer 复核结论                                                                                       |
| ---- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| C1   | 设计 §3.1 + §6                              | **CLOSED** — 强制移除/改 keyed 指纹、禁 `fingerprintText` 入 `log_json`;#10 断言无 `fp_`                |
| C2   | 设计 §3.2 + §3.3(`keyId` 纪元)              | **CLOSED** — 复合 UNIQUE(HMAC 列 + `key_id`)+ 原子 create-if-absent + 纪元/TTL 语义入元组;#9 强化       |
| C3   | 设计 §2(flag 改用 §5 同源持久热配置)        | **CLOSED** — flag 脱离纯 env,改 §5 同源持久热加载多实例源;#16 针对真实配置源                            |
| C4   | 设计 §5(持久 schema + 版本 CAS)+ §4         | **CLOSED(设计规定 + 验收强制)** — allowlist 具体 schema + 版本化 CAS;runner 合同;#7/#9/#12/#13 真实并发 |
| C5   | 设计 §6(`TenantHmacKeyProvider` 缺失必抛错) | **CLOSED** — 缺失必抛错、不返回空 secret、不降级;#11 覆盖缺失(非仅过期)                                 |
| C6   | 设计全文符号化锚点 + 校准 + 约定说明        | **CLOSED** — 锚点符号化 + 符号优先约定;§1 校准已亲验;残留 `replay.ts≈:75` vs 实际 `:44` 属非阻断提示    |
| C7   | 设计 §7.4(P2.5 独立告警表 + 唯一自动响应链) | **CLOSED** — 独立 P2.5 告警表 + 唯一自动响应链,区别于 activation force-off                              |

> **治理:C1–C7 均由独立 reviewer(≠ 实施 owner)复核确认 CLOSED。** C2/C3/C4 属“设计已充分规定 + 强化验收在编码门禁强制执行”一类:设计层条件解除,实施与真实测试须在获书面 P2.5 编码准入后落地并由验收(#7/#9/#10/#11/#12/#13/#16)强制。**四项 CONDITIONAL 全部解除。**

## 5. 书面 P2.5 编码准入申请

> **当前状态: APPROVED WITH CONDITIONS(有条件批准 · 仅 shadow-only 接线)。** 见 §5.1 书面准入决定。**本批准仅解锁 §1 shadow-only 接线实现;生产灰度/cutover/activation 属另一轮独立生产发布审批,`production rollout = NOT APPROVED`。**

面向专家/审批人的申请(门禁 1–3 已满足):

- 申请事项:批准**仅 shadow-only** 的 gateway 接线实现(§1 范围),接受 §2 全部验收测试要求作为合并门槛。
- 明确不申请:activation/projection/authorization 开启、正式任务创建、Ledger、Agent/Mission、通知/副作用、生产灰度或 cutover(这些属独立的生产发布审批,`production rollout = NOT APPROVED`)。
- 附带材料:`./p2-5-production-integration.md`(设计)、本准入包、四项评审签署。
- 批准记录要求:审批人身份、日期、批准范围(shadow-only)、附加条件。

### 5.1 书面 P2.5 编码准入决定(authority 记录)

- **审批人(authority)**:`kiro-p2-5-authority`（**≠ 实施 owner `kiro-conversation-task-runtime`，≠ 任一评审 `kiro-*-reviewer`**）。
- **日期**:2026-08-25。
- **决定**:**APPROVED WITH CONDITIONS（有条件批准）**。
- **批准范围（仅此）**:在 `dispatchReplyFromConfig` 单点接入**被动、fire-and-forget、自带 try/catch、有界队列**的 shadow runner;`detection`/`qualification` 在内部 allowlist 下纯计算 + 写 tenant-HMAC 影子日志(§3)+ 发射有界指标(§4);新增服务端持久 allowlist 读取与 flag 热配置源读取(§2/§5)。运行链在 §1.1 `stop` 结束。

**独立核验依据（authority 亲验,基线 `origin/main = f3a64952dc`）**：

1. **评审独立性成立**:`#701`(CONDITIONAL ×4)、`#715`(C1–C7 CLOSED)提交 trailer `Agent: kiro-gateway-reviewer`(≠ 实施者);`#707`(设计整改)`Agent: kiro-conversation-task-runtime`(实施者)。闭合确认由评审方作出,非实施者自证。
2. **C1–C7 底层问题真实且设计已规定修复**:亲验 `replay.ts` `inputFingerprint = fingerprintText(...)`(无密钥)、`shadow.ts` 明文 `conversation_id`/`message_id` 且无复合 UNIQUE、`feature.ts` 纯 env flag、`TenantHmacKeyProvider` 非可选返回——问题属实;设计 §3.1/§3.2/§3.3/§6/§2 分别规定 keyed `tenantFingerprint`、复合 UNIQUE(HMAC 列 + `keyId`)+ 原子 create-if-absent、缺 key 必抛错、flag 改热配置源。
3. **范围红线明确**:§0/§1.1 不进 Activation、不 `openTaskStore`、不写 Ledger、不启 Agent、不改 `chat.send`;§2 `activation`/`projection`/`authorization` 全 OFF;§6 无明文 id/无无密钥指纹;§7.4 P2.5 独立告警链(区别于 activation force-off)。
4. **验收充分且可强制**:§2 的 19 项 + §4.1 强化(#7/#9/#10/#11/#12/#13/#16)可在编码门禁强制 C2/C3/C4(“设计规定 + 验收强制”型闭合)。
5. **现状安全**:`origin/main` 上 `src/conversation-task` 目录外零引用(greenfield);`src/config`/`src/gateway` 无 `conversationTask` 接线;未开 flag、未部署。

**附加条件(合并前必须全部满足,缺一不得合并接线)**：

- **AC1 合并门槛**:§2 全部 19 项 + §4.1 强化验收(#7/#9/#10/#11/#12/#13/#16)必须**通过**;任一红线违反或用例失败即不得合并。
- **AC2 严格 shadow-only**:仅 §1 范围;`activation`/`projection`/`authorization` 保持 OFF;**禁止** `runActivationGate`、`openTaskStore`、Candidate/Task 写入、Progress Ledger、Agent/Mission、通知/外部副作用、改 `chat.send` 内容/时序/错误语义、UI 宣称任务已激活。
- **AC3 C1/C5 隐私**:生产 shadow **不得**持久化无密钥 `fingerprintText`/明文 id;`TenantHmacKeyProvider` 缺失密钥必抛错,缺失(非仅过期)=不写不降级(验收 #10/#11 断言)。
- **AC4 C2 幂等/去明文**:复合 UNIQUE `(conv_hmac, msg_hmac, decision_version, key_id)` + 原子 create-if-absent;`conversationId`/`messageId` 以全宽 tenant-scoped HMAC 落列;密钥纪元/TTL 重置语义显式断言(验收 #9,须真实并发/跨进程,非桩)。
- **AC5 C3/C4 配置源与异步合同**:detection/qualification flag 与 allowlist 同源(服务端持久、热加载、多实例一致,非纯 env);allowlist 持久 schema + 版本化 CAS;异步 runner 单例 + 单连接 + 有界队列 + 唯一 drop + 单项超时 + 有界 shutdown drain(验收 #7/#12/#13/#16,须真实用例)。
- **AC6 独立再评审**:实现须由实施 owner 在**新分支**随附上述验收测试提交,并经**独立 reviewer(≠ 实施者)**评审通过后方可合入 `main`;实施者不得自记为通过。
- **AC7 不在本次授权内**:生产灰度、cutover、开启 activation、进入 P3 —— 需**另一轮独立生产发布审批**(`production rollout = NOT APPROVED` 维持)。
- **AC8 文档小项(非阻断)**:实施者应将设计文档自身状态标签由 `PENDING RE-REVIEW` 更新为 re-review-confirmed,并校准 §3.1 `replay.ts` `fingerprintText` 锚点(标注 ≈:75、实际 :44;符号优先约定已覆盖,不阻断)。

> **理由摘要**:设计范围紧、红线明确、C1–C7 已在设计层由独立评审确认闭合且底层问题经 authority 亲验属实、验收可在编码门禁强制、模块 greenfield 未接线未开 flag。真实代码修复尚未编写,故批准为**有条件**——批准的是“开始 shadow-only 接线”的门禁,实际合并仍以强化验收 + 独立再评审为准。此非生产发布批准。

## 6. 声明

- 本轮仅设计 + 评审申请;`production integration = NOT IMPLEMENTED`,`production rollout = NOT APPROVED`。
- 未获 §4 四项独立评审 + §5 书面 P2.5 编码准入,不改 gateway/config/channels/ui/deploy,不开 flag,不部署,不进入 P3。
- 合入主干 ≠ 已上线 ≠ activation 批准。
