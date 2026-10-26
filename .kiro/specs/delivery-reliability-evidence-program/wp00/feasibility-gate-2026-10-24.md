# 可行性核准门（对照当前代码，执行前）

- 日期：2026-10-24（Asia/Shanghai）
- 审阅人：grokbot-verifiable-delivery（可验证交付）
- 审阅 HEAD：`c0c0ba52b0b2460a1e3e2fa9bbf7b889355dd07d`（= freshly fetched `origin/main`）
- 计划编制基线：`1012c1bd553e69f1b7ebe81d258f3872dfb0bea6`（是当前 HEAD 祖先；其间仅 2 个 device-sdk pin 提交）
- 证据级别：E0（源码/调用图/登记表）；未跑应用测试、未连生产、未改开关/LICENSE
- 结论立场：**有条件核准推进 WP-00 基线交付物；不核准在未完成归属接管前改运行热点代码**

## 1. 计划前提 vs 代码实证

| 计划主张                               | 当前代码事实                                                                                                | 判定                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Fabric 默认关闭                        | `isFabricEnabled` 需 env 或 `gateway.fabric.enabled===true`；注释明确 OFF by default                        | 成立                                         |
| Fabric 可只比较决策                    | `check()` / `replayDecision()` / `dryRunDiff` / `isRelaxation` 存在；replay 注明不重跑副作用工具            | 成立（WP-04 技术可行）                       |
| Fabric 已注入 Gateway                  | `server.impl.ts` 安装 provider，未启用时返回 null                                                           | 成立                                         |
| 编排 live invoke 冻结                  | `ORCHESTRATION_LIVE_INVOKE = false`（types.ts 常量）                                                        | 成立                                         |
| 编排四开关默认关；readonly 默认开      | `feature.ts`：四 env 默认关；`isReadonlyInvokeEnabled` 除非显式 0/false                                     | 成立（计划已警示，不能说编排全 dormant）     |
| constitutional scaffold / 非 enforce   | `RUNTIME_SCAFFOLD_BOUNDARY.scaffoldOnly=true`, `enforce=false`, `liveInvoke=false`                          | 成立                                         |
| `recoverPendingHandoffTxns` 缺生产接线 | 非测试源码仅见 `handoff-contract.ts` 定义；startup 有 `recoverPendingDeliveries`，未见 handoff recover 调用 | 缺口仍在 → WP-02 有真实工作                  |
| completion-hold 偏进程内               | `completion-hold.ts` 注释/结构指向 in-memory receipt                                                        | 成立 → WP-01/06 需证明持久化，不可假定已完成 |
| 进化 Phase1 surface 仅两项             | `PHASE1_SURFACES = working-dna + skill-installation`                                                        | 成立 → WP-09/10 扩 surface 需另评审          |
| 治理默认 assist                        | `DEFAULT_MODE = "assist"`                                                                                   | 成立                                         |
| SBOM 可复用但非权属结论                | CycloneDX 1.6，1600 components，timestamp 2026-10-08，cdxgen 12.8.5；LICENSE 仍为 MIT                       | 成立 → WP-12 可并行审计，不可改 LICENSE      |
| 计划落库目录尚不存在                   | 本轮已复制到 `.kiro/specs/delivery-reliability-evidence-program/`（未提交）                                 | WP-00 文档落库可行                           |

## 2. 架构三条硬约束 — 与计划一致性

1. **Fabric 先比较后迁移**：现有 `check`/`replay` 支持；迁移执行前必须证明比较路径不触发审批/业务写。**可行，且必须按 WP-04→WP-05 顺序。**
2. **编排先恢复/幂等**：当前 live invoke 冻结、缺 lease/fencing 生产语义（orch 目录几乎无租约实现）。**可行但工作量大；WP-06/07 是实质缺口，不是文档工作。**
3. **constitutional 先内部强制、不平行策略器**：scaffold 边界明确禁止用布尔伪装成熟。**可行；WP-08 必须走既有 preflight 强制点，并与 kiro-constitutional-activation 协调。**

## 3. 归属与冲突（阻断运行代码改动）

Loom 在计划热点上存在大量 active 重叠（节选）：

- `src/fabric/**`：`kiro-fabric`（openbot-fabric）等
- `src/agents/pi-embedded-runner/run/attempt.ts`：十余个 active 任务（batch6/7/11、constitutional、collab、…）
- `src/agents/execution-preflight/**`：`kiro-constitutional-activation`、`cursor-grok`、batch8 等
- `src/gateway/collaboration-dispatch/**`：大量 grok-bot / cursor-cloud collab 任务
- `packages/evolution-core/**`：`cursor-grok` evolution-unification、`kiro-decision-surfaces`
- `src/agents/context-compiler/**`：batch7 + grok-bot collab
- `.loom/registry.yaml`：lander=`kiro-loom`（共享热点）

**推论：** 本计划文档 owner（已登记 `delivery-reliability-evidence-program:grokbot-verifiable-delivery`）**不等于**上述运行路径 owner。未完成 verify-then-take / 分工书面确认前，WP-01～WP-11 的代码实施应标 **BLOCKED_ON_OWNERSHIP**。

## 4. 工作包逐项核准

| ID    | 技术可行性                                               | 归属可行性                                  | 核准                                       |
| ----- | -------------------------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| WP-00 | 高：基线/矩阵/ADR/试点草案                               | 已登记计划目录；不改运行代码                | **APPROVE**（仅文档与 E0 证据）            |
| WP-01 | 中高：合同可复用 turn-completion/preflight；需证明持久化 | 触碰 attempt/turn-completion/preflight 热点 | **CONDITIONAL** — 先精确路径清单 + 接管    |
| WP-02 | 高：恢复函数已存在但未接线                               | collaboration-dispatch 热点极密             | **CONDITIONAL**                            |
| WP-03 | 中：legacy + context-compiler 双轨属实                   | context-compiler 多 owner                   | **CONDITIONAL**                            |
| WP-04 | 高：check/replay/dryRunDiff 已具备                       | 需与 kiro-fabric 协调只读探针               | **CONDITIONAL**                            |
| WP-05 | 中：入口收敛可行，但不得双执行                           | fabric + 工具入口多 owner                   | **CONDITIONAL**；写操作另依赖 WP-07        |
| WP-06 | 中：需在既有实体上增量；orch live 仍冻                   | task-orchestration 归属需确认               | **CONDITIONAL**；勿新建平行 DB             |
| WP-07 | 中：适配器能力不齐，unknown_outcome 流程需新建           | 外发/订单相关需隔离端点                     | **CONDITIONAL**；禁止真实客户故障实验      |
| WP-08 | 中：强制点可落 preflight；scaffold 禁改布尔充数          | 与 constitutional-activation 重叠           | **CONDITIONAL**；需 enforce ADR + 前任核验 |
| WP-09 | 中高：evolution-core 统计/surface 边界清楚               | evolution-core 已有专项                     | **CONDITIONAL**                            |
| WP-10 | 中：机制可建；无业务样本则收益只能 unknown               | 依赖业务负责人与数据授权（未冻结）          | **CONDITIONAL**；无样本不宣称 IMPROVED     |
| WP-11 | 依赖全部 G 门槛                                          | 集成 lander 未定                            | **DEFER** 至前置 ACCEPTED                  |
| WP-12 | 高：审计方法清晰；SBOM 可起步                            | 不改 LICENSE；法律结论外置                  | **APPROVE_PARALLEL**（盘点/清单 only）     |

## 5. 已知不可行 / 必须修订的执行方式

- 不可：把 shadow 审批当 enforce；改 scaffold 布尔宣称成熟；开 auto 作完成证明。
- 不可：在共享树上静默改 `attempt.ts` 等 CONFLICT 文件。
- 不可：用安装次数/模型自评/文本长度证明收益。
- 不可：本计划授权生产切换或更换 LICENSE。
- 试点业务负责人、数据授权、验收规则仍未冻结 → 真实收益结论保持 UNKNOWN。

## 6. 建议的下一步（待你核准）

1. **仅完成 WP-00 E0 交付物**（baseline-manifest、entrypoint-matrix、existing-work-map、storage-reuse-adr、pilot-charter、冲突清单），小步提交计划目录；`registry.yaml` 交 kiro-loom land 或获代理授权。
2. **同期启动 WP-12 只读盘点**（不改许可文本）。
3. **逐包对热点路径做 verify-then-take** 后再开 WP-01/02/04/06。
4. 在业务负责人确认前，试点保持「合成回放 + 机制验证」。

— grokbot-verifiable-delivery
