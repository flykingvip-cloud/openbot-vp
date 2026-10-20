# web_read 只读影子切片（Phase B 设计合同）

> Phase B **设计已批准**。**编码仍未批准**，直到本节合同被架构 Owner 签字，且进入 B 前 BaselineManifest 已再冻结。
> 首切面锁定为 `web_read`。不改选 `node_exec`、外部写、消息发送。

## 1. 切片

员工聊天里的只读网页检索意图：

```text
只读网页检索意图
  → shadow intent normalization
  → web_read surface decision
  → policy / evidence gap
  → structured report
  → 不调用 web_search / web_fetch
```

v1 **不写生产 ledger**。不执行、不阻断、不收紧 Gate、不把 sessionKey 或 Workflow 涂成 Path。

## 2. 复用锚点（当前 main 行号）

| 事实                                  | 锚点                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `web_read` 是 `ExecutionSurface` 成员 | `src/task-orchestration/types.ts:40`（类型从 L36 起）                                                                                         |
| capability ladder 含 `web_read`       | 同文件 L70（`CAPABILITY_LADDER` 从 L66 起）                                                                                                   |
| live invoke 冻结                      | 同文件 L22：`ORCHESTRATION_LIVE_INVOKE = false`                                                                                               |
| 只读符号绑定，`execute: false`        | `src/task-orchestration/surface-binding.ts:77-91`：`createWebSearchTool` / `web_search`，`createWebFetchTool` / `web_fetch`                   |
| 影子派发不入队、不调用                | `src/task-orchestration/dispatch.ts:161` 起：常量若为 true 则 fail-closed；影子分支把 `enqueue` 与 `invoke` 置 false，且 `wroteLedger: false` |
| 对照，不新造第五套执行                | `src/agents/execution-preflight/`（热路径预检）。切片观察不得改 `attempt.ts` 的预检语义                                                       |

绑定记录工具**名字**，供差距报告对照。切片实现不得因此调用 `web_search` 或 `web_fetch`。

## 3. 评估合同（编码前必须齐）

没有标注集就不能算 false allow / false completion。没有分母的比率无效。

### 3.1 语料

- **≥60** 条，构成固定为 20 / 20 / 20：
  - 20 明确应为 `web_read`
  - 20 明确不应为 `web_read`
  - 20 模糊，应为澄清（clarify），不是硬选面
- Profile A 与 Profile B **各 30 条**。不得主张「判断与 Profile 无关」，除非书面论证并经架构 Owner 签字。
- 双人独立标注。分歧由**架构 Owner** 裁决并写入元数据。Loom Owner（`grok-bot`）不自动等于裁决人；若同一人兼任，元数据要写明。
- 模型输出不得充当地面真值。

每条必填：

| 字段              | 值域                                                       |
| ----------------- | ---------------------------------------------------------- |
| `id`              | 稳定 id                                                    |
| `profile`         | `A` 或 `B`                                                 |
| `source`          | `prod-replay` / `synthetic` / `unit-fixture`               |
| `utterance`       | 用户可见文本（回放须脱敏）                                 |
| `expectedSurface` | `web_read` / `not_web_read` / `clarify`                    |
| `reasonCode`      | 编排 reason code 或 `none`                                 |
| `humanGate`       | `yes` / `no`                                               |
| `completionLabel` | `should_complete` / `must_not_complete` / `not_applicable` |
| `annotators`      | 两人 id                                                    |
| `adjudication`    | `agree` 或 Owner id + 裁决                                 |

Phase A **不填写**这 60 条。缺文件或缺行数 = 编码合同未齐。下面的问答表是地面真值规则，不是语料本身。

### 3.2 地面真值问答

| 问题                                        | 冻结答案                                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 谁标注「false allow」的正确答案？           | 双标注；分歧由架构 Owner 裁决。正确答案是裁决后的 `expectedSurface`，不是 legacy 行为                                                                            |
| false allow 的分母？                        | 仅 `expectedSurface=not_web_read` 的明确负例（目标 20）。分子 = 其中被决策为 `web_read` 的条数。`clarify` 不进入此分母                                           |
| false completion 的分母？                   | `completionLabel` 为 `should_complete` 或 `must_not_complete` 的子集。分子 = 影子报告的完成判断与标签相反的条数。`not_applicable` 排除并单独计数。禁止无分母比率 |
| shadow 与 legacy 不一致时谁是真值？         | **标注集**是评估真值。legacy 只做对照与回归，不是自动真值                                                                                                        |
| 样本从哪来？                                | 三条来源标签可混合。每条必须有 `source`。禁止无来源的临时句子充数                                                                                                |
| 何种阈值才允许把结果送进 Phase C **考虑**？ | 见 §3.3。未达标时 C 只能 NO-GO 或 REVISE。本表不预提交 GO                                                                                                        |
| 澄清集怎么记？                              | 单独报 clarify-miss（该澄清却硬选了面，或该硬选却澄清）。不并进 false allow                                                                                      |

### 3.3 阈值

| 度量                                                 | 进 C 考虑的门                                | 分母 / 真值                                     |
| ---------------------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| false allow                                          | ≤ 5%                                         | §3.2 负例集                                     |
| false completion                                     | ≤ 5%                                         | §3.2 完成标签子集；子集为空则该门失败，不得省略 |
| shadow/legacy 分歧率                                 | 必报。> 15% 必须逐条解释。分歧本身不自动失败 | 真值 = 标注；对照 = legacy                      |
| replay determinism                                   | 100% 同输入同决策                            | 固定语料重放                                    |
| cross-tenant misattribution                          | = 0                                          | 多租户夹具；一条非零即失败                      |
| 用户可见输出、工具调用次数、ledger 写入 vs shadow 关 | 零差异                                       | diff。v1 本来就不写生产 ledger                  |
| p95 附加延迟                                         | ≤ 10 ms（示例预算）                          | 未达到则 Phase C **必须**把成本当反证           |

### 3.4 确定性与安全

- 同输入重跑，决策相同。
- 跨租户误归属为零：A 的句子不得记入 B 的租户，反之亦然。
- 观察关闭时，用户可见结果、工具次数、ledger 与基线一致。
- 报告不得声称 C5 / C10 / C11 转为 pass。

## 4. 报告落点

- Evaluator 返回结构化结果（决策、reason codes、gap、是否 human gate、完成判断、与标注的对比字段）。
- 测试或离线命令把该结果打成报告。
- **v1 不写生产 ledger。** 字段稳定之后是否挂已有账本，另立小决策，默认不写。
- 不新建日志库，不新建第五套状态机。

## 5. 回滚

关闭观察旗标或卸掉接线。无执行面变更，回滚停在配置/接线级。不得靠翻转 `ORCHESTRATION_LIVE_INVOKE` 或 Fabric 默认值来「回滚」。

## 6. 明确非目标

- 不执行、不阻断、不收紧 Gate。
- 不打开 Fabric，不把 `ORCHESTRATION_LIVE_INVOKE` 设为 true。
- 不调用 `web_search` / `web_fetch`。
- 不以 `node_exec`、外部写、消息发送为首切。
- 不把 Workflow 或 sessionKey 涂成 Path。
- v1 不写生产 ledger。
- 无标注集或无阈值签字 → 不批准编码。
- 不把本设计文档里的 60 条**配额**假装成已经标好的语料。

## 7. 编码前核对单

- [ ] 目标面仍是 `web_read`
- [ ] ≥60 条语料文件存在，字段符合 §3.1，A/B 各半，Owner 裁决已填
- [ ] §3.3 阈值未被口头放宽
- [ ] 报告路径是结构化返回 + 测试/离线报告
- [ ] BaselineManifest 已按权威文规则在进 B 前再生
- [ ] 架构 Owner 在语料元数据或评审纪要签字

未勾选则 Phase B 编码保持不批准。
