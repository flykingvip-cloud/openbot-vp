# ConversationTask Runtime — §4.A 设计冻结(A1–A5)

> Owner(实施): `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 关联: `./p2-admission-package.md`(§4.A)、`./p2-ops-review.md`、`./p2-security-review.md`、`./execution-plan.md`(§7/§8/§9/§15)、`../task-progress-ledger/design.md`(Ledger invariants I1–I8)、`src/conversation-task/types.ts`(P0 冻结合同)
> 存储既有实践依据(仅参考,不改动):`src/gateway/knowledge/kb-index.ts`、`src/gateway/knowledge/kb-index-schema.ts`、`src/memory/sqlite.ts`(`requireNodeSqlite`)。
> 状态: **§4.A 设计冻结,仅冻结「设计 + 验收合同」,不含任何 runtime 实现。** 本版按专家反馈修复矛盾:①派生 ID/碰撞合同采用**单一方案 A**;②存储**tenant-only、移除 personal fallback**;③tenant 文件键=**完整 SHA-256 + `meta.tenant_id` 打开核对(mismatch fail-closed)**,删除上一版「截断 SHA-256 保证注入」的错误表述。经独立安全 reviewer 复核(`./p2-security-review.md` §9、§10、§11)。待专家书面 P2 编码准入。

## 0. 约束

- 本文只描述 P2 将要实现的**设计与验收合同**;`src/conversation-task/` 现有代码仍为 P0/P1 离线/影子,**未新增任何 store/activation/runtime 代码**。
- P2 范围:仅 Activation Gate + Task store + 个人 ConversationTask;不接 Progress Ledger、不产生真实副作用、不实施 Mission;`authorization`/`projection` flag 持续 OFF。
- 下列 SQL / TypeScript 片段是**设计契约(illustrative,非实现)**。

## A1 — 权威存储方案(node:sqlite,可证明跨进程唯一约束)

### A1.1 存储后端(冻结)

- **后端 = Node 内置 `node:sqlite`(`DatabaseSync`)**,经仓库封装 `src/memory/sqlite.ts` 的 `requireNodeSqlite()` 打开,与 `src/gateway/knowledge/kb-index.ts` 同一既有实践。
- **选择理由**:SQLite 以**表级 UNIQUE 约束 + OS 文件锁**在多进程/多 worker 间强制唯一,并以 `INSERT ... ON CONFLICT DO NOTHING` 提供原子 create-if-absent。**JSONL / 追加文件无法提供跨进程唯一约束,故不作权威写入**(仅可作导出/审计快照)。因 SQLite 可证明跨进程唯一约束,**CAS 得以冻结**(A1.3)。

### A1.2 分区与文件结构(冻结 · tenant-only,无 personal fallback)

- **仅 tenant 分区,每租户一个 DB 文件**:
  - `<root>/conversation-task/tenant/<fileKey(tenantId)>.db`
  - **移除 personal fallback**:P2 **不提供** `personal/<ownerId>.db` 路径;不存在按 `ownerId` 派生的存储分区。
  - **缺可信 `tenantId` ⇒ fail-closed**(拒绝打开/读写);`tenantId` 与 `ownerId` **不得互相回退或混用**(`ownerId` 只是任务归属属性,不参与存储分区)。
- **文件键合同(冻结 · 方案 A:完整 SHA-256 + metadata 核对)**:
  - `canonicalTenantBytes(tenantId) = utf8(NFC(tenantId))`(固定规范化);`fileKey(tenantId) = sha256Hex(canonicalTenantBytes(tenantId))`,即**完整 64 位十六进制 SHA-256**;**不截断**、**不含 sanitize 人类可读前缀**、**不由调用方自行派生或回退**。文件名不携带任何来自 `tenantId` 的可读片段;`fileKey` 为纯 hex,天然不含路径分隔符。
  - **纠错(删除错误表述)**:上一版 `sanitize(tenantId) + "." + sha256Hex(tenantId).slice(0,16)` 声称「**截断 SHA-256 保证**不同 `tenantId` 不映射到同一文件」是**错误的**——截断哈希只是碰撞概率低,**不是单射证明**;本版删除该「截断保证注入」表述。
  - **DB 内 `meta` 表保存原始(canonical)`tenantId`**;**每次打开必须比对** `meta.tenant_id` 与请求的 canonical `tenantId`,**不匹配立即 fail-closed 并记录隔离违规(`TenantIsolationViolation`)**,拒绝任何读写。**即使采用完整 SHA-256,也不得仅依赖「密码学碰撞概率极低」**——metadata 核对是**强制纵深防御**,覆盖哈希碰撞、文件错配、被替换/被篡改。
  - `root` 取自可信配置目录,**不得由用户输入拼接**(防路径穿越)。
- **打开时 PRAGMA(冻结)**:`journal_mode=WAL`、`synchronous=NORMAL`、`busy_timeout=5000`、`foreign_keys=ON`。
- **表结构(设计契约 · 方案 A)**:`meta` 表存 canonical `tenantId`(打开核对);内部 `INTEGER PRIMARY KEY`(rowid)为**不可碰撞行主键**;`candidate_id`/`task_key`(hash 派生)为**普通非唯一索引**;**复合列 UNIQUE 为业务唯一真实性依据**;外键引用**内部行主键**。

```sql
-- 租户身份 metadata:每次打开必比对,mismatch ⇒ fail-closed + 记录隔离违规
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,          -- 'tenant_id' | 'schema_version'
  value TEXT NOT NULL
);
-- 首次创建:在同一初始化事务内写入 meta('tenant_id', <canonical tenantId>)

CREATE TABLE IF NOT EXISTS candidates (
  id                INTEGER PRIMARY KEY,        -- 内部不可碰撞行主键(rowid)
  candidate_id      TEXT NOT NULL,              -- hash 派生;普通索引,不设 UNIQUE
  tenant_id         TEXT NOT NULL,
  conversation_id   TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  decision_version  TEXT NOT NULL,
  status            TEXT NOT NULL,              -- observing | discarded | classified
  payload           TEXT NOT NULL,              -- 脱敏判定快照(JSON;不落原文)
  created_at_ms     INTEGER NOT NULL,
  expires_at_ms     INTEGER NOT NULL,
  UNIQUE (tenant_id, conversation_id, source_message_id, decision_version)  -- 业务唯一真实性依据
);
CREATE INDEX IF NOT EXISTS idx_candidates_cid ON candidates(candidate_id); -- 普通(可非唯一)索引

CREATE TABLE IF NOT EXISTS conversation_tasks (
  id               INTEGER PRIMARY KEY,         -- 内部不可碰撞行主键(rowid)
  task_key         TEXT NOT NULL,               -- hash 派生;普通索引,不设 UNIQUE
  tenant_id        TEXT NOT NULL,
  conversation_id  TEXT NOT NULL,
  normalized_goal  TEXT NOT NULL,
  goal             TEXT NOT NULL,
  activation_epoch INTEGER NOT NULL,
  lifecycle        TEXT NOT NULL,               -- draft | active | closed | cancelled
  requester_id     TEXT NOT NULL,               -- 租户内任务归属,非存储分区键
  owner_id         TEXT,                        -- 同上
  created_at_ms    INTEGER NOT NULL,
  updated_at_ms    INTEGER NOT NULL,
  UNIQUE (tenant_id, conversation_id, normalized_goal, activation_epoch)  -- 业务唯一真实性依据
);
CREATE INDEX IF NOT EXISTS idx_tasks_key ON conversation_tasks(task_key); -- 普通(可非唯一)索引

-- P2 预留 schema,但 P2 不写入(见「P2/P3 边界」)
CREATE TABLE IF NOT EXISTS task_revisions (
  id            INTEGER PRIMARY KEY,
  task_row_id   INTEGER NOT NULL REFERENCES conversation_tasks(id) ON DELETE CASCADE, -- 引用内部行主键
  revision      INTEGER NOT NULL,
  field         TEXT NOT NULL,                  -- goal | acceptance | deadline | delivery
  previous_json TEXT,
  next_json     TEXT,
  reason        TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  at_ms         INTEGER NOT NULL,
  UNIQUE (task_row_id, revision)
);
```

- **打开协议(冻结 · tenant metadata 核对)**:打开租户 DB 时,在初始化事务内 `CREATE TABLE IF NOT EXISTS meta ...`;若 `meta` 无 `tenant_id` 行(全新库)则写入请求的 canonical `tenantId`;若已存在,则 `SELECT value FROM meta WHERE key='tenant_id'` 并与请求的 canonical `tenantId` 做**字节相等**校验;不等 ⇒ 抛 `TenantIsolationViolation`、记录隔离违规、**拒绝任何读写**(fail-closed)。此核对是**强制**的,独立于 `fileKey` 的哈希强度。

### A1.3 CAS / create-if-absent 原子边界(冻结)

- **原子边界 = 单条 SQLite 写事务**,`ON CONFLICT` 目标为**复合 UNIQUE 列**(非 hash):

```sql
BEGIN IMMEDIATE;                 -- reserved 锁,跨进程串行化写者
INSERT INTO conversation_tasks (task_key, tenant_id, conversation_id, normalized_goal, goal,
                                activation_epoch, lifecycle, requester_id, owner_id,
                                created_at_ms, updated_at_ms)
VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
ON CONFLICT (tenant_id, conversation_id, normalized_goal, activation_epoch) DO NOTHING;
COMMIT;
-- 胜者:changes()=1;败者:changes()=0 → 按复合列 SELECT 现有行返回
```

- Candidate 同理(`ON CONFLICT (tenant_id, conversation_id, source_message_id, decision_version) DO NOTHING`)。
- 并发激活「只成功一个」(S6)由**复合 UNIQUE 在存储层**强制;应用层串行队列仅可选优化。

### A1.4 crash recovery / 部分写 / 并发 worker(冻结)

- **crash recovery**:WAL 原子提交;未提交事务下次打开自动回滚,**不产生部分行**。
- **部分写**:多语句变更包在 `BEGIN IMMEDIATE ... COMMIT`,失败 `ROLLBACK`(镜像 `kb-index.ts` 事务写法)。
- **并发 worker**:同一租户 DB 可多进程打开;SQLite **写者互斥**、WAL 下读者并发;`busy_timeout=5000` 处理竞争;唯一性/原子性由 SQLite 保证,与哪个 worker 写无关。
- **分区权威写者**:正确性来自复合 UNIQUE + 文件锁,**不依赖**单写者;可选按 `tenantId` 路由激活写到单一进程(性能优化,非正确性前提)。

### A1.5 A1 验收合同

- ①复合 UNIQUE 在存储层生效:并发 create-if-absent(N≥100)零重复 active 任务(S6/B3);
- ②crash 注入(事务中途 kill)重开:无部分行、状态一致(B7);
- ③`StoredConversationTask` 不含执行运行态字段(CT2 机检);
- ④缺可信 `tenantId` ⇒ 打开/读写 fail-closed(无 personal fallback);
- ⑤tenant 文件键合同:canonical tenant key 测试(NFC+UTF-8 稳定、`fileKey` 确定性);`meta.tenant_id` mismatch 拒绝测试(错配/被替换的 DB ⇒ `TenantIsolationViolation` + fail-closed);路径碰撞注入测试;跨租户文件替换/错配测试;路径穿越测试(恶意 `conversationId`/`goal`/`tenantId`)。

## A2 — Tenant 分区模型(tenant-only)

- 冻结:Candidate / ConversationTask / shadow 日志一律**按 `tenantId` 每租户一个 DB 文件**(A1.2);顶层隔离键 `tenantId`;跨租户访问一律拒绝。
- **移除 personal fallback**:P2 不支持个人域存储;所有 ConversationTask **必须携带可信 `tenantId`**;缺失 ⇒ **fail-closed**。`tenantId` 与 `ownerId` **不互相回退/混用**(`requesterId`/`ownerId` 仅为租户内任务归属属性)。
- **个人域(若未来需要)另行单独冻结**,不属于 P2,须定义:`isolationDomain = tenant | personal`、personal `ownerId` 的可信来源、路径/ACL/唯一键/跨域拒绝规则,且严禁 `tenantId`↔`ownerId` 回退混用。
- **文件键合同(冻结 · 方案 A)**:`fileKey(tenantId) = sha256Hex(utf8(NFC(tenantId)))`(完整 SHA-256,不截断/无可读前缀/不由调用方派生);`meta.tenant_id` 打开核对,mismatch ⇒ fail-closed + 隔离违规(见 A1.2 打开协议)。
- 验收合同:缺 tenant ⇒ 拒绝用例;跨租户探针不可读他租户 DB;文件键合同(完整 SHA-256 + `meta.tenant_id` 打开核对 + 碰撞/错配/替换/穿越)(S2/§10/§11)。

## A3 — ACL 接线设计

- 冻结三处接线点(fail-closed):tenant `src/gateway/tenant-context.ts`;conversation `src/gateway/server-methods/chat.ts` 会话 ACL(读写同源,**detection 输入仅取本会话可见消息**,并在 ACL 之后做二次范围校验);employee/workbench `src/gateway/employee-workbench-scope.ts`。
- `ConversationTask.ownerId` ≠ 外部授权主体;Candidate 不扩大 Conversation 可见范围(CT1)。
- 验收合同:跨会话/跨租户 fail-closed 用例;detection 越域被拒用例。

## A4 — 幂等键与唯一约束(方案 A:内部行主键不可碰撞,hash 仅派生普通索引)

> **单一方案(方案 A),不与「hash 作实体主键 + 碰撞 fail-closed」的方案 B 混用。**

### A4.1 唯一性与主键分层(冻结)

- **内部行主键 = SQLite `INTEGER PRIMARY KEY`(rowid)**,不可碰撞,作为行身份与外键引用目标(`task_revisions.task_row_id → conversation_tasks.id`)。
- **业务唯一真实性依据 = 复合列 UNIQUE**(A1.2):
  - Candidate:`UNIQUE (tenant_id, conversation_id, source_message_id, decision_version)`;
  - ConversationTask:`UNIQUE (tenant_id, conversation_id, normalized_goal, activation_epoch)`。
- **`candidate_id`/`task_key`(hash 派生)= 普通非唯一索引字段**,用于紧凑引用/查找,**不承担唯一性**,**不设 UNIQUE**,**不作主键**。

### A4.2 hash 算法与 canonical serialization(冻结)

- **固定算法 = SHA-256**,输入为 tuple 的 **canonical serialization**:key 字段用 NFC,`normalized_goal` 用「normalizedGoal」,`activation_epoch` 用十进制规范字符串(无前导零);**长度前缀单射编码** `frame(f) = uint32BE(utf8ByteLength(f)) || utf8Bytes(f)`,`serialize = frame(f1)||frame(f2)||...`;`candidate_id = "cand_" + hex(SHA-256(...))`,`task_key = "ctask_" + hex(SHA-256(...))`。
- hash 仅为索引/引用派生值。

### A4.3 命中后核对完整 tuple + 碰撞共存(冻结)

- 任何按 `candidate_id`/`task_key`(hash)查找,**命中后必须比对存储行复合列与查询 tuple 完全相等**才视为同一实体。
- **hash 相同但 tuple 不同 ⇒ 两行各自存储、各自读取**(内部 rowid 与复合列区分),**不合并、不 fail-closed、不报 invariant violation**。这是方案 A 的正确行为(hash 非唯一,碰撞是可接受且被正确处理的)。

### A4.4 A4 验收合同

- ①**hash collision 共存测试**:构造/注入 `candidate_id`(或 `task_key`)相同但复合 tuple 不同的两条 → 断言:两行均可写入(唯一约束不被 hash 触发)、按复合 tuple 各自可读、A4.3 完整 tuple 核对不误合并;
- ②**normalizedGoal collision 测试**(见下节);
- ③重复投递(同 messageId)命中 Candidate 复合键,不产生重复候选/事件(CT8);
- ④并发激活 N≥100 fuzz:零重复 active 任务(S6/B3);
- ⑤`serialize` 单射性单测;`activation_epoch` 规范化单测(防 `01` vs `1`)。

## normalizedGoal 规范化(冻结)

- **只做不改变语义的规范化**:Unicode **NFC**;首尾 `trim`;Unicode 空白连续段折叠为**单个 ASCII 空格**。**不做**大小写折叠、全半角转换、词干化、同义词/停用词、标点删除。
- **禁止删除可能改义的内容**:数字、否定词(不/没/别/勿/no/not/never)、实体(人名/群名/ID/账号)、货币/百分号/关键标点一律保留。
- **验收合同**:
  - **确定性**:同输入恒等输出(纯函数,无时钟/locale 依赖);
  - **稳定性(幂等)**:`normalize(normalize(x)) === normalize(x)`;
  - **语义区分**(以下各组必须产生**不同** `normalized_goal` → 不同 `task_key` → 不同复合唯一键):否定「不要发送给全部销售」vs「发送给全部销售」;数字「涨幅超过 10% 预警」vs「涨幅超过 20% 预警」;实体「整理后发给张总」vs「整理后发给李总」;范围「监控华东,不含华南」vs「监控华东华南」;
  - 仅空白/Unicode 形态差异归一为**相同**:「 每周 监控\t竞品 」=「每周 监控 竞品」。

## P2 / P3 边界(冻结)

- **P2 可预留** `task_revisions` 表与 `StoredConversationTask.revisions`(空集合/schema),仅占位。
- **P2 不实现 Revision 写入**:不向 `task_revisions` 插入、不追加 `revisions`。
- **P2 不修改 active 任务的 `goal` / `acceptance` / `delivery`**;P2 仅允许 Activation 一次性创建 + 生命周期迁移(`active → closed | cancelled`)。
- **active-task resolution 与跨回合修改仍属 P3**;改目标/验收/交付留待 P3 Revision 合同(§8)。
- 验收合同(P2):`task_revisions` 恒空、`revisions` 恒 `[]`;对 `goal/acceptance/delivery` 的更新写路径在 P2 不提供。

## A5 — Ledger 删除 / 保留语义(与 Progress Ledger invariants 对齐)

- 冻结四态:**archive**(可逆隐藏,全部保留);**soft delete**(tombstone + 保留窗口,可恢复;Candidate/Task 软删,**append-only Ledger 不软删/不级联删**);**hard delete**(窗口到期删业务投影;**Ledger 默认不随之硬删**);**tenant purge**(合规级擦除,**唯一**允许物理擦除 append-only Ledger,须**显式授权(双人)** + 生成 **purge receipt(tamper-evident,保留期长于被擦除数据)**)。
- 红线:**任何默认路径不得级联删除 append-only Progress Ledger**;须与 `../task-progress-ledger/design.md` invariants(I1–I8)交叉核对。
- 说明:P2 不接 Progress Ledger,本项在 P2 仅**冻结语义**,实现与验证在 **P4**。
- 验收合同(P4):级联软删/硬删/purge 用例;「删除后无悬挂业务投影」探针;purge receipt 防篡改 + 审计留存测试。

## 冻结状态

| 项             | 内容                                                                                                                                            | 冻结人                                     | 日期       | 状态                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------- | ------------------------------ |
| A1             | 权威存储 = node:sqlite;tenant-only;文件键=完整 SHA-256 + meta.tenant_id 打开核对(mismatch fail-closed);跨进程复合 UNIQUE + CAS + crash/并发语义 | kiro-conversation-task-runtime(实施 owner) | 2026-08-24 | 设计冻结 · 安全复核 §9/§10/§11 |
| A2             | Tenant 分区(每租户一 DB;缺 tenant fail-closed;不与 ownerId 回退;文件键完整 SHA-256 + metadata 核对)                                             | 同上                                       | 2026-08-24 | 设计冻结 · 安全复核 §10/§11    |
| A3             | ACL 接线设计                                                                                                                                    | 同上                                       | 2026-08-24 | 设计冻结                       |
| A4             | **方案 A**:内部 INTEGER 行主键(不可碰撞)+ 复合 UNIQUE 业务真实性 + hash 仅普通索引 + 命中核对 tuple + 碰撞共存                                  | 同上                                       | 2026-08-24 | 设计冻结 · 安全复核 §10        |
| normalizedGoal | 语义保持规范化 + 语义区分测试                                                                                                                   | 同上                                       | 2026-08-24 | 设计冻结                       |
| P2/P3 边界     | 预留 revisions、不写 Revision、不改 active goal/acceptance/delivery                                                                             | 同上                                       | 2026-08-24 | 设计冻结                       |
| A5             | Ledger 删除/保留四态语义                                                                                                                        | 同上                                       | 2026-08-24 | 设计冻结                       |

> 本冻结**仅冻结设计 + 验收合同,未编写任何 runtime**。派生 ID/碰撞合同为**单一方案 A**(不与方案 B 混用);存储 **tenant-only、无 personal fallback**;tenant 文件键 = **完整 SHA-256 + `meta.tenant_id` 打开核对**(mismatch fail-closed,不依赖截断哈希/碰撞概率)。A1/A2/A4 已由独立安全 reviewer 复核签署(`./p2-security-review.md` §9/§10/§11)。开始 P2 编码仍需专家书面准入;§4.B 各项在 P2 合并 / 开启 `activation` 前实现并验证。
