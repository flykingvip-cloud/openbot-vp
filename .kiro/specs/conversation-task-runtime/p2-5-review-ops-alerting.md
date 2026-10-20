# P2.5 专项评审 — 运维与告警

> 被评审设计: `./p2-5-production-integration.md`(§4、§7、§8、§9)、`./p2-ops-runbook.md`、`./p2-production-rollout.md`、`./p2-rollback-drill.md`
> 实施 owner: `kiro-conversation-task-runtime` · 独立 reviewer: `kiro-ops-reviewer`(**≠ 实施 owner**)
> 关注点: 三类指标合同、线上质量样本、异步资源、失败隔离、P2.5 自动响应与即时回滚(不越层、不需重新部署)。
> 状态: **独立评审已签署;经 C1–C7 复核(2026-08-25,基线 `1e948ebf70`/#707)后 CONDITIONAL 已解除 → CLOSED。** 治理: 实施 owner 不得切角色代签。
> 评审基线: v1 初评 `origin/main` = `968b4b739f`;C1–C7 复核基线 = `origin/main` = `1e948ebf70`(#707 设计整改)。所有判据均对照相应 SHA 的真实代码亲验。

## 评审清单(逐项 decision 由独立 reviewer 填写)

| #   | 评审项          | 判据                                                                                                                                                                                                 | 实施自评(证据)       | 独立 decision    |
| --- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------- |
| O1  | 指标三类分离    | 实时运行 / 延迟标注质量 / 离线回归 三类清晰分离,互不冒充                                                                                                                                             | 设计 §7.1–§7.3       | **PASS(设计层)** |
| O2  | 线上无实时 gold | 普通生产消息**不**直接计入 Upgrade Precision;质量指标只由延迟人工标注样本计算                                                                                                                        | 设计 §7.2;验收 #18   | **PASS**         |
| O3  | 最小样本量      | 未达最小样本量不产出质量结论、不触发基于质量的自动动作                                                                                                                                               | 设计 §7.2;验收 #19   | **PASS(设计层)** |
| O4  | P2.5 自动响应   | 阈值异常动作 = 清空 allowlist + detection/qualification OFF + 停 shadow + 告警;**不**以 force-off activation 为主(P2.5 不进入 activation 层)                                                         | 设计 §7.4            | **PASS**         |
| O5  | P2.5 指标清单   | 保留 shadow invocation/success/failure、classification dist、tenant/scope rejection、HMAC failure、persistence failure、duplicate shadow delivery、queue depth/drop、latency、delayed-review quality | 设计 §7.1/§7.2       | **CLOSED**       |
| O6  | 移除越阶指标    | `duplicate task rate`/`Candidate CAS`/`Task CAS`/`state_changed_retry_required` 已移出 P2.5(属 Activation/TaskStore)                                                                                 | 设计 §7.5            | **PASS**         |
| O7  | 异步资源合同    | 单例 runner + DB 连接生命周期、有界队列、最大并发、唯一 drop 策略、drop 指标+告警、单项超时、统一 rejection 捕获、shutdown drain 上限                                                                | 设计 §4;验收 #12/#13 | **CLOSED**       |
| O8  | 失败隔离        | CTR 抛错/慢或坏 SQLite/HMAC 缺失过期/指标不可用/队列满 都不阻断或拖慢聊天                                                                                                                            | 设计 §8;验收 #14/#15 | **PASS(设计层)** |
| O9  | 即时回滚        | detection OFF → qualification OFF → allowlist 清空 → 验证 shadow 停 → 验证 chat.send 不变;热读 TTL≤3s,不需重新部署,不依赖 activation force-off                                                       | 设计 §9;验收 #16     | **CLOSED**       |
| O10 | 告警渠道/升级   | 告警渠道、责任人、升级路径明确(承接 `p2-ops-runbook.md`)                                                                                                                                             | 设计 §7.4            | **CLOSED**       |

## 亲验记录(reviewer 对照真实代码)

- **O2 = 真(强证据)。** 全模块唯一计算 `upgradePrecision` 的路径为 `metrics.ts:evaluateDataset`,对**离线** `CONVERSATION_TASK_SAMPLES` 金标数据集打分;**不存在任何实时生产路径**计算 Upgrade Precision。设计“线上无实时 gold、质量指标只由延迟标注样本计算”的论断与代码现状一致。
- **O4 = 真(强证据)。** `forceOff` 位于 Activation 控制面:`control-plane.ts` 的 `InMemory/SqliteActivationControlPlane.forceOff`,由 `degrade.ts` 的 `ActivationDegradeController` 在阈值(`upgradePrecisionMin=0.95`、`overUpgradeDegrade=0.05`)触发,**durably force-disable activation**。即 force-off 是独立的 Activation 层(P3+)机制,与 P2.5 正交。设计 §7.4 把 P2.5 自动响应定义为“清空 allowlist / detection·qualification OFF / 停 shadow / 告警”,与“不以 force-off 为主”一致——论断成立。
- **O6 = 真。** `duplicate task rate`/Candidate·Task CAS/`state_changed_retry_required` 对应 `store.ts`/`control-plane.ts`(Activation/TaskStore 阶段),设计 §7.5 将其移出 P2.5 属正确分层。
- **O5 = 清单完整但均未实现。** §7.1 的实时计数器(invocation/success/failure、classification dist、tenant/scope rejection、HMAC failure、persistence failure、duplicate delivery、queue depth/drop、latency)在模块内**无任何实现**(`metrics.ts` 仅离线评估器)。清单本身连贯、可测,属未来实现。其中 `duplicate shadow delivery` 依赖 §3 复合 UNIQUE 冲突计数——而该复合 UNIQUE 尚未在 `shadow.ts` 落地(见安全 S10 / 隐私 P4)。
- **O7 异步合同 = 纸面完整、无代码。** 模块内无 runner/有界队列/drop 策略/shutdown drain 代码。`store-crossproc.test.ts` 提供了跨进程测试范式可复用。
- **O9/O10 = 存在与代码/文档不符的缺口(见条件)。**

## 附加条件 / 阻断项(独立 reviewer 填写)

- **[CONDITIONAL-O9 / C3(与 Gateway 共担)]** 设计 §9“回滚不需重新部署”依赖 flag 运行时热读;但 `feature.ts` 明示 flag 为**纯环境变量**,`flag-cache.ts` 默认读 `process.env`。运行中的 gateway 无法在不重启前提下热改进程环境变量。**条件**:detection/qualification flag 必须改为从运行时可热加载、多实例一致的配置源读取(与 §5 allowlist 同等严格);验收 #16 须针对该真实 flag 源证明“回滚即停写、chat.send 不变、无需重新部署”。
- **[CONDITIONAL-O7 / C4]** 异步 runner 与 allowlist 均未实现。**条件**:验收 #12(队列满不阻塞)、#13(shutdown drain 有界 + 无 unhandled rejection)须为**真实并发/关停**用例;须证明单例复用**单一** tenant-scoped 连接(禁止每消息新建连接)、固定最大并发、唯一 drop 策略(drop-new/drop-old 二选一并冻结)+ `queue_dropped` 指标与达阈告警、单项超时。
- **[CONDITIONAL-O5 / 交叉引用 S10、P4]** 实时指标须真正落地并经有界 runner 发射;其中 `duplicate shadow delivery` 计数依赖 shadow 复合 UNIQUE 冲突,故须先完成 shadow schema 变更(HMAC 列 + 复合 UNIQUE)方可产出该指标。
- **[CONDITIONAL-O10 / C7]** `p2-ops-runbook.md` 现为 **Activation 阶段**导向(其头号自动动作是 Upgrade Precision<95% 时 force-off activation、控制面卷缺失阻断告警),**未具体给出 P2.5 的告警渠道、责任人与升级阶梯**。设计 §7.4 仅“承接 runbook”不足以覆盖 P2.5 的四类自动响应 + 失败告警。**条件**:为 P2.5 shadow-only 阶段补充独立的告警渠道 / 责任角色 / 升级路径(或在 runbook 内新增 P2.5 shadow-only 小节),明确与 Activation force-off 机制区分。

## 复核确认(C1–C7,2026-08-25,基线 `1e948ebf70`/#707)

- **O9 → CLOSED**:设计 §2 + §9 冻结回滚依赖的 flag 为 §5 同源持久热配置(非纯 env),回滚顺序热改即时生效、无需重新部署;验收 #16 要求针对真实配置源证明“回滚即停写、无需重新部署”。C3 于设计层闭合。
- **O7 → CLOSED(设计规定 + 验收强制)**:设计 §4 给出完整异步资源合同(单例 + 单连接 + 有界队列 + 最大并发 + 唯一 drop 策略 + `queue_dropped` 指标/告警 + 单项超时 + 统一 rejection 捕获 + 有界 shutdown drain);验收 #12/#13 要求真实并发/关停用例,不得桩。
- **O5 → CLOSED**:§7.1 指标清单完整且 `duplicate shadow delivery` 明确依赖 §3.2 复合 UNIQUE 冲突计数(该 schema 变更已在 §3.2 冻结);`HMAC failure` 显式含缺失 + 过期(§6 C5)。指标落地委派编码门禁。
- **O10 → CLOSED**:设计 §7.4 新增 P2.5 专属告警表(触发/阈值/渠道/责任人/升级/自动响应)+ 唯一自动响应链(清 allowlist → detection·qualification OFF → 停 shadow → 脱敏告警),明确区别于 Activation force-off(force-off 仍为 P3+ 独立机制)。C7 于设计层闭合。
- O1/O2/O3/O4/O6/O8 初评即成立,复核维持 PASS。

## 独立签署

- Reviewer id: **`kiro-ops-reviewer`**(≠ `kiro-conversation-task-runtime`) · 初评日期: **2026-08-25**(基线 `968b4b7`) · 复核日期: **2026-08-25**(基线 `1e948ebf70`/#707) · IDE/Loom session: `kiro` / `FBDD4864-0261-4D8F-BA68-3C6E627E7059`(reviewer 统一独立 session)
- 逐项结论: O2/O4/O6 = PASS(亲验);O1/O3/O8 = PASS(设计层);O5/O7/O9/O10 = **CLOSED**(复核后由 CONDITIONAL 解除)。
- 总结论: **条件通过 → CLOSED(2026-08-25 复核)**。三类指标分离、线上无实时 gold(代码确认无实时路径)、force-off 属 Activation 层(P2.5 正交)初评已亲验;C3(flag 热配置源)、C4(异步 runner)、O5(实时指标)、C7(P2.5 专属告警)经 #707 设计整改后于设计层闭合,余下强制点委派给强化验收(#12/#13/#16)于编码门禁执行。**本项无剩余阻断条件。**
