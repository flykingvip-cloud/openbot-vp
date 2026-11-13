# P0 继承与覆盖决策表（当前事实与建议）

- 盘点 SHA（行号与实现引用的固定点，亦为验收文件名中的 inventory baseline）：`9b65109f41dee30b892a6faff493e46e735cab8d`
- 当前工作树 HEAD（仅用于 loom 登记与快进后的仓库状态）：`4a786626a1e2892043f57b3832ddf2a407be284a`（= 再 fetch 后的 `origin/main`，含 #277）。工作树可以晚于盘点 SHA；**不**把验收文件名或行号改到新 SHA。
- 目录声明的 inventory pin（未随本 SHA 更新）：`efdb1b98d83e096a31e251095080de954f5883ec`
- 时间：2026-11-12（Asia/Shanghai）
- 性质：描述**当前源码事实**和**建议**。本阶段不实现新的合并机制，不修改运行时白名单，不启用动态调整。
- 生产配置与生产 flag 实际值：未读取，一律记为 **未知**。
- #277 未触及 `src/agent-runtime/policy/**` 及相关规则强制执行路径，故下列实现行号仍按 `9b65109f…` 引用，与当前 HEAD 在政策实现上兼容。

本表不采用“任务覆盖个人、个人覆盖小组”的统一顺序。分层语义按字段性质分别处理。

三种版本必须分开，不能把“目录 version 与 HEAD 不同”单独解释为规则版本无效。兼容判断见 §3 与 `contracts-and-merge-semantics.md` §4：

| 种类 | 本文件中的所指 |
| --- | --- |
| 目录 inventory version | `inventory:efdb1b98…`（目录盘点元数据，预期可落后于 HEAD 乃至落后于盘点实现 SHA） |
| 实现版本 implementation version | 规则实现源码；本盘点引用固定在 `9b65109f…` |
| 有效策略版本 effective policy version | 运行时真正生效者，如 `POLICY_COMPILER_REVISION=1.2.0`、协议 `1.1`、已编译 `policyHash`、现行有效窗口 / lane / operatingState |

## 1. 当前合并与作用域事实

### 1.1 协作 EffectivePolicy = L1 ∩ L2

权威实现：`compileEffectiveCollaborationPolicy`（`src/agent-runtime/policy/collaboration-compile.ts` 第 192–362 行）。源码约定：

> EffectivePolicy = L1 ∩ L2。L1-Hard never yields。L1-Default applies unless L2 tightens or selects a permitted alternative.

- `GroupPolicyInput` 注释写明：这是 **L2 group-admin input**；缺字段回退 L1-Default（`collaboration-policy-model.ts` 第 16–17 行）。
- 组合根：`resolveGroupEffectivePolicy` / `resolveGroupPolicyInput`（`src/gateway/collaboration-dispatch/resolve-effective-policy.ts`）。长期来源是已持久化的 `operatingState`；`legacyOverlay` 仍可能让 dispatch 与 learning 对同一群编译出不同输入（`legacyOverlayDivergence` 可测量该差异）。
- 编译器修订：`POLICY_COMPILER_REVISION = "1.2.0"`（不计入 `policyHash`）。
- 协议版本：`COLLABORATION_POLICY_PROTOCOL_VERSION = "1.1"`。
- `SYSTEM_INVARIANTS.l2CannotWidenL1 = true` 是声明型不变量，须区分 **L1 强制边界**与 **可覆盖默认**。L2 把某字段的默认 false 改成 true，不得自动视为违反硬约束；该类字段记为「语义及授权边界待核准」。强制边界（协议版本、可见回复天花板、隔离、外发、观察者不可写、取消围栏等）仍不可放宽。具体字段编译逻辑见 §2、§4.2、§5。

Gateway 侧 `src/gateway/collaboration-dispatch/policy-compiler.ts` **只再导出** policy 实现，不是第二套算法。适配层也不得另建第二套参数权威。

### 1.2 个人任务作用域

个人会话任务板（`SessionTaskBoard`）、完成绑定、挂起/唤醒、显式暂停取消，走 `agent-runtime` 的 state / command / execution，**不继承群 EffectivePolicy 技能白名单**（`SYSTEM_INVARIANTS.personalSessionDoesNotInheritGroupSkillAllowlist`）。

个人配置中与本盘点直接相关的已有收紧帽：`OpenBotConfig.agents.defaults.contextTokens`（`src/config/types.agent-defaults.ts`，zod：`z.number().int().positive().optional()`）。它只在小于模型/供应商窗口时生效；生产值未知。

**配置来源 ≠ 调整授权。** 该字段证明当前配置值从哪里来，不证明动态 Agent 可以修改它。须分项记录：值来源、谁可在哪个作用域调整、可信身份、实际执行点。在动态调整授权建立之前，只允许 shadow 提案。

对已有帽做有界收紧时，上限是**当前有效窗口**（已计入现有 `contextTokens` 帽），不只是模型窗口。合约：`hardMin ≤ proposedValue ≤ currentEffectiveValue`。例如有效窗口 32000、提案 64000 必须拒绝。删除已有帽或恢复此前更高值属于可能的放宽，须单独授权并重新校验，不是普通收紧。删除参数不是合法回退。若当前有效值未知或低于 hardMin，不生成可执行调参提案。

### 1.3 能力 lane 与“编译值 ≠ 一定在用”

协作参与度 / 展示等字段另有 `collaboration.lane.*`（`legacy | shadow | effective`）。源码默认 **unset = legacy**，即仍可能服务 operatingState 原始值（再按本地钳制），而不是 `authority.policy.effective.*`。生产 lane 值未知。因此：shadow 候选必须同时对照 legacy 钳制与 compiler 钳制（取更紧者），且不得把改 lane 当作“选择规则”。在 lane 核准前只做 shadow 校验，不改变 lane。

### 1.4 停用 / 删除 / 修改 ≠ 选择

当前目录 API（`listRuntimeRuleDeclarations` / `getRuntimeRuleDeclaration`）只提供查询视图，**没有生产消费者**，也没有运行时选择/停用开关。`management: code_required` 的规则没有普通关闭开关。目录条目的存在或缺失不会改变执行。把一条规则从目录拿掉、改声明、或“不选中”，都不等于改变强制执行。强制规则由宿主完成，不由 Agent 选择来补齐或关闭。选择、调参、修改/创建、停用是四种独立授权。

## 2. 现役字段决策表

图例：

- 只能收紧：提案值不得宽于**当前有效值**（也不得突破硬上限）。普通收紧不包括删除帽或恢复更高历史值。
- 授权交集：多方授权同时成立才允许。
- 下层可覆盖：在允许集合内，L2 或个人配置可以替换 L1-Default。此类覆盖是否构成“放宽硬约束”须单独核准，不得自动升格为硬约束违反。
- 有明确上下界：源码中存在可引用的上下限。
- 必须重新授权：放宽、改角色/审批、改外发或隔离时，不能只靠“调参”或“选规则”。
- 语义及授权边界待核准：L1 强制边界与可覆盖默认尚未就该字段划清；记录缺口，本阶段不改编译器，也不把默认值翻转自动判为硬约束违反。

| 字段 / 规则 | 当前合并事实 | 建议（未实现） | 上下界（源码） | 未知 / 冲突 / 缺版本 |
| --- | --- | --- | --- | --- |
| `SYSTEM_INVARIANTS` 各布尔项与 `protocolVersion` | 声明为 L1-Hard，永不让步；编译结果带上 `invariants`。其中 `l2CannotWidenL1` 是声明，须与各字段编译逻辑对照，并区分强制边界与可覆盖默认 | 强制边界只能保持；不可调整、不可选择关闭。可覆盖默认的翻转记为「语义及授权边界待核准」，不得自动视为违反硬约束 | 固定字面量；`maxVisibleRepliesCeiling=12` | 未知版本不得推断可放宽。`protocolVersion` 与输入不一致时仍输出常量 1.1。目录 inventory pin 与 HEAD 不同不单独使该不变量无效 |
| `maxVisibleBotRepliesPerRound` | L2 数值经 `resolveMaxVisible` 钳到 `[1, ceiling]`；非数值则 L1-Default=5。legacy lane 用 `COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT`（同为 12）再钳一次 | **只能收紧**已授权的当前有效值：`1 ≤ proposedValue ≤ currentEffectiveValue`（且有效值本身 ≤ 12）。不得为凑配额把默认 5 或现行 3 抬到 5/12。两处 ceiling 常量同源值、不同文件，建议后续单一权威。编译器钳制是失败安全，提案越界须显式拒绝，不得钳制后宣称原提案通过 | compiler：`[1, 12]`；legacy：`[1, 12]`；调参上限=当前有效值 | 缺字段 → 5。未知/非有限数 → 5。生产 lane 与 OS 有效值未知时，不生成可执行调参提案 |
| `maxBeatsPerEpisode` | `clampMaxBeatsPerEpisode`：无效则 1；小于 1 抬到 1；大于 12 压到 12。注释：>1 只开 Facilitator next_beat **观察** | 首期不开放上调（可能增加可见轮次/外发）。若未来开放，只能在已授权范围内且不突破 12，且非法提案须拒绝而非静默钳制通过 | `[1, 12]`，默认 1 | 缺/非数 → 1 |
| `botMaySelfAdvanceWithoutHuman` | 当前实现是 `input ?? L1_DEFAULT`（默认 `false`）。**L2 可以把 false 改成 true**，源码并未在此字段上实现“只能收紧” | 这是可覆盖默认，不是已核实的 L1 强制边界。L2 将默认 false 改为 true **不得自动视为违反硬约束**，记为「语义及授权边界待核准」。首期 shadow 候选不得调整该字段；若将来开放，须单独授权 | 布尔；默认 false | 缺 → false。语义及授权边界待核准 |
| `finalDecisionMode` | 合法值 `human_required` / `delegated_low_risk`；非法回退 L1-Default=`human_required`。L2 可选 `delegated_low_risk`（相对默认更宽的人审） | 同样区分可覆盖默认与强制边界，记为「语义及授权边界待核准」，不得自动判为硬约束违反。放宽到 `delegated_low_risk` 必须重新授权；首期不开放 | 枚举 2 值 | 未知枚举 → 回退 `human_required` 并记 clamp |
| `allowAgentPublishProposal` | `input ?? L1_DEFAULT`（默认 true） | 关闭是收紧，开启或保持开启须符合当前治理门；不作为首期调参 | 布尔 | 缺 → true |
| `mentionBotMustRespond` / `openDiscussionWithoutMention` | 同样是 `input ?? L1_DEFAULT`（默认 false）。L2 可打开 | 打开会扩大主动发言/无提及讨论。属可覆盖默认，授权边界待核准；建议按授权交集处理，首期不开放 | 布尔；默认 false | 缺 → false。生产 lane 未知。语义及授权边界待核准 |
| `lowSignalStrategy` | 合法 `one_reply` / `all_named_confirmers`；非法回退默认 `one_reply` | `all_named_confirmers` 会扩大确认人集合，须重新授权 | 枚举 2 值 | 未知 → `one_reply` |
| `collaborationMode` | 合法三模板；非法回退 `discussion_driven` | 模式切换会改变交付/参与约束，须重新授权，不可当作偏好覆盖 | 三枚举 | 未知 → L1-Default |
| `replyLanguage` | 合法 `zh` / `en` / `inherit`；非法保留默认 `inherit`（脏值只进 provenance，不进 legacy clamps） | 属偏好，可在群 L2 授权下覆盖；**不能覆盖群治理硬字段**。因 lane 默认 legacy，编译值不一定是线上服务值，首期不选此字段 | 三枚举，默认 inherit | 未知枚举 → inherit。生产 lane 未知 |
| `confidentialityCeiling` | 合法 `public` / `internal` / `restricted`；非法回退默认 `internal`。**当前 L2 可以把默认 internal 改成 public**。`enforceConfidentiality` 本身标为 l1-hard | `enforceConfidentiality` 是强制边界；密级默认值是否允许 L2 选 `public` 记为「语义及授权边界待核准」，不得把“L2 选了与默认不同的值”自动写成硬约束违反。建议方向：保密层级只能收紧（public < internal < restricted），上调必须重新授权。这是实现与声明之间待核准的缺口，本阶段不修代码 | 三枚举，默认 internal | 未知 → internal。语义及授权边界待核准 |
| `collaboration.task.requirePeerReview` | 独立配置，默认 false；只影响 accept 门槛，不驱动 admission，不控制 `recordPeerReview` 写入 | 打开等于新增验收门槛/近似审批，首期不开放，也不新增审批模式。配置可读 ≠ 已授权调整 | 布尔，默认 false | 生产值未知 |
| `agents.defaults.contextTokens`（个人/agent 配置帽） | 仅当帽值小于模型/供应商/`DEFAULT_CONTEXT_TOKENS`(200000) 窗口时替换；配置项本身不能放大模型窗口。**当前有效窗口**已计入现有帽 | **只能收紧当前有效值**：`CONTEXT_WINDOW_HARD_MIN_TOKENS(16000) ≤ proposedValue ≤ currentEffectiveValue`。上限是含已有帽的有效窗口，不只是模型窗口（有效 32000 不得提案 64000）。不得修改硬下限常量。删除帽或恢复更高值属放宽，须单独授权并重核，不是普通收紧；删除参数不是合法回退。有效值未知或低于 hardMin 时不生成可执行调参提案。该配置是值来源，不是动态调整授权 | 正整数可选；硬阻断 `<16000`；调参上限=当前有效值 | 生产值未知。缺帽 → 不戴帽（此时有效值=已解析模型窗口；删除已有帽仍属放宽）。无调整授权时只允许 shadow 提案 |
| `CONTEXT_WINDOW_HARD_MIN_TOKENS` / `WARN_BELOW` | `prepare-embedded-model.ts` 传入源码常量 16000 / 32000。函数签名允许覆盖，但该生产入口未把硬下限放到可配置路径 | 硬下限只能收紧（本阶段建议保持常量、不可调）。告警阈不是强制执行点 | 硬下限 16000；告警 32000 | 函数若被传入更低 `hardMinTokens` 可降到 1——当前主入口未这样做，但仍是 API 风险 |
| 重试 / 溢出压缩 / 过载退避 | `resolveMaxRunRetryIterations` 已有 `[32, 160]`；`MAX_OVERFLOW_COMPACTION_ATTEMPTS=3`；退避 `initialMs=250,maxMs=1500,factor=2,jitter=0.2` | 有界，但无独立运行时授权主体；不得为候选发明新的运行时调权。保持 `reviewed_parameters` / 代码评审 | 见左 | 无 per-tenant 覆盖证据 |
| `MAX_PARKED_TASKS` / `MAX_PARKED_SLOTS` / `MAX_FOCUS_SLOTS` / continue 窗口 | 源码常量：任务板挂起基数 3；执行槽挂起 3；焦点 1；每任务续跑 3 次、冷却 15 分钟。两者均为 3 但是**不同常量**，注释禁止混用 | 无独立上下界函数；上调会增加并发任务，首期不开放。不可把两个 3 当成同一规则 | 常量即现行值，无第二套 clamp | 生产值=源码常量（非外部配置） |
| 任务绑定 / 墓碑 / 取消 / `checkTaskActionBoundary` | 绑定失效、墓碑、`wakeSuppress`、约束变更时拒绝动作；工具前 hook 会重查 | **只能收紧**。放宽策略不能复活已取消任务。恢复必须走原 state 入口（如 resume），且仍受墓碑约束 | 无“放宽”参数 | 无版本字段；以当前板快照为准。提案须绑定预期任务版本，过期则拒绝 |
| 外发授权 / 组终稿资格 / 租户+群+actor+target 精确匹配 | `accepted-artifact-delivery.ts` 缺 grant 则 `authorization_pending`，错配/撤销则 deny。组终稿资格在未接线时返回 `outbound_auth_unwired` | **不可调整**。不得作为候选。T9 缺口独立处理 | 无放宽参数；空目的地不是全允许 | 未读生产授权账本 |

## 3. 冲突、缺失、未知版本时的当前行为（事实）

| 情况 | 当前行为 | 建议 |
| --- | --- | --- |
| 未知协作 mode / decision / low-signal / 语言 / 密级 | 回退 L1-Default，部分记入 `clamps` 或仅 provenance | 保持失败安全回退；不得把未知当成更宽授权 |
| 越界 `maxVisibleBotRepliesPerRound` / `maxBeatsPerEpisode` | **编译器**钳到 `[1,12]` 并记录 clamp | 维持硬天花板。P1 **提案校验**对非法值须显式拒绝，不得静默钳制后再把原提案判为通过 |
| 目录 `version`（inventory pin）与当前树 SHA 不一致 | 全部目录条目仍声明 `inventory:efdb1b98…`，不是本盘点 SHA，也不是发布版本，也不是有效策略版本 | **不得**仅因 inventory pin 与 HEAD（或与 `9b65109f…` / `4a786626…`）不同就宣布规则版本无效。须区分 inventory / implementation / effective policy version，并做显式兼容判断（见文首与合约文档 §4）。未知实现版本、有效策略版本不匹配或提案状态过期，才拒绝 |
| 规则 ID 未知 | `getRuntimeRuleDeclaration` 返回 `undefined`；运行时并不查阅目录 | 未知 ID 不得冒充正式规则，不得编入有效策略 |
| lane=`legacy` 与 compiler 同时存在 | 可能服务原始 OS 值（再钳制），与 effective 发生可记录的 divergence | 冲突时不得取更宽者；生产 lane 未知，故候选须按两套钳制的交集收紧。不改 lane |
| `legacyOverlay` 使 dispatch 与 learning 输入不一致 | `legacyOverlayDivergence` 列出差异字段 | 不得用 overlay 扩大 learning 侧未见过的权限 |
| 任务已取消/墓碑/绑定失效 | admit、resume、完成、工具前边界拒绝推进 | 新策略或放宽参数不得复活；恢复走原入口并重核当前授权 |
| 外发 grant 缺失/撤销/字段不匹配 | pending 或 deny，不发送 | 不得用提案补授权 |
| 配置可读但动态调整授权未建立 | 现值可被宿主执行，目录/配置不是控制面 | 只允许 shadow 提案，不得激活；配置来源 ≠ 授权来源 |
| 当前有效值未知或低于 hardMin | 生产配置未读，不得臆造有效窗口/回复上限 | 不生成可执行调参提案（`needs_information` / `blocked`） |

## 4. 五项重点核准（当前事实 + 建议）

### 4.1 个人偏好不能覆盖当前群任务治理

**事实：** 个人 `SessionTaskBoard` 约束、prompt mode、`agents.defaults.contextTokens` 都没有写入 `GroupPolicyInput` 的路径。`SYSTEM_INVARIANTS.personalSessionDoesNotInheritGroupSkillAllowlist` 从相反方向切断个人会话对群技能白名单的继承。群治理门（`evaluateGovernanceGate`）读取的是 `EffectiveCollaborationPolicy.governance`，不是个人偏好。

**建议：** 保持该隔离。任何规则适配提案若以个人偏好改写当前群任务的自进、决策模式、外发或成员写权限，应直接拒绝。

### 4.2 小组策略不能扩大企业或平台权限

**事实：** 不变量声明 `l2CannotWidenL1` 与 `cannotBypassConfidentiality`。`maxVisible*` 与 `maxBeats*` 确实有硬天花板（L1 强制边界）。但若干 L2 字段（`botMaySelfAdvanceWithoutHuman`、`finalDecisionMode=delegated_low_risk`、`confidentialityCeiling=public`）在当前编译器中可以被设得与 L1-Default 不同、且按日常语义更宽。这不等于已经核实它们违反了硬约束：这些是 **可覆盖默认**，与强制边界的关系记为「语义及授权边界待核准」。本阶段不修编译器，也不把“默认 false 改为 true”自动写成硬约束违反。

**建议：** 企业/平台 **强制边界**与不变量只能收紧（协议、可见回复天花板、隔离、外发、观察者不可写、取消围栏等）。可覆盖默认的翻转须单独核准与授权，不得混进首期 shadow 调参。在核准前，首期候选不得调整这些字段。

### 4.3 参数调整不能突破共享预算

**事实：** 可见回复与 beats 受 12 的天花板约束；上下文段预算默认 `maxTokens=24000, maxFiles=20`，当前 compileContextSegment **没有**把 L2 预算覆盖接进去（沿用 L1_CONTEXT_DEFAULTS）。个人 `contextTokens` 的**当前有效窗口**已含现有帽，普通收紧不得高于该有效值，更不能抬高模型窗口。重试次数有 160 上限。生产共享额度/计费预算本阶段未读。

**建议：** shadow 调参必须取“字段硬上限 ∩ 当前已授权有效值 ∩ 共享预算（若后续读到）”。读不到生产预算或读不到当前有效值时按未知处理，不得假设还有余量，不得生成可执行调参提案。

### 4.4 放宽策略不能复活已取消任务

**事实：** `isTaskTombstoned` / `isLiveTaskBinding`（要求 `unfinished` 且非 `wakeSuppress` 且非墓碑且 attempt/版本/约束一致）在 admit、完成、认领、工具前 `checkTaskActionBoundary`（`src/agent-runtime/state/task-action.ts` 第 20–38 行）中强制执行。`boardTodolistDeliveryMapping("cancelled")` 禁止普通交付自进。heartbeat 不能 `create_identity` / `write_completion` / `replan`。

**建议：** 任何“放宽规则/回退快照”都不得使墓碑或已取消任务重新可执行。回退也是一次新版本变更，必须按当前授权重核。删除参数不是合法回退。

### 4.5 停用、删除、修改规则不等同于选择规则

**事实：** 目录不是控制面；硬规则由宿主自动执行，不依赖 Agent 或目录选中。`code_required` 无普通关闭开关。选择/调参/修改/创建/停用在方案中本就是不同权限，当前源码尚未实现该运行时权限模型。

**建议：** 首期只允许对已存在字段做有界收紧的 shadow 提案；禁止把“从目录删除/停用硬规则”解释为适配操作。四种操作须分别授权。

## 5. 与新合并机制的边界

本阶段只记录建议，不实现编译器或 CAS。P1 合约（`contracts-and-merge-semantics.md`）以本表字段性质为准，而不是引入统一覆盖顺序。P1 校验器本身尚未实现。

发现但未修复的实现缺口（最小建议，本阶段不修代码）：

1. `l2CannotWidenL1` 须区分 L1 强制边界与可覆盖默认。部分布尔/枚举/密级字段允许 L2 选择与 L1-Default 不同的值——记为「语义及授权边界待核准」，不要在 P0 改编译器，也不要自动写成硬约束违反。P1 决策按字段写死：首期不调这些字段；若开放则放宽须重授权。
2. `maxVisibleRepliesCeiling` 与 `COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT` 两处维护同一数字 12——建议后续单点权威，避免漂移。
3. `evaluateContextWindowGuard` 允许调用方把硬下限降到 1；生产主入口虽传入常量，compaction/extensions 只 `resolveContextWindowInfo`、不跑 `shouldBlock`。建议后续在所有使用窗口的路径上统一强制下限，但不作为本阶段代码变更。
4. 编译器越界钳制与提案校验必须分开：非法提案显式拒绝，不得钳制后当作原提案通过。适配层不得成为第二套参数权威。

## 6. 首期 shadow-proposal 候选（不是运行时白名单）

选择原则：已有字段、低影响、无新增外部写入、可回退；不新增审批模式；不改变协作自动确认；不涉及外发授权放宽、租户隔离或取消围栏。

**定性（对个人与协作两个候选同时成立）：** 它们是覆盖已有配置字段的 **shadow-proposal 候选**；动态调整授权尚未建立；它们**不是**运行时白名单。独立验收前不生效，亦未修改任何运行时白名单。配置可读只证明值来源，不构成调整授权。在 lane / 调整授权核准前，只做影子校验，不改变 lane，不创建第二套参数权威。

### 6.1 个人场景候选：`model.context_window.guard`（对 contextTokens 的有界收紧 shadow 提案）

| 项 | 内容 |
| --- | --- |
| 规则 ID 与版本依据 | 目录 ID `model.context_window.guard`。目录声明 version=`inventory:efdb1b98d83e096a31e251095080de954f5883ec`。该 pin 落后于盘点 SHA **不单独**使规则版本无效。本盘点以 SHA `9b65109f41dee30b892a6faff493e46e735cab8d` 的**实现版本**为准：`src/agent-runtime/policy/context-window.ts`（`resolveContextWindowInfo` 第 21–50 行，`evaluateContextWindowGuard` 第 57–74 行）。有效策略版本是现行有效窗口（含已有帽），生产值未知。 |
| 适用任务与触发原因 | 个人/嵌入模型准备路径，需要在模型上下文窗口上设置更紧的 agent 帽，以控制压缩与上下文体积。 |
| 当前行为 | 解析顺序：modelsConfig 窗口 → 模型声明窗口 → `DEFAULT_CONTEXT_TOKENS`(200000)。若 `agents.defaults.contextTokens` 存在且更小，则改用该帽（source=`agentContextTokens`），此即**当前有效窗口**。随后用常量 32000 告警、16000 阻断；阻断时 `prepare-embedded-model.ts` 第 82–89 行抛出 `FailoverError`。生产帽值未知。 |
| 建议允许的操作 | **有界调参（只能收紧）的 shadow 提案**。不允许选择关闭该规则，不允许下调硬下限，不允许提案高于当前有效值。选择 / 修改创建 / 停用须另授权，本候选不含。 |
| 值来源（配置来源） | 该 agent 的 `OpenBotConfig.agents.defaults.contextTokens`（可选帽）以及模型/供应商/`DEFAULT_CONTEXT_TOKENS` 解析窗口。生产实际值未知。 |
| 调整授权（谁可在何作用域调整） | **尚未建立**。配置所有者能改配置文件 ≠ 动态适配通道可改该值。在建立前只允许 shadow 提案，不得激活。 |
| 可信身份 | 待核准。个人偏好不是群治理授权，也不是生产凭证。 |
| 允许值 / 范围 | 整数，`16000 ≤ proposedValue ≤ currentEffectiveValue`。`currentEffectiveValue` = 已计入现有 contextTokens 帽后的有效窗口，**不只是**模型窗口。例：有效 32000，提案 64000 必须拒绝。有效值未知或低于 16000 时，不生成可执行调参提案。 |
| 不能改变的硬约束 | `CONTEXT_WINDOW_HARD_MIN_TOKENS=16000` 的阻断；租户隔离、任务取消围栏、外发授权；不得把 `hardMinTokens` 参数降到常量以下。 |
| 实际执行点 | `src/agent-runtime/model/prepare-embedded-model.ts` 第 59–89 行。`src/agents/pi-embedded-runner/compact.ts` 与 `extensions.ts` 只解析窗口、**不调用** `evaluateContextWindowGuard`（遗留缺口，见规则地图）。 |
| 失败与回退 | 低于硬下限：阻断并故障转移，不启动该模型。无效/非正整数帽：`normalizePositiveInt` 忽略，等同未设帽（这是既有解析行为，不是提案通过）。提案低于 hardMin 或高于当前有效值：P1 须显式拒绝，不得钳制后当作通过。删除已有帽或恢复此前更高值：属可能的放宽，须单独授权并重新校验，不得作为普通收紧通过。**删除参数不是合法回退。** 合法回退（若另获放宽授权）是恢复到变更前已授权有效值，并按当前授权重核。 |
| 已有测试 | 目录 `tests: []`（未列）。实际存在：`src/agents/context-window-guard.test.ts`、`src/agent-runtime/model/prepare-embedded-model.test.ts`、`src/commands/onboard-custom.test.ts`（证明解析/告警/阻断与部分配置帽，**存在≠本 SHA 已在本机跑过**）。 |
| 待补测试 | 见 `p1-validation-test-matrix.md`：有效 32000 提案 64000 须拒绝；提案低于 hardMin 须拒绝；删除已有帽不得作为普通收紧通过。另：compact/extensions 路径是否也应阻断（实现缺口，不在本阶段修）。 |
| 预期收益与风险 | 收益：用已有配置项做可回退的上下文收紧影子提案，无新增外发。风险：过紧增加压缩、可能误伤长任务；生产现值和 compact 路径未统一阻断；调整授权尚未建立。 |

### 6.2 协作场景候选：`collab.policy.compile`（仅字段 maxVisibleBotRepliesPerRound 的有界收紧 shadow 提案）

| 项 | 内容 |
| --- | --- |
| 规则 ID 与版本依据 | 目录 ID `collab.policy.compile`。目录 version 同上，仍为旧 inventory pin，**不单独**使规则无效。当前**实现版本**：`compileEffectiveCollaborationPolicy` / `resolveMaxVisible`（`collaboration-compile.ts` 第 101–136、192–362 行）。有效策略版本含 `POLICY_COMPILER_REVISION="1.2.0"`、协议 `1.1` 与已编译 `policyHash`。不得把整个 compile 包当作可任意调参。 |
| 适用任务与触发原因 | 已有群任务在 visible-reply 预算上需要更紧的每轮可见机器人回复上限，以减少同轮并行可见输出。 |
| 当前行为 | L1-Default=5，硬顶=12。L2 合法整数钳到 `[1,12]`。宿主组合根把 `operatingState.collaborationPolicy` 编成有效策略。legacy lane 默认可能直接读 OS 原值并按同样 1–12 钳制。生产 lane 与 OS 值未知。编译器对越界会钳制并记 clamp；这不是提案验收。 |
| 建议允许的操作 | **仅对该字段**的有界调参（只能收紧）shadow 提案：`1 ≤ proposedValue ≤ currentEffectiveValue`（且有效值 ≤ 12）。例：当前有效上限 3，提案 5 必须拒绝。不得把默认 5 上调到 12。不得改 lane 开关，不得调自进/审批/外发/取消等其他 compile 字段。 |
| 值来源（配置来源） | 群已持久化的 `operatingState.collaborationPolicy.maxVisibleBotRepliesPerRound`（L2 group-admin 输入），经 `resolveGroupPolicyInput` → `compileEffectiveCollaborationPolicy`。生产现值未知。 |
| 调整授权（谁可在何作用域调整） | **尚未建立**。能读到 operatingState 或编译结果 ≠ 动态适配通道可改该字段。在建立前只允许 shadow 提案，不得激活。个人偏好不是授权来源。 |
| 可信身份 | 待核准。预期为该群已授权的 group-admin / 平台宿主，须在授权模型中另定。 |
| 允许值 / 范围 | 整数，`1 ≤ proposedValue ≤ currentEffectiveValue`，`currentEffectiveValue ≤ 12`。当前有效值按 legacy 钳制与 compiler 钳制的交集理解；生产 lane 未知时取更紧者，不得取更宽。缺省字段在编译器中按 5 处理，但若已有更紧的有效值，不得推断更大授权。有效值未知时不生成可执行调参提案。 |
| 不能改变的硬约束 | `SYSTEM_INVARIANTS` 中的强制边界（协议、可见回复天花板、隔离、外发、观察者不可写、取消围栏等）；不得新增审批模式。自进默认、决策模式、密级默认等可覆盖字段属「语义及授权边界待核准」，首期不得调整，但不得把它们自动写成硬约束本身。 |
| 实际执行点 | 编译：`resolveMaxVisible`。消费：`src/gateway/collaboration-dispatch/policy-lane-participation.ts`（legacy/`effectivePolicyCeiling`）及后续 dispatch / round-runtime 可见轮次限制。 |
| 失败与回退 | 编译器：越界被钳制并写入 `clamps`，不扩大天花板；非法/缺失回退默认 5。提案校验：越界、放宽、无授权须显式拒绝，不得钳制后当作原提案通过。删除该字段使编译回退到默认 5：若当前有效值更紧，这是放宽，须单独授权，不是普通收紧。回退：恢复到变更前已授权有效值（须按当前授权重核，不得复活取消任务）。删除参数不是合法回退。 |
| 已有测试 | `src/gateway/collaboration-dispatch/policy-compiler.test.ts`、`policy-compiler-sections.test.ts`、`src/agent-runtime/policy/collaboration-rules.test.ts`（含把 99 钳到天花板的用例）。未在本机跑测试。这些证明编译器钳制，不证明提案校验（尚未实现）。 |
| 待补测试 | 见 `p1-validation-test-matrix.md`：有效上限 3 提案 5 须拒绝；提案 99 须拒绝而非“钳到 12 后通过”；无调整授权不得激活；改自进/审批/外发/取消须拒绝。另：legacy 与 effective 在不同 OS 值下取交集；与绝对常量 12 双权威漂移。 |
| 预期收益与风险 | 收益：使用已有、已钳制、无新增写入的群预算字段做影子提案。风险：生产 lane 未知时需同时约束两套路径；双常量可能未来漂移；不得把该字段当成可以改治理或自进的入口；调整授权尚未建立。 |

### 6.3 明确未入选（避免为凑白名单或候选发明可调权限）

- `requirePeerReview`：打开即新增 accept 门槛，接近新审批模式。
- `botMaySelfAdvanceWithoutHuman` / `finalDecisionMode`：改变自动确认与人审。属可覆盖默认，「语义及授权边界待核准」，首期不开放。
- 外发授权、组终稿资格、租户隔离、取消/墓碑围栏：系统强制边界，且 T9 接线仍独立未完成。
- `replyLanguage`：偏好本身低影响，但 live 路径被 lane 默认 legacy 挡住，执行证据不足。
- `maxBeatsPerEpisode` 上调：默认已是 1，上调会增加回合，不符合“无新增外部写入/低影响”。
- `prompt-mode`：无正式规则 ID；按会话类型写死，不是用户偏好开关。
- 源码常量型限额（挂起槽、重试）缺少运行时授权主体，开放即等于发明新调权。
- 整个 `collab.policy.compile` 包：只开放上表单一字段，其余字段不在 shadow 候选集。
