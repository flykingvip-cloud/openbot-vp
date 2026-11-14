# P1 合约与合并语义（规格已同步程序输入边界与安全整数语义；配套纯校验器在本工作树实施中）

- 状态：规格已按安全整数语义、普通数据对象边界、测试夹具标记与双参数公开入口同步。本工作树同时实施类型化契约与纯校验器；不调用模型、不启用策略、不改变 lane、不创建第二套参数权威、不修改既有编译或执行路径、不扩大 T9、不接入生产消费者。
- 本轮：收紧程序输入为 JSON-like 无环普通数据对象，循环引用与过深输入安全拒绝；明确只给 `fixture=true` 不得当作凭证。不重新盘点规则。
- 盘点 / 行号基线 SHA（inventory baseline）：`9b65109f41dee30b892a6faff493e46e735cab8d`（引用与验收文件名固定于此）。
- 工作树登记 SHA（仅登记上下文，**不是**校验器可采信的兼容性证明）：`4a786626a1e2892043f57b3832ddf2a407be284a`。该 SHA 与盘点基线是否行为兼容，仅按既有团队报告记录；P1 不自行判断，也不把路径未变或祖先关系当作宿主核准记录。
- 时间：2026-11-12（Asia/Shanghai）
- 前置：P0 规则地图与决策表（验收方已关闭 P0）。本文件把已核准的纠正写成校验与合并合约；验收矩阵见 `p1-validation-test-matrix.md`；规范性 JSON 样例见 `p1-json-samples.md` 与 `samples/`。
- 退役名称：`candidate_recorded` 不再是活的校验结果种类。若实现或旧文稿出现该词，一律视为已更名为 `candidate_validated`，且不得再被解读为“已经登记入库”。

## 1. 分层：提案输入与校验结果

不得把 Agent 产出与纯校验器产出写成同一组可互换结果。实现者不得在五种结果标签中自由选择，也不得用校验器替 Agent 创建候选。

### 1.1 提案输入（Agent / 调用方提交，校验器不创建）

一次请求的输入种类只能是下列之一；复合请求不得混合这两种输入种类，否则整份 `blocked`（见 §7）。

| 输入种类          | 含义                                                                                                                                                      | 校验器是否可替 Agent 生成该输入                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `policy_proposal` | 对两个 shadow 候选及其**已允许字段**提出的选择 / 调参 / 修改创建 / 停用请求。本阶段字段级合约只覆盖有界收紧调参；其余轴若出现在该输入中，按已知违法处理。 | 否                                                   |
| `rule_candidate`  | Agent 提交的新规则建议（尚不在目录中，或未升格为正式规则）。                                                                                              | 否。校验器不得在输入中没有候选时自行发明或创建候选。 |

授权轴（选择 / 调参 / 修改创建 / 停用）仍然彼此独立，见 §3。它们是授权分类，不是校验结果种类。

### 1.2 校验结果（纯校验器的唯一产出）

一次评估恰好返回**一个**顶层校验结果，不得把 `policy_proposal` 或 `rule_candidate` 当作校验器创建的结果种类。P1 结果种类**恰好**为下列五个（已定义，不得增删或混用）：

| 校验结果              | 含义                                                                                                                 | 可否写入有效策略 / 改配置 / 改 lane / 激活 / 登记入库                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `no_change`           | 提案值等于当前有效值，且当前有效值是合法基线（已知且不低于 hardMin）。                                               | 否。`activationAllowed` 必须为 `false`。                                                                                              |
| `needs_information`   | 在没有任何可独立判定的拒绝条件成立之后，仍缺至少一个**必要的可信宿主事实**；须点名缺失项。尚不能做完整的可执行判断。 | 否。不得合成当前有效值、不得臆造授权状态、不得猜测兼容性。`activationAllowed` 必须为 `false`。                                        |
| `blocked`             | 已知违法、结构不合法或不可接受；须点名违反项。                                                                       | 否。`activationAllowed` 必须为 `false`。                                                                                              |
| `shadow_accepted`     | `policy_proposal` 输入在 shadow 字段合约下合法（有界收紧且通过本文件全部判定）。                                     | 否。P1 即使宿主评估为已授权，也不得激活或写配置。`activationAllowed` 必须为 `false`。                                                 |
| `candidate_validated` | `rule_candidate` 输入通过候选 payload 校验。这只表示提案形态可被接受为**待登记候选**，**不**表示已经登记。           | 否。不得编译进有效策略，不得激活，不得声称已登记。`activationAllowed` 必须为 `false`。结果中不得包含登记回执或由校验器分配的存储 id。 |

选用 `candidate_validated` 而不是 `candidate_accepted` 或已退役的 `candidate_recorded`，是为了避免被误读成“已被写入候选存储 / 已经登记”。真正登记（若发生）只能由后续受控入口完成，并返回**独立回执**；该回执不属于 P1 校验结果。

`needs_information` 与 `blocked` 都不得激活。前者表示在可独立判定的拒绝都未触发之后必要事实仍不足，后者表示已经可否决。不得用“先钳制再通过”把 `blocked` 改写成 `shadow_accepted`。同一输入经 §6 固定顺序只能得到一个顶层结果，实现者不得在多种结果之间任选。

## 2. 影子合法性、activationAllowed 与 authorizationAssessment

影子合法性（提案值是否落在字段合约内）与执行授权（是否允许激活或写配置）是不同字段，不得合成一个结果标签。P1 **没有**激活通道；激活资格契约留待 P3 单独定义，本文件只保留指针，不预写 P3 判定。

| 字段                             | 来源                                    | 规则                                                                                                                                       |
| -------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 影子合法性                       | 按 §6 用提案输入 + **可信宿主输入**判定 | 按 §6，合法时的顶层结果只能是 `shadow_accepted`、`no_change`、`candidate_validated` 三者之一，由输入种类与是否等于合法当前值决定，不得任选 |
| `activationAllowed`              | P1 固定字面量                           | 见下。模型不得在提案里填写或覆盖该字段。                                                                                                   |
| `authorizationAssessment`        | 仅由可信宿主提供的授权状态映射          | 见下。用于展示宿主对“调整授权”的评估，**不是**“现在可以激活”。                                                                             |
| 是否实际激活 / 写配置 / 登记入库 | P1 不做                                 | 即使 `authorizationAssessment=host_authorized`，P1 也只返回校验结果，不激活、不写生产配置、不改 lane、不写候选存储。                       |

### 2.1 `activationAllowed` 在 P1 恒为 `false`

`activationAllowed` 是每份校验结果的必填布尔字段。在 P1，它对**每一种**顶层结果都**恒为** JSON 布尔值 `false`。不得返回 `true`。不得把“宿主认为调整已授权”编码进该字段，以免在尚无激活通道时被消费者误用为可执行许可。

### 2.2 `authorizationAssessment`（封闭枚举）

`authorizationAssessment` 是每份校验结果的必填字段，取值只能是下列三者之一，不得自由填写：

| 值                       | 含义                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host_authorized`        | 可信宿主通道**明确**给出 `authorizationStatus=authorized`（该作用域、该授权轴、这些字段的调整授权被宿主视为已授予）。这**不是** P1 的激活许可，也不得据此把 `activationAllowed` 设为 `true`。 |
| `host_unauthorized`      | 可信宿主通道**明确**给出 `authorizationStatus=unauthorized`（未授予 / 尚未建立动态调整授权）。                                                                                                |
| `assessment_unavailable` | 宿主省略了 `authorizationStatus`，或宿主给出的值存在但不可用（不是已定义枚举）。此时不得臆造 `host_authorized` 或 `host_unauthorized`。                                                       |

映射规则：该字段**只**反映可信宿主通道，绝不反映模型提案中的任何授权或激活声明（这类字段若出现在提案上，本身就是结构性拒绝，见 §5）。

- 宿主明确 `unauthorized`，且提案在 shadow 合约下合法：顶层 `shadow_accepted`，`activationAllowed=false`，`authorizationAssessment=host_unauthorized`。
- 宿主明确 `authorized`，且提案在 shadow 合约下合法：顶层仍为 `shadow_accepted`（若等于合法基线则为 `no_change`），`activationAllowed=false`，`authorizationAssessment=host_authorized`。该评估不可被当作 P1 执行许可。
- 宿主省略授权状态：若没有可独立判定的拒绝条件先触发，顶层为 `needs_information`（点名缺授权状态），`activationAllowed=false`，`authorizationAssessment=assessment_unavailable`。
- 若因结构性拒绝或其他可独立判定条件已经 `blocked`，仍按上述规则填写 `authorizationAssessment`（宿主已给出则如实映射，省略或不可用则为 `assessment_unavailable`）。不得用提案里的伪造字段覆盖该映射。

## 3. 四种独立授权

选择（select）、调参（parameter tuning）、修改/创建（modify/create）、停用（disable）是四种独立授权。任一成立不推导另一项。

- 选择已存在且已授权的规则或字段 ≠ 可以改参数。
- 调参 ≠ 可以修改规则文本、创建新规则或停用规则。
- 纯校验器给出 `candidate_validated` ≠ 已经登记、已经选择或已经启用，也 ≠ 校验器创建了该候选。真正登记由后续受控入口完成并返回独立回执。
- 停用、删除、修改规则 ≠ 选择规则。
- 强制规则由宿主在既有执行点完成，不由 Agent 选择目录条目来“补齐”或关闭。

在动态调整授权建立之前：个人与协作两个候选都只是覆盖已有配置字段的 **shadow-proposal 候选**，**不是**运行时白名单。此时只允许影子校验，不允许激活。

## 4. 配置来源 ≠ 授权来源

能读到配置只证明值存在，不证明动态 Agent 可以修改它。每条候选和每份提案须分项记录：

| 记录项     | 含义                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| 值来源     | 当前值从哪里读到（如 `agents.defaults.contextTokens`、`operatingState.collaborationPolicy.maxVisibleBotRepliesPerRound`） |
| 调整授权   | 谁可以在哪个作用域调整该值；动态适配通道的该项授权是否已建立。该状态只来自可信宿主输入。                                  |
| 可信身份   | 提案与执行所信任的身份（人、企业、群管理、平台宿主）。只来自可信宿主输入。待核准则不得执行。                              |
| 实际执行点 | 现值被强制执行的代码路径（相对盘点 SHA 的实现）                                                                           |

配置可读但无调整授权：不得激活。若提案值合法，记录 `shadow_accepted`，`activationAllowed=false`，`authorizationAssessment=host_unauthorized`。

## 5. 模型提案 schema 与可信宿主输入

公开入口是两个**独立函数参数**，而不是把一份 JSON 信封当作外部授权接口：

```text
validateRuntimeRuleProposal(proposal, hostFacts) -> ValidationResult
```

`{ "proposal": <模型提案>, "host": <可信宿主事实> }` 只是**测试夹具**的装载形状，便于把样例文件映射到上述两个参数。不得导出“解析该信封并采信其中 host”的产品 API。测试装载器若发现信封含 `proposal` / `host` 以外的顶层键，不得把该文件当作可信任授权接口继续使用。

两个参数接受的是**已经解析后的程序值**（`unknown`），不是原始 JSON 文本。校验器只接受**普通数据对象**（plain data object）：JSON-like、无环的数据，即原型为 `Object.prototype` 或 `null` 的普通对象、原型为 `Array.prototype` 的普通数组，以及 schema 已允许的原始值（`string` / `number` / `boolean` / `null`；程序通道中的 `undefined` 视为缺省）。类实例、`Date`、`Map`、`Set`、函数及其他宿主对象一律拒绝（`structural_non_plain_object`）。循环引用拒绝（`structural_circular_reference`）。嵌套深度超过 `RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH=32`（顶层参数为深度 1，深度 33 即拒绝）时拒绝（`structural_input_too_deep`）。循环或过深时必须安全返回 `blocked`，不得抛出栈溢出。不要为此开发专用 JSON 解析器。

为避免在环或过深结构上继续行走导致溢出，一旦出现上述任一程序输入边界拒绝，校验器只返回这些已发现的形状原因，不再继续扫描其余 §6.1 项。

`proposal` 走模型提案 schema（不可信，封闭允许集）。`hostFacts` 走宿主输入 schema（可信，封闭允许集）。宿主事实不得出现在提案上，提案字段也不得写入或覆盖宿主通道。

本阶段规范性样例中的宿主事实都是**显式提供的测试夹具**，须带 `fixture=true`；`fixture` **只是测试标记**，不得被当作可信身份、授权或兼容性凭证。校验器不得因 `fixture=true` 授予授权、身份或兼容性。只提供 `fixture=true`、不提供身份或其他必要宿主事实时，按 §6 既有顺序得到 `blocked` 或 `needs_information`，不得通过。从完整宿主事实上删除 `fixture` 后，稳定判定（`resultKind`、`activationAllowed`、`authorizationAssessment` 以及原因 `code` / `path`）必须不变。不得把样例数字当作生产配置读数。P1 不读生产配置。

### 5.1 模型提案：封闭允许集

`proposal.kind` 必须是 `policy_proposal` 或 `rule_candidate`。每种 kind 只允许下列键；未列出的键一律视为未知字段，整份 `blocked`（`structural_unknown_field`）。属于 §5.2 禁止列表的键，即使语义上像“额外信息”，也一律结构性拒绝（`structural_forbidden_field`），**不得忽略后再继续校验**。本文件不同时要求“忽略伪造字段”和“未知字段全部拒绝”。

`policy_proposal` 允许的键（全部必填）：

| 键                      | 类型与约束                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `kind`                  | 字面量 `policy_proposal`                                                                               |
| `scope`                 | 对象，必填键 `type`、`id`。`type` ∈ `personal` \| `group` \| `enterprise` \| `task`；`id` 为非空字符串 |
| `implementationVersion` | 非空字符串（提案声明所依据的实现 SHA，不是兼容性证明）                                                 |
| `expectedPolicyVersion` | 对象，必填键 `policyHash`、`protocolVersion`、`compilerRevision`，均为非空字符串                       |
| `items`                 | 非空数组；每个元素为一个调参项                                                                         |

`policy_proposal` 的每个 `items[]` 元素只允许且必须具备：

| 键              | 类型与约束                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ruleId`        | 非空字符串                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `field`         | 非空字符串                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `action`        | `tune` \| `select` \| `modify` \| `create` \| `disable` \| `delete`。字段级合约只接受 `tune`；其余按可独立判定的已知违法拒绝                                                                                                                                                                                                                                                                                                                                                     |
| `proposedValue` | 对本文件两个整数型候选字段：接受解析后为安全整数的 number：`Number.isSafeInteger(value)`；拒绝非整数、字符串、非有限数及超出安全整数范围的值。之后再检查业务上下界。不要为数字书写形式开发专用 JSON 解析器。普通 `JSON.parse` 之后，`24000.0` 与 `2.4e4` 与 `24000` 不可区分，只要解析结果为安全整数就必须接受。`NaN` 与 `Infinity` / `-Infinity` 仅可作为程序调用边界测试，不得作为合法 JSON 文件内容。`delete` / 置空不得用合法整数伪装；`null` 或其他类型按删除或非法类型拒绝 |

`rule_candidate` 允许的键：

| 键                      | 必填 | 类型与约束                                                                 |
| ----------------------- | ---- | -------------------------------------------------------------------------- |
| `kind`                  | 是   | 字面量 `rule_candidate`                                                    |
| `scope`                 | 是   | 同 `policy_proposal.scope`                                                 |
| `implementationVersion` | 否   | 非空字符串（若出现）                                                       |
| `candidate`             | 是   | 对象，只允许且必须具备 `proposedRuleId`、`summary`、`body`，均为非空字符串 |

`rule_candidate` 不得带 `items`；`policy_proposal` 不得带 `candidate`。若同一提案对象同时具备两类主体，或同一复合请求混合两种 `kind` → 整份 `blocked`（`structural_mixed_input_kinds`）。

`action`、`kind`、`scope.type` 等枚举若出现未定义值，按结构性拒绝（`structural_invalid_type`）。

### 5.2 模型提案禁止字段（出现即结构性拒绝）

下列字段（及其同义写法）**不得**出现在模型提案的任何层级（含 `items[]`、`candidate`、嵌套对象）。出现则整份 `blocked`（`structural_forbidden_field`），即使其余数值本可合法收紧，即使宿主事实本会给出影子通过，即使宿主事实不完整。它们**永远不得**覆盖可信宿主事实。

禁止主题与规范性键名（大小写敏感，精确匹配）：

| 禁止主题                      | 规范性禁止键名                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 授权状态或任何激活 / 授权声明 | `authorizationStatus`、`authorizationAssessment`、`activationAllowed`、`authorized`、`authorization`、`activationRequested`、`activateNow`、`compileNow`、`registerNow` |
| 当前有效值                    | `currentEffectiveValue`、`currentEffectiveValues`                                                                                                                       |
| 兼容性证明或兼容性记录        | `compatibilityRecord`、`compatibilityProof`、`compatibility`、`compatibilityStatus`、`gitAncestry`、`pathUnchangedProof`                                                |

禁止列表不是“可忽略字段清单”。实现者不得先剥离再按其余字段继续校验。未知字段与禁止字段的处理一致：都是结构性 `blocked`，仅 `code` 不同（禁止列表内为 `structural_forbidden_field`，允许集与禁止列表之外为 `structural_unknown_field`）。检查顺序见 §6.1。

### 5.3 可信宿主输入：封闭允许集

`host` 只允许下列键。未知键 → `blocked`（`structural_unknown_field`，路径落在 `host`）。宿主通道是唯一可信来源。

| 键                       | 何时必要                                             | 类型与约束                                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixture`                | 规范性样例必须为 `true`；非样例调用可省略            | 布尔测试标记，不是可信身份或授权凭证。样例中的所有宿主值都是测试夹具，不是生产读数。校验器不得因该标记授予授权、身份或兼容性                                                                         |
| `identity`               | 所有请求必填                                         | 对象，必填键 `principalType`、`principalId`、`scope`。`principalType` ∈ `personal` \| `enterprise` \| `group` \| `platform`；`principalId` 为非空字符串；`scope` 形状同提案 `scope`                  |
| `lane`                   | 所评字段的有效值依赖于 lane 时（含协作编译字段）必填 | `legacy` \| `effective` \| `shadow`                                                                                                                                                                  |
| `currentEffectiveValues` | 所有 `policy_proposal` 调参 / 比较必填               | 对象：键为目标字段路径，值为安全整数（`Number.isSafeInteger`）                                                                                                                                       |
| `authorizationStatus`    | 所有 `policy_proposal` 必填；`rule_candidate` 不要求 | 只能是 `authorized` 或 `unauthorized`。省略视为缺失，不得默认成其中之一                                                                                                                              |
| `compatibilityRecord`    | 所有 `policy_proposal` 必填；`rule_candidate` 不要求 | 对象，必填键 `status` ∈ `approved_compatible` \| `unapproved` \| `incompatible`，以及 `boundImplementationVersion`（非空字符串）、`boundExpectedPolicyVersion`（形状同提案 `expectedPolicyVersion`） |
| `expectedPolicyState`    | 所有 `policy_proposal` 必填；`rule_candidate` 不要求 | `active` \| `cancelled` \| `tombstone` \| `expired`                                                                                                                                                  |

`rule_candidate` 至少需要可信身份与作用域上下文；不要求当前有效值、调参授权状态、兼容性记录或 `expectedPolicyState`。

### 5.4 缺失与不可用的宿主事实

- 某项必要宿主事实**省略**：仅当 §6.1 没有任何可独立判定的拒绝条件成立时，才进入 `needs_information`（点名缺失项）。不得合成当前有效值，不得臆造授权状态，不得猜测兼容性，不得自行跑 Git、判断祖先或根据路径差异推断。
- 某项宿主事实**存在但不可用**（当前有效值不是安全整数，即不满足 `Number.isSafeInteger`；`authorizationStatus`、`compatibilityRecord.status`、`expectedPolicyState`、`lane`、`identity.principalType` 不是已定义枚举）：视为可独立判定的已知违法，`blocked`（`structural_unusable_host_value`），不得改写成合成值后再继续，也不得改称 `needs_information`。

## 6. 固定判定顺序（规范性，先匹配先生效）

对每一份请求，按下述总序判定；**先匹配先生效**。同一输入只允许一个顶层结果。实现者不得跳步、合并或在 `needs_information` 与 `blocked` 之间任选。文档级（整份）检查先于逐项检查。复合请求的逐项结果按 §7 聚合成唯一顶层结果。

**可独立判定的拒绝条件必须前置。** 只要 §6.1 命中任一项，顶层就是 `blocked`，不再进入“缺宿主事实 → `needs_information`”，也不再进入后续兼容性 / 当前值比较。§6.1 扫描时应收集**全部**已发现的可独立判定拒绝原因（按下列子序排列），但不得继续到 §6.2 及之后。

### 6.1 可独立判定的拒绝 → `blocked`

子序如下，先匹配的原因排在 `reasons` 更前；全部为 `blocked`，不得改写成 `needs_information`。

1. 程序输入不是普通数据对象、存在循环引用、或嵌套深度超过 `RUNTIME_RULE_ADAPTATION_MAX_INPUT_DEPTH=32`（顶层参数为深度 1）→ `structural_non_plain_object` / `structural_circular_reference` / `structural_input_too_deep`。类实例、`Date`、`Map`、`Set`、函数及宿主对象均属非普通数据。循环或过深时不得抛出。不要为此开发专用 JSON 解析器。一旦命中本条，不再继续扫描后续 §6.1 项，以免在环或过深结构上溢出。
2. `proposal` 不是普通对象，或 `proposal.kind` 缺失 / 不是两种输入种类之一 → `structural_invalid_type`。测试夹具信封若含未知顶层键，不得作为产品授权接口装载。
3. 同一请求混合 `policy_proposal` 与 `rule_candidate`（含同一对象同时带 `items` 与 `candidate`） → `structural_mixed_input_kinds`。
4. 提案任一层级出现 §5.2 禁止字段 → `structural_forbidden_field`。
5. 提案出现允许集与禁止列表之外的未知字段 → `structural_unknown_field`。
6. 结构 / 类型错误 → `structural_invalid_type`。对已解析的 JavaScript number 使用 `Number.isSafeInteger(value)`：拒绝非整数（如 `24000.5`）、字符串数字（如 `"24000"`）、非有限数（`NaN`、`Infinity`、`-Infinity`）以及超出安全整数范围的值；不得沿用旧编译器的钳制、截断、强制转换或忽略。不要为数字书写形式开发专用 JSON 解析器。普通 `JSON.parse` 后，`24000.0` 与 `2.4e4` 与 `24000` 不可区分，若结果为安全整数则必须接受，然后再检查业务上下界。`NaN` 与无穷值只作为程序调用边界测试，不得写入合法 JSON 样例文件。枚举未定义值同样拒绝。
7. `policy_proposal` 未声明作用域、未绑定实现版本、或未绑定预期任务/策略版本（提案结构性缺失，属已知不完整，不是“再问宿主要一个值”） → `structural_missing_binding`。
8. 同一字段在 `items` 中重复出现（取值冲突或取值相同均整份拒绝，不得部分采纳或折叠为一次） → `structural_duplicate_field`。
9. 宿主通道出现未知键，或某项**已提供**的宿主值不可用 → `structural_unknown_field` 或 `structural_unusable_host_value`。
10. 身份或作用域错配，且根据提案加上**已经提供**的宿主身份 / 作用域事实即可判定（个人 / 企业 / 群与所声明作用域或宿主可信身份不一致；个人偏好改写当前群治理） → `identity_scope_mismatch`。若宿主身份或作用域上下文本身缺失，则本条不命中，留待 §6.2。
11. 未知规则 ID（不在盘点基线目录 / inventory 的已知 ID 集合中；该集合不是逐次请求的宿主事实，P1 不重新盘点） → `unknown_rule_id`。即使同时还缺 lane、当前有效值、授权状态或兼容性记录，仍为 `blocked`。
12. 非候选 / 非 shadow 字段集字段（含批量中出现任一项） → `non_candidate_field`。整份拒绝，不得部分采纳。
13. 宿主已经提供 `expectedPolicyState`，且其值为 `cancelled`、`tombstone` 或 `expired`（以及同类已知终态 / 不可复活状态） → `cancelled_or_tombstone`。即使同时还缺兼容性记录或其他宿主事实，仍为 `blocked`，不得改写成 `needs_information`。不得复活墓碑或已取消任务。
14. 不依赖缺失宿主事实即可判定的其他已知违法 → 对应原因码。包括：提案值低于该字段硬下限（如 `< 16000` 或协作字段 `< 1`）；提案值高于该字段硬天花板（如协作字段 `> 12`）；把删除已有帽 / 置空 / 恢复更高值当作普通收紧（`delete_or_relax_as_tighten`）；在本候选上选择、停用、修改规则文本或创建新规则（应以 `rule_candidate` 输入提交的新规则建议除外，`unauthorized_action`）；改自进 / 审批 / 外发 / 取消围栏 / lane / 密级 / `requirePeerReview` / `maxBeatsPerEpisode` 或其他非 shadow 字段；放宽且未走单独授权通道。此类判定不因同时还缺 lane、当前有效值、授权状态或兼容性记录而改写成 `needs_information`。

### 6.2 必要的可信宿主事实缺失 → `needs_information`

仅当 §6.1 全部未命中时进入本步。点名缺失项（`missing_host_fact`，并填写 `missingFact`）。不得合成当前有效值，不得臆造授权状态，不得猜测兼容性。适用事实见 §5.3–§5.4。

### 6.3 宿主核准的兼容性记录存在，且声明不兼容或未核准 → `blocked`

`compatibilityRecord.status` 为 `incompatible` 或 `unapproved` → `compatibility_not_approved`。

### 6.4 当前有效值已知且已经低于 hardMin → `blocked`

禁止借“无需变化”或“提案等于当前值”返回 `no_change`。也不得生成可执行调参提案。原因码 `current_below_hard_min`。

### 6.5 提案值或操作在依赖宿主事实之后仍属已知违法 → `blocked`

包括：有效窗口 32000 而提案 64000（高于含已有帽的当前有效值，`above_current_effective`）；群当前上限 3 而提案 5；其他 `proposedValue > currentEffectiveValue`；与强制边界冲突或主张在 lane/legacy 与 compiler 冲突时取更宽者（`hard_boundary_conflict`）。未知规则 ID 与已取消 / 墓碑不再放在本步，它们属于 §6.1。

### 6.6 提案值等于当前有效值，且当前有效值是合法基线 → `no_change`

当前值须已知且不低于 hardMin。`activationAllowed=false`。`authorizationAssessment` 仍按 §2.2 映射。原因码 `equal_to_legal_baseline`。

### 6.7 否则，若变更在 shadow 字段合约下合法

- 对 `policy_proposal` 给出 `shadow_accepted`。`activationAllowed` 必须为 `false`。`authorizationAssessment` 按 §2.2 填写（宿主未授权则为 `host_unauthorized`；宿主已授权则为 `host_authorized`，仍不得激活）。原因码 `shadow_legal`。
- 对合法的 `rule_candidate` 给出 `candidate_validated`。`activationAllowed=false`。结果不得包含登记回执、存储 id，也不得使用“已登记 / 已记录 / 已入库”的措辞。校验器不得创建输入中不存在的候选，也不得把输入中的 `compileNow` / `activateNow` / `registerNow` 当成可忽略旗标——那些键属于 §5.2，已在 §6.1 被结构性拒绝。原因码 `candidate_validated`。

若实现需要收紧表述，仍必须保持本顺序的总体性、确定性，以及“可独立判定的拒绝先于缺事实；缺必要宿主事实 → `needs_information`；其余已知违法 → `blocked`”。

## 7. 复合请求：唯一顶层结果与固定聚合规则

复合 / 批量请求只返回**一个**顶层校验结果，并附**逐项原因**。不得部分采纳。

文档级拒绝（§6.1 中适用于整份的项，含非普通数据对象、循环引用、输入过深、禁止字段、未知字段、同一字段重复、批量含非候选字段、混合输入种类、类型/字面量错误、已可判定的身份或作用域错配、未知规则 ID、已知取消 / 墓碑等）→ 顶层 `blocked`，整份拒绝，并附全部已发现的可独立判定原因。即使同时还缺其他宿主事实，也不改为 `needs_information`。

通过文档级与 §6.1 检查后，对每一项按 §6.2–§6.7 得到逐项结果，再按下列**固定**顺序聚合（实现者不得改排序）：

1. 若任一项为 `blocked` → 顶层 `blocked`，附全部逐项原因。
2. 否则若任一项为 `needs_information` → 顶层 `needs_information`，附全部逐项原因（点名每一项缺失的事实）。
3. 否则若全部为 `no_change` → 顶层 `no_change`。
4. 否则若存在 `candidate_validated`，其余仅为 `no_change` 或 `candidate_validated` → 顶层 `candidate_validated`（只表示通过校验，不表示已登记）。因文档级已禁止混合输入种类，该分支只会出现在纯 `rule_candidate` 批量中。
5. 否则 → 顶层 `shadow_accepted`，附逐项细节。`activationAllowed` 仍必须为 `false`。`authorizationAssessment` 按请求级宿主授权状态映射。P1 仍不激活。

## 8. 提案绑定

`policy_proposal` 必须同时绑定：

1. **作用域**：个人 agent 配置、指定群、或指定任务。不得跨作用域改写（个人偏好不得改当前群治理）。
2. **规则实现版本（implementation version）**：所依据的实现 SHA，以及（如适用）编译器修订。本阶段规格文档默认把盘点引用绑定在 `9b65109f…`，协作字段同时声明 `POLICY_COMPILER_REVISION=1.2.0`。这是提案声明，不是兼容性证明。
3. **预期任务/策略版本（expected task/policy version）**：例如预期 `policyHash`、协议 `1.1`、任务绑定版本与约束文本。过期、已被替换或墓碑则拒绝。

提案自身缺任一绑定时，按 §6.1 第 7 条 `blocked`，不得当作可执行提案，也不得改称 `needs_information`。

兼容性是否成立，只看宿主核准的兼容性记录（§9），不由校验器根据绑定 SHA 自行推导。

## 9. 三种版本；兼容性只接受宿主核准信息

不得把“目录 version 与 HEAD 不同”单独解释为规则版本无效。inventory、实现和有效策略版本仍然区分，但**兼容性判断是宿主输入，不是校验器从路径差异或祖先关系推断的结果**。

| 种类                                  | 所指                                                                                                                                                  | 与 HEAD 不同是否自动无效                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 目录 inventory version                | 各规则声明的 `version=inventory:efdb1b98d83e096a31e251095080de954f5883ec`                                                                             | 否。该 pin 是目录盘点元数据，预期会落后于 HEAD，也可落后于盘点实现 SHA。                                                            |
| 实现版本 implementation version       | 规则实现源码所在提交。P0 行号与行为引用固定在 `9b65109f…`。工作树可为登记快进到其他 SHA。                                                             | 否。不得仅因与 HEAD 不同而判无效。是否与提案绑定版本行为兼容，只接受宿主核准记录。                                                  |
| 有效策略版本 effective policy version | 运行时真正生效的版本：`POLICY_COMPILER_REVISION`、`COLLABORATION_POLICY_PROTOCOL_VERSION`、已编译 `policyHash`、现行有效窗口、`collaboration.lane` 等 | 取决于提案绑定的预期版本，以及宿主核准记录与宿主提供的有效策略事实。未知则不生成可执行调参提案。滞后/过期状态在事实已知时明确拒绝。 |

P1 只接收宿主核准的兼容性信息，且：

- **不得**自行运行 Git、判断祖先、比较工作树或猜测兼容。
- “policy 路径没变化”**不足以**证明行为兼容；依赖、schema 与消费者也可能变化。路径未变或祖先关系不能代替宿主核准记录。
- 宿主核准记录缺失 → 仅在 §6.1 未命中时为 `needs_information`。
- 宿主记录声明不兼容或未核准 → `blocked`。
- 目录条目存在且 ID 已知；inventory pin 可与实现 SHA 或 HEAD 不同，只要宿主核准记录接受该绑定，且其余合约通过。
- 本文件记载的工作树 SHA `4a786626…` 仅用于登记上下文。P1 不判断该 SHA，也不把团队关于 #277 的报告当作已提交给校验器的宿主核准记录。

## 10. 强制规则由宿主完成

硬约束与条件强制规则由宿主在既有执行点完成，不靠 Agent 选择目录来启用或关闭。`listRuntimeRuleDeclarations` / `getRuntimeRuleDeclaration` 不是控制面。未选中、从目录删除、或“不编译进本次提案”，都不会、也不得被解释为关闭强制执行。

## 11. 拒绝语义（单一结果，服从 §6）

| 原因                                                                                                    | 结果                                                                                                                  | 说明                                                                                                            |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 提案出现禁止字段（授权、当前有效值、兼容证明）                                                          | `blocked`（`structural_forbidden_field`）                                                                             | 结构性拒绝，不得忽略后继续，不得覆盖宿主事实                                                                    |
| 未知字段 / schema 外键                                                                                  | `blocked`（`structural_unknown_field`）                                                                               | 与禁止字段一样拒绝，不存在“忽略”路径                                                                            |
| 非安全整数（非整数、字符串数字、`NaN`、无穷值、超出安全整数范围）、错误类型                             | `blocked`                                                                                                             | 以 `Number.isSafeInteger` 判定；不得钳制、强制转换、截断或忽略。解析后的 `24000.0` / `2.4e4` 若为安全整数则接受 |
| 同一字段重复（含冲突或取值相同）                                                                        | `blocked`（整份）                                                                                                     | 不得部分采纳                                                                                                    |
| 批量含非候选字段                                                                                        | `blocked`（整份）                                                                                                     | 不得只采纳其中的合法项                                                                                          |
| 个人 / 企业 / 群身份或作用域错配（宿主身份事实已可判定）                                                | `blocked`                                                                                                             | 以宿主可信身份与作用域上下文为准                                                                                |
| 未知规则 ID                                                                                             | `blocked`                                                                                                             | 即使同时还缺宿主事实，也不得改为 `needs_information`；不得冒充正式规则                                          |
| 已知取消 / 墓碑 / 过期（`expectedPolicyState` 已给出）                                                  | `blocked`                                                                                                             | 即使同时还缺兼容性记录，也不得改为 `needs_information`；不得复活                                                |
| 参数越界（低于 hardMin、高于硬天花板）                                                                  | `blocked`                                                                                                             | 不依赖当前有效值即可判定。**明确拒绝**原提案值；不得先钳制再宣称原提案通过                                      |
| 参数高于当前有效值（有效值已知之后）                                                                    | `blocked`                                                                                                             | 同上，显式拒绝原提案值                                                                                          |
| 删除已有帽 / 恢复更高历史值（作为“普通收紧”提交）                                                       | `blocked`                                                                                                             | 属可能的放宽，须单独授权并重新校验。删除参数不是合法回退                                                        |
| 当前有效值已知且已低于 hardMin                                                                          | `blocked`                                                                                                             | 即使提案等于当前值，也不得 `no_change`                                                                          |
| lane、任一必要当前有效值、宿主授权状态、宿主核准兼容性记录或 `expectedPolicyState` 缺失，且 §6.1 未命中 | `needs_information`                                                                                                   | 点名缺失项；不得合成或猜测                                                                                      |
| 宿主兼容性记录声明不兼容或未核准                                                                        | `blocked`                                                                                                             | 不由校验器自行改判                                                                                              |
| 与强制边界冲突，或主张取更宽者                                                                          | `blocked`                                                                                                             | 冲突时不得取更宽者                                                                                              |
| 配置可读但调整未授权，且提案值合法                                                                      | `shadow_accepted`，`activationAllowed=false`，`authorizationAssessment=host_unauthorized`                             | 配置来源 ≠ 授权来源；不得激活                                                                                   |
| 宿主省略授权状态，且 §6.1 未命中                                                                        | `needs_information`                                                                                                   | `authorizationAssessment=assessment_unavailable`；不得臆造                                                      |
| 宿主明确已授权，且提案值合法                                                                            | `shadow_accepted`（或合法基线上的 `no_change`），`activationAllowed=false`，`authorizationAssessment=host_authorized` | 不是 P1 激活许可                                                                                                |
| 非候选字段（自进、审批、外发、取消围栏、改 lane 等）                                                    | `blocked`；若在批量中则整份拒绝                                                                                       | 不在 shadow 候选字段集                                                                                          |
| 试图改 lane 或建立第二套参数权威                                                                        | `blocked`                                                                                                             | 在 lane 核准前只做 shadow 校验                                                                                  |
| 输入中的新规则候选（`rule_candidate`）通过校验                                                          | `candidate_validated`                                                                                                 | 只表示通过纯校验；不得声称已登记；不得带登记回执；校验器不得代为创建                                            |
| 以 `policy_proposal` 要求把新规则立即编入有效策略                                                       | `blocked`                                                                                                             | 输入种类错误或越权生效请求                                                                                      |
| inventory pin 落后于 HEAD                                                                               | 不自动无效                                                                                                            | 只看宿主核准的兼容性记录与其余合约                                                                              |

## 12. 编译器钳制 vs 提案校验

当前协作编译器对越界 `maxVisibleBotRepliesPerRound` / `maxBeatsPerEpisode` 会钳到 `[1,12]` 并写入 `clamps`。这是**编译器的失败安全**，不是提案验收。

P1 校验合约：

- 非法提案值必须被**显式拒绝**（`blocked`），并保留原提案值与拒绝原因。
- 不得把编译器钳制后的值当作“原提案已通过”。
- 非安全整数（非整数、字符串数字、`NaN`、无穷值、超出安全整数范围）与未知字段必须显式 `blocked`，不得沿用旧编译器可能采取的截断或忽略。解析后为安全整数的 `24000.0` / `2.4e4` 必须接受，然后再检查业务上下界。
- 例：提案 99 不得报告为通过且有效值 12；应拒绝提案 99。
- 例：有效窗口 32000，提案 64000，不得钳到 32000 后算通过；应拒绝。
- Shadow 校验可以对照编译器将会如何钳制，作为解释信息，但通过/失败判定不得用静默钳制代替拒绝。
- 本阶段不修改编译器，也不把适配层做成第二套参数权威。

## 13. 在 lane / 调整授权核准前

- 只做 shadow 校验。
- 不改变 `collaboration.lane`（保持未知生产值与源码默认 unset=legacy 的事实；提案不得以改 lane 作为“选择规则”）。
- 不创建第二套参数写入路径或第二编译器。
- 不得激活 policy，不得修改生产配置，不得写任务 / 策略 / 候选存储。
- `activationAllowed` 恒为 `false`，不得把它解释为已激活或“现在可以激活”。`authorizationAssessment` 只展示宿主评估。激活资格契约推迟到 P3。

## 14. 字段级适配合约（仅两个候选）

不得把整个 `collab.policy.compile` 当作可任意调参的包。仅下列已有字段进入 shadow-proposal 合约。

### 14.1 个人：`model.context_window.guard` × `agents.defaults.contextTokens`

- 操作类型：仅调参（有界收紧）。选择 / 修改规则 / 创建 / 停用 / 删除帽均不在本合约。
- 值来源：`OpenBotConfig.agents.defaults.contextTokens`（可选帽）及模型/供应商/`DEFAULT_CONTEXT_TOKENS` 解析窗口。
- 当前有效值 `currentEffectiveValue`：已解析窗口在戴上**现有** contextTokens 帽之后的有效窗口（含已有帽，不只是模型窗口）。只采信宿主提供的该值。
- 硬下限 `hardMin`：`CONTEXT_WINDOW_HARD_MIN_TOKENS=16000`（主入口常量；不可下调）。
- 收紧合约：`hardMin ≤ proposedValue ≤ currentEffectiveValue`，且 `proposedValue` 为安全整数（`Number.isSafeInteger`）。
  - 有效 32000，提案 64000：`blocked`。
  - 提案 `< 16000`：`blocked`。
  - 提案等于当前有效值，且当前值是合法基线：`no_change`。
- 若 `currentEffectiveValue` 未知，且 §6.1 未命中：`needs_information`，不得合成当前有效值，不生成可执行调参提案。
- 若 `currentEffectiveValue` 已知且 `< hardMin`：`blocked`，即使提案等于当前值也不得 `no_change`，不生成可执行调参提案。
- 删除已有帽、或恢复此前更高值：可能的放宽，须单独授权并重新校验，不得作为普通收紧通过。删除参数不是合法回退。此类作为普通收紧提交时：`blocked`。
- 调整授权：由宿主输入提供。未授权且值合法时：`shadow_accepted`，`activationAllowed=false`，`authorizationAssessment=host_unauthorized`。宿主明确已授权且值合法时：仍为 `shadow_accepted`（或 `no_change`），`activationAllowed=false`，`authorizationAssessment=host_authorized`。宿主省略授权状态且 §6.1 未命中：`needs_information`，`authorizationAssessment=assessment_unavailable`。
- 可信身份：由宿主输入提供。错配则 `blocked`；缺失且 §6.1 未命中则 `needs_information`。
- 执行点（相对 `9b65109f…`）：`prepare-embedded-model.ts` 第 59–89 行。compact/extensions 未调用 guard，属已记录缺口，适配层不补偿。

### 14.2 协作：仅 `collab.policy.compile` 字段 `maxVisibleBotRepliesPerRound`

- 操作类型：仅对该字段调参（有界收紧）。不得调自进、审批、外发、取消、lane、密级、`requirePeerReview`、`maxBeatsPerEpisode` 上调等。批量中夹带任一上述字段：整份 `blocked`。
- 值来源：已持久化 `operatingState.collaborationPolicy.maxVisibleBotRepliesPerRound`（L2 输入），经组合根编译；legacy lane 另有本地钳制。生产值未知时须由宿主提供当前有效值，不得由校验器合成。
- 硬下限 1，硬天花板 12（双常量现值相同，权威未合并，取交集 12）。
- 收紧合约：`1 ≤ proposedValue ≤ currentEffectiveValue`，且 `currentEffectiveValue ≤ 12`，且 `proposedValue` 为安全整数（`Number.isSafeInteger`）。
  - 群当前有效上限 3，提案 5：`blocked`。
  - 不得把缺省 5 抬到 12。
- 当前有效值须按 legacy 钳制与 compiler 钳制的**交集**理解，且该交集结果由宿主作为当前有效值提供；校验器不得在 lane 未知时自行取更宽或更紧后当作已读到的有效值。lane 未知且 §6.1 未命中：`needs_information`。
- 调整授权：由宿主输入提供。未授权且值合法时：`shadow_accepted`，`activationAllowed=false`，`authorizationAssessment=host_unauthorized`。个人偏好不是授权来源。
- 编译器钳制不得替代提案拒绝。
- 不改 lane，不引入第二参数权威。
- 提案须绑定实现版本与预期 `policyHash` / 协议版本；兼容性只看宿主核准记录。

## 15. 合并语义（沿用 P0，不实现新机制）

- 无“任务覆盖个人、个人覆盖小组”的统一顺序；按字段性质处理。
- 协作 EffectivePolicy = L1 ∩ L2；L1-Hard 永不让步。
- `l2CannotWidenL1` 须区分 L1 **强制边界**与可覆盖默认：L2 把默认 false 改为 true，不得自动视为违反硬约束，记为「语义及授权边界待核准」。强制边界（协议、可见回复天花板、隔离、外发、观察者不可写、取消围栏等）仍不可放宽。
- 强制规则由宿主执行。回退是新版本变更，须按当前授权重核；不得复活墓碑或已取消任务。删除参数不是合法回退。
- 冲突时不得取更宽者。未知不得推断为更宽授权。

## 16. 校验结果 JSON 形状与原因码

公开入口为 `validateRuntimeRuleProposal(proposal, hostFacts)`。拒绝原因以稳定 `code` / `path` 为核心；`message` 仅供人读，不得作为后续业务判定依据。

每份校验结果必须是如下对象（封闭允许集；不得出现 `registrationReceipt`、`storageId`、`recorded`、`registered` 或同义键）：

| 键                        | 约束                                                                  |
| ------------------------- | --------------------------------------------------------------------- |
| `resultKind`              | 五个结果种类之一                                                      |
| `activationAllowed`       | P1 必须为布尔值 `false`                                               |
| `authorizationAssessment` | `host_authorized` \| `host_unauthorized` \| `assessment_unavailable`  |
| `reasons`                 | 非空数组，按 §6 子序排列                                              |
| `items`                   | 数组；对 `policy_proposal` 的每个输入项一条，对 `rule_candidate` 一条 |

`reasons[]` 与 `items[].reasons[]` 的每个元素允许键：`code`（必填）、`message`（必填字符串）、`path`（可选 JSON 指针式路径，如 `proposal.authorizationStatus`、`proposal.items[0].ruleId`）、`missingFact`（仅 `missing_host_fact` 时必填）。

`items[]` 允许键：`ruleId`、`field`、`proposedRuleId`（仅候选）、`resultKind`、`reasons`。

`missingFact` 封闭取值：`identity`、`scopeContext`、`lane`、`currentEffectiveValue`、`authorizationStatus`、`compatibilityRecord`、`expectedPolicyState`。

`code` 封闭取值：`structural_non_plain_object`、`structural_circular_reference`、`structural_input_too_deep`、`structural_forbidden_field`、`structural_unknown_field`、`structural_invalid_type`、`structural_missing_binding`、`structural_mixed_input_kinds`、`structural_duplicate_field`、`structural_unusable_host_value`、`identity_scope_mismatch`、`unknown_rule_id`、`non_candidate_field`、`cancelled_or_tombstone`、`below_hard_min`、`above_hard_ceiling`、`above_current_effective`、`delete_or_relax_as_tighten`、`unauthorized_action`、`hard_boundary_conflict`、`missing_host_fact`、`compatibility_not_approved`、`current_below_hard_min`、`equal_to_legal_baseline`、`shadow_legal`、`candidate_validated`、`validator_must_not_create_candidate`。

规范性输入／输出样例见 `p1-json-samples.md`；后续测试必须能直接对照这些样例，不得另行发明结果形状。
