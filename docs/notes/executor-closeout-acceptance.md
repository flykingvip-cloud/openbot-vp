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

## 6. 仍待发布的决定

1. 合入后是否授权从新的 `origin/main` 做隔离构建和发布。本轮不做生产切换、重启或配置变更。
2. 嵌入式 runner 内部每一轮 provider 请求是否都要单独计费。会碰到 `attempt.ts`，本轮不做。

## 7. 本地 CI 等价验收（不依赖 Actions runner）

代码提交 `5a9261cc05de02a607ac22985657c538457f09a7`。本节本身的后续提交只改这份笔记。GitHub Actions 因账单未启动任何 job，下列命令在云端 VM 上执行。日志在 `/tmp/accept/`。

| 等价检查                  | 命令                                                                                                                   | 退出码 | 结果                                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no-tabs                   | workflow 同款 Python 扫描 `.github/workflows`                                                                          | 0      | 18 个 workflow 无 tab                                                                                                                                                                           |
| actionlint 1.7.11         | `actionlint`                                                                                                           | 0      | 日志 `/tmp/accept/actionlint.log`                                                                                                                                                               |
| composite input 插值      | `python3 scripts/check-composite-action-input-interpolation.py`                                                        | 0      | 无直接插值                                                                                                                                                                                      |
| format（本 PR 文件）      | `oxfmt --check` 本 PR 改过的源文件与结项笔记                                                                           | 0      | 本 PR 文件无格式问题                                                                                                                                                                            |
| format（全库，CI 绝对门） | `pnpm exec oxfmt --check`                                                                                              | 1      | 29 个文件与 `origin/main` 内容相同，不是本 PR 引入。日志 `/tmp/accept/format.log`                                                                                                               |
| host env policy           | `pnpm check:host-env-policy:swift`                                                                                     | 0      |                                                                                                                                                                                                 |
| Knowledge Universe tabs   | `node scripts/check-knowledge-universe-page-tabs.mjs`                                                                  | 0      |                                                                                                                                                                                                 |
| S01 R6                    | `node scripts/verify-single-sot.mjs` 与 `node --test docs/design/evidence/memory-workspace-s01-r6-single-sot.test.mjs` | 0      |                                                                                                                                                                                                 |
| phase0 单测               | `node --test` 三个 `memory-workspace-phase0-*.test.mjs`                                                                | 0      | 23 通过                                                                                                                                                                                         |
| types/lint 增量           | `node scripts/ci-diagnostic-delta.mjs --base origin/main --candidate 5a9261cc`                                         | 0      | tsgo 基线 30、候选 30、新增 0；oxlint 新增 0。日志 `/tmp/accept/diagnostic-delta-3.log`                                                                                                         |
| 协作能力门                | `pnpm lint:collab:runtime-capabilities` 与 `pnpm test:collab:runtime-lifecycle`                                        | 0      | 生命周期 28 通过                                                                                                                                                                                |
| 本 PR 与 delivery 单测    | `OPENBOT_TEST_PROFILE=low pnpm exec vitest run` 任务结果、监督预算、delivery、`scripts/ci-diagnostic-delta.test.ts`    | 0      | 23 文件、291 通过。日志 `/tmp/accept/vitest.log`                                                                                                                                                |
| 类型修复后相关测试        | 同上配置再跑 closeout、supervisor tip、followup、cron closeout                                                         | 0      | 34 通过。日志 `/tmp/accept/vitest-after-types.log`                                                                                                                                              |
| release record            | `pnpm delivery:release-record:check`                                                                                   | 0      | seq 151 文档与账本一致，不是容器 LIVE 核对                                                                                                                                                      |
| ledger audit              | `pnpm delivery:ledger:audit`                                                                                           | 30     | 见下节。日志未完整保留；退出码 30，157 个 `missing-object`                                                                                                                                      |
| freeze 扫描               | workflow 同款 trusted blob + `--mode freeze`                                                                           | 1      | 相对 2026-08-14 基线 blob 报新增调用点。除 `src/commands/agent.ts` 行号因本 PR 移动外，列出的文件与 `origin/main` 相同，且 diff 没有新增 `resolveAgentWorkspaceDir`。不是本 PR 新写的工作区入口 |

## 8. 无法等价复现

- **历史 git 对象。** 本克隆从恢复快照 `dd6c85ca` 起只有约 229 个提交，不是浅克隆，但没有 seq 2 起的发布对象。`git fetch origin 1e1143012db2` 失败：`couldn't find remote ref`。因此 `delivery:ledger:audit` 不能像 `fetch-depth: 0` 的 CI 那样裁定旧发布是否仍活着。影响：不能用这次退出码 30 证明账本逻辑回归；本 PR 没有改 `releases.jsonl`。`delivery:release-record:check` 只核对当前 seq 151，已通过。
- **生产环境。** 无 kubectl、podman、生产 SSH，没有读运行容器 `build-info.json`。影响：不能把合入 main 说成 LIVE。seq 151 仍是账本里的最后一条生产身份。
- **GitHub Actions。** 账单未付或支出上限导致 job 的 `steps` 为 0。label / label-issues 是同一原因，不是标签权限逻辑失败。`docs-scope` 同样没启动；它只区分文档与代码，本 PR 含源码，不是 docs-only。
- **全库 `pnpm build`。** CI Gate 的失败项不包含完整构建；`build-artifacts` 因 `docs-scope` 没启动而 skipping。本次没有把完整 `pnpm build` 当作合入门。
- **全库 `oxfmt --check` 与 freeze。** 失败点在 `origin/main` 上已经存在。本 PR 不重新格式化那 29 个无关文件，也不改记忆冻结基线。
