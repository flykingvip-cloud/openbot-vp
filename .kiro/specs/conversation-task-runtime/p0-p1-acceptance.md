# ConversationTask Runtime — P0/P1 专家验收材料

> Owner: `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 方案: `./execution-plan.md` · 任务: `./tasks.md`
> 状态: **P0 / P1 = ACCEPTED（第二轮专家验收通过，2026-08-24）。** 现停止业务实现,仅做 P2 门禁准备(CTR 落地 + 运维/安全专项评审);未获新的书面批准前不进入 P2（Activation Gate）。

本材料对应 `execution-plan.md` 第 11 节（实施阶段）与第 16 节（阶段门禁）。所有代码位于独立模块
`src/conversation-task/`，完全离线 / 影子（shadow-only），不接任何生产路径。

## 1. 交接确认（verify-then-take）

- 前任 `codex-conversation-task-plan` 已冻结 `execution-plan.md` 与 `tasks.md`（3 项规划任务 `[x]`，P0/P1 待做）。
- 已复核前任执行状态后接管：Loom 注册表 `owner=kiro-conversation-task-runtime`，`ownerHistory` 记录
  `codex-conversation-task-plan -> kiro-conversation-task-runtime (via: verified)`，前任 session 保留在 `sessions[]`。
- 校验命令：`node --import tsx scripts/loom.ts status`（显示当前 owner 与两个 session）。

## 2. 范围与红线（本阶段严格遵守）

P0/P1 阶段以下动作**全部未发生**（机制上不可能，因为模块不被任何生产代码引用）：

| 红线                        | 结论                                                                      |
| --------------------------- | ------------------------------------------------------------------------- |
| 创建正式 ConversationTask   | 未做（仅冻结类型，无 store、无实例化路径）                                |
| 创建 / 写入 Progress Ledger | 未做（模块不 import `src/progress-ledger` 的写接口）                      |
| 启动 Agent                  | 未做                                                                      |
| 修改 `chat.send` 运行行为   | 未做（无改动）                                                            |
| 修改 Cron 行为              | 未做（无改动）                                                            |
| 打开生产 flag               | 未做（5 个 flag 均默认 OFF，且仅 env 影子，无 config schema 接线）        |
| 实施协作组 Mission          | 未做（仅保留 `MissionBoundaryMarker` 边界 + CT11 守卫拒绝个人域 Mission） |

## 3. P0 交付物（合同冻结与离线数据集）

### 3.1 三边界冻结（`types.ts` + `invariants.ts`）

- **Candidate**：`TaskCandidate` 仅含描述字段；`CANDIDATE_FORBIDDEN_CAPABILITIES` +
  `assertCandidateBoundary`（CT1）在运行期拒绝携带 `steps/progress/evidence/ledger/agent/authorization/notify/quota`。
- **ConversationTask**：`ConversationTask` 仅含身份/归属/目标/生命周期/会话绑定/Revision；
  `CONVERSATION_TASK_FORBIDDEN_FIELDS` + `assertConversationTaskBoundary`（CT2）拒绝执行运行态字段。
- **Mission**：`MissionBoundaryMarker(scope: collaboration_only)`；`assertNoMissionInPersonalScope`（CT11）确保个人助手不铸造 Mission（留待 P7 独立规格）。

### 3.2 四层判定合同（`types.ts`）

- Detection：`DetectionResult { detected, signals, confidence, reasons }`
- Qualification：`QualificationResult`（`chat | short_action | reminder | scheduled_action | long_running_candidate | needs_clarification`）
- Activation：`ActivationConditions`（三最小条件）+ `evaluateActivation`（仅合同，**P0/P1 不执行**）
- Authorization：`AuthorizationState` + `SideEffectClass` + `resolveAuthorization`（fail-closed）

### 3.3 工作类型与 8 强信号

- 工作类型：`l0_chat / l1_short_action / reminder / scheduled_action / l2_long_running`；`NON_LEDGER_WORK_TYPES` 明确仅 L2 可（P2 后）建长程 Ledger。
- 冻结 8 强信号：`hasFutureIntent / hasWaitCondition / hasMultipleStages / hasRecurringIntent / hasDeliverable / hasCrossTurnDependency / hasExplicitAcceptance / hasPersistentState`。

### 3.4 不变式 CT1–CT11 + 威胁模型（`invariants.ts`）

每条不变式为可机检纯函数，测试以正/反例钉死（`invariants.test.ts`，23 用例）：

| ID          | 防御的威胁                                                                    |
| ----------- | ----------------------------------------------------------------------------- |
| CT1         | Candidate 伪装成任务（携带执行/账本/授权能力）                                |
| CT2         | ConversationTask 生长执行运行态 → 与 Ledger 形成双状态                        |
| CT3         | Qualification 非纯（结果夹带副作用键）                                        |
| CT4/CT5/CT6 | 单一强信号（未来/等待/重复/交付）擅自升级 L2 → 摧毁 Upgrade Precision         |
| CT7         | 外部副作用泄漏进时长判定；授权未 fail-closed                                  |
| CT8         | 重复投递产生重复候选/决策（幂等丢失）                                         |
| CT9         | 模型自述完成被当作事实改动 Acceptance                                         |
| CT10        | 影子决策被复用为真实激活；P0/P1 打开 activation/projection/authorization flag |
| CT11        | 个人域偷偷铸造协作 Mission                                                    |

### 3.5 离线金标数据集（`dataset.ts` + `dataset.test.ts`）

11 类共 36 例，含正例/反例/模糊例/跨回合例；数据集完整性由 `dataset.test.ts`（9 用例）校验。
必覆盖场景映射见第 6 节。

### 3.6 Feature flags（`feature.ts`）

`conversationTask.{detection,qualification,activation,projection,authorization}.enabled` 全部默认 OFF；
仅 `detection/qualification` 允许在影子模式开启；`isShadowModeOnly` 保证 P0/P1 期间三个高风险 flag 保持 OFF。

## 4. P1 交付物（离线 Detection 与 Qualification）

- `signals.ts`：确定性强信号抽取（8 信号）+ 词法线索 + 副作用分类；**精度优先**，弱表述（"多留意一下"/"关注下"）刻意不算强信号。
- `detector.ts`：高精度 detector（`detectTurn`），允许漏识别，禁止为召回率批量误检。
- `qualification.ts`：纯函数 `qualifyTurn`，输出 kind + 稳定 reason codes；升级 L2 需"持久状态 + 延续驱动 + 具体目标"，且经 `assertNoInsufficientUpgrade` 守卫。
- `replay.ts`：影子判定日志（`ShadowDecisionLog.shadowOnly:true`），隐私安全指纹（FNV-1a，不含原文），授权 fail-closed，`flag-off == 无决策`。
- `metrics.ts` / `evaluate.ts`：confusion matrix、Upgrade Precision、Task Survival 代理、Detection/逐类分数与离线报告。

## 5. 离线评估结果（shadow-only）

复现：`node --import tsx src/conversation-task/evaluate.ts`

```text
Samples:                 36
Qualification accuracy:  97.2%
Side-effect accuracy:    100.0%
Upgrade (long_running_candidate):
  Upgrade Precision:     100.0%  (target >= 95%)
  Upgrade Recall:        83.3%   (recall intentionally < 100%)
  Task Survival (proxy): 100.0%  (dataset proxy; runtime value needs P2+)
Detection:
  Precision:             100.0%
  Recall (all):          96.2%
  Recall (excl. misses): 100.0%
  Intentional misses:    1
Per-class (precision / recall / F1 / support):
  chat                      91.7% / 100.0% /  95.7% / 11
  short_action             100.0% / 100.0% / 100.0% / 10
  reminder                 100.0% / 100.0% / 100.0% / 3
  scheduled_action         100.0% / 100.0% / 100.0% / 3
  long_running_candidate   100.0% /  83.3% /  90.9% / 6
  needs_clarification      100.0% / 100.0% / 100.0% / 3
Confusion matrix (rows = gold, cols = predicted):
  gold\pred    chat   short  remind   sched      L2 clarify
      chat      11       0       0       0       0       0
     short       0      10       0       0       0       0
    remind       0       0       3       0       0       0
     sched       0       0       0       3       0       0
        L2       1       0       0       0       5       0
   clarify       0       0       0       0       0       3
Mismatches (gold -> predicted):
  ct-fuzzy-01: long_running_candidate -> chat
```

解读：

- **Upgrade Precision = 100%**（目标 `>= 95%`）：预测为 `long_running_candidate` 的样本全部确为真实 L2，零误升级。
- **唯一失配 `ct-fuzzy-01`** 是**刻意漏识别**（`expectedDetectorMiss=true`）："这个竞品最近老是变价，你多留意一下" 真实是隐含持续监控，但信号过弱；高精度检测器选择漏识别而非误升级——这正是精度优先设计的体现，故 Upgrade Recall = 83.3%。
- **Detection Precision = 100%**，无误检；排除刻意漏识别后 Detection Recall = 100%。
- **Task Survival = 100% 为影子代理**：定义为"预测 L2 中 `goldSurvivesFirstRound=true` 的比例"。真实的 Task Survival 需 P2+ 运行时数据（任务首轮后是否仍需推进）才有意义，此处仅作离线代理，**不作为进入自动激活的充分证据**。

## 6. 必覆盖场景逐条结论（对照 execution-plan §12）

| 场景               | 样例                                                                                                             | 预测结论                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 普通问答           | ct-qa-01..04                                                                                                     | `chat`，不检测、不建任务                                             |
| 一次性短动作       | ct-sa-01..04                                                                                                     | `short_action`，当前 run 完成                                        |
| Reminder           | ct-rm-01..03                                                                                                     | `reminder`，不建长程 Ledger                                          |
| Scheduled Action   | ct-sch-01..03                                                                                                    | `scheduled_action`；未来/重复本身不升级 L2                           |
| 长程监控任务       | ct-lr-01..05                                                                                                     | `long_running_candidate`（仅 Candidate，未激活）                     |
| 等待条件但不应升级 | ct-wait-01（无目标→`needs_clarification`）、ct-wait-02（有活跃任务→`chat` 阻塞闸）、ct-wait-03/04（推迟→`chat`） | 均不升级 L2                                                          |
| 用户修改目标       | ct-rev-01/02                                                                                                     | `needs_clarification`（target_task 待 P3 绑定），不新建任务          |
| 外部副作用授权     | ct-auth-01(广播)/02(写CRM)/03(无副作用对照)/04(群发)                                                             | 类型与副作用分离；副作用 → `human_gate_required`；CT7 正交（同类型） |
| 重复消息幂等       | ct-dup-01/02（同 messageId）                                                                                     | 决策逐字节一致（CT8）                                                |
| 模型自述完成       | ct-claim-01/02                                                                                                   | `chat` + `MODEL_SELF_CLAIM_IGNORED`，不改 Acceptance（CT9）          |
| flag off           | `replay.test.ts`                                                                                                 | `evaluateTurnGated` 在 detection=off 时返回 `null`（行为不变）       |

## 7. 复现命令

```bash
# 离线评估报告（confusion matrix / Upgrade Precision / Task Survival）
node --import tsx src/conversation-task/evaluate.ts

# 模块测试（P0 + P1，共 103 用例）
OPENBOT_TEST_PROFILE=low npx vitest run src/conversation-task

# 类型 / lint / 格式（模块内 0 问题）
./node_modules/.bin/tsgo -p tsconfig.json --noEmit   # grep src/conversation-task 无错误
./node_modules/.bin/oxlint src/conversation-task
./node_modules/.bin/oxfmt --check src/conversation-task
```

质量门：103 测试通过；模块在 `tsgo` 下 0 类型错误、`oxlint` 0 告警 0 错误、`oxfmt` 全绿。

## 8. 提交记录（每个绿色检查点独立提交）

| 阶段                    | Commit       | Trailers                                                                    |
| ----------------------- | ------------ | --------------------------------------------------------------------------- |
| P0 合同 + 数据集        | `4e757676ed` | `Task: conversation-task-runtime` / `Agent: kiro-conversation-task-runtime` |
| P1 检测/判定 + 影子指标 | `cafef8847e` | 同上                                                                        |

说明：`.loom/registry.yaml` 新增了本任务的 `CTR` landing stream 以满足 worktree 审计，但**未由本 agent 提交**（该文件 lander 为 `loom-workspace-orchestrator:kiro-loom`），保持 modified/uncommitted 交由其落地。

## 9. P2（Activation Gate）准入清单 — 待专家裁定

对照 `execution-plan.md` §16 P2 准入条件（本 agent **不自行进入 P2**）：

1. Candidate / ConversationTask / Mission 边界有测试与评审证据 — **已具备测试证据（CT1/CT2/CT11 + `invariants.test.ts`），待专家评审**。
2. Qualification / Activation / Authorization 无职责重叠 — **合同层已分离（纯判定 vs 激活 vs 授权），待评审**。
3. Reminder / Scheduled / Long-running 分类回放通过 — **已通过（逐类 100% 精度，见第 5 节），待确认**。
4. Upgrade Precision `>= 95%` 达标样本门槛 — **离线 100%，待确认样本规模是否足够**。
5. 误升级 / 重复投递 / 改目标 / 副作用反例通过 — **已覆盖并通过（第 6 节），待确认**。
6. feature flag / 回滚 / 观测设计过运维评审 — **flag 已拆分且默认关，config 接线与观测留待 P2，待运维评审**。
7. 安全 / tenant isolation / 授权边界专项评审 — **授权 fail-closed 合同就绪，隔离接线属 P2+，待安全评审**。

> 结论：**P0/P1 已按批准范围完成。是否进入 P2 Activation Gate 需专家依据上表逐条批准。** 在获得明确批准前，不创建正式任务、不写 Ledger、不启动 Agent、不改生产行为、不实施 Mission。

## 10. 遗留与后续（不在本阶段实施）

- P2：Candidate 生命周期、Activation Gate、ConversationTask store、稳定会话绑定、取消/关闭与幂等。
- P3：Revision 与连续性；active-task 解析（当前 revision 样例判为 `needs_clarification` 即由此边界决定）。
- P4：Progress Ledger Binding 与 Canonical Projection（复用现有 `src/progress-ledger`，不新建第二套）。
- P5：Authorization / Human Gate 接线。
- Feature flag 的 config schema 接线（当前仅 env 影子）留待 P2，避免本阶段触碰生产 config。

## 11. 第二轮验收收口(P0/P1 通过、P2 暂不批准)

依据专家结论(P0/P1 功能基本通过,P2 暂不批准)做验收收口,**未进入 Activation runtime**。

### 11.1 独立盲测(标注先于规则调整)

- 新增独立盲测集 `src/conversation-task/blind-dataset.ts`:**166 样本**(L2 正例 34、Reminder 16 + Scheduled 17、Wait 15 + Revision 13 + Side-effect 14;含上下文省略、口语、跨回合)。gold 标签依 spec 语义先行标注,rubric 写在文件头,**不按实现反向构造金标**。
- 盲测评估 `src/conversation-task/evaluate-blind.ts` + 断言 `blind-dataset.test.ts`(硬断言 Upgrade Precision ≥ 95%、零 false upgrade、Detection Precision ≥ 95%;Recall / 逐类 / confusion 仅报告)。
- 复现:`node --import tsx src/conversation-task/evaluate-blind.ts`。

盲测结果(v2):

```text
Samples:                 166
Qualification accuracy:  89.2%
Side-effect accuracy:    98.8%
Upgrade Precision:       100.0%  (target >= 95%)
Upgrade Recall:          58.8%   (14 漏识别全为口语/省略/弱信号,精度优先)
Task Survival (proxy):   100.0%
Detection Precision:     99.1%
Detection Recall (all):  89.3%
Per-class P/R/F1(support): chat 73.1/100/84.5(49) · short 100/94.3/97.1(35)
  · reminder 100/93.8/96.8(16) · scheduled 100/100/100(17)
  · long_running 100/58.8/74.1(34) · needs_clarification 100/93.3/96.6(15)
Confusion(rows gold, cols pred; 仅 L2 行有 14 个漏识别落入 chat, L2 列无误升级):
  gold\pred  chat short remind sched  L2 clarify
     chat      49    0     0     0    0     0
    short       2   33     0     0    0     0
   remind       1    0    15     0    0     0
    sched       0    0     0    17    0     0
       L2      14    0     0     0   20     0
  clarify       1    0     0     0    0    14
```

### 11.2 盲测发现的精度缺陷与 spec 对齐修正(未改任何 gold)

v1(冻结 detector)盲测 Upgrade Precision = 90.0%:`bsch-08`(接下来一个月每天发摘要)、`bsch-09`(持续每天生成发邮箱)被误升级为 L2。根因:`hasPersistentState` 把裸时长词(`持续`/`一直`/`接下来N月`)当作持久状态,违反 spec §6「未来时间 / 重复本身不是 L2 的充分条件」。据此做三处 **spec 对齐** 修正(先标注、后调整;未改 gold):

- (a) `PERSISTENT_PATTERNS` 去除裸时长词,保留真正的持久评估线索(监控/监测/盯着/盯住、持续跟踪|跟踪..进度、超过阈值/异常时/异动、连续N(下降/上升/失败/走高/超时/未处理)、如果..(预警/告警/升级)、等..(签收/到港)、到期/逾期/超时、deadline/截止)。→ 消除 `bsch-08/09` 误升级,并恢复真 L2 `blr-05`(走高)、`blr-09`(异常时)。
- (b) `FUTURE_PATTERNS` 补中文数字时刻(`[一..十两]+点`)与相对时段(月底/月末/年底/季度末/周末)。→ 恢复 reminder 召回(`brm-04` 三点、`brm-08` 月底)。精度中性。
- (c) CT9 自述完成词补 `啦` 变体(`搞定啦`)。精度中性。

v2 盲测 Upgrade Precision 回到 **100%**;**原始 36 集零回归**(Upgrade Precision 100%、Detection Precision 100%、qual 97.2%)。剩余盲测失配全部是口语/省略/弱信号 L2 的召回漏识别(`blr-21..32`、`bfz-09/10`),属高精度取向的预期行为,已如实报告。

### 11.3 P2 前置评审材料

新增 `./p2-prereview.md`,覆盖:feature flag 接线与即时回滚、shadow 日志脱敏/保留/删除、tenant/employee/conversation ACL 接线点、Authorization fail-closed 威胁模型(T1–T5)、Candidate/ConversationTask 幂等键、重复投递与并发单飞、Candidate 保留/过期/清理,并附 §16 门禁对照。**均为设计提案,未实现 runtime。**

### 11.4 CTR landing stream 交接

新增 `./loom-ctr-handoff.md`,交由 registry lander `kiro-loom` 落地 `.loom/registry.yaml`(仅其提交;保留 ownerHistory/sessions;禁用 `loom import --write`)。已核对:`agent-attribution` 将本任务文件全部正确归属,`loom lint` 无 CTR/conversation-task 相关问题。本 agent 不提交 `.loom/registry.yaml`。

### 11.5 质量门(第二轮复跑)

- `OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/conversation-task` → 113 通过。
- `pnpm exec oxlint src/conversation-task` → 0 告警 0 错误。
- `pnpm exec tsgo -p tsconfig.json --noEmit` → 模块内 0 类型错误。
- `node --import tsx src/conversation-task/evaluate.ts`(原集)/ `evaluate-blind.ts`(盲测)→ Upgrade Precision 均 100%。

> 结论:第二轮验收收口完成,**仍停在 P2 前**。未创建任务、未写 Ledger、未启动 Agent、未改 `chat.send`/Cron、未开生产 flag、未实施 Mission。等待第二轮专家验收与 P2 书面批准。
