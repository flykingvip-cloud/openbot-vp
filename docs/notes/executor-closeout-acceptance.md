# 执行器功能验收收尾（源码）

状态：**实现与源码验收完成，待发布**。本文件不把接口存在写成生产接通，也不把本分支写成 LIVE。

## 1. 接管与基线

| 项                      | 值                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| 核查时间                | 2026-11-01T11:36:38Z 起，测试约 2026-11-01T11:56Z                                          |
| 实施前 `origin/main`    | `72a042332a5b0f3e630a7f916390f730be5e92e0`                                                 |
| rebase 后 `origin/main` | `ea7f9218889ac9ca3d280d15cc14736149af369f`（#181）。祖先检查通过                           |
| 本分支提交              | `b991d50e4294bcc79a76603f575204c31cc95792`                                                 |
| 工作区                  | rebase 后干净，`git merge-base --is-ancestor origin/main HEAD` 通过                        |
| 运行时                  | Node v22.23.4，pnpm 10.23.0（本环境执行 `pnpm install --frozen-lockfile`，退出码 0）       |
| 任务                    | `askOutcome-p0-task-outcome-contract`                                                      |
| 当前 owner              | `执行器收尾`（`via: verified`）                                                            |
| 前任 owner              | `executor-acceptance`（保留在 `ownerHistory` 与 session `askoutcome-p0-local-20261026`）   |
| 本会话                  | `executor-closeout-6a40`，ide `cursor`                                                     |
| 历史预发布报告          | 仓库内无 `openbot-prelease-accept-20261027.md` / `-r2.md` / `-r3.md`。缺失，不补写伪造说明 |

## 2. 本轮修了什么

复用已有 `TaskOutcome` tip、`assessRunnerTurnBudgetGate` / `chargeRunnerTurnBudgetSpend`、`recordRunnerTurnOutcome`、`recordRunOutcome` 去重。不新增第二套成功判定或预算账本。

| 断点                                               | 处理                                                                                                                                                | 生产调用                                                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| CLI / gateway agent / cron / followup 只在收尾记账 | 模型调用前 `assertRunnerTurnBudgetAllowsModelCall`，返回后 `chargeModelCallAgainstTip`                                                              | `src/commands/agent.ts`、`src/cron/isolated-agent/run.ts`、`src/auto-reply/reply/followup-runner.ts`；chat 热路径改为同一计费函数 |
| 未知费用被当成 0                                   | `classifyTipBudgetCostFromUsage`：无价为 `unknown`，成本配置算出的 0 为 `known`。`spentCostUsd` 只加已知正数                                        | `unknownCostCharges` / `knownZeroCostCharges`                                                                                     |
| 子 agent lane 跳过 TaskOutcome                     | `entrypoint: "subagent"`，taskId `subagent:{agentId}:{runId}`                                                                                       | `ensureSubagentTurnTaskOutcome` ← `agentCommandInternal`；spawn 只在父 tip 已存在时传 `parentTaskId`                              |
| 父预算可被子调用绕过，且父子相加会双计             | 子任务记自己的 spend；父 tip 只增加 `childAttributed*`。耗尽判断用两者之和                                                                          | 同一 `callSeq` 的 commandId 重放不累加                                                                                            |
| 模型回退把预算耗尽当成供应商失败                   | `runFallbackCandidate` 遇到 `TaskBudgetExceededError` 直接抛出，不再换模型                                                                          | `src/agents/model-fallback.ts`                                                                                                    |
| 协作 claim 无用量                                  | 不是模型调用。`costEvidence: "not_applicable"`，不计未知美元                                                                                        | `claim-contract-entry.ts`                                                                                                         |
| evolution RPC 把观察写成任务成功                   | `countsAsTaskJudgement: false` 时不增加 `tasksTotal` / `tasksSucceeded`。jsonl 仍可写观察，`readEffectiveEvolutionTaskOutcomes` 本来就要求 `taskId` | `evolution-control.ts`                                                                                                            |
| 长时间 pending 无观测                              | `listStaleAwaitingDeliveries`，启动和 drain 只打日志。不删除、不改成已送达                                                                          | `pending-delivery.ts`、`consumer-boot.ts`                                                                                         |
| supervisor spend 与 tip 各记一本                   | 复用 `chargeModelCallAgainstTip` / `assessRunnerTurnBudgetGate`。每轮监督只记一笔 tip，`nextStop` 读投影，不把本地估计再加一次                      | `superviseTick` 在 `worker.dispatch` 前检查；`src/task-outcome/supervisor-tip-budget.ts`                                          |

## 3. 仍未闭合（不是改名结项）

- 一次 embedded attempt 内部的多轮 provider 调用（工具循环、压缩）仍算一次入口计费。下一次 fallback、下一次入口调用，以及下一次 supervisor `worker.dispatch` 才会被同一本 tip 拦住。
- `attachAdoptedLearningAssetsToTask` 仍没有生产调用方。按契约不从提示词注入推断采用；没有执行证据就不计有效、不策展。
- 学习曝光 pending 仍是进程内 Map。重启会丢掉尚未挂到 tip 的注入记录。
- 协作里非 claim 的 board RPC 继续复用 claim tip，不另造任务身份。
- 同一次 `runId` 在已经记过 attempt 之后再次收尾，若成败载荷不同，会 `command_conflict` 并记日志。模型调用仍然被挡住；这次被挡住的失败不会改写第一条 attempt。
- `recordRunOutcome` 的 evolution append 没有删除。tip 已桥接的同 runId 仍跳过重复样本。

## 4. 检查

| 命令                                                                                                                                                                                                                                                      | 退出码 | 说明                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                                                                                                                          | 0      | 日志 `/tmp/pnpm-install.log`                    |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/task-outcome/executor-closeout-residuals.test.ts src/task-outcome/w3-task-budget.test.ts src/task-outcome/reverify-p1-crash-budget.test.ts src/gateway/agent-growth/operational-metrics-store.test.ts` | 0      | 修复指纹后                                      |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run` 上列 closeout + `paths-bypass-cleanup` + `residual-four-items` + `entrypoint-identity` + `cli-gateway-collab-entry-wiring` + `consumer-boot` + `run.task-outcome-closeout` + `followup-runner.test.ts`    | 0      | followup 的 `parentTaskId` 提升到函数作用域之后 |
| `pnpm exec oxlint` 本轮改过的源文件                                                                                                                                                                                                                       | 0      | 去掉未使用测试辅助函数之后                      |
| `OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/task-outcome/supervisor-tip-budget.test.ts src/gateway/supervisor/engine.test.ts src/gateway/supervisor/retry.test.ts`                                                                                 | 0      | 41 tests。超限后 worker dispatch 次数不变       |
| rebase 到 `ea7f9218` 后 `vitest run src/task-outcome/executor-closeout-residuals.test.ts src/task-outcome/closed-loop-negation-diagnosis.test.ts`                                                                                                         | 0      | 12 tests                                        |

`src/task-outcome/executor-closeout-residuals.test.ts` 用真实 `assertRunnerTurnBudgetAllowsModelCall` / `chargeModelCallAgainstTip`，并用真实 `agentCommand` + 嵌入式 runner 替身：第一次调用计数为 1，把 tip 的 `maxIterations` 收到已用次数后，第二次 `agentCommand` 抛出 `TaskBudgetExceededError`，替身次数仍为 1。

## 5. r3 与 LIVE

仓库内没有 r3 预发布报告原文，不能逐条贴出旧 NO-GO 的原文证据。发布账本 `deploy/production/releases.jsonl` 最后一条是 seq 151：

- gateway / ui SHA `d37bed5117d6969e5ad0ee47b32e4efa8b6d715a`
- digest `sha256:09c9b4c0db843c8b977f21cc0e5fb78c43ab408dbd633cda9e41573756442c48`
- `liveFrom` `2026-10-31T03:21:00.871Z`

`git merge-base --is-ancestor d37bed5117d6 origin/main` 为真：seq 151 是当前 main 的祖先，不是 main 的 tip。本分支在 main 之后，**还没有进入发布产物，也没有 LIVE 证据**。

本环境没有 `kubectl`、`podman`、生产 SSH。没有读取运行容器的 `build-info.json`。因此不能声称已核对实际 LIVE 身份。要核对需要：能进运行 gateway 容器的只读入口，执行 `cat /app/dist/build-info.json`，并对照镜像 digest。

## 6. 发布前还要用户决定的事

1. 是否授权从合入后的 `origin/main` 做新一轮隔离构建和验收。本 PR 不合入，也不做生产切换。
2. 嵌入式 runner 内部每一轮 provider 请求是否都要单独计费。会碰到 `attempt.ts`，本轮不做。
