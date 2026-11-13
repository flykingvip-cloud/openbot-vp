# P4 个人主链接入设计（设计方向已通过；本文件为 t20u 修订，不是生产生效批准）

- 状态：个人场景 P3 有限实施及冻结包已由 Owner 关闭。设计方向已由 Owner 通过（t20u）。**本轮验收的是设计文档，未验证线上配置或执行效果。** 本文件是对该设计的最小修订：锁定三项实施选择，并修正「失效快照自动回退」语义；无需重写方案。P4 本次仅放行上述限定测试接入，不代表生产生效、合并或部署批准。协作快照／lane 仍单独核准；生产白名单、合并和部署未放行。不改 `SYSTEM_INVARIANTS` 与硬下限常量，不打开 `collaboration.policySnapshot`，不补偿 T9。
- 授权（t19u）：「下一步可准备 P4 接入设计，先明确个人场景的策略读取、生效节点及原参数来源衔接，不直接接线。协作快照／lane 仍单独核准；生产白名单、合并和部署未放行。」
- 授权（t20u）：设计方向通过；锁定消费者覆盖 C、宿主注入端口（默认 `original`）、本次尝试在模型准备时固定上下文帽且后续尝试重读；修正失效／撤销不得混为「无快照」；身份按最小方式落实；可修订文档并开始个人场景限定测试接入。完整引述见 §12。
- 当前工作树：`/workspace/openbot-vp-runtime-rule-adaptation`。经授权快进后，HEAD 与 `origin/main` 均为 `8a686145c33f8c7e1d776a5aca2502d9091f11b0`（#278、#279，仅 exec-protocol 生产监听骨架／记录，未重叠未提交的 P3 文件）。P3 未提交钉扎已核验保持不变。正文行号凡称「当前工作树」，均指该 HEAD **加上已验收未提交的 P3**。修订后的本设计文将复制进工作树 `.kiro/specs/runtime-rule-adaptation/`（仅新增文件，不改写已验收 P0–P3 规格正文）。
- 盘点／历史引用 pin：`9b65109f41dee30b892a6faff493e46e735cab8d`。引用历史盘点时单独标明；不把历史行号说成当前行号。
- P3 冻结包（只读，本轮未写入）：`/workspace/runtime-rule-adaptation-p3-frozen/`。`MANIFEST.md` sha256 `4f4635034ca92725d16269922c6b56e4ef06eb4d2610e863d2f73e5603f25f2b`；完整补丁 `p3-all-uncommitted.diff` sha256 `8f18e0f2e904ac18b7e4e59b7c3c0c5014972d5c89c838d9fe85d5565960a633`；registry `d91c37c8a9f8c3816211f301c5e0cd80c2567f9df0e71ae87ad37a0f452198e9`。Owner 已独立核验。14 文件／139 项 PASS 沿用 P3 r2，本轮未复跑。
- 原计划：`/workspace/openbot-dynamic-rule-adaptation-plan.md` §9（P4），并遵守 §8 残余与 §12 暂停条件。
- 已验收、本轮不重开的契约：`effective-policy-lifecycle.md`（含已锁定落点与空白名单）、`current-rule-map.md`、`first-scope-decision-table.md`、`contracts-and-merge-semantics.md`、`p2-shadow-agent.md`。P1／P2 `activationAllowed=false` 保持不变；激活仍只走 P3 宿主入口，P4 设计只谈**消费者读取已激活快照**，校验器不激活任何策略。
- 初稿时间：2026-11-12 21:57（Asia/Shanghai，UTC+8）。t20u 修订时间：2026-11-12 22:16（Asia/Shanghai，UTC+8）。
- 本轮不宣称：生产路径已读取活板或已构造生产 `HostIdentity`、已有非空生产白名单、`mainChainWired` 可为 true、已合并或部署、协作消费者链已核准、已有可供审查的提交 SHA、本设计或本轮限定测试接入即生产生效批准。手动 `/compact` 本期不纳入，不宣称已覆盖。

配套决策表：同目录 `p4-personal-enforcement-decision-table.md`。

## 1. 范围与分层

一个执行体系、一组受控状态入口、一套规则目录。不新增第二执行器、第二套计划／恢复循环、第二套配置或第二套参数权威。不改 `SYSTEM_INVARIANTS`，不改 `CONTEXT_WINDOW_HARD_MIN_TOKENS`／`CONTEXT_WINDOW_WARN_BELOW_TOKENS`，不改编译或执行硬门禁。来源选择开关只决定**读哪一路已解析的策略值**，不得绕过硬门禁。

本设计只覆盖个人候选 **`model.context_window.guard`**，目标字段 **`agents.defaults.contextTokens`**。已锁定的个人收紧合约：`hardMin(16000) ≤ proposedValue ≤ currentEffectiveValue`（`currentEffectiveValue` 是已计入现有帽的有效窗口，不只是模型窗口）。删除帽或恢复更高值属放宽，不是本候选。

计划 §9「个人和协作各一条真实消费者链」中，**协作消费者链本轮推迟**：`collab.policy.compile` 字段 `maxVisibleBotRepliesPerRound`、`RoundPolicySnapshot`／lane、以及打开 `collaboration.policySnapshot`，均仍须单独核准，本文只将其标为范围外。

P3 快照落点已锁定：既有 `SessionTaskBoard.runtimeRuleAdaptationByTaskId`（board 级、按 `taskId` 索引），与 `writeEpoch` 同一锁、同一次原子写入。读取必须走既有官方入口 `readActivatedRuntimeRulePolicy`／`readRuntimeRuleAdaptationBoard`，且须先验证身份与作用域；未验证不得返回快照、历史或 `boardWriteEpoch`。不发明新 store。

`command` 组织提案（P3 激活／撤销／回退入口已存在）；未来接线只注入读取结果；**原执行主机**读取有效版本。不得在适配层补偿或绕过原迁移 T9／已接受成果投递缺口。

## 2. 原参数来源（必须按仓库事实精确定名）

以下行号均引自当前工作树（`8a686145…` 加上已验收未提交的 P3），不是盘点 pin 的历史行号。与历史盘点对照时，实现仍在同一文件；功能结论与 `first-scope-decision-table.md` §6.1、`current-rule-map.md` §1.14（盘点 pin `9b65109f41dee30b892a6faff493e46e735cab8d`）一致，但本文件以当前行号为准。

### 2.1 定义（唯一解析与守卫实现）

| 符号 | 位置 | 角色 |
| --- | --- | --- |
| `CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000` | `src/agent-runtime/policy/context-window.ts` 第 3 行 | 硬下限常量。不可由适配下调。 |
| `CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000` | 同文件第 4 行 | 告警阈，只记日志，不阻断。 |
| `ContextWindowSource` | 同文件第 6 行 | `"modelsConfig" \| "model" \| "default" \| "agentContextTokens"`。这是原解析来源标签，不是任务快照权威。 |
| `resolveContextWindowInfo` | 同文件第 21–50 行 | **当前有效窗口的原权威解析**。 |
| `evaluateContextWindowGuard` | 同文件第 57–74 行 | 硬门禁与告警判定。`shouldBlock` 当 `tokens > 0 && tokens < hardMin`。未传入阈值时回退到上述源码常量。 |

解析顺序（当前实现，不得在设计中改写）：

1. `OpenBotConfig.models.providers[provider].models[]` 中 `id` 匹配的 `contextWindow`（来源 `modelsConfig`）；
2. 否则使用调用方传入的 `modelContextWindow`（来源 `model`，通常来自模型目录／`resolveModel`）；
3. 否则使用 `defaultTokens`（生产主路径传入 `DEFAULT_CONTEXT_TOKENS`，来源 `default`）；
4. 若 `cfg.agents.defaults.contextTokens` 为正整数且**小于**上述基线，则改为该帽（来源 `agentContextTokens`）。配置帽只能收紧，不能放大模型窗口。

`currentEffectiveValue` 即该函数在当时配置与模型事实上的 `tokens`。P1 校验器不自己读配置：由宿主把该值放进 `hostFacts.currentEffectiveValues["agents.defaults.contextTokens"]`。

### 2.2 配置与默认（值来源，不是调整授权）

| 名称 | 位置 | 性质 |
| --- | --- | --- |
| `DEFAULT_CONTEXT_TOKENS = 200_000` | `src/agents/defaults.ts` 第 6 行 | 模型元数据不可用时的保守回退。定义在 agents 默认模块，不是 policy 常量。 |
| `agents.defaults.contextTokens` | 类型：`src/config/types.agent-defaults.ts` 第 232–233 行；zod：`src/config/zod-schema.agent-defaults.ts` 第 53 行（`z.number().int().positive().optional()`） | 可选配置帽。**值来源**。能读到配置 ≠ 动态调整授权已建立。生产现值未知。 |
| `SessionEntry.contextTokens` | `src/config/sessions/types.ts` 第 164 行 | 会话上的运行时估计／状态展示字段，**不是**本规则的策略权威，不得当作第二套帽来源。 |

无效或非正整数帽由 `normalizePositiveInt` 忽略，等同未设帽。这是既有解析行为，不得冒充「提案通过」。

### 2.3 生产调用（个人主链强制）

唯一对解析结果做 **shouldBlock 并抛错** 的生产调用：

- `prepareEmbeddedModel`（`src/agent-runtime/model/prepare-embedded-model.ts` 第 12–93 行）。注释写明在凭据与执行之前解析有效上限。第 59–65 行调用 `resolveContextWindowInfo`（`defaultTokens: DEFAULT_CONTEXT_TOKENS`）；第 68–71 行若有效 tokens 小于模型原生 `contextWindow`，则把 `effectiveModel.contextWindow` 改为有效值；第 72–90 行用源码常量调用 `evaluateContextWindowGuard`，告警记日志，阻断时抛 `FailoverError`。
- 生产调用方：`prepareEmbeddedRunAuth`（`src/agent-runtime/execution/runner/embedded-run-auth.ts` 第 127–135 行）把返回的 `ctxInfo` 与 `effectiveModel` 写入会话（约第 376–377 行）。
- `prepareEmbeddedRunAuth` 的上游是 `runEmbeddedPiAgent`（`embedded-run.ts` 第 192 行附近）。个人聊天主链经 `auto-reply/reply/agent-runner.ts` → wiring `reply-turn.ts` → `runAdmittedTurn` → `invokeAdmittedCandidateEmbedded`（在 `host.assertOriginalTaskCurrent()` 之后调用 `runEmbeddedPiAgent`，`admitted-candidate-embedded.ts` 第 151–152 行）。同函数亦被 `queued-candidate.ts`、`scheduled-candidate.ts`、`command-candidate.ts` 调用。另有 **不一定带个人任务绑定** 的调用：`agent-runner-memory.ts`、`hooks/llm-slug-generator.ts`。选择源不得对未验证身份的调用应用任务快照。

同一轮尝试随后把已解析结果向下传递，而不是再次作为硬门禁权威：

- `runEmbeddedRunAttemptIteration`（`embedded-run-attempt.ts` 第 128、140 行）：`contextTokenBudget: session.ctxInfo.tokens`，`model: session.effectiveModel`。
- `runEmbeddedAttemptPreflight`（`embedded-attempt-preflight.ts` 第 230 行）把 `params.model.contextWindow` 作为 `modelContextWindowTokens`。
- `embedded-attempt-stream.ts` 第 96–99、127–130 行：**不**调用 `resolveContextWindowInfo`，直接使用 `params.model.contextWindow ?? params.model.maxTokens ?? DEFAULT_CONTEXT_TOKENS`。若 `params.model` 已是被收紧的 `effectiveModel`，编译器与 tool-result guard 会继承该帽；它们自己不是第二套解析权威。
- 溢出恢复 `context-overflow.ts` 第 131 行使用 `ctxInfo.tokens`。

### 2.4 仅解析、不阻断的路径（既有执行缺口）

下列路径调用 `resolveContextWindowInfo`，**不**调用 `evaluateContextWindowGuard`（P0 盘点已记为执行缺口；当前工作树仍如此）：

- `src/agents/pi-embedded-runner/extensions.ts`：`resolveContextWindowTokens` 第 15–27 行；`buildEmbeddedExtensionFactories` 第 75–84 行。个人主链上由 `embedded-attempt-session.ts` 第 79–85 行调用，传入的 `model` 是上游的 `params.model`（在 admitted／embedded 路径上即 `session.effectiveModel`）。但该处**再次**按配置与 `model.contextWindow` 解析。今日配置帽仍在 `cfg` 中，再解析通常与主路径一致；**任务级快照并不在 `cfg` 里**，再解析会丢掉仅存在于快照中的收紧帽，甚至在 `modelsConfig` 更大时把窗口放大回去。
- `src/agents/pi-embedded-runner/compact.ts`：`compactEmbeddedPiSessionDirect` 第 438–448 行同样再解析并可能改写 `effectiveModel`；第 649 行再交给 `buildEmbeddedExtensionFactories`。`compactEmbeddedPiSession`（约第 958–996 行，`/compact` 命令路径）会自己 `resolveModel` 后再解析，不一定经过 `prepareEmbeddedModel`。`src/context-engine/legacy.ts` 委托 `compactEmbeddedPiSessionDirect`。

上述再解析缺口正是覆盖 C 要处理的对象：同次执行的 extensions 与自动压缩必须继承模型准备节点的选择结果，不得再解析放大。手动 `/compact`（`compactEmbeddedPiSession`）及经该命令路径的 legacy 委托本期不纳入，不宣称覆盖，不改该命令路径。

### 2.5 再导出、测试与旁路

| 类别 | 位置 | 说明 |
| --- | --- | --- |
| 再导出 | `src/agent-runtime/policy/index.ts` 第 20–24、26–29 行；`src/agent-runtime/model/index.ts` 第 29 行 | 再导出不是第二套实现。 |
| 目录声明 | `src/agent-runtime/policy/catalog.ts` 第 258–275 行，`enforcementPoints: ["before_model_context_use"]`，`version` 仍为 `INVENTORY_VERSION`（历史 inventory pin，不单独使实现无效） | 目录不是参数权威。 |
| P1 字段适配 | `src/agent-runtime/policy/rule-adaptation/descriptors.ts` 第 21–22、44–51 行 | 只声明 `ruleId`／`field`／`hardMin`，不改解析或强制。 |
| 测试 | `src/agents/context-window-guard.test.ts`、`src/agent-runtime/model/prepare-embedded-model.test.ts`、`src/commands/onboard-custom.test.ts`、以及 P1／P3 夹具 | 测试与夹具不是生产权威。目录 `tests: []` 仍未登记已有测试（历史遗留）。 |
| 动态 import／替身 | `src/agents/pi-embedded-runner/run.overflow-compaction.mocks.shared.ts` 等 | 测试替身，不得当作生产来源。 |
| 旁路常量使用 | `src/commands/onboard-custom.ts` 用 `CONTEXT_WINDOW_HARD_MIN_TOKENS` 作为自定义模型登记默认窗口 | 引导／登记路径，不是个人任务策略强制，也不是本候选消费者。 |
| 协作旁路 | `src/gateway/server-methods/chat.ts` 约第 3603–3610 行用目录 `selectedModel.contextWindow` 做成员上下文体积断言 | 协作路径，本轮范围外。不得借个人帽改写该检查。 |

硬门禁的权威是源码常量加上 `evaluateContextWindowGuard`，不是函数参数里可能被传入的更低 `hardMinTokens`（P0 已记 API 风险）。未来消费者必须像 `prepareEmbeddedModel` 一样传入源码常量。

## 3. 策略读取路径（设计；不接线）

P3 已提供、必须复用的官方入口：

| 入口 | 位置 | 作用 |
| --- | --- | --- |
| `readRuntimeRuleAdaptationBoard` | `src/agent-runtime/state/mutations/runtime-rule-adaptation.ts` 第 37–42 行 | 经官方 `readSessionTaskBoard` 读板；不是新 store。 |
| `precheckRuntimeRuleRead` | `src/agent-runtime/policy/rule-adaptation/activation-precheck.ts` 第 1939 行起 | 只做读预检：封闭键、身份、个人 scope、完整 `boardScope` 与活板一致。协作 scope 以 `collaboration_path_unwired` 拒绝。 |
| `activationAccessScopeVerified` | 同文件第 1030–1061 行 | 身份与 `TaskBoardScope` 未验证时，不得暴露快照／历史／`boardWriteEpoch`。 |
| `readActivatedRuntimeRulePolicy` | `src/agent-runtime/command/rule-adaptation/activate.ts` 第 609–638 行；由 `command/rule-adaptation/index.ts` 再导出 | 宿主／未来消费者的读契约。`found`／`not_found`／`rejected`。 |

读绑定已锁定为 `RuntimeRuleAdaptationReadBinding`：`identity`、`taskBinding`（`taskId` + `boardScope`），可选 `fixture`。不得携带 `FORBIDDEN_ACTIVATION_KEYS`（包括 `OpenBotConfig`、`operatingState`、`policySnapshot`、`activationAllowed` 等）。

建议的未来读取步骤（实施前须先锁定 §10 身份映射与开关默认值）：

1. 仅当该次模型准备属于**已绑定的个人任务**，且来源选择开关允许读取快照时，由**原执行宿主**（不是模型、不是 P1 校验器、不是 P2 影子编排）构造读绑定，调用 `readActivatedRuntimeRulePolicy`。wiring 只负责把宿主已验证的依赖注入；command 不在主链上另起计划循环。
2. 身份或作用域未验证，或预检 `rejected`：不得使用快照，不得暴露 board 状态。若开关已对该已绑定任务启用而身份失败：阻断**本次模型准备**（相关动作），等待或要求宿主补齐身份；不是「全部失败继续」，也不是「冻结所有聊天」，更不是悄悄改用快照。无任务绑定的调用（问候、memory flush、slug 等）不走快照，只用原解析。
3. 读取结果必须按状态分开处理，**不得把失效、损坏、撤销混称为「无快照」**（这是上下文预算策略的生效语义，不是把快照当作权限凭证）：
   - **确实没有快照**（`not_found`，或该 `taskId` 下没有 `current` 记录）：使用原解析。选择结果须标明 `outcome=no_snapshot`。
   - **合法撤销／回退已完成**：按该受控变更的**明确结果**处理，不得称为「无快照」（板上 `current` 可能是 `status: "revoked"` 的新版本，见 `activate.ts` 第 399–411 行；被取代项进入 history 且状态为 `superseded`）。不得把已撤销快照当作帽来用。若该受控变更的明确结果是「当前没有生效帽」（例如已完成的撤销，`current.status=revoked`），tokens 跟随原解析，但选择结果须标明 `outcome=controlled_change`，与「从未有过快照」区分。若回退后的新 `current` 是合法 `status=effective` 快照，则按下面第 5 步作为收紧帽候选。历史快照不是不可撤销权利，不得自行取用。
   - **存在快照但损坏、不兼容、来源不合法，或读取失败**（含官方读入口抛错、在快照选择模式下身份／作用域未验证而被 `rejected`）：在选择模式为 `personal_activated_snapshot` 时，**阻断本次模型准备**，不静默扩大窗口（例如不得从已选择的 24000 悄悄回到原窗口 128000）。选择结果须标明 `outcome=blocked`，且不得提供一个可被下游当成成功帽的原解析 tokens。
4. `found` 且 `status === "effective"` 时，仍须核对：目标 `ruleId`／`field` 为个人候选；`items[].parameter` 为安全整数，且满足已锁定个人收紧合约（`hardMin(16000) ≤ parameter`；与原解析的 `min` 保证不超过当前有效窗口）；`implementationVersion` 与当前实现相容；**夹具快照（`whitelistSource=fixture`）不得送进生产选择源**（见 §8）；测试接入的夹具端口可以消费标明 `fixture` 的快照，这不是生产启用。任一条件不满足：在快照选择模式下视为损坏／不兼容／来源不合法，**阻断本次模型准备**，不得回退到原解析，也不得用编译器或 `Math.min` 把非法参数「钳制后当作快照生效」。
5. 合法生效快照只提供一个**收紧帽候选值**。原权威解析仍必须先跑。有效 tokens = `min(原解析 tokens, 快照参数)`。之后**一律**用源码常量做 `evaluateContextWindowGuard`。若配置此后变得更紧，配置胜出；快照不得放大窗口。

`prepareEmbeddedModel` 今日签名只有 `config`／`provider`／`modelId`／`agentDir`／`providerAuthOverride`／`log`，没有任务身份。不建议让纯解析函数 `resolveContextWindowInfo` 自己读任务板（那会把 policy 变成第二套状态消费者）。建议：由已握有 `RunEmbeddedPiAgentParams`（含 `sessionFile`、`taskExecutionBinding`、`executionIdentity`）的 `prepareEmbeddedRunAuth`（或同等宿主）完成官方读取，再把**可选的已授权收紧帽**注入 `prepareEmbeddedModel`。wiring 只注入该帽；守卫与阻断仍在原主机。

生产路径上构造 `HostIdentity`／`boardScope` 的完整字段对应关系，仓库里目前只有测试夹具（如 `activation-test-support.ts` 第 56–64 行的 `user:fixture-1`），没有已核准的生产映射。**t20u 按最小方式落实：** 不新增身份体系，不根据板内 scope 反向证明调用者身份；由宿主用既有服务端可信执行身份及会话绑定构造读取参数，再与磁盘 `TaskBoardScope` 核对。字段来源尚未明确时，测试接入使用独立夹具解析端口；生产路径继续关闭。个人任务也可以有租户。见 §10.2 与 §12.3。

## 4. 来源选择开关与回退开关

计划原文：「新旧规则选择源不能同时裁定；覆盖范围有明确切换点及回退开关，开关只选策略来源，不绕过硬门禁。」

### 4.1 语义（t20u 已锁定：首期使用宿主注入端口）

为个人候选设单一选择源，互斥两态，不得并行裁定：

| 状态 | 含义 |
| --- | --- |
| `original` | **默认**。只使用 §2 的原解析。即使板上已有 `status=effective` 的快照，生产消费者也不读它作为有效帽。 |
| `personal_activated_snapshot` | 在身份与作用域已验证的前提下，按 §3 读取官方快照；仅当快照合法且为收紧时，以 `min(原解析, 快照参数)` 作为待守卫的 tokens。原解析仍先执行。 |

回退开关：把选择源切回 `original`。立即生效于之后每一次经该选择源的读取；板上快照与历史不删除、不改写；硬门禁不变。回退不是把磁盘倒回旧字节，也不是删除 `contextTokens` 让窗口变宽。**切回 `original` 可能解除任务帽，必须由受控宿主授权切换，不能作为任意错误（损坏、不兼容、读取失败、来源不合法）的兜底。** 若还要把某任务的生效帽撤回，仍走既有 `revokeActivatedRuntimeRulePolicy`／`rollbackActivatedRuntimeRulePolicy`（按**当前**授权重核的新版本变更）。

**t20u 已锁定选择源形式：** 首期使用宿主注入端口，默认 `original`；不新增生产配置键，不把开关写入 `OpenBotConfig`，不开放生产白名单。端口省略时，`prepareEmbeddedModel` 必须完全保持原行为。当前模式为 `original` 时，即使夹具板上存在损坏快照，也仍完全保持原行为。默认必须保持影子／原源：本轮**不写**生产配置、不打开该开关、不把开关默认设为快照。生产白名单为空则生产不得进入 `personal_activated_snapshot`；夹具快照不得被生产选择源消费。字段来源尚未明确时，测试接入可以使用独立夹具解析端口；**生产路径继续关闭**（默认嵌入运行不得开始读取活板或构造生产 `HostIdentity`）。

### 4.2 切换点（t20u 已锁定覆盖 C）

**唯一裁定点**：在 `resolveContextWindowInfo` 已经得到原有效窗口之后、`evaluateContextWindowGuard` 之前。这与目录登记的 `before_model_context_use` 以及 `prepareEmbeddedModel`「凭据或执行之前」的现有位置一致。

**消费者覆盖采用 C：** 在模型准备节点统一选择。同次执行的 extensions、自动压缩及溢出恢复必须继承该选择结果，不能再次解析后放大。它们应消费与主路径**同一选择结果**（由宿主注入同一已授权帽，或消费已经收紧且不再被再解析放大的 tokens），而不是各自读板、各自决策。**手动 `/compact` 本期不纳入，不宣称覆盖，不改手动压缩命令路径。**

硬门禁始终在选择之后执行，且使用源码常量。开关不能关闭守卫，不能传入更低 `hardMinTokens`，不能跳过 `FailoverError` 阻断。

## 5. 生效节点

须区分两层，避免把 P3 持久化说成主链已强制：

1. **P3 快照生效节点**（已锁定）：`ACTIVATION_EFFECTIVE_NODE = "cas_persist_success"`。CAS 成功写入后，该绑定任务／`TaskBoardScope` 上的「P3 生效策略」以 state 为准。`mainChainWired` 在本阶段快照上恒为 `false`。
2. **P4 主链约束节点**（本设计对象；t20u 仅放行限定测试接入，不是生产接线或生产生效）：个人主链在何处开始受该快照收紧帽约束。

已锁定的主约束节点：`prepareEmbeddedModel` 的选择点（§4.2）。**本次尝试在模型准备时固定上下文帽，后续尝试重新读取。不新增 HTTP 前快照重读节点。** 经此节点得到的 `ctxInfo` 与 `effectiveModel`，在 admitted／embedded 主路径上会传到预算、预检、编译器（经 `effectiveModel.contextWindow`）和溢出恢复；同次执行的 extensions／自动压缩／溢出恢复必须继承该结果。

在该节点之前，必要授权与任务存活检查已部分存在，且应保持：

- `runAdmittedTurn` 入口及候选调用前的 `assertOriginalTaskCurrent`／`isTaskExecutionBindingCurrent`（`admitted-turn.ts` 第 35–48 行；`admitted-candidate-embedded.ts` 第 151 行）：任务已暂停、关闭、取消或被替换则拒绝，不启动提供者。
- 工具动作：`checkTaskActionBoundary`（`state/task-action.ts` 第 19–38 行）在 `runBeforeToolCallHook`（`before-call.ts` 第 112–116 行）以及 hook 等待之后、真正 `execute` 之前再查一次（第 246–248 行）。这是取消／暂停／约束变更的既有边界，**今天不读取规则适配快照**。

「已认领、尚未外发」的最后重查：对个人候选而言，本规则的「外发」是**模型请求出站**（以及同次执行中已纳入覆盖 C 的自动压缩出站），不是 T9 渠道成果投递，也不是本期范围外的手动 `/compact`。**t20u 已锁定：** 不新增 HTTP 前快照重读节点；帽在模型准备时固定，后续尝试再读。取消、撤权及任务替换仍由既有门禁独立执行。渠道投递的认领／外发重查保持由既有 delivery／`accepted-artifact-delivery` 负责；其 `outbound_auth_unwired` 等 T9 缺口不得用本候选补偿或绕过。

`claimQueuedExecution` 服务于异步等待恢复认领，不是每一次个人模型准备的必经点。有活 `executionAttempt`／`claimToken` 时，激活／撤销绑定仍须使用真实执行身份（P3 已锁定 `NO_LIVE_EXECUTION_CLAIM` 哨兵）；读取路径的读绑定不要求该字段，但消费方不得在任务已取消或认领已失效时继续把快照当作有效帽。

## 6. 衔接规则摘要

| 节点或条件 | 权威 | 行为 |
| --- | --- | --- |
| 选择源 = `original`（默认） | 仅 `resolveContextWindowInfo` | 完全保持原行为。不读快照作帽。硬门禁照常。夹具损坏不得改变该模式。 |
| 选择源 = `personal_activated_snapshot`，身份已验证，快照 `effective` 且合法 | 原解析与快照收紧帽的 `min`，然后守卫 | 只能更紧或持平；持平即原窗口。配置此后更紧则配置胜出。 |
| 确实没有快照（`not_found`／无 `current`） | 原解析 | `outcome=no_snapshot`。仅此情形可把「无快照」当作原解析。 |
| 合法撤销／回退已完成 | 该受控变更的明确结果 | `outcome=controlled_change`（若当前无生效帽，tokens 跟随原解析，但不得称为「无快照」）。不得使用已撤销快照作帽。回退后的新 `effective` 快照按上一行收紧。 |
| 存在快照但损坏、不兼容、来源不合法，或读取失败 | **阻断本次模型准备** | `outcome=blocked`。不得回退到原解析，不得静默扩大窗口。非法快照不得钳制后生效。 |
| 夹具快照（`whitelistSource=fixture`）出现在生产选择源 | **阻断**（生产路径保持关闭） | 不得当作生产生效帽。E-04／夹具端口成功只证明测试路径。 |
| 身份／作用域失败 | 不得使用快照 | 已绑定且选择源为快照模式：阻断本次模型准备。未绑定：原解析。不泄露 board 状态。不得根据板内 `scope` 反向证明调用者身份。个人任务也可以有租户，不得把 `scope=personal` 理解成没有租户。 |
| 硬下限 | 源码常量 + `evaluateContextWindowGuard` | 任何选择源均不可绕过。低于 hardMin 的非法快照在快照模式下阻断，而不是应用后再「顺便」放宽。 |
| 选择源回退为 `original` | 原解析 | 可能解除任务帽，必须由受控宿主授权切换，不能作为任意错误的兜底。不删除快照；不绕过硬门禁。 |
| Agent／影子不可用 | 已持久化且仍合法的当前策略（若模式为 `original`，即原解析；若为快照模式且快照仍 effective 且合法，则按 §3；若读取失败或快照损坏，则阻断本次准备） | 不自动激活；不「全部失败继续」；不「冻结所有聊天」。强制事实不足则阻止相关动作或等待。 |
| 任务取消／墓碑 | 既有任务围栏 | 放宽或历史快照不得复活任务。恢复须走原状态入口。 |
| 必要授权 | 入站即生效的既有授权／任务绑定 | 适配只做具体执行前的可选策略准备，禁止「动作已启动再补必要授权」。 |

快照参数若因常量或实现变更变得低于 hardMin：视为不兼容／非法，在快照选择模式下**阻断本次模型准备**，不得回退原解析以致静默扩大窗口。

## 7. 失败行为

与计划 §8／§9 及 P3 生命周期一致，落实到本候选：

- 读取失败：在快照选择模式下阻断本次模型准备，不发明默认帽，不把失败当成「无快照」或切回 `original`。选择源为 `original`（含受控切回）时完全走原解析。不把影子内存结果或校验器返回值当成生效策略。
- 模型准备被硬门禁阻断：维持现有 `FailoverError`，不启动该模型；不是聊天全冻结。
- 在途工具：已开始的动作不在 `before-call` 里被本设计改成「假撤回」。取消／撤权后，旧结果可按当前权限记为事实，但不得推进已取消或已替换的旧任务。
- 已外发的模型请求或渠道消息：不得虚称已撤回。
- 持久化失败不是消费路径的责任；消费方只读已成功持久化的 state。
- 时间型截止字段与权威时钟仍按 P3 已锁定项为待核准；本设计不发明默认 TTL。若宿主未给截止时间，只按状态与版本／撤销结果判断。

## 8. 先测试接入，生产白名单仍空

「先测试接入，再对核准白名单启用，默认保持影子」仍是实施政策。t20u **仅放行个人场景限定测试接入**：明确「上下文帽选择结果」的类型及来源；接入模型准备节点并保证同次执行下游不放大；覆盖默认原行为、合法收紧、损坏拒绝、配置进一步收紧、取消及下一次尝试重读。**生产白名单保持为空**，不接协作、不改手动压缩、不增加时间截止机制。本轮不写生产配置，不把任何规则写入生产白名单，不代表生产生效。

- `PRODUCTION_RUNTIME_RULE_WHITELIST` 保持空数组（`rule-adaptation-activation.ts` 第 58 行）。空名单一律拒绝生产激活；本设计也要求：生产选择源不得在白名单仍空时进入 `personal_activated_snapshot`。
- P3 成功激活（含 E-04）只证明 `test_entry`／夹具白名单路径，且须标明 `whitelistSource=fixture`，`mainChainWired` 恒为 `false`。不得把夹具成功当成生产白名单或主链已生效。
- 本轮测试接入：仅测试宿主可经**独立夹具解析端口**在夹具板上行使选择源，由宿主用既有服务端可信执行身份及会话绑定构造读取参数，再与磁盘 `TaskBoardScope` 核对，并调用官方读入口 `readActivatedRuntimeRulePolicy`。不新增身份体系，不根据板内 scope 反向证明调用者身份。生产路径继续关闭。
- 未来若对核准白名单启用：须另获独立验收；届时仍默认影子／`original`，仅对白名单命中且身份已验证的个人任务切换选择源。本文件与本轮限定测试接入均不构成该启用批准。

## 9. 实施前前置条件

在任何后续 P4 实施（仍须单独核准）之前，至少应具备：

1. 本设计及决策表经独立评审；§10 中会改变接线形状的项已锁定或被明确推迟。
2. 工作树相对当时 `origin/main` 的祖先关系已重新核验。经授权快进后，HEAD 与 `origin/main` 均为 `8a686145c33f8c7e1d776a5aca2502d9091f11b0`；P3 未提交钉扎保持不变。其后若 `origin/main` 再次前移且不再是 HEAD 祖先，须停止写入并汇报。
3. 生产白名单仍空，直至另获独立接受；测试接入与生产启用分开授权。
4. 不把 T9／`accepted-artifact-delivery` 的 `outbound_auth_unwired` 等缺口当作本任务可修项，也不在适配层做补偿通路。
5. 个人主链若存在必须先修才能诚实接线的断裂，须单独最小修复并验收。当前已识别、需评审裁定的缺口见 §10.1（再解析可能丢掉任务帽；非主路径无硬下限阻断）。不得为接线而放宽硬约束或新增第二调度器。
6. 官方 `loom register` 与共享 registry 仍按既有纪律；本轮禁止正式 register。
7. 保持 P1／P2 `activationAllowed=false`；不改 `SYSTEM_INVARIANTS` 与硬下限常量；不打开协作开关。

## 10. 原待核准项（t20u 已锁定实施选择；本节保留原选项说明，以锁定结论为准）

t20u 已锁定 §10.1–§10.4 的实施选择，见 §12。以下保留原选项说明，避免把锁定前的讨论抹掉。实施必须以 §12 与已修订正文为准，不得再按「待核准」静默另选。

### 10.1 个人消费者覆盖范围（t20u 已锁定为 C）

选项 A：只把 `prepareEmbeddedModel` 作为选择与强制点，依赖 `effectiveModel`／`ctxInfo` 向下传递。优点是改动面最小，且 admitted 主路径的预算、编译器（经 model 对象）、溢出恢复能继承。缺点是 `extensions.ts`／`compact.ts` 再解析会忽略任务帽，手动 `/compact` 与 legacy context engine 可能完全不经 `prepareEmbeddedModel`；非主路径仍无硬下限阻断。

选项 B：凡调用 `resolveContextWindowInfo` 的个人相关路径（含 compact／extensions／手动压缩）统一消费同一注入帽，且非主路径补上同一硬门禁。更诚实，但超出「只碰主强制点」，并可能改变今日压缩阈值。

选项 C：主强制点按 A，同时把 compact／extensions 改为禁止在已有选择结果时再解析放大（只消费上游 tokens）。行为介于 A 与 B 之间，仍须明确手动 `/compact` 是否在范围。

**t20u 已选定 C。** 手动 `/compact` 本期不纳入，不得宣称任务帽已覆盖该路径。同次执行的 extensions、自动压缩及溢出恢复必须继承模型准备节点的选择结果，不能再次解析后放大。

### 10.2 生产读取的可信身份映射（t20u 已锁定最小方式）

从 `RunEmbeddedPiAgentParams`／`TaskCompletionBinding`／`executionIdentity`／活 `SessionTaskBoard.scope` 构造 `RuntimeRuleAdaptationReadBinding` 的完整生产字段对应关系，仓库里仍只有测试夹具，没有已核准的生产映射。**t20u 锁定最小落实方式：** 不新增身份体系，也不根据板内 scope 反向证明调用者身份。由宿主使用既有服务端可信执行身份及会话绑定构造读取参数，再与磁盘 `TaskBoardScope` 核对。字段来源尚未明确时，测试接入可以使用独立夹具解析端口；**生产路径继续关闭**。个人任务也可能属于企业，不能把 `scope=personal` 理解成没有租户。

### 10.3 选择源的配置键或宿主端口形态（t20u 已锁定）

**首期使用宿主注入端口，默认 `original`。** 不新增生产配置键，不写入 `OpenBotConfig`，不开放生产白名单。端口省略时必须完全保持原行为。

### 10.4 已认领、模型出站前是否必须重读快照（t20u 已锁定）

**本次尝试在模型准备时固定上下文帽，后续尝试重新读取。不新增 HTTP 前快照重读节点。** 取消、撤权及任务替换仍由既有门禁独立执行。不得把已撤销快照写成「本尝试仍永久有效的权利」；下一轮准备按新状态读取。

### 10.5 其他仍待核准或范围外

- 协作快照／lane／`collaboration.policySnapshot`：范围外，单独核准。
- 时间型截止字段名与权威时钟：P3 已锁定为待核准；本设计不发明。
- 生产白名单内容、合并、部署、真实渠道外发：未放行。
- `mainChainWired` 何时可以变为 true：须在真实消费者接线并经验收后单独核准；本设计保持其在现快照上为 `false`。
- 是否扩展 `ContextWindowSource` 联合类型以标记诊断来源：可选，不得变成第二套解析权威；未核准则实施时只减少 tokens、保留原 `source` 标签亦可。

## 11. 后续实施前必须先锁定的要点

下列事项沿用已验收决定，实施时不得重开或削弱：

- 一个执行体系、一套目录、一组受控状态入口；command 组织、wiring 只注入、原主机读取。
- 不改 `SYSTEM_INVARIANTS` 与上下文硬下限／告警常量；开关不绕过硬门禁。
- P1／P2 `activationAllowed=false`；激活只走 P3 宿主入口。
- 快照只在既有 `runtimeRuleAdaptationByTaskId`；官方读入口与身份隔离纪律不变。
- 个人合约只能收紧：`16000 ≤ proposedValue ≤ currentEffectiveValue`；删除帽不是合法回退。
- 生产白名单保持为空，直至另获独立接受；夹具成功不是生产白名单。
- 历史快照不是不可撤销权利；同一版本仍受最新取消／撤权约束；放宽不复活取消任务。
- 不补偿 T9／成果投递缺口；不把协作路径当作已核准。
- 默认选择源为 `original`；新旧源不得同时裁定。

t20u 已锁定第 1–4 项及第 6 项（基线已授权快进至 `8a686145…`，P3 钉扎保留）。下列事项仍然有效，不得在本轮悄悄放宽：

1. 测试接入与生产启用必须**分别授权**。本轮只放行限定测试接入。生产启用仍以非空且已独立接受的白名单为前提；本轮不构成该批准。
2. 协作消费者链仍单独核准，不随个人测试接入搭售。
3. 手动 `/compact`、时间截止机制、生产白名单内容、合并与部署均未放行。

本文件是经 t20u 修订的设计，**不是**生产生效、合并或部署批准。

## 12. 已锁定（t20u）

- 时间：2026-11-12 22:16（Asia/Shanghai，UTC+8）。
- Owner（t20u）原文：「设计方向通过，但实施前需锁定三项选择，并修正“失效快照自动回退”的语义。无需重写方案。」
- Owner 明确：「本轮验收的是设计文档，未验证线上配置或执行效果。」
- 授权快进后的 git 基线：HEAD 与 `origin/main` 均为 `8a686145c33f8c7e1d776a5aca2502d9091f11b0`。P3 未提交钉扎保持不变：registry `d91c37c8a9f8c3816211f301c5e0cd80c2567f9df0e71ae87ad37a0f452198e9`，`task.ts` `a9bcf965…`，`task-board-file.ts` `5f17c939…`，mutation `910418cc…`，activation contract `0af48ce08…`，`activate.ts` `020efb9847…`。盘点／引用 pin 仍为 `9b65109f41dee30b892a6faff493e46e735cab8d`。P3 冻结包哨兵未改写。
- 这是上下文预算策略的生效语义，不是将快照当作权限凭证。取消、撤权及任务替换仍由既有门禁独立执行。

### 12.1 实施选择（原文锁定）

> 项目核准决定消费者覆盖采用 C：在模型准备节点统一选择；同次执行的 extensions、自动压缩及溢出恢复必须继承该结果，不能再次解析后放大。手动 /compact 本期不纳入，不宣称覆盖选择源形式首期使用宿主注入端口，默认 original；不新增生产配置键，不开放生产白名单本次尝试生效点模型准备时固定上下文帽，后续尝试重新读取。不新增 HTTP 前快照重读节点；取消、撤权及任务替换仍由既有门禁独立执行

落实为三项不得放宽的选择：

1. **消费者覆盖 = C：** 在模型准备节点统一选择。同次执行的 extensions、自动压缩及溢出恢复必须继承该结果，不能再次解析后放大。手动 `/compact` 本期不纳入，不宣称覆盖，不改手动压缩命令路径。
2. **选择源形式：** 首期使用宿主注入端口，默认 `original`。不新增生产配置键，不开放生产白名单（保持为空）。
3. **本次尝试生效点：** 模型准备时固定上下文帽，后续尝试重新读取。不新增 HTTP 前快照重读节点。

### 12.2 失效与撤销不得混为「无快照」（原文锁定）

> 必须修正：失效与撤销不能混为“无快照”
>
> 目前设计将参数非法、实现不兼容、读取失败等情况回退到原解析。原窗口可能更大，因此会静默放宽已经选择的任务限制。
>
> 请改成：
>
> - 确实没有快照：使用原解析。
> - 合法撤销／回退已完成：按该受控变更的明确结果处理。
> - 存在快照但损坏、不兼容、来源不合法，或读取失败：快照选择模式下阻断本次模型准备，不静默扩大窗口。
> - 切回 original：可能解除任务帽，必须由受控宿主授权切换，不能作为任意错误的兜底。
> - 当前模式为 original 时，仍完全保持原行为。
>
> 补充测试：原窗口 128000、有效任务帽 24000；快照损坏或读取失败后，不能悄悄变成 128000。

正文 §3、§6、§7 与决策表已按此修正，不再把损坏／读失败回退为原解析，也不再把已完成的撤销称为「无快照」。

### 12.3 身份映射按最小方式落实（原文锁定）

> 不新增身份体系，也不要根据板内 scope 反向证明调用者身份。
>
> 由宿主使用既有服务端可信执行身份及会话绑定构造读取参数，再与磁盘 TaskBoardScope 核对。字段来源尚未明确时，测试接入可以使用独立夹具解析端口；生产路径继续关闭。个人任务也可能属于企业，不能把 scope=personal 理解成没有租户。

### 12.4 本轮放行范围（原文锁定）

> 可据此修订文档并开始个人场景测试接入：
>
> 1. 明确“上下文帽选择结果”的类型及来源。
> 2. 接入模型准备节点，并保证下游不放大。
> 3. 测试默认原行为、合法收紧、损坏拒绝、配置进一步收紧、取消及下一次尝试重读。
> 4. 生产白名单保持为空，不接协作、不改手动压缩、不增加时间截止机制。
>
> 先处理最新主干基线关系，再写实现。 P4 本次仅放行上述限定测试接入，不代表生产生效、合并或部署批准。

`mainChainWired` 在生产／默认路径上必须保持为 false。P1／P2 `activationAllowed=false` 不变。不补偿 T9／`outbound_auth_unwired`。
