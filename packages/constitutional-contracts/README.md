# @openbot/constitutional-contracts

Phase D §9.1 第一刀：单一契约包的**草稿**。书面范围是 `phase_d_first_knife_contracts`（2026-09-25）。Phase C 的独立裁决仍是 NO-GO；本包不把该裁决改写成 GO。

包是纯控制面。它不 import Gateway、领域存储或 `evolution-core`。调用方把已经读到的源账行注入适配器。

## 范围内

| 组件       | 做什么                                     |
| ---------- | ------------------------------------------ |
| schemas    | Identity / Contract / Evidence 的 Zod 草稿 |
| adapters   | 把注入的源账行映射成上述草稿               |
| read-model | 宪法账本**视图**。源账 id 保持分开         |
| evaluator  | 只读 shadow 符合性报告                     |
| path-gap   | P8a：默认关闭的 `no_valid_path` 报告       |
| runtime-facade | 默认关闭的 shadow hook。复用 evaluator |
| legal-path | P8b Knife1 选中 + P8b 有界执行 opt-in（均默认关；执行为包本地 stub） |

三条术语在 schema 和适配器里保持分开：

- Workflow ≠ Path（P8a / 默认关时 `selectedPath` 为 `null`；P8b Knife1 仅在显式 opt-in 且候选命中登记集时可为 `constitutional.declared.v1`）
- receipt ≠ proof（回执不能带 proof 等级）
- plugin installed ≠ capability authorized（插件登记簿不能当授权账）

## 明确不做

- 不把 `ORCHESTRATION_LIVE_INVOKE` 设为 true（本包不引用该常量，自身 `CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE` 为 `false`）
- 不默认打开 Fabric
- 不涂装 Path，不收紧 Path / Gate。P8a 只命名 `no_valid_path`（见下节）。P8b Knife1 提供默认关的选中 API；P8b 有界执行 opt-in 提供默认关的包本地 stub（见下节）；P8c 提供默认关的影子↔legacy **对照报告**（见下节）；Gate 收紧仍不在本包
- 不在生产聊天上 enforce。`evaluateShadowConformance` 的 `enforce` 选项即使传入 `true` 也只记一条忽略说明，`enforced` 仍为 `false`
- 不合并 Profile A/B，不物理并账，不把回执升成证明，不把已安装插件写成已授权能力
- 不新增第五套执行状态机、生产日志库或跨域写权威
- 不实现 Bridge，不替换 Pi，不抬升 Gateway `PROTOCOL_VERSION`
- 不把本包接到 gateway chat、tool invoke、ACP、AOR。Runtime 门面只是可选 shadow hook，调用点在 `task-orchestration` 与 `execution-preflight` 的显式函数上，不进聊天热路径，不另起执行故事

主张等级：`code-present`。门面默认关闭，且没有挂进聊天热路径，不能写成 `runtime-enabled` 或 `production-proven`。

## P8a 缺口命名（仅报告）

书面范围是 `phase_d_p8a_report_only`。发现注：`.kiro/specs/constitutional-governance-discovery/phase-d-p8a-no-valid-path.md`。

`reportPathGap` 在显式 `report: true`，或调用方传入已打开的 `OPENBOT_CONSTITUTIONAL_PATH_GAP_REPORT` 快照时，发出 `no_valid_path`。默认不命名。函数不读 `process.env`，不选择 Path，不执行，不收紧。

- Workflow ≠ Path。sessionKey、Lobster、AOR 图、Fabric 图、休眠编排都不会被写成 Path。
- `path=unset` 是缺口报告，不是热路径收紧的成功门。`readyToTighten` 与 `pathUnsetIsTighteningGate` 恒为 false。
- P8b（可执行的合法 Path）、P8c（影子对照收紧门）、Gate 收紧、enforce、live invoke、Fabric 默认开：**未授权**。
- gateway chat、tool invoke、ACP、AOR 不读取该旗标，也不调用该函数。

## Runtime 门面（仅 shadow，默认关）

书面范围是 `phase_d_runtime_facade_shadow_only`。发现注：`.kiro/specs/constitutional-governance-discovery/phase-d-runtime-facade-shadow.md`。

`runRuntimeFacadeShadow` 在显式 `shadow: true`，或调用方传入已打开的 `OPENBOT_CONSTITUTIONAL_SHADOW` 快照时，调用 `evaluateShadowConformance`。默认不调用评估器。函数不读 `process.env`。

显式调用点（都不会被聊天热路径 import）：

- `observeOrchestrationRuntimeFacade`（`src/task-orchestration/constitutional-runtime-facade.ts`）
- `observePreflightRuntimeFacade`（`src/agents/execution-preflight/constitutional-runtime-facade.ts`）

打开之后仍然只报告。`enforce`、`enforced`、`liveInvoke`、`fabricDefaultOn` 恒为 false。不阻断，不写生产账本，不调用 `considerDispatch`，不写预检回执或 trace。

- 仅 shadow opt-in（无 select）时：`selectedPath` 仍为 null，`legalPathSelectable` 为 false（#60 行为面）。
- P8c、Gate / Path 收紧、enforce 默认开、live invoke、Fabric 默认开：**未授权**。
- `enforce: true` 只会被评估器记成忽略说明，不能把本门面打开成强制模式。单独传 `enforce: true` 且未 opt-in 时，门面保持 inert。

## Path-Gate：shadow ↔ Knife1 select 仅报告桥（双 opt-in，默认关）

书面范围是 `phase_d_path_gate_shadow_select_report`。开工令：`phase_d_path_gate_shadow_select_report_start_order`。发现注：`.kiro/specs/constitutional-governance-discovery/phase-d-path-gate-shadow-select-report-scope.md`。

当调用方**同时** opt-in shadow（`shadow: true` 或 `OPENBOT_CONSTITUTIONAL_SHADOW`）**且** legal-path select（`select: true` 或 `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT`）时，`runRuntimeFacadeShadow` 可调用 `selectLegalPath` 并在报告结果中表面化非空 `selectedPath` / `legalPathSelectable`。任一旗标关 → 退回 #60 面（不选中）。函数不读 `process.env`。

- **报告桥 ≠ Gate 收紧 ≠ 热路径 ≠ 执行。** `executed` 恒 false；`readyToTighten` 恒 false。`shadowCompared` 仅在独立 P8c COMPARE opt-in 下可为 true（见下节）。
- 涂装候选（workflow / session / Lobster 等词）不会被写成 Path。
- 不接线 gateway chat / tool observe 以外的热路径；不打开 Fabric / live invoke / enforce。
- 主张等级：`code-present`。**C10 仍不能 pass**；非整段 D GO。

## Path-Gate：shadow select 诊断充实（同一双 opt-in，默认关）

书面范围是 `phase_d_path_gate_shadow_select_diagnostics`。开工令：`phase_d_path_gate_shadow_select_diagnostics_start_order`。发现注：`.kiro/specs/constitutional-governance-discovery/phase-d-path-gate-shadow-select-diagnostics-scope.md`。

在同一双 opt-in（SHADOW ∧ LEGAL_PATH_SELECT）下，shadow 报告结果额外表面化 Knife1 select 诊断字段：`selectEnabled`、`effectiveLegalPathIds`、`candidatePresent`、`candidateAccepted`、`selectMessage`（来自 `LegalPathSelectResult.message`）。select 关时这些字段保持 inert / 空等价。**不**发明新 ENV；**不**扩登记集；**不**热路径接线。

- **诊断充实 ≠ Gate 收紧 ≠ 热路径 ≠ 执行 ≠ 登记扩展。** `executed` 恒 false。
- 主张等级：`code-present`。**C10 仍不能 pass**；非整段 D GO。

## P8b Knife1 合法 Path 选中（不执行，默认关）

书面范围是 `phase_d_p8b_knife1_select_only`。发现注：`.kiro/specs/constitutional-governance-discovery/phase-d-p8b-knife1-scope.md`。Profile 冲击：`phase-d-p8b-knife1-profile-impact.md`。

`selectLegalPath` 在显式 `select: true`，或调用方传入已打开的 `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT` 快照时，可从登记集选取 `constitutional.declared.v1`。默认不选中。函数不读 `process.env`。

- 合法集在旗标打开时长度为 1；旗标关闭时有效合法集为空（秒级回滚到 P8a 行为面）。
- `executed` / `sideEffects` 恒为 false / 空。本刀不授权执行副作用。
- sessionKey、Lobster、AOR 图、Fabric 图、休眠编排、workflow 词都不会被写成 Path。
- `c5Pass`、`readyToTighten`、`shadowCompared`、`enforce`、`liveInvoke`、`fabricDefaultOn` 恒为 false。
- P8a 的 `LEGAL_CONSTITUTIONAL_PATHS = []` 与 `reportPathGap` 保持不动。
- gateway chat、tool invoke、ACP、AOR 不读取该旗标，也不调用该函数。
- 主张等级：`code-present`。不得写成 `runtime-enabled` / `production-proven` / C5 全面 pass。

## P8b 有界执行 opt-in（包本地 stub，默认关）

书面范围是 `phase_d_p8b_execute_opt_in`。开工令：`phase_d_p8b_execute_opt_in_start_order`。发现注：`.kiro/specs/constitutional-governance-discovery/phase-d-p8b-execute-opt-in-scope.md`。

`executeLegalPath` 复用 `selectLegalPath` 做选中；仅当 `selectedPath` 非空 **且** 显式 `execute: true`（或调用方传入已打开的 `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE` 快照）时，`executed=true`。默认不执行。函数不读 `process.env`。

- **执行 opt-in ≠ Gate 收紧 ≠ 热路径 ≠ 整段 P8b 完成 ≠ C5/C10 pass。**
- EXECUTE 默认关；关掉旗标（或不传 `execute` / 不传 EXECUTE 快照）即秒级回滚到「仅选中 / 不执行」。
- `executed=true` 时 `sideEffects` 至多含包内审计标记 `package-local-execute-allowed`；**禁止**写网关/租户数据。
- 登记集仍为 1；`registry.ts` 的 `executionAuthorized: false` 保持 Knife1 历史面；执行由本 API 的 EXECUTE 旗标门控，不靠扩登记。
- Knife1 `selectLegalPath` 的 `executed` 仍恒 false；执行是独立 API。
- `c5Pass`、`readyToTighten`、`shadowCompared`、`enforce`、`liveInvoke`、`fabricDefaultOn`、`paintedAliasUsedAsPath`、`mutated` 恒为 false。
- gateway chat、tool invoke、ACP、AOR 不读取该旗标，也不调用该函数。
- 主张等级：`code-present`。**C10 仍不能 pass**；非整段 D GO；非整段 P8b 完成。

## P8c 有界影子↔legacy 对照报告（默认关）

书面范围是 `phase_d_p8c_shadow_legacy_compare`。开工令：`phase_d_p8c_shadow_legacy_compare_start_order`。发现注：`.kiro/specs/constitutional-governance-discovery/phase-d-p8c-shadow-legacy-compare-scope.md`。

当调用方 **SHADOW 开**（`shadow: true` 或 `OPENBOT_CONSTITUTIONAL_SHADOW`）**且** **COMPARE 开**（`compare: true` 或 `OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE`）**且** 两侧提供足够的字符串决策快照（`legacyDecision` / `legacyPathRef` 与 `constitutionalDecision` 或复用 `selectedPath`）时，`runRuntimeFacadeShadow`（及/或 `compareShadowToLegacy`）可设 `shadowCompared=true` 并表面化 `compareMatch`、`legacyDecisionPresent`、`constitutionalDecisionPresent`、`compareMessage`。默认不对照。函数不读 `process.env`。

- **对照报告 ≠ Gate 收紧 ≠ 热路径 ≠ 整段 P8c 完成 ≠ C5/C10 pass。**
- COMPARE 默认关；关掉旗标（或不传 `compare` / 不传 COMPARE 快照）即秒级回滚到 `shadowCompared=false`。
- **`readyToTighten` 本刀永远 false**；禁止因对照匹配而翻 true。
- `executed` 不由本刀扩展；仍由独立 EXECUTE opt-in 管辖。
- `legacyDecision` / `legacyPathRef` 是**字符串快照**，不是 Path；涂装别名不得升格为 Path。
- gateway chat、tool invoke、ACP、AOR 不读取该旗标，也不调用该函数。
- 主张等级：`code-present`。**C10 仍不能 pass**；非整段 D GO；非整段 P8c 完成。

## 回滚

本刀没有热路径接线，关闭方式是不再 import 本包。

- `CONSTITUTIONAL_CONTRACTS_ENFORCE`、`CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE`、`CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON` 都是常量 `false`，没有环境变量可以把它们打开。
- `OPENBOT_CONSTITUTIONAL_SHADOW` 默认未设置即为关闭。Runtime 门面只在调用方传入该变量的快照（或 `shadow: true`）时调用评估器，并且不读 `process.env`。聊天热路径没有安装读取它的 hook。删掉变量、不要调用 observe 函数，或把包从依赖图拿掉，即回到今天的行为。
- `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT` 默认未设置即为关闭。`selectLegalPath` 只在调用方传入该变量的快照（或 `select: true`）时允许选中，并且不读 `process.env`。关闭后有效合法集为空、`selectedPath` 为 null、`executed` 为 false。聊天热路径没有安装读取它的 hook。
- `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE` 默认未设置即为关闭。`executeLegalPath` 只在选中已成立且调用方传入该变量的快照（或 `execute: true`）时设 `executed=true`，并且不读 `process.env`。关掉即秒级回滚到「仅选中 / 不执行」。聊天热路径没有安装读取它的 hook。执行 opt-in ≠ Gate 收紧 ≠ 整段 P8b 完成。
- `OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE` 默认未设置即为关闭。对照只在 SHADOW 已开且调用方传入该变量的快照（或 `compare: true`）且两侧快照足够时设 `shadowCompared=true`，并且不读 `process.env`。关掉即秒级回滚到 `shadowCompared=false`。`readyToTighten` 仍恒 false。对照报告 ≠ Gate 收紧 ≠ 整段 P8c 完成。
- shadow↔select 报告桥 / 诊断充实需**两旗标同时** opt-in。关掉任一旗标（或不传 `shadow`/`select`）即回到 #60 报告面（`selectedPath` null；诊断字段 inert/空）。秒级回滚，无需删库。
- 任何真正的 enforce 或 Gate 收紧需要单独 ADR，并且必须默认为关。本包不提供这个开关。

## 本地检查

```bash
pnpm --dir packages/constitutional-contracts run typecheck
pnpm --dir packages/constitutional-contracts test
pnpm --dir packages/constitutional-contracts run build
```
