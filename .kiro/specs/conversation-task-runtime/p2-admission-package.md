# ConversationTask Runtime — P2 最终准入包

> Owner(实施): `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 关联: `./execution-plan.md`(§16)、`./p0-p1-acceptance.md`、`./p2-prereview.md`、`./p2-ops-review.md`、`./p2-security-review.md`、`./p2-design-freeze.md`、`./loom-ctr-handoff.md`
> 状态(机器可判定,三态分离):
>
> - **`P2 implementation = ACCEPTED`** —— P2 编码准入已获书面批准并实现;首轮(§9,P0×2/P1×4/P2×1)、第二轮(§9.1,P0×2/P1×1/P2×1)、第三轮(§9.2,控制面 fail-open 与重启后人工恢复门禁丢失)、第四轮(§9.3,调用方时间伪造绕过冷却、重开非版本化原子 CAS)独立复验发现**均已逐项整改并独立验收通过**,复跑全绿(**197 模块测试**,原集/盲测 Upgrade Precision 100%)。
> - **`main landing = ACCEPTED`** —— 已经 PR **#680** squash 合并入 `origin/main`(合并提交 **`4ef2a43534`**,2026-08-24);经正常评审(APPROVED)+ 三项必需检查(check types/lint/format、delivery guard、freeze+phase0 evidence)全绿合并,**无 ruleset 绕过、无 force-push**。`origin/main` 现含 `src/conversation-task/**` 43 文件 + `.kiro/specs/conversation-task-runtime/**` 12 文件。**合入主干 ≠ 已上线 ≠ activation 批准。**
> - **`production integration = NOT IMPLEMENTED`** —— 模块在 main,但**未接入生产 gateway**:无 shadow-only 接线、无 tenant allowlist、无观测/告警接入。当前阶段 = **P2.5 生产集成准备**,仅设计/评审(见 `./p2-5-production-integration.md`、`./p2-5-admission-package.md`),未经书面 P2.5 编码准入不得改 `src/gateway`/`src/config`/`src/channels`/`ui`/`deploy`。
> - **`production rollout = NOT APPROVED`** —— `activation`/`projection`/`authorization` flag **持续 OFF**,不接 Progress Ledger、无真实副作用、未接 chat.send、未实施 Mission、未构建、未部署、未 cutover、未开启灰度。未获独立发布审批不进入灰度/部署;未获新书面批准不进入 P3–P7。

## 0. 结论摘要

- P0 / P1:**ACCEPTED**(第二轮专家验收,2026-08-24)。
- 门禁#1(CTR 落地):**完成**。
- 门禁#2(运维评审):**实施团队自评完成 + 独立运维评审已签署(条件通过)**,reviewer `kiro-ops-reviewer`(≠ 实施 agent)。
- 门禁#3(安全评审):**实施团队自评完成 + 独立安全评审已签署(条件通过)**,reviewer `kiro-security-reviewer`(≠ 实施 agent)。
- §4.A 设计冻结:**完成**(`./p2-design-freeze.md`,仅设计 + 验收合同,无 runtime)。
- 修复专家指出的矛盾(仅改设计):**①派生 ID/碰撞合同 = 单一方案 A**(内部 INTEGER 行主键不可碰撞 + hash 仅普通非唯一索引 + 复合 UNIQUE 业务真实性 + 命中核对 tuple + 碰撞共存,**不与方案 B 混用**);**②移除 personal fallback、tenant-only、缺 `tenantId` fail-closed**;**③tenant 文件键 = 完整 SHA-256 + `meta.tenant_id` 打开核对(mismatch fail-closed),删除截断哈希保证注入的错误表述**。经独立安全 reviewer 复核(`./p2-security-review.md` §10、§11)。
- **P2 编码实施:完成且 `implementation = ACCEPTED`,并已合入主干 `main landing = ACCEPTED`**(书面准入后实现,首轮…第四轮复验发现均已整改并独立验收通过;经 PR **#680** 合入 `main`,合并提交 **`4ef2a43534`**;下一步 = P2.5 生产集成准备,`production integration = NOT IMPLEMENTED`)。落地 `src/conversation-task/`:`canonical.ts`、`store.ts`(node:sqlite 每租户 DB + 共享 `openTenantScopedDb` meta 打开协议 + CAS + 生命周期)、`flag-cache.ts`(O1)、`acl.ts`(fail-closed ACL + `assertTenantStoreBinding` + `assertDetectionScope`)、`activation.ts`(Gate + freeze-read-only + 写入前租户绑定/会话范围校验 + 必填控制面)、`control-plane.ts`(**持久+共享**强制关闭控制面,取代仅内存 kill switch)、`shadow.ts`(O4 每租户持久 `.shadow.db` + keyed HMAC + 哈希链凭据 + 过期 key 拒写)、`degrade.ts`(O3 强依赖控制面真正关闭)+ 各 `*.test.ts`(含 `store-crossproc.test.ts` 真实跨进程 CAS/crash/控制面)与 `./p2-ops-runbook.md`。**197 模块测试通过**,tsgo/oxlint/oxfmt 全绿。B1–B9 见 §4.B;专家发现与整改映射见 §9 / §9.1 / §9.2 / §9.3。
- 实施边界:`activation`/`projection`/`authorization` flag **OFF**;不接 Progress Ledger、不产生真实副作用、未接 `chat.send`、未实施 Mission、未部署、未开启灰度。

## 1. P2 范围界定

- **P2 仅实现**:Activation Gate、Task store(`node:sqlite`,**仅 tenant 分区、每租户一 DB 文件、无 personal fallback、缺可信 `tenantId` 即 fail-closed**)、租户内 ConversationTask(`draft/active/closed/cancelled` + 会话绑定;**预留 `revisions` schema 但 P2 不写 Revision、不改 active 任务 goal/acceptance/delivery** —— 见 `./p2-design-freeze.md`「P2/P3 边界」)。
- **P2 不做**:接入 Progress Ledger(P4)、真实副作用 / 发送(P5)、Mission(P7)、Revision 写入与 active-task 跨回合修改(P3)。
- **Flag**:`authorization` 与 `projection` 持续 OFF;`detection`/`qualification` 维持影子;`activation` 仅在 §4.B 全绿 + 独立评审签署 + 专家书面批准后按受控灰度开启。

## 2. 门禁与评审身份

| 门禁        | 材料                                                      | 实施团队自评 | 独立评审(reviewer id ≠ 实施 agent)                 |
| ----------- | --------------------------------------------------------- | ------------ | -------------------------------------------------- |
| #1 CTR 落地 | `.loom/registry.yaml`(kiro-loom)、`./loom-ctr-handoff.md` | —            | 完成(见 §3)                                        |
| #2 运维评审 | `./p2-ops-review.md`(O1–O4)                               | 完成         | **kiro-ops-reviewer · 2026-08-24 · 条件通过**      |
| #3 安全评审 | `./p2-security-review.md`(S1–S7)                          | 完成         | **kiro-security-reviewer · 2026-08-24 · 条件通过** |

- 独立 reviewer 已在 Loom 登记可追踪 reviewer session(`kiro-ops-reviewer-p2-20260824`、`kiro-security-reviewer-p2-20260824`),角色 reviewer,**非 owner / 非 lander**;task owner 仍为 `kiro-conversation-task-runtime`。

## 3. 门禁#1 落地证据

- 提交 SHA:`8115d1b792`(仅 `.loom/registry.yaml`;conversation-task 任务条目 + CTR 流)。
- Trailer:`Task: loom-workspace-orchestrator` / `Agent: kiro-loom`;保留 ownerHistory(`via: verified`)与 sessions。
- 复跑:`loom status` / `loom lint`(无 CTR/conversation-task 问题)/ `agent-attribution`(归属正确)。未使用 `loom import --write`。
- reviewer session 登记随本轮 registry 更新由 kiro-loom 落地(见提交记录)。

## 4. P2 条件(分两类)

### 4.A 开始 P2 编码前必须冻结(设计冻结)—— 状态:完成,见 `./p2-design-freeze.md`

- [x] A1 **权威存储方案 = `node:sqlite`**(**仅 tenant 分区、每租户一 DB 文件、无 personal fallback**;`WAL`+`busy_timeout`;**复合列 UNIQUE 提供跨进程唯一约束**;`BEGIN IMMEDIATE ... INSERT ... ON CONFLICT DO NOTHING ... COMMIT` 为 create-if-absent 原子边界;crash recovery/无部分行/并发写者互斥;分区权威写者)。**因 SQLite 可证明跨进程唯一约束,CAS 已冻结**(不采用 JSONL 作权威写)。**文件键 = 完整 SHA-256 + `meta.tenant_id` 打开核对(mismatch fail-closed),不依赖截断哈希/碰撞概率**。经安全复核(`./p2-security-review.md` §9、§10、§11)。
- [x] A2 Tenant 分区模型(**tenant-only、每租户一 DB 文件、无 personal fallback**;隔离键 `tenantId`;**文件键 = 完整 SHA-256** `fileKey(tenantId)=sha256Hex(utf8(NFC(tenantId)))`(不截断/无可读前缀/不由调用方派生)**+ `meta.tenant_id` 打开核对,mismatch ⇒ fail-closed + 隔离违规**;路径派生自可信上下文且禁用户输入拼接;**缺 `tenantId` fail-closed;`tenantId`/`ownerId` 不互相回退**;个人域另行单独冻结)。经安全复核(§10、§11)。
- [x] A3 ACL 接线设计(tenant / conversation / employee 三处 fail-closed + detection 二次范围校验)。
- [x] A4 幂等/唯一约束(**方案 A 单一方案,不与方案 B 混用**:内部 `INTEGER PRIMARY KEY` 为不可碰撞行主键;`candidate_id`/`task_key` 为普通非唯一索引、不作主键;**复合列 UNIQUE 为唯一业务真实性依据**;外键引用内部行主键;SHA-256 + 长度前缀 canonical serialization;**命中后核对完整 tuple;hash 相同 tuple 不同 ⇒ 各自存储/读取,不合并/不 fail-closed**;含 hash 碰撞共存/normalizedGoal collision 测试要求)。经安全复核(§9、§10)。
- [x] normalizedGoal(仅 Unicode NFC/空白规范化;不删数字/否定词/实体/关键标点;确定性/稳定性/语义区分测试)。
- [x] P2/P3 边界(P2 预留 `revisions` schema、不写 Revision、不改 active goal/acceptance/delivery;active-task resolution 与跨回合修改属 P3)。
- [x] A5 Ledger 删除 / 保留语义(archive/soft/hard/tenant purge 四态 + tombstone/purge receipt,不默认级联删 append-only Ledger,与 Ledger invariants 对齐)。

### 4.B P2 合并或开启 `activation` flag 前必须实现并验证 —— 状态:已实现 + 全绿,待独立复验

> 状态:B1–B9 **已实现 + 单测全绿**(197 模块测试通过,tsgo/oxlint/oxfmt 全绿);首轮复验对 B3/B7 的进程内实现判定不足,已改为**真实子进程**测试(§9);第二轮对自动关闭的持久/共享性与压测收敛证据判定不足,已改为**持久共享控制面** + **attempted/succeeded/failed/created** 断言(§9.1);第三轮对控制面首启 fail-open 与重启后人工恢复门禁判定不足,已改为**新库/缺行/损坏默认 forced-off、完整持久降级状态、重开只经受控 attemptReopen**(§9.2);第四轮对调用方时间伪造与重开非原子判定不足,已改为**服务端时间唯一(公共类型无时间戳)+ 版本化原子 CAS 重开**(§9.3)。`activation`/`projection`/`authorization` flag 仍 **OFF**;实际开启 `activation` 与受控灰度、实时告警渠道接线是**独立门禁步骤**,须在受控环境按运维手册执行。

- [x] B1 fail-safe-off(O1;含读异常三类用例、缓存失效证明)。→ `flag-cache.ts` / `flag-cache.test.ts`。
- [x] B2 跨租户 / 跨会话隔离测试 fail-closed(S1/S2;含路径穿越 + **Activation 写入前 access.tenantId===store.tenantId 绑定 + detection 二次范围校验**)。→ `acl.ts`/`acl.test.ts` + `activation.test.ts`(跨租户/跨会话负向)+ `store.test.ts`(路径穿越 containment)。
- [x] B3 CAS 并发测试(S6;**真实跨进程** ≥100 次写竞争,断言 **attempted≥100、succeeded=attempted、failed=0、created=1**,证明全部并发请求收敛且唯一者创建)。→ `store-crossproc.test.ts`(10 子进程×12=120 真实竞争)+ `__fixtures__/cas-worker.ts`。
- [x] B4 HMAC / TTL / 清理测试(O4;日志不含原文、TTL、硬删、HMAC 轮换、租户级 TTL 下调、break-glass runbook)。→ `shadow.ts`/`shadow.test.ts` + `./p2-ops-runbook.md`。
- [x] B5 freeze-read-only 测试(O2;off 零新任务/事件/通知、on 幂等恢复、冻结任务数指标)。→ `activation.ts`/`activation.test.ts`。
- [x] B6 告警与自动降级演练(O3;滞回/最小间隔、重开人工确认、Reminder RCA;**降级经持久共享控制面真正关闭 activation,重启/多实例保持 OFF**)。→ `degrade.ts`/`control-plane.ts`/`degrade.test.ts`/`control-plane.test.ts` + `./p2-ops-runbook.md` §3.1(单测级演练;生产实时渠道接线为独立步骤)。
- [x] B7 存储 crash 注入测试(A1;**子进程 BEGIN IMMEDIATE 后 SIGKILL** → 重开 WAL 恢复无部分行、已提交行在、状态一致)。→ `store-crossproc.test.ts` + `__fixtures__/crash-worker.ts`。
- [x] B8 碰撞共存测试(A4 准入必需项;**hash collision 共存**——`candidate_id`/`task_key` 相同但复合 tuple 不同的两行均写入成功、按复合 tuple 各自可读、tuple 核对不误合并 + normalizedGoal collision + `serialize` 单射 + `activation_epoch` 规范化)。→ `store.test.ts`(共存)+ `canonical.test.ts`(单射/语义区分/epoch 规范化)。
- [x] B9 tenant 文件寻址(替换旧「注入性」项;A2/§11):**canonical tenant key 测试**(NFC/UTF-8 稳定 + `fileKey` 确定性)+ **`meta.tenant_id` mismatch 拒绝测试**(fail-closed + 隔离违规)+ **路径碰撞/跨租户文件替换/错配测试**(错配库置于目标路径 ⇒ fail-closed)+ `meta` 缺失而业务表非空 ⇒ fail-closed;附 SQLite PRAGMA 生效自检 +「缺 `tenantId`⇒拒绝」用例。→ `store.ts`/`store.test.ts` + `canonical.test.ts`。

> 独立评审附加条件已并入上表(详见 `./p2-ops-review.md` §5、`./p2-security-review.md` §8、A1/A4 复核 §9、派生 ID/碰撞合同=方案 A + tenant-only 复核 §10 与 tenant 文件寻址复核 §11);运维程序见 `./p2-ops-runbook.md`。

## 5. execution-plan §16 P2 准入门禁对照

| §16 条件                                        | 证据 / 材料                                                  | 状态                 |
| ----------------------------------------------- | ------------------------------------------------------------ | -------------------- |
| 1 Candidate/Task/Mission 边界测试+评审          | CT1/CT2/CT11 + `invariants.test.ts`;`p2-design-freeze.md` A1 | 通过                 |
| 2 Qualification/Activation/Authorization 无重叠 | 合同分层(types.ts §5)                                        | 通过                 |
| 3 Reminder/Scheduled/Long-running 回放通过      | 原集 + 盲测(`p0-p1-acceptance.md`)                           | 通过                 |
| 4 Upgrade Precision ≥ 95% 门槛                  | 原集 100% / 盲测 100%(n=166)                                 | 达标                 |
| 5 误升级/重复/改目标/副作用反例                 | 盲测 + CT7/CT8                                               | 通过                 |
| 6 flag/回滚/观测过运维评审                      | `p2-ops-review.md`(kiro-ops-reviewer 条件通过)               | **独立评审条件通过** |
| 7 安全/tenant 隔离/授权边界专项评审             | `p2-security-review.md`(kiro-security-reviewer 条件通过)     | **独立评审条件通过** |

## 6. 离线证据速览(可复现)

- 测试:`OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/conversation-task` → 197 通过(17 文件,含真实子进程 CAS/crash/控制面 + 控制面首启/重启/重开 + 服务端时间不可伪造 + 版本化 CAS 竞态测试)。
- 质量:`pnpm exec oxlint src/conversation-task`(0/0)、`pnpm exec tsgo -p tsconfig.json --noEmit`(模块内 0 错误)。
- 评估:`node --import tsx src/conversation-task/evaluate.ts`(原集 Upgrade Precision 100%)、`.../evaluate-blind.ts`(盲测 n=166,Upgrade Precision 100%)。

## 7. 进入 P2 编码前须满足

1. ✅ **独立运维评审**签署(`kiro-ops-reviewer`,O1–O4 条件通过)。
2. ✅ **独立安全评审**签署(`kiro-security-reviewer`,S1–S7 条件通过)。
3. ✅ **§4.A 设计冻结**完成(`./p2-design-freeze.md`)。
4. ✅ **A1/A4 存储决策细化**(权威后端 = `node:sqlite`,复合列 UNIQUE 提供跨进程唯一约束、CAS 冻结、hash 仅派生 ID)并经**独立安全 reviewer 复核**(`./p2-security-review.md` §9)。
5. ✅ **派生 ID/碰撞合同 = 单一方案 A**(内部 INTEGER 行主键不可碰撞 + hash 仅普通非唯一索引 + 复合 UNIQUE 业务真实性 + 命中核对 tuple + 碰撞共存,不与方案 B 混用)与 **tenant/personal 矛盾修复**(移除 personal fallback、tenant-only、缺 `tenantId` fail-closed),经**独立安全 reviewer 复核**(`./p2-security-review.md` §10)。
6. ✅ **tenant 文件键合同**(完整 SHA-256 `fileKey=sha256Hex(utf8(NFC(tenantId)))` + `meta.tenant_id` 打开核对、mismatch ⇒ fail-closed + 隔离违规;删除截断哈希保证注入的错误表述;路径碰撞/文件错配/篡改一律 fail-closed),经**独立安全 reviewer 复核**(`./p2-security-review.md` §11)。
7. ✅ 专家出具**书面 P2 编码准入**(已授权),接受 §4.B 与独立评审附加条件(§9 A1/A4、§10 派生 ID/碰撞 + tenant-only、§11 tenant 文件寻址)。
8. ✅ **独立复验通过 + 已合入主干**:首轮(§9)、第二轮(§9.1)、第三轮(§9.2)、第四轮(§9.3)复验发现均已逐项整改并**独立验收通过**(197 测试全绿),`P2 implementation = ACCEPTED`;已经 PR **#680** 合入 `main`(合并提交 **`4ef2a43534`**),`main landing = ACCEPTED`。合入主干**不等于**开启 `activation`、**不等于**已上线;下一步 = P2.5 生产集成准备(仅设计/评审),`production integration = NOT IMPLEMENTED`,仍不得灰度或部署,直到独立发布审批(`production rollout = NOT APPROVED`)。

## 8. 红线(未获书面批准前一律禁止)

- 创建正式 ConversationTask;接入 `chat.send`;写入 / 绑定 Progress Ledger;产生真实副作用;
- 开启 `activation` / `projection` / `authorization` flag;部署生产功能;实施 Mission。

> 当前状态(四态分离):**`P2 implementation = ACCEPTED` · `main landing = ACCEPTED` (PR #680, `4ef2a43534`) · `production integration = NOT IMPLEMENTED` · `production rollout = NOT APPROVED`**。已实现并整改首轮(§9)、第二轮(§9.1)、第三轮(§9.2)与第四轮(§9.3)复验发现且独立验收通过,**197 模块测试通过**,tsgo(模块)/oxlint/oxfmt 全绿;模块已合入 `origin/main`。`activation`/`projection`/`authorization` flag **仍 OFF**,不接 Ledger、无真实副作用、未接 `chat.send`、未实施 Mission、未构建、未部署、未开启灰度。**合入主干 ≠ 已上线 ≠ activation 批准;下一步 = P2.5 生产集成准备(仅设计/评审),不得改 gateway、不得开启灰度或部署,直到书面 P2.5 编码准入与独立发布审批。** 未获新书面批准不进入 P3–P7。

## 9. 首轮独立复验发现与整改映射(2026-08-24)

> 首轮独立复验判定 **P2 暂不通过**(禁止开启 activation / 进入 P3 / 生产部署),列出 P0×2、P1×4、P2×1。以下为逐项整改,均已实现 + 全绿;**结论仍为 ACCEPTANCE BLOCKED,等待独立复验**。

| 编号 | 发现                                                                                    | 整改                                                                                                                                                   | 证据                                                                     |
| ---- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| P0-1 | Activation Gate 未绑定 ACL tenant 与 Store tenant,tenant B 上下文可写 tenant A 的 Store | `runActivationGate` 写入前 `assertTenantStoreBinding(access.tenantId===store.tenantId)`(canonical);`TaskStore.tenantId` 公开                           | `activation.ts`、`acl.ts`;`activation.test.ts`(跨租户负向,写入为 0)      |
| P0-2 | detection 二次范围检查未进入激活路径;输入无可信 message 会话身份                        | `ActivationGateInput.messageConversationId`(可信,网关提供);写入前 `assertDetectionScope()`                                                             | `activation.ts`、`acl.ts`;`activation.test.ts`(跨会话拒,写入为 0)        |
| P1-3 | B3 为同进程串行循环,非跨进程并发                                                        | 改为**真实子进程**:10 子进程×12=120 次真实写竞争,恰一 created/active(修复:busy_timeout 先于 journal_mode=WAL)                                          | `store-crossproc.test.ts`、`__fixtures__/cas-worker.ts`                  |
| P1-4 | B7 仅 raw.close() 触发回滚,非真实 crash                                                 | 子进程 `BEGIN IMMEDIATE` + 未提交 INSERT 后 **SIGKILL**;重开验证 WAL 恢复(无部分行 + 已提交在)                                                         | `store-crossproc.test.ts`、`__fixtures__/crash-worker.ts`                |
| P1-5 | 自动降级只改内存状态,未真正关闭 activation                                              | 首轮引入 kill switch;**第二轮**(§9.1 P0-A/P0-B)进一步改为**持久+共享控制面** `ActivationControlPlane`                                                  | `control-plane.ts`、`degrade.ts`、`activation.ts`;测试见 §9.1            |
| P1-6 | Shadow 日志/凭据仅内存;凭据无密钥 SHA-256 可重算;过期 HMAC key 仍可写                   | Shadow 落每租户持久 `.shadow.db`(经 `openTenantScopedDb`);删除凭据改 **HMAC keyed + 哈希链** `verifyShadowReceipt`;**过期 key(>90天)拒写 fail-closed** | `shadow.ts`;`shadow.test.ts`(重开仍在 / 篡改与错密钥验证失败 / 过期拒写) |
| P2-7 | `tasks.md` 顶部与 P2 行自相矛盾,状态不可机器判定                                        | 顶部改为机器可判定状态块;P2 行改为 `IMPLEMENTED / ACCEPTANCE BLOCKED`                                                                                  | `./tasks.md`(顶部横幅 + P2 行)                                           |

- 保留状态:候选实现提交保留;**未验收、未合并为已验收、未开启灰度、未部署**。

## 9.1 第二轮独立复验发现与整改映射(2026-08-24)

> 第二轮判定:上轮 7 项中 **5 项实质通过**(ACL 租户绑定、detection 会话二次校验、SIGKILL/WAL 恢复、Shadow 持久+HMAC+过期拒写、tasks.md 状态),另判 **P0×2 / P1×1 / P2×1** 仍阻断。以下逐项整改,已实现 + 全绿;**结论仍为 ACCEPTANCE BLOCKED,等待复验**。

| 编号     | 发现                                                     | 整改                                                                                                                                                                                                               | 证据                                                                                                                                           |
| -------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-A     | 自动关闭仅单进程内存,重启恢复 ON、多实例不共享           | 新增 **持久 + 共享控制面** `SqliteActivationControlPlane`(单行表,WAL+busy_timeout,跨进程/重启共享;读失败 fail-safe-off=视为 forced off);删除仅内存的 `ActivationKillSwitch`                                        | `control-plane.ts`;`control-plane.test.ts`(重开后仍 OFF / 双实例共享 / fail-safe-off)、`store-crossproc.test.ts`(子进程写、另一进程读同一状态) |
| P0-B     | kill switch 可选、fail-open;Gate 可省略参数绕过          | `ActivationDegradeController` **强依赖** `controlPlane`(缺失构造抛错);`runActivationGate`/`frozenActiveTaskCount` **必填** `controlPlane`,`effectiveActivation = flag && !controlPlane.isForcedOff()`,无法省略绕过 | `degrade.ts`、`activation.ts`;`degrade.test.ts`(缺 controlPlane 构造抛错)、`activation.test.ts`(控制面 forced-off 时冻结)                      |
| P1-C     | 跨进程压测吞掉写错误,只报 created,可能假通过             | worker 上报 `{attempted,succeeded,failed,created}`,断言 **attempted≥100、succeeded=attempted、failed=0、created=1**(证明全部并发请求收敛,唯一者创建)                                                               | `__fixtures__/cas-worker.ts`、`store-crossproc.test.ts`                                                                                        |
| P2-D     | 运维手册称凭据为普通 SHA-256,且未说明 kill switch 仅内存 | 手册更正:删除凭据 = **HMAC keyed + 哈希链**(`verifyShadowReceipt`);新增 §3.1 说明控制面为**持久 SQLite、跨进程/重启共享、读失败 fail-safe-off**、重开须人工流程                                                    | `./p2-ops-runbook.md` §3.1 / §4                                                                                                                |
| 新增测试 | 降级→杀进程/重启→仍 OFF;双进程共享关闭状态               | `degrade.test.ts`(降级 → 持久 forceOff → 新实例读 OFF)、`control-plane.test.ts`(重启/双实例)、`store-crossproc.test.ts`(子进程写→另一进程读 OFF)                                                                   | 同上                                                                                                                                           |

- 复跑(当前):`OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/conversation-task` → **197 通过**(17 文件,含真实子进程 CAS/crash/控制面);`pnpm exec tsgo -p tsconfig.json --noEmit`(模块内 0 错误);`pnpm exec oxlint`/`oxfmt`(0/clean)。
- 保留状态:候选实现提交保留;**未验收、未合并为已验收、未开启灰度、未部署**。

## 9.2 第三轮独立复验发现与整改映射(2026-08-24)

> 第三轮判定:上轮 7 项中 5 项实质通过;另判**控制面 fail-open 与重启后人工恢复门禁丢失**仍阻断。逐项整改,已实现 + 全绿;**结论仍 ACCEPTANCE BLOCKED,等待复验**。

| 编号  | 发现                                                             | 整改                                                                                                                                                                                                                                                                | 证据                                                                                                                                   |
| ----- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| P0    | 新建控制面 DB 默认 `forced_off=0`(fail-open);DB 不存在被当作可用 | `SqliteActivationControlPlane` 新库/缺行一律初始化并视为 **`forced_off=1` reason=`uninitialized_or_recovered` at_ms=now**;schema 异常/读异常 fail-safe-off;DB 缺失绝不等于可用;首启即使 flag ON 也 `shadow_frozen`,首次启用必须经受控人工重开                       | `control-plane.ts`;`control-plane.test.ts`(首启即 OFF)、`activation.test.ts`(空目录首启 flag ON 仍 shadow_frozen)                      |
| P0    | 重启后人工恢复门禁丢失(降级状态非完整持久)                       | 控制面完整持久 `forcedOff/reason/degradedAtMs/rcaPending/stateVersion/lastReopenActor/lastReopenAtMs`;`ActivationDegradeController` 状态从控制面派生(forced-off ⇒ degraded,不默认 active);重启后 `requestReopen` 仍强制人工确认+控制面自持冷却+RCA;记录操作者与时间 | `control-plane.ts`、`degrade.ts`;`degrade.test.ts`(重建仍 degraded、重启后门禁保持)、`control-plane.test.ts`(重启后仍 OFF、记录操作者) |
| P0/P1 | 存在无约束 clear、可绕过 Controller                              | **移除公开 `clear()`**;唯一出路 `attemptReopen` 在控制面内基于持久状态重新校验(确认/冷却/RCA/actor);冷却由控制面自持,调用方不能缩短                                                                                                                                 | `control-plane.ts`;`control-plane.test.ts`(无公开 clear、删行/删库仍 OFF)、`store-crossproc.test.ts`(跨进程重开同步)                   |
| P2    | 文档残留旧测试数;runbook 未反映上述语义                          | 文档统一为当前实际测试数(去除 180/189 旧值);runbook §3.1 明确控制面缺失默认 OFF、首启不自动开、重开必经 Controller、禁运维直接改 SQLite 或无条件 clear、多实例同一持久存储、控制面卷缺失属阻断告警                                                                  | `./p2-ops-runbook.md` §3.1、`./tasks.md`、本文件                                                                                       |

- 复跑(当前):`OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/conversation-task` → **197 通过**(17 文件);`tsgo`(模块内 0 错误,全仓 120 为共享工作树既有);`oxlint`/`oxfmt --check`(0/clean);`evaluate.ts` 原集 Upgrade Precision 100%、`evaluate-blind.ts` 盲测 n=166 Upgrade Precision 100%/Recall 58.8%。
- 保留状态:候选实现提交保留;**未验收、未合并为已验收、未开启灰度、未部署**。

## 9.3 第四轮独立复验发现与整改映射(2026-08-24)

> 第四轮判定:先前 §9.2 文档声称的"服务端时间/跨进程竞态"整改**在代码中并不存在**(旧实现:公共类型仍有 `nowMs`;重开为"读-判断-无条件 UPDATE")。本轮**真正落代码**;**结论仍 ACCEPTANCE BLOCKED,等待复验**。

| 编号 | 发现                                                                                                                                                                              | 整改                                                                                                                                                                                                                                                                                               | 证据                                                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| P0   | 调用方时间伪造仍可绕过冷却:`ForceOffInput.nowMs` / `ReopenAttempt.nowMs` 仍在公共类型,`attemptReopen`/`forceOff` 使用 `req.nowMs`/`input.nowMs`(实测传入未来时间即 reopened:true) | 从 `ForceOffInput`/`ReopenAttempt` **移除 nowMs**;控制面 `forceOff`/`setRcaPending`/`attemptReopen`/`reopenIfVersion` 一律使用**自身注入的服务端时钟 `this.now()`**;冷却按服务端时间计算,调用方无时间通道                                                                                          | `control-plane.ts`;`control-plane.test.ts`(服务端时钟 1000/冷却 600000 时伪造未来时间无字段可传、按服务端时间仍 cooldown_active) |
| P0   | 重开非版本化原子 CAS:仍是"先读→进程内判断→无条件 UPDATE",无 `BEGIN IMMEDIATE`/`state_version` 条件/`changes===1`/竞态测试                                                         | 重开改为 `reopenIfVersion(req, observedStateVersion)`:读版本→`BEGIN IMMEDIATE`→`UPDATE ... WHERE id=1 AND state_version=<observed>`→`changes===1` 否则 `ROLLBACK` 返回 **`state_changed_retry_required`**;`attemptReopen`=以刚读版本调用;`forceOff`/`setRcaPending`/reopen 均 bump `state_version` | `control-plane.ts`;`control-plane.test.ts`(陈旧观察版本→state_changed_retry_required、无丢失更新)、`degrade.test.ts`(共享控制面) |
| P1   | 既有测试仍使用被禁止的 `nowMs`,未验证真实 API 约束                                                                                                                                | 全部测试移除 `nowMs`,改用**构造注入的 `now` 闭包**推进服务端时间;新增服务端时间不可伪造、版本化 CAS 竞态、跨实例可见测试                                                                                                                                                                           | `control-plane.test.ts`/`degrade.test.ts`/`activation.test.ts`                                                                   |
| P2   | 文档不实声称"服务端时间/跨进程竞态"已完成                                                                                                                                         | 本文件与 `tasks.md` 纠正为**真实实现**描述;runbook §3.1 增"时间仅服务端(无 nowMs)""重开为版本化原子 CAS(state_version + changes===1,否则 state_changed_retry_required)";测试数统一 197                                                                                                             | `./p2-ops-runbook.md` §3.1、`./tasks.md`、本文件 §9.3                                                                            |

- 复跑(当前):`OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/conversation-task` → **197 通过**(17 文件);`tsgo`(模块内 0 错误,全仓 120 为共享工作树既有);`oxlint`/`oxfmt --check`(0/clean);`evaluate.ts` 原集 Upgrade Precision 100%、`evaluate-blind.ts` 盲测 n=166 Upgrade Precision 100%/Recall 58.8%。
- 保留状态:候选实现提交保留;**未验收、未合并为已验收、未开启灰度、未部署**。
