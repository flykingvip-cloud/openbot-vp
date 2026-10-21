# 批次 5：单目标群无人推进（代码护栏）

| 项   | 值                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 日期 | 2026-10-21                                                                                                                                                                                   |
| 仓库 | `flykingvip-cloud/openbot-vp`                                                                                                                                                                |
| 祖先 | `348e7940e5ef0039952c4b09040170ee3aacd366`（批次 4，PR #26）。开工时 `git merge-base --is-ancestor 348e7940e5ef0039952c4b09040170ee3aacd366 origin/main` 为真，分支从该 `origin/main` 拉出。 |
| 性质 | 在现有心跳 / self_advance / wake 上加单目标群任务围栏和硬停止。不放权，不开生产旗。                                                                                                          |

## 未扩权

本批没有放宽 `submit` / `submitForReview` / `self_advance` / `accept` / `finalize` 的权限、handler 范围或生产旗。

- 平台 L2 `botMaySelfAdvanceWithoutHuman` 仍默认 `false`。
- `selfAdvance.mode` 仍默认 `dry_run`。`executeGroupAllowlist` 仍默认空。
- 心跳 `schedulerEnabled` 仍默认 `false`，写模式仍默认 `observe`。
- Wake / claim 全局开关不在本批打开。
- self_advance 仍然不调用 submit、accept、finalize。
- 单目标群上的 accept 额外拒绝非协调者、非看板发布人。其他群的 accept 路径保持原样。
- finalize 仍由 Governance Gate 拒绝。本批只在单目标群上把这次拒绝记成硬停止。

`collaboration.task.singleGroupUnattended.groupAllowlist` 默认空。正好一条时，该群才进入围栏。零条或多条都不授权（不是「任意群」）。写上群 id 本身不会发 wake，也不会把 execute 打开。

## 代码假设的配置前提

这些是运营核验，不是本 PR 已经配好的部署。

| 前提                                                          | 代码里怎么用                                                                                         | 本 PR 是否写入生产配置 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------- |
| 目标群只有一个，且写在 `singleGroupUnattended.groupAllowlist` | 围栏开关。多群则整表失效                                                                             | 否，默认 `[]`          |
| 执行类使命，不是介绍 / onboarding                             | 沿用 self_advance 已有的 `mission_not_onboarding`                                                    | 否                     |
| 协调者（`coordinatorBotId`）或看板 `publishedBy`              | 只有这两类能在该群 accept。执行人自验收会硬停止                                                      | 否，调用方原样传入     |
| 活跃任务指针                                                  | 看板 `in_progress` 或 `applied`，且执行人有已确认 Todolist                                           | 否                     |
| 真要发出回合                                                  | 仍须既有 wake 开启，且 `selfAdvance.mode=execute` 并且群在 `executeGroupAllowlist`，心跳不是 dry_run | 否，这些默认仍关       |

有效进展只算两类：已确认计划里的步骤（`confirmed_step`），或调度返回 `verifiable:` 的产出（`verifiable_output`）。wake 结果 `recorded` 不是有效进展。

回滚：从 allowlist 拿掉那一条，围栏不再发副作用。硬停止之后要再跑，须显式 `releaseUnattendedHardStop`；释放不会把 execute 或调度器打开，也不会把已取消的排队捡回来。

## 围栏

当前步骤的标题和说明决定动作类型。

| 动作         | 结果                                   |
| ------------ | -------------------------------------- |
| 起草（默认） | 可以沿现有 wake → 回合消费推进恰好一步 |
| 创建日历     | 不调用外部动作，记人闸                 |
| 发送邀请     | 不调用外部动作，记人闸                 |

同一步在扫描间隔内的重复 heartbeat / wake 不再次调用调度器。第二次相同的日历 / 邀请意图是硬停止，不是再发一次。

## 硬停止

任一即停，并且处理已经排队和进行中的车道作业，不是只关 `schedulerEnabled`。

| 触发                   | 排队        | 进行中 | 不做什么                                                                 |
| ---------------------- | ----------- | ------ | ------------------------------------------------------------------------ |
| 越权 accept / finalize | `cancelled` | `held` | 不把看板写成 accepted，不放行 finalize                                   |
| 陈旧确认（版本门拒绝） | `cancelled` | `held` | 不把旧版本写成 confirmed。对上当前版本的人工确认仍可写入，但车道保持停止 |
| 重复外部副作用         | `cancelled` | `held` | 不发出日历 / 邀请                                                        |

进行中的调度如果在返回前触发硬停止，这一次回合 id 不记成有效进展，也不再写 dispatched wake。

## 五场景

用例名与 `src/gateway/collaboration-dispatch/single-group-unattended.test.ts` 一致。

| #   | 用例                                   | 期望                                                                                |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | 正常推进一步（已确认计划内）           | 调度 1 次；进展种类 `confirmed_step`；任务仍是 `in_progress`；计划版本不变          |
| 2   | dry_run / 未开白名单时无外部副作用     | `selfAdvance` 为 dry_run，或 execute 白名单没有该群：调度 0 次，外部副作用 0        |
| 3   | 重复 heartbeat / wake 不重复副作用     | 间隔内第二次 force tick 不再调用调度器                                              |
| 4   | 偏离动作被拒或升人闸                   | 「创建日历」走 self_advance 人闸，调度 0 次                                         |
| 5   | 触发硬停止后排队与进行中任务被安全处理 | 进行中的越权 accept 不提交回合；排队 `cancelled`，进行中 `held`；后续 tick 不再调度 |

硬停止演练（同文件）：越权 accept、越权 finalize、陈旧确认、重复外部副作用。四处都断言排队与进行中已被处理。

## 指标

窗口是 `[windowStartMs, windowEndMs)`。

- 分母：窗口内已确认计划中可推进的步骤数（`confirmedStepsInWindow`）。不是心跳调用数。
- 分子：窗口内 `confirmed_step` 与 `verifiable_output` 的条数。
- `recorded` 的条数单独计数，分子不加它。
- `callCountIsSufficient` 固定为 false。调用数 > 0，或过夜「有动静」，都不是验收。

`summarizeUnattendedEffectiveProgress` 只做这道算术，不读生产计数器。
