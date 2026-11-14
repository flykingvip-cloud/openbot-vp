# P3 有效策略生命周期（激活契约设计；本轮不实施）

- 状态：P2 影子组件阶段验收已通过（范围是受控端口与替身测试，不代表生产治理已接通或可以激活策略）。本文件只交激活契约：绑定、CAS、生效节点、撤销与回退。不实现激活入口，不接入执行，不改 P1／P2 源码，不改变 `activationAllowed=false`，不启用策略，不写生产配置，不启动 P4／P5。
- 盘点／行号基线 SHA：`9b65109f41dee30b892a6faff493e46e735cab8d`
- 工作树登记 SHA（仅登记上下文，不是兼容性证明）：`4a786626a1e2892043f57b3832ddf2a407be284a`
- 时间：2026-11-12 18:56（Asia/Shanghai，UTC+8）
- 前置：已验收 P0 决策表、P1 合约与纯校验器、P2 影子组件；P2 完整冻结包见 `/workspace/runtime-rule-adaptation-p2-frozen/`（密封后只读，本文件不混入该包）。
- 验收矩阵：`p3-activation-test-matrix.md`。原计划依据：`/workspace/openbot-dynamic-rule-adaptation-plan.md` §8、§4.1–§4.4。
- 本轮不宣称已实施激活器、已接通治理，或已存在非空生产白名单。
- 变更记录（2026-11-12 19:18，Asia/Shanghai，UTC+8）：Owner 已锁定个人快照落点与首期空白名单，并放行有限 P3 实施（类型、预检、CAS 夹具与失败测试）。本轮**不是** P3 代码验收、合并或部署批准。已锁定决定见文末「已锁定」节，不改写上文已验收正文。

## 1. 分层与单独入口

P1 公开校验器 `validateRuntimeRuleProposal(proposal, hostFacts)`（`src/agent-runtime/policy/rule-adaptation/validate.ts`）与 P2 公开影子入口 `runShadowRuleAdaptation`（`src/agent-runtime/command/rule-adaptation/index.ts`）的产品结果必须继续满足 `activationAllowed === false`，语义与已冻结契约完全相同。影子成功、`shadow_accepted`、或模型在提案里写入 `activationAllowed`／`activateNow` 等禁止字段，都不得打开激活。

P3 另设受控、由宿主调用的激活用例，名称定为：

| 用例 | 设计名称 | 调用方 | 作用 |
| --- | --- | --- | --- |
| 激活 | `activateApprovedRuntimeRuleProposal` | 测试入口或明确审批的宿主，不是模型，不是影子编排 | 在确定性校验之后，经 state CAS 写入不可变生效快照 |
| 撤销 | `revokeActivatedRuntimeRulePolicy` | 同上 | 撤回授权、目录下架或停用后，按当前授权处理生效快照 |
| 回退 | `rollbackActivatedRuntimeRulePolicy` | 同上 | 一次**新的版本变更**，按**当前**授权重核后写入新快照 |
| 读取 | `readActivatedRuntimeRulePolicy` | 宿主／未来消费者；P3 只定义读契约，不接线主链 | 读取 state 已持久化的生效快照；不是影子内存结果 |

上述名称是本阶段的设计符号，尚未在源码中实现，不得被写成已经存在的导出函数。实现阶段不得把这些入口挂到 `validateRuntimeRuleProposal` 或 `runShadowRuleAdaptation` 的返回路径上，也不得因为影子跑通而自动调用。

无任务绑定可以咨询（走 P1／P2），但不能激活任务策略（计划 §4.1）。未知授权不得推断。提案不得携带授权或兼容性证明：这些事实仍只走宿主侧参数，与 P1 封闭提案模式及 `FORBIDDEN_PROPOSAL_KEYS` 一致。

## 2. 现有权威与版本轴（必须对齐仓库事实，不得另造第二套）

激活是在**既有 state／编译权威**上记录或选择一份生效策略快照，不是新建配置文件、第二套目录、第二套参数权威，也不是改写 `SYSTEM_INVARIANTS` 或编译硬门禁。

### 2.1 已存在、必须复用的机制

1. **会话任务板 CAS（个人／会话任务状态权威）**  
   `SessionTaskBoard.writeEpoch` 是板上每次成功写入后，由磁盘值在同一文件锁内单调递增的世代（`src/agent-runtime/state/repository/task-board-file.ts`：`writeSessionTaskBoardUnlocked`、`writeSessionTaskBoard`、`mutateSessionTaskBoard`、`StaleSessionTaskBoardWriteError`）。现有变更（如 `admit-task.ts`、`resume-current.ts`、`interaction-proposal.ts`）以 `expectedWriteEpoch` 比较；接线层把任务目标写成 `{ taskId, revision: String(board.writeEpoch) }`（`src/agent-runtime/command/host-task-target.ts`）。这是当前真实的 task／state 版本 CAS 轴。生产 RMW 必须走持锁的 `mutateSessionTaskBoard`（或其既有封装），不得在锁外拿过期快照再调用会覆盖的写入。

2. **P1 已建模的策略版本**  
   `RuntimeRuleAdaptationExpectedPolicyVersion = { policyHash, protocolVersion, compilerRevision }`（`src/agent-runtime/contracts/rule-adaptation.ts`）。这与协作编译输出一致：协议常量 `COLLABORATION_POLICY_PROTOCOL_VERSION = "1.1"`，编译器修订 `POLICY_COMPILER_REVISION = "1.2.0"`，内容身份为 `policyHash`（见 `collaboration-rules.ts`、`collaboration-policy-identity.ts`、`handoff-txn.ts` 的 key、以及 `RoundPolicySnapshot`）。不得再发明平行的“策略版本”字段来替代这三项。

3. **目录版本与实现版本必须分开**  
   规则目录条目的 `version` 现为 `inventory:<旧 pin>`（`src/agent-runtime/policy/catalog.ts` 的 `INVENTORY_VERSION`）。P0 已写明：该 pin 落后于盘点 SHA **不单独**使规则版本无效；实现版本以盘点 SHA 上的源码为准（例如 `model.context_window.guard` 对应 `context-window.ts`，`collab.policy.compile` 对应 `compileEffectiveCollaborationPolicy`）。任务策略版本（见下）与目录 version、规则实现版本、`expectedPolicyVersion` 是不同轴，激活快照必须分别记录，不得混用一个数字。

4. **协作侧已有冻结快照权威**  
   `RoundPolicySnapshot`（`src/gateway/collaboration-dispatch/round-policy-snapshot.ts`）含 `policySnapshotId`、`policyHash`、`provenanceHash`、`compilerRevision`、冻结的 `effective` 与输入。配置开关 `collaboration.policySnapshot`（计划名 `collab.policySnapshot`）默认 `false`；关闭时不持久化快照正文。交接契约 `HandoffTxnContract.key` 已包含 `policySnapshotId`／`policyHash`／`compilerRevision`。P3 **不得**另建第二套协作策略 store，也**不得**把打开该生产开关当作本阶段激活实现的一部分。

5. **认领／执行身份（不是新的 claimVersion 字段）**  
   任务板上的活执行身份是 `TrackedTask.executionAttempt`（及完成绑定里的同名字段，`execution-binding.ts`）。异步等待独占认领另有 `claimToken`（`claimQueuedExecution`／`bindAsyncWaitRecoveryTurn`）。并发回滚已按“不得覆盖更新的 attempt”做 CAS（`restoreBoardExecutionAttemptAfterFailedBind`）。P3 不发明 `claimVersion`。

6. **`planVersionId` 不是本契约的 CAS 轴**  
   仓库里大量 `planVersionId` 属于商业订阅／用量（`authorized-session`、commerce、credit-usage）。不得把它当作任务计划或策略版本来做激活 CAS。

### 2.2 映射到计划原文“task／claim／plan／策略版本”

| 计划用语 | 本仓库对应事实 | P3 绑定要求 |
| --- | --- | --- |
| task 版本 | `taskId` + `SessionTaskBoard.writeEpoch`（`revision = String(writeEpoch)`）；并核对其 `resetGeneration`／墓碑／取消状态 | 激活请求必须带 `expectedWriteEpoch`，缺失则结构性拒绝。CAS 比较磁盘 `writeEpoch`，冲突不得覆盖较新写入 |
| 策略版本 | 已有 `expectedPolicyVersion`：`policyHash` + `protocolVersion` + `compilerRevision` | 必须与提案内已绑定值及**当前**编译／生效内容身份一致；过期或未知版本拒绝 |
| claim 版本 | 若存在活的 `executionAttempt`（及适用时的 `claimToken`），比较该身份；不另造字段 | 请求必须显式声明预期执行身份或封闭的“无活认领”哨兵。活认领与预期不符 → 冲突或拒绝。哨兵的精确字面量待核准，但必须是封闭枚举，不得省略后默认“无所谓” |
| plan 版本 | 协作：既有 `episodeId`／`beatId` 与（若已存在）`policySnapshotId`，外加 `policyHash`／`compilerRevision`。个人任务板**没有**独立的 work-plan 版本字段 | 个人场景不发明 plan 版本轴。协作必须绑定真实 episode／beat／已有快照身份；不得把商业 `planVersionId` 塞进绑定 |

### 2.3 快照落点（待核准，但边界已封闭）

个人／会话任务的生效快照必须写入**既有** `SessionTaskBoard` 权威：与 `writeEpoch` 同一把锁、同一次原子写入。不得新建 `*.effective-policy.json` 之类的平行 store，不得改 `OpenBotConfig` 或 operatingState 来“顺便生效”。字段是挂在 `TrackedTask` 上还是 board 级按 `taskId` 索引，实现前**待核准**；无论落点如何，都必须绑定 `taskId` 与 `TaskBoardScope`（`tenantId`／`userId`／`sessionId`），并随 `writeEpoch` 一起 CAS。

协作侧若激活影响到 EffectivePolicy，只能选择或引用既有编译权威（`compileEffectiveCollaborationPolicy`／已有 `RoundPolicySnapshot`），并仍受 `SYSTEM_INVARIANTS` 与编译硬门禁约束。如何与默认关闭的 `collaboration.policySnapshot`、以及 lane（`legacy | shadow | effective`，源码默认 unset = legacy）组合，**待核准**。在该点核准且 P4 接线之前，协作激活契约仍可在测试夹具中演示 CAS 与失败语义，但不得声称主链 dispatch 已改读本快照，也不得为了激活去打开生产开关或写入第二套配置。

## 3. 封闭输入与绑定

`activateApprovedRuntimeRuleProposal` 的输入必须是 JSON-like 无环普通数据对象，深度上限与 P1 相同（`RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH`）。未知字段、禁止字段、非普通对象、循环引用、过深输入：整份结构性拒绝，且**不得**写入 state。

### 3.1 提案部分（沿用 P1 封闭模式，宿主不得让模型夹带证明）

激活所针对的提案必须是已校验的 `policy_proposal`，字段仅限 P1 的 `POLICY_PROPOSAL_ROOT_KEYS`：`kind`、`scope`、`implementationVersion`、`expectedPolicyVersion`、`items`。提案中一旦出现 `FORBIDDEN_PROPOSAL_KEYS`（含 `authorizationStatus`、`authorizationAssessment`、`activationAllowed`、`activateNow`、`compatibilityRecord` 等）或未知字段，结构性拒绝。`rule_candidate` 不得作为激活输入。

### 3.2 宿主绑定部分（独立参数，不得从提案推断）

宿主必须同时提供以下绑定，缺一则 `structural_missing_binding`，不进入 CAS 写入：

1. **可信授权引用** `authorizationReference`：指向宿主侧授权记录的引用（标识符），不是提案内的布尔“已授权”。激活时必须**重新**评估当前授权，而不是复用旧校验结果里的 `authorizationAssessment`。仅当当前评估为 `host_authorized` 时才允许成功激活。`host_unauthorized` 或 `assessment_unavailable` 拒绝，且不改生效快照。
2. **可信身份与作用域** `identity`：`HostIdentity`（`principalType`／`principalId`／`scope`）必须与提案 `scope` 及任务板 `TaskBoardScope` 一致，否则 `identity_scope_mismatch`。
3. **任务／作用域身份** `taskBinding`：至少包含 `taskId` 与用于定位既有任务板的会话／作用域键。无任务绑定不得激活。任务已取消、墓碑（`TaskTombstone`）、或不属于当前 `resetGeneration` 的默认目标：拒绝，且不得复活。
4. **预期版本** `expectedVersions`：至少包含 `expectedWriteEpoch` 与完整的 `expectedPolicyVersion`（三项字符串均非空）。缺项为结构性拒绝。协作按 §2.2 补齐 episode／beat／已有 `policySnapshotId`（若有）。活执行认领按 §2.2 显式绑定。
5. **已核准候选身份** `approvedCandidateIdentity`：必须精确标识“哪一份已校验提案”（建议为规范化提案字节的内容哈希 + 校验结果 `resultKind` + 校验器实现／协议版本）。激活时的提案必须与该身份逐项相同；任何改写（含调参值、ruleId、作用域、版本）都视为未核准输入。
6. **宿主门禁** `hostActivationGate`：封闭枚举，仅 `test_entry` 或 `explicit_approval`。不得出现模型门、影子成功门、或可调权限开关。
7. **所行使的权限轴** `permission`：`select`／`tune`／`modify`／`create`／`disable` 彼此独立（P1 行动词仍按已验收合约解释；`delete` 不是合法回退，见 §9）。请求的权限必须覆盖提案 `items[].action`，且当前授权必须单独具备该轴。

测试夹具可继续使用 `fixture=true` 标记，但与 P1 相同：只是夹具标记，绝不是凭证。

## 4. 仅使用已核准候选；白名单在独立验收前为空

计划原文：“候选不能激活。先只允许测试或明确审批入口激活白名单。”

下列输入**一律不得激活**，无论影子看起来多合理：

- `rule_candidate`，以及校验结果 `candidate_validated`（P1 已声明该结果不是登记回执，更不是激活凭证）。
- 仅有 `shadow_accepted` 而没有宿主门禁与白名单命中：`shadow_accepted` **不是**激活凭证。
- `no_change`、`needs_information`、`blocked`。
- 未登记、未核准、或 P2 `p2_persist_forbidden` 的候选落盘替身。
- 不在已核准白名单中的 `ruleId`／字段／行动。
- 校验时的提案身份与激活时不一致。

**先决条件（同时满足）**：

1. 对**同一** `policy_proposal` 身份，已由 `validateRuntimeRuleProposal` 得到 `resultKind = shadow_accepted`（合法有界提案；授权轴仍以激活当时的宿主重评为准）。
2. 宿主门禁为 `test_entry` 或 `explicit_approval`。
3. 该 `ruleId` + 字段 + 权限轴命中**已独立验收**的运行时白名单。

P0 决策表 §6 已明确：`model.context_window.guard`（`agents.defaults.contextTokens` 有界收紧）与 `collab.policy.compile`（仅 `maxVisibleBotRepliesPerRound` 有界收紧）是 **shadow-proposal 候选，不是运行时白名单**；动态调整授权尚未建立。因此，在独立验收给出真实 ruleId／参数并关闭白名单之前，**运行时白名单为空**。空名单上任何激活请求都必须拒绝。本设计不发明可调权限或新的 ruleId，不把 P0 候选自动升格为白名单，也不填写生产白名单内容。

说明：用户任务里曾举例“`candidate_validated` 加宿主核准”。在已验收的 P1 合约中，`candidate_validated` 专指 `rule_candidate` 的结构通过，且计划禁止候选激活。本契约不以该例覆盖 P1 语义，而以 `shadow_accepted` + 宿主门禁 + 非空白名单作为政策提案的先决条件，并以矩阵用例固定“`candidate_validated` 不能激活”。

## 5. 经 state 的 CAS

成功路径（全部检查通过之后，在同一把任务板锁内）必须是一次原子 compare-and-swap：

1. 再读磁盘上的 `SessionTaskBoard`（及协作侧若已核准的既有快照身份）。
2. 比较绑定的 `expectedWriteEpoch`、`expectedPolicyVersion`、任务／作用域／身份、授权引用所指向的**当前**授权、以及 §2.2 的 claim／plan 绑定。
3. 仅当全部相等且授权仍为 `host_authorized`、规则仍在目录且白名单仍命中、任务仍活、提案未过期时，写入新的不可变生效快照，并使 `writeEpoch` 从**磁盘值**加一。
4. 写入失败或比较失败不得留下部分字段。

并发提案不得覆盖较新版本：若磁盘 `writeEpoch` 已大于请求的 `expectedWriteEpoch`，结果为 `conflict`（CAS miss），**既有生效快照保持不变**。这与 `StaleSessionTaskBoardWriteError` 及现有 “不得覆盖更新 attempt” 的语义一致。P3 实现应把这类冲突映射为稳定的激活结果，而不是让调用方吞掉未分类异常后误认为成功。

若现有 `writeEpoch` CAS 不能单独覆盖某条必需比较（例如协作 `policySnapshotId` 与任务板不在同一文件），不得为图方便再写第二份权威。应在同一事务边界内比较所有绑定；做不到的组合标为**待核准**，在核准前该组合的激活必须失败关闭，而不是降级为“只比较 writeEpoch”。

### 5.1 结果种类（设计；尚未实现类型）

| `resultKind` | 含义 | 既有生效快照 |
| --- | --- | --- |
| `activated` | CAS 成功，新快照已持久化且在返回前冻结 | 被新快照取代（旧快照只作为历史，不是不可撤销权利） |
| `conflict` | CAS 未命中（并发更新、预期 `writeEpoch`／执行身份过期） | 保持不变 |
| `rejected` | 结构、绑定、未核准、白名单空、授权、下架、过期、身份隔离等 | 保持不变 |
| `persist_failed` | 比较通过但持久化失败或锁／I/O 失败 | 保持不变；不得出现部分激活 |

激活结果对象在返回时冻结。晚到的磁盘状态或重试不得改写调用方已经拿到的快照（与 P2 已返回结果纪律一致）。P1／P2 的 `activationAllowed` 字段不出现在本结果里，更不得回写到校验器或影子结果上把它变成 `true`。

### 5.2 过期与陈旧

“过期提案”包括但不限于：宿主 `expectedPolicyState` 为 `expired`／`cancelled`／`tombstone`；绑定的 `expectedPolicyVersion` 或 `expectedWriteEpoch` 与当前权威不一致；宿主提供的提案有效期已过。仓库**没有**现成的规则适配提案 TTL 常量；本设计不发明默认小时数。若要以时间为过期条件，必须由宿主显式给出截止点，否则只按状态与版本绑定判断。陈旧预期版本与过期提案都不得激活，且保持既有快照。

## 6. 成功后的不可变生效快照

成功写入的快照在返回前深冻结，之后不得原地改字段。内容至少包括：

- `ruleId` 与**实现版本**（盘点 SHA 上的源码实现身份，不是目录 `inventory:` 字符串单独代替）。
- 目录版本（`INVENTORY_VERSION` 这类目录声明，原样记录，不与实现版本混用）。
- 参数（已校验的有界值；不得记录被编译器钳制后的“原提案通过”值）。
- 适用对象（scope + `taskId` + `TaskBoardScope`）。
- 来源（哪次批准、哪份校验身份、哪条授权引用、哪道宿主门禁）。
- schema／编译版本：`protocolVersion`、`compilerRevision`、`policyHash`（及协作若已有的 `provenanceHash`／`policySnapshotId`）。
- 任务策略版本：本次成功写入后的 `writeEpoch`（以及绑定的 taskId）。这与目录版本、规则实现版本、`policyHash` 分开。
- 生效步骤／生效节点声明（见 §7；P3 只记录约定，不执行主链强制）。
- 时间与变更者（宿主身份，不是模型身份）。
- 所行使的权限轴与行动。

历史快照可审计，但**不是不可撤销的权利**（计划 §9／P4 主题，P3 必须先写明以免被误读为“有旧快照即可一直行使旧权限”）。同一策略版本仍受最新取消／撤权约束。

## 7. 生效节点（设计诚实边界）

一份快照在 **CAS 持久化成功的那一刻**成为该绑定作用域（该任务／该 `TaskBoardScope`，协作则还含已绑定的 episode／beat）上的“P3 生效策略”。此后 `readActivatedRuntimeRulePolicy` 必须读 state 已持久化的内容，而不是进程内影子结果、校验器返回值或模型文本。

P3 **不**把该快照接到主链强制执行。当前主链仍使用既有参数权威，例如：

- 个人上下文窗口：`prepare-embedded-model.ts` 经 `evaluateContextWindowGuard`／配置解析得到有效窗口（P0 已记录 compact／extensions 路径缺口）。
- 协作：`compileEffectiveCollaborationPolicy` 与（默认关闭的）`RoundPolicySnapshot`；lane 默认仍可能走 legacy。

未来消费者（P4）应在明确触发点读取本快照，且不得与旧选择源同时裁定。本阶段只规定：若有人现在就去读主链，读到的仍是旧权威；不得把“P3 契约已写”说成“运行时已强制”。测试可以在注入的任务板上断言快照读写、CAS 与隔离，但不得修改生产配置或打开生产开关来冒充接线完成。

## 8. 撤销

`revokeActivatedRuntimeRulePolicy` 同样是宿主调用，必须重核身份隔离与当前权威。触发包括：撤回授权、规则从目录下架、对某规则／字段行使已授权的 `disable`、任务取消或进入墓碑。

语义：

- 撤销成功也是一次新的 state 变更（推进 `writeEpoch`），记录不可变的撤销事实；不是偷偷清空历史。
- 撤销后，该作用域不得再按被撤权限执行相关动作。已写入的历史快照仍可审计，但不得继续当授权用。
- 规则下架：即使快照里还写着该 `ruleId`，新的激活／回退／主链消费（未来）都必须拒绝依赖该规则的放宽或继续启用；仍合法且不依赖已下架规则的现策略可以保留。
- 授权被撤回：未完成的激活必须失败；已生效但依赖该授权的部分不得继续作为权利来源。

Agent 不可用（模型、影子入口或适配 Agent 故障）时：保留**仍然合法**的当前策略；不得借机清空策略，也不得因为 Agent 不可用就自动激活任何提案。

若强制事实不足（身份、作用域、当前有效值、授权评估、兼容性、预期策略状态等，对应 P1 的 `missingFact`）：**阻止相关动作或等待补齐**，不得笼统“全部失败继续”，也不得“所有聊天冻结”。无关的普通问答与不依赖该事实的既有合法策略仍可按其原边界工作。

## 9. 回退

`rollbackActivatedRuntimeRulePolicy` 是一次**新版本变更**，不是把磁盘倒回旧字节、也不是删除参数让编译器回退到更宽默认值。P0 已写明：删除已有帽或删除字段使编译回到更宽默认，属于可能的放宽，不是合法回退。

回退必须：

1. 给出目标快照或目标已授权有效值（须仍是当时合法、且**现在**仍被授权的状态）。
2. 按**当前**授权、当前目录、当前白名单、当前任务存活状态重核。
3. 经同一套 CAS 写入新快照。
4. 不得恢复已经撤销的权限。
5. 不得复活已取消或墓碑任务。
6. 权限轴独立：一次只以当前授权拥有的轴（选择／调参／修改创建／停用）进行；有调参权不等于有停用权，有停用权不等于可以回退出已撤销的选择。

## 10. 身份隔离与重启

激活、撤销、回退与读取都不得跨租户、跨用户、跨会话、跨群。比较必须包含 `TaskBoardScope` 与提案 `scope`；协作还须包含 `groupId`／`tenantId` 及已绑定的 episode。键不完整则失败关闭，不得靠“路径碰巧能读到文件”成功。

进程重启后，生效快照以 state 持久化内容为准。影子运行的内存结果、未持久化的校验对象、或晚到的模型输出都不是激活来源，也不得在重启后补写为生效策略。

持久化失败：保持上一份生效快照，无部分激活。

## 11. 本轮明确不宣称、待核准项

不宣称：P3 已实施；生产白名单已有内容；生产治理已接通；可以激活策略；主链已改读本快照；`collaboration.policySnapshot` 将被打开；商业 `planVersionId` 将参与 CAS。

待核准（证据不足则保持失败关闭，不放宽）：

1. 生效快照在 `SessionTaskBoard` 上的具体字段名与落点（`TrackedTask` vs board 级映射）。
2. 协作激活与默认关闭的 `RoundPolicySnapshot`／lane 如何选择同一权威，而不写入第二 store、不打开生产开关。
3. “无活认领”哨兵的精确封闭字面量，以及激活是否允许发生在活 `executionAttempt` 期间的产品规则（比较规则本身不待核准：不匹配就必须失败）。
4. 若需要时间型提案过期，宿主截止点的字段名与权威时钟；不发明默认 TTL。
5. 空白名单被独立验收填充之前，任何非测试夹具的成功激活都不得被设计成可能发生。测试入口可以在**测试夹具白名单**上演示成功 CAS，该名单不是生产白名单，不得写入生产配置。

## 12. 已锁定（2026-11-12 19:18，Asia/Shanghai，UTC+8）

本轮是有限 P3 实施，**不是** P3 代码验收、合并或部署批准。提交、推送、PR、合并、部署仍未获授权。P1／P2 的 `activationAllowed=false` 保持不变。

### 12.1 个人快照落点

- 字段名：`SessionTaskBoard.runtimeRuleAdaptationByTaskId`（board 级、按 `taskId` 索引的映射）。
- 每个条目为 `{ current?, history[] }`：当前快照与不可变历史。不得把快照挂在 `TrackedTask` 上（任务 CLOSE 会丢掉仅挂在任务上的字段，但撤销／审计需要历史仍在）。
- 必须写入既有 `SessionTaskBoard` 权威，与 `writeEpoch` **同一把文件锁、同一次原子写入**。不得新建策略文件或独立 store，不得改 `OpenBotConfig`／operatingState。
- 官方 `readSessionTaskBoardUnlocked` 与 `cloneBoardShell` 必须保留该可选字段，否则重启读取不能成立（`writeSessionTaskBoardUnlocked` 虽会展开写入，但下一次官方读取会丢掉未列入白名单的键）。这是对他人所有的 `src/agent-runtime/contracts/task.ts` 与 `src/agent-runtime/state/repository/task-board-file.ts` 的协调外科修改，**不**把这两份文件登记为本任务独占路径。
- 协作激活与默认关闭的 `RoundPolicySnapshot`／lane 如何共用既有权威，仍为待核准；本轮协作路径失败关闭，不打开 `collaboration.policySnapshot`，不接线主链。

### 12.2 首期白名单为空

- 生产／运行时白名单保持空数组：`PRODUCTION_RUNTIME_RULE_WHITELIST = []`。空名单一律拒绝。
- P3 只能使用 `test_entry` 或夹具中的 `explicit_approval`，外加**测试夹具白名单**。E-04 即使成功，也只证明测试激活链路，必须标明 `whitelistSource=fixture`，不得形成真实非空生产白名单，也不得声称主链已生效（`mainChainWired` 恒为 `false`）。

### 12.3 「无活认领」哨兵（本轮实现字面量）

- 封闭常量：`NO_LIVE_EXECUTION_CLAIM = "no_live_execution_claim"`（`src/agent-runtime/contracts/rule-adaptation-activation.ts`）。
- 请求必须显式给出预期执行身份或该哨兵；省略不得默认为“无所谓”。
- 无活 `executionAttempt` 且无活 `claimToken` 时，必须使用该哨兵。不发明默认 TTL；若宿主未给 `expiresAtMs`，只按状态与版本绑定判断过期。

### 12.4 对照上文待核准项

- 原 §11 第 1 项（落点）与第 3 项（哨兵字面量）按本节锁定。
- 原 §11 第 2 项（协作权威组合）与第 4 项（时间型截止字段名／权威时钟）仍待核准；核准前失败关闭。
- 原 §11 第 5 项（空白名单）按 12.2 锁定。
