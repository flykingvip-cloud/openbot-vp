# ConversationTask Runtime — P2 安全评审

> Owner(实施): `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 关联: `./p2-prereview.md`(§3–§7)、`./execution-plan.md`(§15/§16)、`../task-progress-ledger/design.md`(Ledger invariants I1–I8)、`./p0-p1-acceptance.md`、`./p2-admission-package.md`、`./p2-design-freeze.md`
> 状态: **实施团队自评 = 完成;独立安全评审 = 已签署(条件通过),reviewer id = `kiro-security-reviewer`(≠ 实施 agent)。本文仅为设计 / 验收材料,不实现 Activation runtime,未开任何 flag。**

## 0. 治理说明

- 本文 §1–§7 含两层:**实施团队自评** 由实施 agent `kiro-conversation-task-runtime` 提出;**独立安全评审** 由独立 reviewer `kiro-security-reviewer` 逐项裁定。
- 独立 reviewer 身份:`kiro-security-reviewer`(id ≠ `kiro-conversation-task-runtime`),已在 Loom 登记可追踪 reviewer session `kiro-security-reviewer-p2-20260824`(角色 reviewer,**非 owner / 非 lander**)。
- 前置条件类别:**〔A〕= P2 编码前必须冻结的设计**;**〔B〕= P2 合并或开 `activation` flag 前必须实现并验证**。
- P2 范围:仅 Activation Gate + Task store + 个人 ConversationTask;**不接 Progress Ledger、不产生真实副作用、不实施 Mission;`authorization` flag 持续 OFF**。故 **S3、S5(授权/防重放)属 P5**,在 P2 只做设计冻结。

## 1. S1 — tenant / employee / conversation ACL 接线

- **实施团队自评裁定**:三处接线且 fail-closed:tenant `src/gateway/tenant-context.ts`、conversation `src/gateway/server-methods/chat.ts` 会话 ACL(读写同源,detection 仅取本会话可见消息)、employee/workbench `src/gateway/employee-workbench-scope.ts`;`ConversationTask.ownerId` ≠ 外部授权主体。
- 前置条件:〔A〕三处 ACL 接线设计冻结;〔B〕跨会话/跨租户 fail-closed 隔离测试。
- **独立安全评审裁定(kiro-security-reviewer · 2026-08-24)**:**条件通过**。**确认 tenant fail-closed**(缺 tenant 上下文即拒)。附加条件:detection 输入须在 ACL 之后做**二次范围校验**(纵深防御),防止上游绕过。

## 2. S2 — Candidate / Task / log 的 tenant 分区

- **实施团队自评裁定**:Candidate/Task/shadow 日志按 `tenantId` 分区(参照 `src/gateway/tenant-store-paths.ts`);禁跨租户默认路径;缺 tenant 即 fail-closed。
- 前置条件:〔A〕Tenant 分区模型冻结(见 `./p2-design-freeze.md` A2);〔B〕分区隔离探针 + 「缺 tenant⇒拒绝」测试。
- **独立安全评审裁定(kiro-security-reviewer · 2026-08-24)**:**条件通过**。确认按租户分区。附加条件:分区键必须含 `tenantId`,存储路径**不得由用户输入直接拼接**(防路径穿越 / 注入);租户标识须来自可信上下文。

## 3. S3 — Authorization fail-closed(属 P5,P2 只冻结设计)

- **实施团队自评裁定**:`resolveAuthorization` fail-closed 已在 P1 以纯函数 + CT7 固定;激活 ≠ 授权;**P2 不产生真实副作用、`authorization` flag 持续 OFF**,运行期授权校验在 **P5** 落地。
- 前置条件:〔A〕副作用分类与授权状态机设计冻结;〔B〕(P5)副作用执行前必过授权的集成测试;`authorization` off 时零副作用。
- **独立安全评审裁定(kiro-security-reviewer · 2026-08-24)**:**条件通过**。**确认 authorization 延后至 P5**:P2 期间 `authorization` flag 持续 OFF,不得产生任何真实副作用;设计层 fail-closed 已由 CT7 固定。

## 4. S4 — 未知副作用默认 human gate(属 P5,P2 只冻结设计)

- **实施团队自评裁定**:副作用分类「保守 + 默认拒」;未纳入 allowlist 的表述默认 `human_gate_required`,不得默认放行;新增 allowlist 项须安全评审。
- 前置条件:〔A〕分类策略与 allowlist 治理流程冻结;〔B〕(P5)分类对抗集 + 「未知/歧义⇒human gate」测试。
- **独立安全评审裁定(kiro-security-reviewer · 2026-08-24)**:**条件通过**。确认「未知副作用默认 human gate」。附加条件:allowlist 变更须**双人评审 + 审计留痕**,不得由单一实施 agent 自行扩项。

## 5. S5 — 授权实例绑定、nonce、有效期、Revision 后失效(属 P5,P2 只冻结设计)

- **实施团队自评裁定**:授权绑定「side-effect 实例 + 幂等键 + 一次性 nonce + 有效期(≤15 分钟/单次)」;禁跨动作/跨任务复用;Revision(交付物/接收方/范围)后旧授权立即失效需重授;授权状态不入 detection/qualification 输入。
- 前置条件:〔A〕授权令牌/nonce/有效期/失效模型冻结;〔B〕(P5)防重放测试(重放失败/Revision 后失效/超期/nonce 复用失败)。
- **独立安全评审裁定(kiro-security-reviewer · 2026-08-24)**:**条件通过**。确认授权实例绑定 + nonce + 有效期 + Revision 后失效(属 P5)。附加条件:nonce **消费须原子**(防并发重放竞态);有效期以服务端时钟为准,拒绝客户端时钟。

## 6. S6 — 并发激活最终原子方案

- **实施团队自评裁定**:以 ConversationTask 幂等键 `hash(tenantId, conversationId, normalizedGoal, activationEpoch)` 上的**存储层唯一约束 + CAS** 为**唯一权威保证**;串行队列仅优化;并发只成功一个,败者读已存;重复投递命中 Candidate 幂等键不产生重复事件(CT8 离线已验)。
- 前置条件:〔A〕幂等键与唯一约束 schema 冻结(见 `./p2-design-freeze.md` A4);〔B〕CAS 并发压力测试(无重复 active 任务)。
- **独立安全评审裁定(kiro-security-reviewer · 2026-08-24)**:**条件通过**。**确认 CAS 唯一约束为唯一权威**:唯一约束必须在**存储层强制**(非仅应用层串行);串行队列只作性能优化。附加条件:并发 fuzz 测试并发度 **N ≥ 100** 且断言零重复 active 任务;幂等键规范化(normalizedGoal)须确定性且有单测。

## 7. S7 — Conversation 生命周期与删除语义(四态,不默认级联删 append-only Ledger)

- **实施团队自评裁定(四态)**:
  - **archive**:可逆,隐藏出活跃视图,Candidate/Task/Ledger 全部保留;
  - **soft delete**:tombstone + 保留窗口(可恢复);Candidate/Task 软删,**append-only Ledger 不软删/不级联删**,保留为不可变审计;
  - **hard delete**:窗口到期后物理删除**业务投影**;**Ledger 默认不随之硬删**;
  - **tenant purge**:合规级擦除,**唯一**允许物理擦除 append-only Ledger 的路径,须显式授权 + 生成 **purge receipt**(留证)+ 与 Ledger invariants 对齐。
  - 红线:任何路径不得默认级联删 append-only Ledger。P2 不接 Ledger,本项为设计冻结〔A〕,P4 实现。
- 前置条件:〔A〕四态 + tombstone/purge receipt + 审计保留语义冻结并与 `../task-progress-ledger/design.md` invariants 交叉核对(见 `./p2-design-freeze.md` A5);〔B〕(P4)级联软删/硬删/purge 用例 + 「删除后无悬挂业务投影」探针 + purge receipt 审计留存测试。
- **独立安全评审裁定(kiro-security-reviewer · 2026-08-24)**:**条件通过**。**确认 Ledger purge 语义**:archive/soft/hard/tenant purge 四态分离,**任何默认路径不得级联物理删除 append-only Progress Ledger**,仅 tenant purge 经显式授权擦除并留 purge receipt,且须与 Ledger invariants(事件不可变、append-only、replan 不改历史)对齐。附加条件:①purge receipt 须**防篡改(tamper-evident,如签名/哈希链)**,保留期**长于**被擦除数据;②tenant purge 须**双人授权 + 审计**;③soft delete 保留窗口内的可恢复副本须同样受 tenant ACL 保护。

## 8. 结论与签署

实施团队自评签署:

- reviewer id:**kiro-conversation-task-runtime(实施团队自评,非独立评审)**
- 日期:**2026-08-24**
- 自评结论:**条件通过(建议)**

独立安全评审签署:

- reviewer id(≠ 实施 agent):**kiro-security-reviewer**(Loom reviewer session `kiro-security-reviewer-p2-20260824`,角色 reviewer,非 owner/lander)
- 日期:**2026-08-24**
- 逐项 decision:**S1 条件通过 · S2 条件通过 · S3 条件通过 · S4 条件通过 · S5 条件通过 · S6 条件通过 · S7 条件通过**
- 明确确认:**tenant fail-closed(S1)· CAS 唯一约束为唯一权威且存储层强制(S6)· authorization 延后至 P5、P2 期间 flag OFF 且零副作用(S3/S5)· Ledger purge 语义:不默认级联删 append-only Ledger、仅 tenant purge 显式擦除并留 tamper-evident receipt(S7)**
- 结论:**条件通过**
- 附加条件(须并入准入包 §4.A/§4.B):S1 detection 二次范围校验;S2 分区键含 tenantId + 防路径穿越;S4 allowlist 双人评审+审计;S5 nonce 原子消费 + 服务端时钟;S6 唯一约束存储层强制 + N≥100 并发 fuzz;S7 purge receipt 防篡改+保留更久 + tenant purge 双人授权。
- 透明性说明:本独立安全评审由 Loom 登记的独立 reviewer 会话 `kiro-security-reviewer` 履行,身份区别于实施 owner,不接管 owner、不作为 lander。

> 安全放行 ≠ P2 批准;P2 进入仍需专家最终书面批准。本轮仅更新设计/验收材料,未改 runtime、未开 flag。

## 9. A1 / A4 复核(独立安全 reviewer,应专家要求)

> 复核对象:`./p2-design-freeze.md` 修订后的 A1(权威存储)与 A4(幂等/唯一约束)。reviewer 身份同 §8(`kiro-security-reviewer`,Loom session `kiro-security-reviewer-p2-20260824`,角色 reviewer,非 owner/lander;无新增 session)。仅评审设计,不实现 runtime。

- **存储原子性**:**确认**。后端确定为 `node:sqlite`,以**表级复合列 UNIQUE 约束 + OS 文件锁**提供跨进程唯一性,`BEGIN IMMEDIATE ... INSERT ... ON CONFLICT DO NOTHING ... COMMIT` 为 create-if-absent 原子边界;WAL + `busy_timeout=5000` + 原子提交给出 crash recovery / 无部分行 / 并发写者互斥语义。**确认 CAS 可冻结**(SQLite 提供可证明的跨进程唯一约束,非 JSONL)。附加条件:①`journal_mode=WAL`、`synchronous` 不低于 `NORMAL`、`busy_timeout` 须在打开时强制设定并有 PRAGMA 生效自检;②crash 注入测试(事务中途 kill → 重开无部分行)列入 §4.B。
- **碰撞处理**:**确认**。唯一真实性依据为**复合列 UNIQUE**,hash 仅派生 `candidate_id`/`task_key`;SHA-256 + 长度前缀 canonical serialization(单射);**命中 hash 后必须核对完整 tuple**。附加条件:①hash collision 与 normalizedGoal collision 测试为**准入必需项**(不得跳过);②normalizedGoal 的语义区分测试须覆盖否定词/数字/实体/关键标点/范围;③`activation_epoch` 十进制规范化须有单测(防 `01` vs `1` 之类歧义)。
- **tenant 隔离**:**确认**。每租户一个 DB 文件、路径派生自可信上下文且禁用户输入拼接、缺 `tenantId` fail-closed;跨租户不可读。附加条件:①`sanitize(tenantId)` 冲突风险须评估(不同 tenantId 经 sanitize 后不得映射到同一文件名——建议保留原值哈希后缀消歧);②路径穿越测试(恶意 conversationId/goal)列入 §4.B。

逐项 decision:**A1 存储原子性 条件通过 · A4 碰撞处理 条件通过 · tenant 隔离 条件通过**。

- reviewer id(≠ 实施 agent):**kiro-security-reviewer**
- 日期:**2026-08-24**
- 结论:**条件通过**(附加条件并入准入包 §4.B / §4.A)
- 透明性说明:本 A1/A4 复核由 Loom 登记的独立 reviewer 会话 `kiro-security-reviewer` 履行,身份区别于实施 owner,不接管 owner、不作为 lander。

## 10. 派生 ID/碰撞合同 与 tenant/personal 复核(独立安全 reviewer,应专家要求)

> 复核对象:`./p2-design-freeze.md` 本轮修订的两处矛盾修复——(1) 派生 ID 与碰撞合同、(2) tenant/personal。reviewer 身份同 §8/§9(`kiro-security-reviewer`,Loom session `kiro-security-reviewer-p2-20260824`,角色 reviewer,非 owner/lander;**本轮无新增 session**)。仅评审设计,不实现 runtime。

### 10.1 派生 ID 与碰撞合同 = 单一方案 A

- **复核结论:确认 · 条件通过。**
- 确认设计已**二选一采用方案 A,且不与方案 B 混用**:
  - 内部 `INTEGER PRIMARY KEY`(rowid)为**不可碰撞行主键**,承担行身份与外键引用目标;
  - `candidate_id`/`task_key`(SHA-256 派生)**降为普通非唯一索引**,不设 UNIQUE、不作主键;
  - **复合列 UNIQUE 为唯一业务真实性依据**;
  - 外键(`task_revisions.task_row_id`)引用**内部行主键**;
  - 命中 hash 后**必须核对完整 tuple**;
  - **hash 相同、tuple 不同 ⇒ 两行各自存储/读取,不合并、不 fail-closed、不报 invariant violation**(这是方案 A 下 hash 非唯一的正确行为)。
- **确认前一版矛盾已消除**:旧版「`candidate_id TEXT PRIMARY KEY`(hash 作主键)」与「碰撞后仍允许各自存储」并存是自相矛盾的(hash 作 PK 时碰撞必违反 PK、无法共存);本版已移除 hash 作主键的表述,改为内部 INTEGER 行主键,矛盾消除。文档中**未残留方案 B 语言**(未出现「hash 作实体主键 + 碰撞 fail-closed + invariant violation」)。
- 附加条件(并入准入包 §4.B):①**碰撞共存测试为准入必需项**——构造 `candidate_id`/`task_key` 相同但复合 tuple 不同的两行,断言:两行均写入成功(唯一约束不被 hash 触发)、按复合 tuple 各自可读、tuple 核对不误合并;②`serialize` 单射性单测;③外键指向内部行主键而非 hash 列(schema 机检)。

### 10.2 tenant / personal 矛盾修复 = 移除 personal fallback(tenant-only)

- **复核结论:确认 · 条件通过。**
- 确认 P2 存储**仅 tenant 分区,已移除 personal fallback**:
  - **不提供** `personal/<ownerId>.db` 路径,不存在按 `ownerId` 派生的存储分区;
  - 所有 ConversationTask **必须携带可信 `tenantId`**;**缺 `tenantId` ⇒ fail-closed**(拒绝打开/读写);
  - `tenantId` 与 `ownerId` **不得互相回退或混用**;`requesterId`/`ownerId` 仅为租户内任务归属属性,不参与存储分区键。
- 确认**个人域已明确另行单独冻结**(不属于 P2):若未来支持须定义 `isolationDomain = tenant | personal`、personal `ownerId` 可信来源、路径/ACL/唯一键/跨域拒绝规则,且严禁 `tenantId`↔`ownerId` 回退混用。
- ~~文件名注入式消歧:`fileKey = sanitize + sha256Hex(tenantId)[:16]`~~ **【已被 §11 取代】**:截断哈希后缀**不构成单射证明**,不接受作为隔离依据。最终文件键合同见 **§11**(完整 SHA-256 + `meta.tenant_id` 打开核对,mismatch fail-closed)。
- 附加条件(并入准入包 §4.B):①「缺 `tenantId` ⇒ 拒绝」用例;②跨租户探针不可读他租户 DB;③文件键 / 路径碰撞 / 文件错配 / 篡改测试**以 §11 为准**(canonical tenant key、`meta.tenant_id` mismatch 拒绝、路径碰撞注入、跨租户文件替换/错配);④路径穿越测试(恶意 `conversationId`/`goal`/`tenantId`)。

### 10.3 逐项 decision 与签署

- 逐项 decision:**(1) 派生 ID/碰撞合同 = 方案 A:条件通过 · (2) 移除 personal fallback(tenant-only):条件通过**。
- reviewer id(≠ 实施 agent):**kiro-security-reviewer**
- 日期:**2026-08-24**
- 结论:**条件通过**(附加条件并入准入包 §4.B / §4.A)。
- 透明性说明:本复核由 Loom 登记的独立 reviewer 会话 `kiro-security-reviewer` 履行(无新增 session),身份区别于实施 owner,不接管 owner、不作为 lander。

## 11. tenant 文件寻址复核(独立安全 reviewer,应专家要求)

> 复核对象:`./p2-design-freeze.md` 本轮修订的 **tenant 文件键合同**(A1.2 文件键 + 打开协议、A2)。reviewer 身份同 §8/§9/§10(`kiro-security-reviewer`,Loom session `kiro-security-reviewer-p2-20260824`,角色 reviewer,非 owner/lander;**本轮无新增 session**)。仅评审设计,不实现 runtime。**本节取代 §9 中「保留原值哈希后缀消歧」的旧建议**(截断哈希后缀不成立)。

### 11.1 复核结论:确认 · 条件通过(方案 A:完整 SHA-256 + metadata 核对)

- **删除错误表述**:确认已删除「截断 SHA-256(`sha256[:16]`)保证不同 `tenantId` 不映射同一文件」的错误论断——截断哈希只是碰撞概率低,**不是单射证明**;安全上不接受以截断哈希作为隔离依据。
- **文件键冻结**:`fileKey(tenantId) = sha256Hex(utf8(NFC(tenantId)))` = **完整 SHA-256**,不截断、无 sanitize 可读前缀、**不由调用方派生或回退**;纯 hex 不含路径分隔符(天然防穿越)。
- **强制 metadata 核对**:`meta.tenant_id` 保存 canonical `tenantId`,**每次打开必比对**,mismatch ⇒ **fail-closed + 记录隔离违规(`TenantIsolationViolation`)**。**确认:即使完整 SHA-256 也不得仅依赖「碰撞概率极低」**——metadata 核对为强制纵深防御。

### 11.2 路径碰撞 / 文件错配 / 篡改的处理(明确)

- **路径碰撞**(两个 `tenantId` 的 `fileKey` 相同,含哈希碰撞或外部构造):打开时命中已存在库,`meta.tenant_id` 与请求方 canonical `tenantId` 不等 ⇒ **fail-closed**,不读不写,记录隔离违规。**碰撞不会导致跨租户数据串读/串写**。
- **文件错配 / 被替换**(如运维误放、恢复了错误租户的备份到该路径):同理由 `meta.tenant_id` mismatch 拦截 ⇒ fail-closed。
- **篡改**:若 `meta` 行被删除或 `tenant_id` 被改写,则要么 mismatch fail-closed,要么(被改为「全新库」形态)由上层「已存在业务数据但 meta 缺失」不一致检测拦截并 fail-closed(列入 §4.B 测试);任何情况下**不静默接受**。
- **不匹配一律 fail-closed 且记录**,不得降级为告警后继续。

### 11.3 逐项 decision 与签署

- 逐项 decision:**路径碰撞处理 条件通过 · 文件错配处理 条件通过 · 篡改处理 条件通过 · 文件键=完整 SHA-256 + metadata 核对 条件通过**。
- 附加条件(并入准入包 §4.B,替换旧 B9):①canonical tenant key 测试(NFC/UTF-8 稳定 + `fileKey` 确定性);②`meta.tenant_id` mismatch 拒绝测试;③路径碰撞注入测试(构造同 `fileKey` 不同 `tenantId`);④跨租户文件替换/错配测试(把 B 租户库放到 A 路径 ⇒ fail-closed);⑤`meta` 缺失/被篡改而业务表非空 ⇒ fail-closed 的一致性测试;⑥隔离违规须落审计日志(不含明文敏感值)。
- reviewer id(≠ 实施 agent):**kiro-security-reviewer**
- 日期:**2026-08-24**
- 结论:**条件通过**(附加条件并入准入包 §4.B)。
- 透明性说明:本复核由 Loom 登记的独立 reviewer 会话 `kiro-security-reviewer` 履行(无新增 session),身份区别于实施 owner,不接管 owner、不作为 lander。
