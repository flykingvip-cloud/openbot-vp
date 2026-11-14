# P2 验收矩阵

本矩阵描述只读影子 Agent 的自动化验收案例。稳定断言使用影子 `outcomeCode`、理由 `code` / `path`，以及（在调用了 P1 校验器时）校验结果的稳定字段。不以 `message` 作为业务判定依据。

测试命令：

```
./node_modules/.bin/vitest run --config vitest.unit.config.ts \
  src/agent-runtime/policy/rule-adaptation \
  src/agent-runtime/command/rule-adaptation \
  src/agent-runtime/model/rule-adaptation \
  src/agent-runtime/context/rule-adaptation
```

覆盖文件：P1 既有 3 个测试文件必须继续全部通过，且其源码不得被本阶段修改。P2 案例分布在 `command/rule-adaptation/*.test.ts` 与 `model/rule-adaptation/*.test.ts`。

| 案例                                       | 期望 `outcomeCode`                 | 关键稳定字段                                                                                                                                                                  | 测试                                                   |
| ------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 无需改规则                                 | `no_change_needed`                 | `code=no_change_needed`，`path=model.output`；`activationAllowed=false`                                                                                                       | `run.cases.test.ts`                                    |
| 来源不足（空视图 + intent）                | `insufficient_sources`             | `code=insufficient_sources`                                                                                                                                                   | `run.cases.test.ts`                                    |
| 来源不足（缺当前有效值，走校验器）         | `insufficient_sources`             | 校验器 `needs_information` + `missing_host_fact`                                                                                                                              | `run.cases.test.ts`                                    |
| 工具不可用                                 | `tool_unavailable`                 | 工具日记 `code=tool_unavailable`，`path=tools.searchRules`                                                                                                                    | `run.cases.test.ts`                                    |
| 权限不足                                   | `insufficient_permission`          | 工具日记 `code=insufficient_permission`，`path=tools.getEffectivePolicy`                                                                                                      | `run.cases.test.ts`                                    |
| 硬规则冲突                                 | `hard_rule_conflict`               | 校验器 `above_current_effective`，`path=proposal.items[0].proposedValue`                                                                                                      | `run.cases.test.ts`                                    |
| 预算耗尽（调用次数 / token / 费用 / 时间） | `budget_exhausted`                 | `path=run.budget`；对应维度出现在 `limitProof.exhausted`；费用为 `costAccounting=estimated_post_hoc`                                                                          | `budget.test.ts`                                       |
| 恶意资料（伪造激活字段）                   | `malicious_material_rejected`      | 含 `structural_forbidden_field`；`policyActivated=false`                                                                                                                      | `run.cases.test.ts`                                    |
| 恶意资料未覆盖协议（模型保持干净提案）     | `shadow_recorded`                  | 校验器 `shadow_accepted`，`activationAllowed=false`                                                                                                                           | `run.cases.test.ts`                                    |
| 编造 ID                                    | `fabricated_rule_id`               | `unknown_rule_id`                                                                                                                                                             | `run.cases.test.ts`                                    |
| 未知参数                                   | `unknown_parameter`                | `non_candidate_field`                                                                                                                                                         | `run.cases.test.ts`                                    |
| 候选规则                                   | `candidate_validated_not_recorded` | 校验器 `candidate_validated`；`candidatePersisted/Activated/Published=false`；`submitRuleCandidate` 的 `code=p2_persist_forbidden`，`path=candidateEntry.submitRuleCandidate` | `run.cases.test.ts`                                    |
| 取消（开始前 / 中途）                      | `cancelled`                        | `path=run.signal`；`commitment=none`；控制权快照不变                                                                                                                          | `run.control.test.ts`                                  |
| 模型散文 / 坏 JSON                         | `protocol_failure`                 | `path=model.output`；无假开工承诺                                                                                                                                             | `run.control.test.ts`                                  |
| 模型端口协议失败 / 抛错                    | `protocol_failure`                 | `path=model.port` 或安全吞掉异常；`threwToCaller=false`                                                                                                                       | `run.control.test.ts`                                  |
| 影子未提权                                 | 同合法影子结果                     | `controlUnchanged=true`；`businessToolsExecuted=[]`；`createTask` / `activatePolicy` 被拒；产品 import 与端口类型无变更器                                                     | `run.control.test.ts`、`no-control-escalation.test.ts` |
| 修正一次后接受结构化输出                   | `no_change_needed`                 | `usage.revisions=1`                                                                                                                                                           | `run.control.test.ts`                                  |
| `fixture: true` 不是凭证                   | `shadow_recorded`                  | `authorizationAssessment=host_unauthorized`，`activationAllowed=false`                                                                                                        | `run.cases.test.ts`                                    |
| 永不返回的模型调用                         | `cancelled`                        | `maxDurationMs` 到期后安全返回，不挂死；用量保留                                                                                                                              | `run.limits.test.ts`、`completion-limits.test.ts`      |
| 超时                                       | `cancelled`                        | 组合超时信号；已产生用量保留并记账                                                                                                                                            | `completion-limits.test.ts`                            |
| 取消后用量                                 | `cancelled`                        | 已产生 token/费用仍在 `usage` 中                                                                                                                                              | `run.limits.test.ts`、`completion-limits.test.ts`      |
| 输出超限                                   | `budget_exhausted`                 | 剩余额度已作为 `maxTokens` 传入；模型仍超额时事后处理且用量保留                                                                                                               | `run.limits.test.ts`、`completion-limits.test.ts`      |
| 清理失败                                   | 安全返回                           | 清理抛错不向调用方抛技术异常，用量保留；成功路径摘掉监听/计时器                                                                                                               | `completion-limits.test.ts`                            |

工具与治理补充：诊断先行门闩、结构化检索、受控入口拒绝落盘、共享 `createAuthorizedModelSession` 复用、取消不启动 fixture completion，见 `tools.test.ts` 与 `model-port.test.ts`。

类型检查与完整治理衔接不得仅凭测试数量宣布完成。若报告 tsgo，须用同一条 `./node_modules/.bin/tsgo -p tsconfig.json` 对照基线，只陈述事实。
