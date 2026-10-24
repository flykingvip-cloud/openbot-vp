# 代码现状与架构约束

核验基线：`1012c1bd553e69f1b7ebe81d258f3872dfb0bea6`。下列是源码阅读事实或待核验项，不是生产证明。本轮未运行应用测试、连接生产或检查线上配置。

## 现状与复用清单

| 主题             | 已读代码或材料                                                                                                                                       | 观察与实施约束                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 交付校验         | `src/agents/execution-preflight/{resolve,validation,completion-hold}.ts`；`src/agents/pi-embedded-runner/run/attempt.ts`                             | 已有技能契约、哈希回执、交付检查；receipt/hold 有进程内状态，需证明恢复及延迟交付行为，不能假定持久化完成                                            |
| 完成与任务上下文 | `src/agents/turn-completion/contract.ts`；`src/agents/task-surface/**`；`src/agents/context-compiler/**`                                             | 近期已有任务面、完成协议和上下文编译器；必须与旧预算规划器联合盘点，禁止再建一套完成判定或互相裁剪                                                   |
| 交接             | `src/gateway/collaboration-dispatch/{handoff-contract,task-runtime}.ts`；`src/gateway/collaboration-learning/handoff-contract-entry.ts`              | 已有 propose/accept/approve/apply、事实与事务恢复；开关默认关闭；负责人转移需人类批准                                                                |
| 恢复接线         | `recoverPendingHandoffTxns`                                                                                                                          | 本轮对生产源码的名称搜索仅发现定义；需查清动态/别名调用、启动和维护路径后再认定缺口，不能直接宣称线上恢复失败                                        |
| Fabric           | `src/fabric/{feature,service,wiring,probes,gateway,execution,policy-runtime,constraints,replay}.ts`；`src/gateway/server.impl.ts`                    | 已有真实执行器工厂和 Gateway 注入，服务受开关控制；公共 execute 使用单工具图，不能推导为已接管所有路径或多步调度                                     |
| Fabric 信任边界  | `src/fabric/probes.ts`；`src/gateway/tools-invoke-http.ts`                                                                                           | 探针包含“入口已鉴权”的假设；迁移到新入口必须证明上下文有效。比较不得读取/消费审批或产生新审批副作用                                                  |
| 编排             | `src/task-orchestration/{types,dispatch,feature,readonly-invoke}.ts`                                                                                 | `ORCHESTRATION_LIVE_INVOKE=false`；核心调度开关默认关闭，但 readonly invoke 默认开启，不能笼统声称编排全部 dormant                                   |
| 预算规划         | `src/context-engine/legacy.ts`；`src/conversations/{context-assemble,context-budget}.ts`                                                             | 旧预算规划器需显式启用；同时存在新 context-compiler，需要确定最终模型请求的唯一裁剪责任                                                              |
| 经验复用         | `src/gateway/pattern-detection/ingest-from-run.ts`；`src/gateway/collaboration-learning/{capsule-promotion,learning-asset-application-store}.ts`     | 工具轨迹形成候选；批准胶囊可晋升为学习资产；被读取或应用的计数不能作为业务收益结论                                                                   |
| 进化评价         | `packages/evolution-core/src/{evaluation-policy,statistics,metrics,external-effect,evolution-completion}.ts`                                         | 已有指标、样本门槛、独立效果验证和完成判定；Phase1 evaluation surface 目前限 working-dna 与 skill-installation，胶囊需映射或经评审扩展，禁止泛化宣称 |
| 实验与效果窗口   | `src/gateway/evolution-control/experiment-manager.ts`；`src/gateway/evolution-governance/{effect-verifications,tick-pipeline}.ts`                    | 已有模型/配置冻结和实验绑定；必须追踪生产存储提供者和真实数据源，内存 store 工厂不等于生产必用内存，也不等于持久化已证明                             |
| 统计口径         | `packages/evolution-core/src/statistics.ts`                                                                                                          | `confidence=2*Phi(abs(z))-1` 是检验相关分数，不能解释为候选改进的后验概率；需要兼容迁移和全部消费者盘点                                              |
| 自动化           | `src/gateway/evolution-governance/{mode,skill-auto-evolution}.ts`                                                                                    | 默认 assist；技能自动推进另需 opt-in、auto 和有效意图；当前规则不允许自动批准候选。保留人工批准边界                                                  |
| 内部约束         | `packages/constitutional-runtime/src/boundary.ts`；`src/agents/execution-preflight/constitutional-runtime-*`；`src/agents/pi-embedded-runner/run.ts` | boundary 明示 scaffold/non-enforce；已有运行时 shadow 注入，默认 NOOP sink；shadow 接线不能证明强制执行或可持久审计                                  |
| 许可             | `LICENSE`；`CONTRIBUTING.md`；各 package/扩展许可；`sbom/openbot.cdx.json`；`scripts/generate-cyclonedx-sbom.ts`                                     | 已有 SBOM，可复用生成链；SBOM、贡献者清单均不是权属法律结论。必须核对当前版本覆盖范围及遗漏生态                                                      |

## 既有专项对照与交接

- `.kiro/specs/openbot-fabric/`：已有执行分工、单策略决策、计划投影、审计及 replay 设计。历史阶段缺口以当前源码复核，不能照抄旧结论。
- `.kiro/specs/openbot-evolution-evaluation-closure/`：复用 Surface/Producer、Effect、Evaluation、Promotion 与完成语义；读取最新任务尾部与未决 blocker。
- `.kiro/specs/evolution-runtime-closure/`：复用 invocation 归因、候选、技能治理；区分完成项、部分项及历史验收范围。
- `.kiro/specs/constitutional-runtime-activation-readiness/`：Checkpoint B 已有 shadow 评审记录；旧设计文本的 REVISE/PENDING 可能已被后续记录替代。以最新同摘要评审材料及源码为准，不扩大历史审批范围。
- `.kiro/specs/constitutional-governance-discovery/`：核对既有 legal-path、唯一收益、禁止平行状态机和生产声明边界。
- `.loom/registry.yaml` 中 Batch 7/8/9/11 等任务：涉及 `attempt.ts`、完成协议、交付目录、OGUI 等共享热点。当前 PM 仅持有本计划目录，不取得这些代码所有权。

WP-00 产出 `existing-work-map.csv`：每个工作项映射原 spec、当前 owner、状态、最近证据、复用/补齐/待确认结论。执行 Agent 对前任改动先核验、再登记正式接管；不得一边保持前任 owner 一边改代码。

## 各层唯一责任

| 层                      | 负责                                                   | 不负责                                     |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------ |
| 组织任务与交接          | 任务责任、交付状态、交接事实                           | 模型选路、底层工具重试                     |
| 编排及既有调度器        | 步骤顺序、依赖、持久调度、租约、恢复、总预算           | 重建权限、另判经验收益                     |
| Fabric                  | 统一请求契约、策略决定与约束、审计投影                 | 另建规划器、第二个调度器或绕开原强制点     |
| 原工具/节点执行边界     | 校验授权绑定、落实约束、业务幂等与效果回执             | 凭旧批准无限执行、靠模型自报成功           |
| constitutional 内部模块 | 验证关键证据/绑定/生命周期不变量，按原执行边界实施约束 | 重做 Fabric 策略、复制任务状态机、独占调度 |
| 进化控制与评价          | 候选、实验、收益证据、晋升和撤回                       | 生产者自批、把安装成功解释为业务收益       |

“单决策点”不意味着取消执行时授权新鲜度、撤销状态、对象版本和租户绑定检查。授权或计划失效时经现有机制重新决策；执行器只落实有效决策，不能自行放宽约束。

## 架构不可违反项

1. 一个业务动作只有一个实际执行所有者，shadow 不执行动作；路径失败后不隐式落到另一执行器重试。
2. 策略决定必须绑定服务端身份、租户、工具及参数摘要、资源范围、策略版本、有效期和批准引用；敏感参数不进入普通日志。
3. 幂等键代表逻辑业务动作，不代表 attempt；重试 attempt 使用相同动作键，参数改变不得复用同键。
4. `unknown_outcome` 是真实状态。外部效果不明时先查询/核对；没有查询或幂等支持的适配器必须暂停人工处理。
5. 执行超时与取消不代表远端操作撤销；补偿不是数据库回滚，补偿动作独立授权并保留原事实。
6. 不建立全局强开关；试点采用服务端范围控制，运行中的任务冻结路径/版本，撤回不清除历史任务或幂等事实。
7. 未拿到业务验收不能计成功；没有数据不能记零事故；缺关键保护指标不能晋升。
8. 禁止修改 scaffold 布尔值冒充成熟；独立部署和跨租户隔离声明需要单独证据。
