# P2 只读规则适配 Agent 与影子模式

- 授权：Owner 于 2026-11-12（Asia/Shanghai）放行 P2 只读 Agent 与影子模式实施。同日判定首轮交付暂不通过（模型编排误放 policy、预算主要是事后统计），本文件已按 r2 纠正后的分层与限额口径修订。
- 基线：`4a786626a1e2892043f57b3832ddf2a407be284a`（HEAD 与 `origin/main` 相同）。
- 盘点 pin：`9b65109f41dee30b892a6faff493e46e735cab8d`。
- 协议版本：`runtime-rule-adaptation-shadow/v1`
- 系统提示词：`runtime-rule-adaptation.shadow.system` / 修订 `2026-11-12.1`（见 `src/agent-runtime/context/rule-adaptation/prompt.ts`）。
- 本文件不改写已验收的 P1 契约正文。P1 全部判定规则继续有效。

## 分层

不能为了复用已登记路径而把模型编排放进 policy。职责如下：

| 内容                                                                 | 归属                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| P1 纯校验器、字段适配描述                                            | `src/agent-runtime/policy/rule-adaptation/`（已冻结，r2 未改源码）                                      |
| Agent 用例、影子调用流程、工具分派、候选受控入口设计存根             | `src/agent-runtime/command/rule-adaptation/`                                                            |
| 模型治理适配、预算/限额执行、把剩余额度与超时信号传给实际 completion | `src/agent-runtime/model/rule-adaptation/`                                                              |
| 系统提示词、规则资料装配/过滤                                        | `src/agent-runtime/context/rule-adaptation/`                                                            |
| 跨层 I/O、预算类型、结果类型                                         | `src/agent-runtime/contracts/rule-adaptation-shadow.ts`（不改冻结的 P1 `contracts/rule-adaptation.ts`） |

`policy/rule-adaptation/shadow/` 已删除，policy 中不再保留编排门面。复用当前实现归位，不复制第二套平行实现。

## 范围与硬边界

本阶段实施通用规则适配 Agent 的只读影子运行：

1. 复用共享 model 治理（`createAuthorizedModelSession`、`resolveEmbeddedModelGovernance`；不另建平行调用栈）。测试与默认夹具注入端口/替身，不发起真实生产模型调用，不读取环境中的真实 key。`resolveAuxiliaryModelGovernance` 的 purpose 是封闭联合类型，本阶段不修改该文件，也不伪造 purpose。
2. Agent 只读取宿主提供的限定规则视图与事实。检索使用结构化过滤和文本匹配，不要求向量库。资料是不可信数据，不能覆盖协议。
3. 输出提案后必须调用已验收的 P1 纯校验器 `validateRuntimeRuleProposal(proposal, hostFacts)`。校验器仍是双参数；`{ proposal, host }` JSON 信封只可作测试夹具；`fixture: true` 不是凭证。
4. 只记录影子结果，并与现行有效策略对比。不写活任务，不改变待办，不进入业务工具循环，不因建议看起来合理而打开执行模式。
5. 限额分为预先强制与事后核算。取消与已产生用量必须保留并走共享记账（`createAuthorizedModelSession(...).recordUsage` 或该端口的测试夹具）。取消及协议失败必须安全返回，不向调用方抛出技术异常，不显示假开工承诺。

明确不放行：策略激活、配置写入、业务工具执行、新规则发布、改现有 compile/执行路径、改规则目录行为、把候选持久化进纯校验器或在本阶段落盘。

## 入口

```ts
runShadowRuleAdaptation(request, { host, model, validate?, candidateEntry? })
  -> Promise<ShadowRunResult>
```

路径：`src/agent-runtime/command/rule-adaptation/`（通过该目录 `index.ts` 导出，不挂到 P1 的 `policy/rule-adaptation/index.ts`，也不挂到 `policy/index.ts` 或现有 command/model/context 总桶以接入生产）。

`activationAllowed`、`claimedEffective`、`executionModeOpened` 恒为 `false`；`commitment` 恒为 `"none"`。结果始终安全返回，不抛给调用方。这些常量字段本身不是「未增加控制权」的独立证明。

## 只读工具

允许：`searchRules`、`getRuleDefinition`、`getEffectivePolicy`。

`submitRuleCandidate` 作为受控入口的设计存根出现时，必须拒绝：`accepted` / `persisted` / `activated` / `published` 均为 false，`code` 为 `p2_persist_forbidden`，`path` 为 `candidateEntry.submitRuleCandidate`。即使调用方传入 `enablePersist: true` 也不得落盘。该入口不得并入 P1 纯校验器。

其他业务工具（如 `createTask`、`writeConfig`、`activatePolicy`）一律 `tool_not_permitted`，不得执行。

检索工具在 runner 记录诊断之前会被 `diagnose_required` 拒绝。Runner 在首次模型调用前自动记录诊断，以满足「先诊断再检索」，不依赖模型自觉遵守。

## 系统提示词要点（版本可追溯）

角色非执行器；信任边界；目录决定约束性质；先诊断再检索；优先保持 / 复用 / 有界调参 / 新候选；结构化输出；未知不猜；不声称已生效。

## 预算与失败

预先强制（须在调用实际 completion 前或之中生效）：

- `maxModelCalls`、`maxRevisions`：下一跳开始前拦截。
- `maxOutputTokens` 的剩余额度作为 `maxTokens` 传给实际 completion 端口。
- `maxDurationMs` 的剩余时长作为 timeout，并与外部取消组成组合 abort 信号；监听与计时器在 `finally` 中清理。永不返回的模型调用必须在时限到期后取消并安全返回，不能挂死。

事后核算 / 预估（不能事先保证，不得称为绝对硬上限）：

- `maxCost`、`maxTotalCost`：费用为预估，完成后入账并在 `limitProof.costAccounting = "estimated_post_hoc"` 中标明。
- `maxInputTokens`：下一跳开始前可预检查，但不能作为 completion 的输出上限传递。
- 若模型忽略 `maxTokens` 仍超额返回：明确做事后处理（本阶段记为 `budget_exhausted`，`postAccountedExhausted` 含 `outputTokens`），用量必须保留。

取消、协议失败时，已产生的用量不得丢弃，须走共享记账机制。超限返回 `budget_exhausted`。取消返回 `cancelled`。散文或坏 JSON 在无剩余修正次数时返回 `protocol_failure`。上述情况均不激活、不写配置、不承诺已开工。

## 结果映射（影子 outcome ← 校验器）

| 影子 `outcomeCode`                        | 主要来源                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `no_change_needed`                        | 结构化 intent 或校验器 `no_change`                                                                                            |
| `insufficient_sources`                    | intent，或校验器 `needs_information` + `missing_host_fact`                                                                    |
| `tool_unavailable`                        | 只读工具不可用后的结构化 intent                                                                                               |
| `insufficient_permission`                 | 读权限拒绝，或校验器 `unauthorized_action`                                                                                    |
| `hard_rule_conflict`                      | `below_hard_min` / `above_hard_ceiling` / `above_current_effective` / `hard_boundary_conflict` / `delete_or_relax_as_tighten` |
| `budget_exhausted`                        | 预先强制门闩或事后核算超额                                                                                                    |
| `malicious_material_rejected`             | 禁止字段或协议覆盖企图；校验器 `structural_forbidden_field`                                                                   |
| `fabricated_rule_id`                      | 校验器 `unknown_rule_id`                                                                                                      |
| `unknown_parameter`                       | 校验器 `non_candidate_field` / `structural_unknown_field`                                                                     |
| `candidate_validated_not_recorded`        | 校验器 `candidate_validated`（不等于已登记）                                                                                  |
| `cancelled`                               | 取消信号、超时或模型端口取消                                                                                                  |
| `protocol_failure`                        | 散文、坏 JSON、端口协议失败                                                                                                   |
| `shadow_recorded`                         | 校验器 `shadow_accepted`（仍不生效）                                                                                          |
| `validator_blocked` / `needs_information` | 其他校验器拒绝或待补事实                                                                                                      |

决策以稳定 `code` / `path` 为准，不以 `message` 文案作为业务判定依据。

## 未增加任务控制权

每次运行前后对 `task` / `claim` / `plan` / `todo` / `task-control` 做快照比较。影子 Agent 不持有这些结构的变更器。`controlUnchanged` 必须为 true，`businessToolsExecuted` 必须为空。相关类型参考但未修改 `src/agent-runtime/contracts/task-control.ts`。

上述断言有价值，但不能单独作为无控制权证明。还必须检查：

- 产品依赖（command / model / context 的实际 import）没有引入可变任务 / claim / plan / todo / 策略激活等状态变更模块；
- 注入端口的类型与测试夹具确实没有暴露状态变更能力（变更器不在产品对象上，只留在测试侧）；
- 常量字段（`activationAllowed=false` 等）本身不是独立证明。
