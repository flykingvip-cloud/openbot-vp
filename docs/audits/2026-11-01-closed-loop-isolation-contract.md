# 闭环隔离补验与合同冻结（2026-11-01）

- 基线：`origin/main` @ `c9050e4aa64482eab6fb61c8b42cf5270e811f20`（`fix(enterprise-data): align data product actions to the selected source connector`）。开工时 `git fetch origin main` 后 `ahead_by 0`。没有更晚的提交修掉下面的断点。
- 对照报告：`docs/audits/2026-11-01-closed-loop-demand-diagnosis-notify.md`（PR 178，分支 `cursor/closed-loop-demand-audit-d411` @ `561e568f`）。本文件不混入协作 #164 或审计 #177。
- 本期改动：隔离测试、审计差量、合同和第一笔业务 PR 的范围。没有改生产判定、没有部署、没有打开开关、没有连接 LIVE 网关、没有给真实用户发消息。
- 证据等级：`代码定义` / `隔离验证`。生产环境变量、用户是否已读、APNs 送达、canary 是否仍有流量，仍然是 `未验证`。

## 测试命令

在本工作区执行 `pnpm install --frozen-lockfile` 之后：

| 命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run src/task-outcome/judge.test.ts src/task-outcome/result-service.test.ts src/task-outcome/consumer-boot.test.ts src/gateway/agent-growth/feedback-signal.test.ts src/auto-reply/reply/goal-correction-mutation.test.ts src/diagnosis/diagnose-daibai-inbox.test.ts src/diagnosis/diagnose-policy.test.ts src/cron/isolated-agent/result-surfacing.test.ts src/task-outcome/w4-experience-evolution.test.ts` | 9 files, 58 passed |
| `pnpm exec vitest run src/diagnosis/diagnosis-issue-queue.test.ts src/task-outcome/judge.test.ts` | 2 files, 13 passed |
| `pnpm exec vitest run src/task-outcome/closed-loop-isolation-contract.test.ts` | 1 file, 9 passed |

隔离用例在 `src/task-outcome/closed-loop-isolation-contract.test.ts`。进程重启由 `src/task-outcome/closed-loop-isolation-restart-child.ts` 另起进程完成，不是在同一进程里 new 一个对象。

## A. 先前结论在本基线上是否仍成立

| 先前结论 | 本基线 | 证据 | 对实施建议的修正 |
| --- | --- | --- | --- |
| 反馈正则能识别「不对」，但 `src/auto-reply` 不调用它 | 仍成立 | `feedback-signal.ts:40-47`、`record-feedback.ts:27-39`。非测试引用只有这两个文件 | 不要把这条正则直接接到 correction。它分不清引用、别的话题和新需求 |
| 没有生产 correction 调用；allowlist 只在测试出现 | 仍成立 | `result-service.ts:102-104` 默认空集合；`rg correctionAllowlist` 的非测试命中只有 `result-service.ts`。`chat-entry.ts:92-95` 与 `runtime-from-runner.ts:467-470` 都没传 allowlist | 第一笔业务 PR 要给「已验证的任务主体」配置已有参数，不是新写一套修正器 |
| correction 会重开任务 | **不成立，用词错误** | `transitions.ts:78-79` 关闭后只放行 `correction`。`transitions.ts:313-401`：失败验收强制 `stopRecovery`，结果是 `closed` + `failure` + `reasonCode=correction`；`pending` 变成 `awaiting_acceptance`。attempts 保留，不新增 run | 禁止把 correction 写成 reopen。它是追加版本并重算门闩 |
| 旧贡献会被撤销 | API 能力成立；当前用户回复路径不会走到 | `consumers.ts:213-215` 旧版本计数先扣再记。隔离测试把 success 贡献收成 failure。`growth-bridge.ts:233-243` 对不再合格的关闭样本写 revoked 行 | 撤销发生在消费者处理 `task.corrected` 时，不是用户一句话自动发生 |
| 诊断不读 TaskOutcome tip | 仍成立 | `src/diagnosis` 没有 `task-outcome` import。`structural-preview-reader.ts:100-107` 读 evolution jsonl；`140-166` 还要求 `eligible`、`completed`、`succeeded` | 读者必须带 `taskId + outcomeVersion`。版本变了返回 `outcome_version_changed`，读失败不能写成正常 |
| 工具失败仍可任务成功 | 仍成立 | `runtime-from-runner.ts:579-586` 把工具比率记成观察；`661-701` 只在调用方给出门闩时关闭。隔离运行：`toolsSucceeded 1 / toolsTotal 2` 且 acceptance `not_required`、delivery `delivered` → `taskJudgement=success`，`reasonCode=accepted_and_delivered` | 不要从工具失败自动升级成用户任务失败，也不要从任务成功推断工具都成功 |
| inject 接受被写成 delivered | 仍成立 | `diagnose-policy.ts:225-248` 一有路由就 `daibai_delivery_gate_closed`。`diagnose-daibai-inbox.ts:159-166` 全部 send 接受后改成 `delivered: true, reason: conversation_accepted` | `delivered` 只表示转写写入被接受。UI 已把它说成「已投送」，见下方消费者。不得拿它判断任务成功或用户已读 |
| 通知失败应让原任务回到 `awaiting_delivery`，并用现有 drain 重试 | **建议作废** | 隔离测试：inject 返回 `unavailable` 后，已关闭任务仍是 `closed/success/delivered`。`pending-delivery.ts` 登记的仍是原 run 的通道投递。outbox 消费者按事件重试，一次关闭路径有多条事件 | 不复用 pending-delivery，也不复用 outbox。缺的是「通知失败」自己的事实；本期不新开队列 |
| 收件人用 platformUserId 拼大白会话 | 半对 | `employee-isolation.ts:46-51` 确实这样拼。TaskOutcome `scope.subjectRef` 没有映射函数（全库无 `subjectRef` 与 `platformUserId` 的互指） | 两者不相等。映射不存在时失败关闭。禁止退回 `agent:main:main` 或 `diagnosis:canary:daibai` |
| cron 只有管家且有 owner 才进该用户大白 | 仍成立，且另有退回 | `result-surfacing.ts:85-94`：owner 且 agent 是内置管家 → 员工会话；否则 `resolveAgentMainSessionKey`。隔离：无 owner 的 `main` 得到 `agent:main:main`；有 owner 但 agent 是 `bot-2` 得到 `agent:bot-2:main` | 这是现有 cron 浮出。用户任务跟进不得调用这个退回 |
| Issue 复查回写在网关被拒绝，响应里 `enabled: true` | 仍成立 | `diagnosis-issue-gateway.ts:34`、`76-85`。常量 `DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED` 在 `diagnose-professional-protocol.ts:12` 为 true | 不打开网关门。库函数在测试传入 `enabled: true` 时能写 cron，那是 API 能力，不是网关行为 |
| 支持单关闭不回写任务 | 仍成立 | `support-cases/store.ts:221-237`。隔离：case `closed`，TaskOutcome 仍是 success | 保持 |
| 无采纳则经验不验证 | 仍成立 | `experience-verified-handler.ts:94-100`。`attachAdoptedLearningAssetsToTask` 的非测试引用只有定义和 `index.ts` 再导出 | 不要自动采纳。有效性验证磁盘副作用本期未跑，见未验证 |
| claimContract 默认关 | 仍成立 | `claim-contract.ts:359-385`。空配置对象返回 false | 第一笔 PR 不打开 |
| 治理默认 assist，skill auto 默认关，remediation 常量 false，soft-observe 默认开 | 仍成立（代码默认） | `mode.ts:16-32`、`skill-auto-evolution.ts:78-86`、`production-cutover.ts:41`、`soft-observe-dh-loop.ts:79-88` | 部署环境变量未验证。本期不改这些默认值 |
| 父子任务只有字段 | 仍成立 | `types.ts:107-111`、`157-158`。`transitions.ts` 没有 parent rollup | 不进第一笔 PR |
| 能力缺口去重在内存 | 仍成立 | `capability-gap-ingest.ts:79`、`252-276`。子进程计数从 1 开始，父进程计数不变，且 `proposalId` 为空 | 不把这块迁进第一笔 PR |

先前报告漏掉的现网行为：`get-reply-run.ts:694-717` 会调用 `applyGoalCorrectionMutation`。`goal-correction-mutation.ts:109-112` 没有 `taskContextId` 就返回 null，不会新建账本行。有绑定则改写该 workspace 任务的 title / description，并把 status 写成 `active`（`123-135`）。隔离测试证明：引用句「他说『不对，重做一遍这个结果』」会改 workspace 任务，同时 TaskOutcome tip 版本和 judgement 不变。这不是 TaskOutcome correction，也不是 reopen。

## B. 六项合同

判定函数 `classifyUserNegationCandidate`、`readBoundTaskEvidence`、`resolveFollowUpRecipient` 写在隔离测试里，生产代码没有调用。它们是第一笔和第二笔业务 PR 必须满足的预言，不是已上线的行为。

### 1. 用户否定与任务修正

当前路径：

- 正则 `deriveInboundFeedbackSignals` 把「他说『不对』」标成 negative。`请再加一个导出` 没有情绪。它不写 TaskOutcome。
- 目标句提取把「今天天气不对啊」和引用句都当成目标修正。绑定的是 `sessionEntry.taskContextId`，不是用户点名的 TaskOutcome，也不是「最近一条任务」。
- 同一 agent workspace 上，task context 的范围是 agent 或群，不校验 platform user。

API 能力（测试直接调用，生产构造器做不到）：

- 空 allowlist：`unauthorized_correction`，tip 不变。
- allowlist 含 `subject:alice` 时，该主体可以 correction。`authorizedBy` 与 `callerSubjectRef` 不一致、或不在 allowlist、或 `requiredScope.subjectRef` 不同，都拒绝。
- 成功的 correction：`outcomeVersion + 1`，`revisionKind=correction`，发出 `task.corrected`。旧版本文件仍在，旧 judgement 仍是 success。
- 同一 `commandId` 再提交：不增加版本。
- 两个进程用同一 `expectedVersion` 做 `set_acceptance`：一个 `ok`，一个 `version_conflict`，tip 只到版本 2，版本 1 还在。
- 把验收改成 failed：lifecycle 仍是 `closed`，judgement `failure`，reasonCode `correction`。消费者把 success 计数收成 failure。
- 把验收改成 pending：lifecycle 是 `awaiting_acceptance`，judgement `incomplete`，attempt 仍是原来的 `r1`。没有新的执行。

绑定规则（预言，今天没有生产调用）：只有「否定的是先前产物」且调用方给出的 `explicitTargetTaskId` 属于候选集，才允许写。候选只有一个也不准猜。引用、别的话题、纯新增需求、目标不清，一律不写。

### 2. 权威结果与根因证据

| 层 | 权威 | 今天的行为 |
| --- | --- | --- |
| 结果 | tip.`taskJudgement`，由 `judge.ts:22-53` 从 lifecycle、acceptance、delivery 投影 | 非 closed 一律 `incomplete`。`delivery_unknown` 不能是 success |
| 观察 | `attempts[].toolObservations`、acceptanceEvidence、delivery 状态 | 工具失败可以和任务 success 同时存在。reasonCode 不会变成工具名 |
| 根因 | 没有单一字段 | `reasonCode=correction` 只表示这次是修正。eligibility 对未知 code 落到 `attribution=other`。诊断协议域、Issue 的客户端 `failureAttribution`、结构候选的 mechanism 映射仍然各写各的 |

诊断读取预言：必须同时给出 taskId 和 outcomeVersion。缺版本 → `version_required`。快照不存在 → `version_missing`。tip 已经更新 → `outcome_version_changed`，不得把新 judgement 当作所请求的版本。`readSessionIndex`（`structural-preview-reader.ts:110-119`）解析失败返回 `[]`，调用方若把它说成「没有会话、系统正常」是错的。零发现文案 `DIAGNOSIS_ZERO_FINDINGS_TEXT` 已经写明证据不足不等于系统正常，但坏文件今天变不成这条文案。

### 3. 用户验收与技术验收

类型里没有 human / automatic。`AcceptanceStatus` 是 `pending | passed | failed | not_required`（`types.ts:34-38`）。

- `not_required`：`resolveChatTurnCloseGates` 在显式 `chat_turn` 且没有校验器时给出，reason 是 `chat_turn_contract_v1:no_external_acceptance`（`chat-entry.ts:416-419`）。这是合同豁免，不是用户点头。
- `pending`：合同未知，或还没人提交验收。不回复就停在这里。禁止把沉默写成 `passed`。
- `passed`：调用方提交，或预检 `acceptanceVerified`。runner 自动补的 evidence `validatorId` 可以是 `agent-runner-execution`（`runtime-from-runner.ts:669-674`）。这是技术回执。
- `failed`：显式失败门。`allowRetry: false` 才关闭；`true` 进入 `recovering`（`judge.ts:70-72`）。correction 路径没有 `allowRetry`，失败会直接关闭。

已有的按任务合同自动豁免可以保留。第一笔 PR 不得把所有验收都改成等人回复。

### 4. 原交付与跟进通知

四件不同的事：

| 事实 | 今天写在哪里 | 跟进通知失败时 |
| --- | --- | --- |
| 原任务产物交给通道 | TaskOutcome delivery。`enqueue_only` 即使 ok 也是 `delivery_unknown`（`delivery-confirm.ts:40-42`） | 不得改 |
| 大白转写被网关接受 | 诊断响应 `delivered/reason`；cron `chat.inject` | 失败是 `conversation_unavailable`。原任务保持原 judgement |
| 离线提醒 | `employee-push` 只服务 mention。本链路没有调用 | 不接入 |
| 用户已读 | 没有原任务回执。支持单 `proposalSeenByUserVersion` 只属于支持单 | 不得伪造 |

`pending-deliveries` 能在子进程里按 taskId 找回原通道登记。它没有 send 函数，drain 也不会发 inject。outbox 第二次 drain 不会把已 ack 的副作用再加一次；ack 丢失后同一版本贡献不会记第二次。这证明任务消费者的幂等，不证明通知能重试。

诊断注入重复调用会再次 send。函数本身没有幂等键。隔离测试里两次接受产生两次 send，任务版本不变。

### 5. 收件人与授权

- 个人：无 tenantId 时 `scopeFromChatEntry` 用 `subjectRef` 做 `personalDomainId`（`chat-entry.ts:47-65`）。subject 可以是 `subject:alice`，大白键要的是另一套 platform user id。`buildEmployeeBuiltinStewardSessionKey("subject:alice")` 与 `"platform-alice"` 不同。
- 企业：有 tenantId 时 scope 带 tenantId 和 subjectRef。诊断鉴权的 tenant 来自 membership，不信任客户端租户（`diagnosis-issue-gateway.ts:141-145`）。
- cron：任务 id 是 `cron:{jobId}:{fireId}`。浮出会话见上表。owner 缺失时现有代码退回 agent main，包括 `agent:main:main`。
- 协作群：普通对话仍是成员自己的 chat task。看板任务要 `claimContract`，默认关。跟进通知没有群收件人解析。

预言 `resolveFollowUpRecipient`：没有映射、或传入的 platformUserId 与映射不一致 → `recipient_unresolved`。不生成 canary 键，不生成 `agent:main:main`。今天的诊断函数没有 subjectRef 参数，所以它无法做这道检查；没有 owner 时已经 `conversation_unavailable`，这是失败关闭，但不是「核对过任务主体」。

### 6. 修复责任与关闭权

| 动作 | 谁可以做 | 对原任务 |
| --- | --- | --- |
| 诊断 confirm | `confirmDiagnoseEvolutionPrescription`。caller 必须是 targetOwner，或持有匹配 grant。写 cron，`delivery.mode=none`（`diagnose-evolution-prescription.ts:289-308`） | 不改。job 描述里没有原 taskId。缺 content hash 的第二次 confirm 返回 `prescription_hash_required`，不追加 job |
| 处方执行 / Issue apply、recheck、writeback | 网关无条件 `confirm_not_enabled`。库函数只有测试传入 `enabled: true` 才在自己的 issue 目录里走完 | 隔离测试中的 TaskOutcome 不变。这不是生产网关 |
| 运行时变更 | 治理默认 assist，不改运行时。skill auto 默认关。remediation 常量 false | 不关用户任务 |
| 人工接手 | confirm 的 cron 带 `ownership.ownerId` 和 wakeText，没有「下一步结果写回哪个 taskId」 | 不能称为闭环 |
| 支持单关闭 | `applySupportCaseResolution` | 不改 TaskOutcome |
| 任务关闭 | 只有 judge | 支持单、报告、注入、曝光都不能关 |

## C. 第一笔业务 PR 的范围

**决定：拆成两笔。本期两笔都不写。**

### PR-1（下一次授权后才做）：显式否定写回 + 诊断只读

依赖：写回产生新版本；读者必须认版本。放在一笔里，避免出现「tip 已改、诊断仍只读 jsonl」的窗口。通知不放进来，因为回滚和身份映射是另一块表面。

要动的生产位置：

1. 把测试里的 `classifyUserNegationCandidate` 落到回复链可调用的纯函数。不要扩大 `deriveInboundFeedbackSignals`，也不要让 `applyGoalCorrectionMutation` 去写 TaskOutcome。后者继续只改 workspace task context。
2. 只在分类为 `explicit_prior_artifact` 且 `explicitTargetTaskId` 命中候选时，对**那个** taskId 调用已有 `correction`。候选不足或不止一个：不写，向用户问是哪一条。`commandId` 用源消息 id，保证重复投递不产生第二版。
3. `chat-entry.ts` 与 `runtime-from-runner.ts` 构造服务时传入 allowlist。allowlist 只能是该任务已验证的 `scope.subjectRef`。不要做全局审核人名单，不要在主体对不上时改写别人的任务。
4. 新增只读读者：输入 taskId + outcomeVersion，读 version 快照；tip 版本不同则返回 `outcome_version_changed`。诊断报告引用它。`structural-preview-reader.ts` 的 jsonl 继续当投影，失败样本不能被 `succeeded && eligible` 滤掉之后假装没有这次任务。坏的 session 文件必须和「没有会话」区分开。
5. 不改 `judge.ts` 的成败谓词。

为何现有机制不够：

- 正则没有任务 id，也没接到回复链。
- 目标修正写的是另一份存储，而且会误伤引用句。
- correction API 已能追加版本、保留历史、撤销旧贡献，但生产构造器拒绝所有调用者。
- 诊断没有 TaskOutcome import，jsonl 读者丢掉失败。

验收：

- 合成会话对已关闭任务发送明确否定，且带上该 taskId：tip `revisionKind=correction`，旧版本仍可按版本号读到，evolution 消费者撤销旧的 success 计数。
- 「他说不对」、天气、纯新增需求、两个候选且没有点名：TaskOutcome 不变。
- 诊断读者在工具失败但任务 success 的 tip 上读到 success，同时看见工具观察；请求旧版本时得到 `outcome_version_changed`，而不是「正常」。
- 正文 transcript 仍不可作为证据。

兼容与回滚：同一 taskId 增加版本，旧文件留在 `versions/`。回滚是去掉调用点和 allowlist。已写下的历史版本不删。没有新目录。

### PR-2（再下一次授权）：通知语义与收件人

不与 PR-1 捆绑。在 `subjectRef → platformUserId` 被产品明确之前，只允许失败关闭，不允许猜。

要动的位置：

- `diagnose-daibai-inbox.ts:159-166` 与 `diagnose-policy.ts:225-248`：计划函数和发送函数今天各说各的。发送结果保留 `conversation_accepted`，`delivered: true` 若继续存在，文档和 UI 都只能把它当「转写被接受」。
- 已有消费者：`ui/src/ui/ports/diagnosis/diagnosis-panel.ts` 把 `delivery.delivered === true` 抄进 `deliveryDelivered`。`ui/src/ui/ports/enterprise/diagnosis/enterprise-diagnosis-surface.ts` 的 `deliverySuffix` 在 `deliveryDelivered` 或 `conversation_accepted` 时写「报告已投送到指定大白对话区」。这是通知文案，不是任务成功，也不是已读。改名或改文案必须同一笔改掉这两处，并写回滚。
- 新的收件人函数实现测试里的 `resolveFollowUpRecipient`。无映射、身份不一致、结果会落到 `agent:main:main` 或 canary：不发送。
- 不改 `resolveCronSurfaceSessionKey` 的现有 cron 退回，除非单独证明每条现有 cron 任务都有 owner。跟进通知禁止调用这个退回。

为何不复用队列：pending-delivery 是原通道登记；outbox 是任务事件，一次关闭有多条，且与 inject 无关。空回复计数重启即失。这三处都证明不了「通知没送到，稍后只补一次，且不改原任务」。缺口保留，不新开队列，也不硬接。

兼容：旧字段 `delivered` 保留一个版本，含义锁定为 transcript accept。任何判断任务成功或用户已读的代码不得读它。回滚是恢复文案和 reason 字符串；不回滚 TaskOutcome。

### 两笔都不含

父任务 rollup、学习自动采纳、缺口按用户聚类、APNs、remediation、Issue 网关写回、claimContract 开关、治理 auto、skill auto。

## D. 即使补验全部通过，整圈仍然缺的环节

从「用户说不对」到「原场景再验」再到「大白跟进」：

1. 没有生产调用把用户回复提交到目标 task 的 correction。直接 API 成功只说明库做得到。
2. 没有人配置生产 allowlist。空名单是今天的安全默认。
3. correction 到 failure 会把任务关成失败，不会自动再跑一遍原场景，也不会派一个复验 attempt。
4. 诊断生产路径不读 tip。读者预言只活在测试里。
5. 没有 `subjectRef` 到 platform user 的映射，也没有 owner 负责维护它。
6. 没有通知失败的持久重试。现有磁盘结构语义不对，本期故意不接。
7. confirm 写的 cron 不带原 taskId，`deliver: false`。人接手只有 owner 和 wake 文本，没有写回结果的位置。
8. Issue 复查回写在网关上不发生。支持单关闭不碰原任务。
9. 用户已读没有存储。inject 接受不能代替。
10. 经验验证的磁盘撤销函数会落到默认 workspace（`createWorkspaceCollaborationStores` → `loadConfig()`）。本期只跑了纯函数 `resolveExperienceVerificationPlan`，没有跑 handler 的落盘。见未验证。

因此「反馈能写回 + 诊断能读 + 通知改名」不是一条完整闭环。

## 未验证

| 项 | 原因 |
| --- | --- |
| 生产网关是否在跑，以及 `OPENBOT_DIAGNOSIS_TICK`、`OPENBOT_EVOLUTION_GOVERNANCE_MODE`、`OPENBOT_SKILL_AUTO_EVOLUTION`、`OPENBOT_EVOLUTION_SOFT_OBSERVE_DH`、`collaboration.task.claimContract` 的实际值 | 未读 LIVE，未打开容器 `build-info.json` |
| 运行镜像里的 `DIAGNOSIS_*` 常量是否与本 SHA 一致 | 同上 |
| 用户客户端是否在线、能否从历史拉到 inject、是否阅读 | 没有已读回执，且禁止连接真实流量 |
| Employee APNs 生产送达 | 未调用，闭环本来也没接它 |
| canary tenant `001` 与 `diagnosis:canary:daibai` 是否仍有流量 | 未读生产 |
| 多 Gateway 实例下内存缺口去重的实际重复率 | 只证明了两个进程计数互不可见 |
| `createExperienceVerifiedHandler` 在修正后撤销 `outcome_verified` 计数的磁盘效果 | 该路径会 `loadConfig()` 并写默认协作工作区。本期拒绝碰默认目录。纯函数计划已覆盖「无采纳则不验证」 |
| 父任务 rollup、学习采纳接线、缺口持久去重 | 明确不在本期。代码检索仍是「没有执行」 |

## Loom

任务 `closed-loop-isolation-contract:cursor-closed-loop-490b`，owner `cursor-closed-loop-490b`，session `02dd5c3c-9e50-4cb8-ac0d-75e5ba88cab9`。

`pnpm loom register` 能写入并被 `loadRegistry()` 接受，但 `saveRegistry` 会重排无关条目。第一次落盘的 diff 是 `.loom/registry.yaml` +41/-16，其中包含别人 intent 的折行、给 `infrastructure-audit:p1-object-recovery` 补默认 `state/sessions`，以及把 `controlled-discuss-to-task-p1-20261031` 从带 owner/intent/state 的记录改成 `landingPolicy: serial`。该次写入已撤回。随后只插入了与 register 相同的任务记录，并在 `landingStreams` 最前面加了 `closed-loop-isolation-contract-20261101`（serial，只覆盖本期限定的文档、spec 和两个测试文件，不包含 `.loom/registry.yaml`，避免抢走别人的注册表落地分类）。`loadRegistry()` 读到 owner、4 条路径、1 个 session。

`pnpm loom lint` 退出码 1，因为仓库里原有大量 warn（本次统计 ownership-overlap 1778 条）。本任务新增：

- `active-task-no-issue`：本期没有 GitHub issue。不新开 issue。
- `ownership-overlap`：与 `pi-sdk-family-migration-v3:cursor` 的 `src/**` 重叠。

另外用 `globsOverlap` 直接比对，测试文件还落在 `askOutcome-p0-task-outcome-contract` 与 `askOutcome-p0-r83-remediation` 的 `src/task-outcome/**` 里。lint 对这两对没有单独打出本任务的行。没有改这三个旧任务的 owner，也没有把 `src/**` 收到本期名下。
