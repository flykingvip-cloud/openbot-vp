# 精确路径与归属冲突清单（WP-00）

HEAD：`c0c0ba52b0b2460a1e3e2fa9bbf7b889355dd07d`  
Agent：`grokbot-verifiable-delivery`  
本任务已登记路径：`.kiro/specs/delivery-reliability-evidence-program/**`（及 Loom 登记触及的 `.loom/registry.yaml` 声明；**registry 提交仍归 kiro-loom lander**）。

## A. 本任务可直接改（无运行热点冲突）

| 路径                                                        | 说明                                   |
| ----------------------------------------------------------- | -------------------------------------- |
| `.kiro/specs/delivery-reliability-evidence-program/**`      | 计划、WP-00/01/02/12 文档与 E0 证据    |
| `.kiro/specs/delivery-reliability-evidence-program/wp12/**` | 许可审计产出（只读结论，不改 LICENSE） |

## B. 共享提交热点（声明≠可提交）

| 路径                  | lander / 信号                                     | 规则                                           |
| --------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `.loom/registry.yaml` | lander=`kiro-loom`（loom-workspace-orchestrator） | 可 `loom register`；**提交由指定 lander 落地** |

## C. 运行路径 — 未批准整片接管

| 路径                                                           | 冲突信号                              | 本阶段处置                       |
| -------------------------------------------------------------- | ------------------------------------- | -------------------------------- |
| `src/agents/pi-embedded-runner/run/attempt.ts`                 | 10+ active claimants                  | **禁止整片接管**；非第一刀       |
| `src/gateway/collaboration-dispatch/**`                        | 大量 collab 任务                      | **禁止整片接管**；仅精确文件切片 |
| `src/agents/execution-preflight/**`                            | constitutional + batch8 + cursor-grok | WP-01/08 先设计，后接管          |
| `src/fabric/**`                                                | kiro-fabric                           | WP-04 先审计；代码需协调         |
| `packages/evolution-core/**`                                   | evolution 专项                        | WP-09+ 协调                      |
| `src/gateway/server.impl.ts`                                   | 多任务宣称                            | WP-02 恢复接线候选；需精确接管   |
| `src/gateway/collaboration-dispatch/handoff-contract.ts`       | 主要为宽泛 `src/**` 宣称              | WP-02 候选；见 wp02 接管表       |
| `src/gateway/collaboration-learning/handoff-contract-entry.ts` | tenant-context + `src/**`             | 仅当接线证明需要时纳入           |

## D. 历史全局冲突

不修改他人 registry owner 以使检查变绿。冲突单列，走 verify-then-take。

## E. 第一刀允许方向（待 WP-02 接管成立）

仅修改已证明必需的最小集合（预期量级）：

1. `src/gateway/server.impl.ts` — 启动路径调用 `recoverPendingHandoffTxns`（或既有恢复所有者等价挂钩点）
2. 可能的薄封装/导出（若缺）— **禁止**无关 refactor
3. 对应测试 — 崩溃夹具 + 重复恢复无副作用

开关 `collaboration.task.handoffContract` 与权限边界保持现状。
