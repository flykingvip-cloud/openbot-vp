# OpenBot Evolution Eligible-Data Release Candidate V1

> 日期：2026-09-07
> 候选 ID：`evolution-eligible-rc.2026.09.07`
> 候选修订：`RC11`
> 任务：`openbot-evolution-unification:cursor-evolution`
> 工作树：`openbot-evolution-eligible-rc11-678e50c1`
> 分支：`cursor-evolution/evolution-eligible-rc-678e50c1`
> 资料刷新：`2026-09-07T20:41:00+08:00`

本文件取代 RC3–**RC10** 报告。那些候选已过期，不得作为当前发布依据。

RC10 过期原因：#1023 已 squash 合入 `origin/main` `678e50c1`，但 RC10 证据仍记录 `candidateSha=5f9d6e4f`、`originMainSha=4ccff829`。

本文件是独立复核用的发布候选报告，不是生产 cutover 记录。PR 合并、该 tip 自己的镜像证明、发布标签与 delivery 对齐完成前仍不得部署。

## 最终结论

**`eligible RC PASS, release-ready PASS`**

| 口径                       | 值               |
| -------------------------- | ---------------- |
| `eligible-scope`           | **PASS**         |
| `full-repo-quality-gate`   | **PASS**         |
| `release-ready`            | **PASS**         |
| 允许创建 evolution PR      | **是**           |
| 允许生产部署               | **否**           |
| `provenance/sha-678e50c1*` | **缺失（预期）** |
| 该 tip Docker Release      | **未完成**       |

`release-ready PASS` 只表示可以进入证据对齐 PR，不表示可部署。

## 0. 过期候选

不得使用 RC9 / RC10 证据证明 `678e50c1`。旧树 `openbot-evolution-eligible-rc10`（`7bcdef55`）和 `openbot-evolution-eligible-rc10-4ccff829` 都不是本候选。

## 1. 当前主干

| 项                               | 值                                                          |
| -------------------------------- | ----------------------------------------------------------- |
| #1023                            | <https://github.com/gmood2008/openbot/pull/1023> **MERGED** |
| `origin/main`                    | `678e50c1ff0505468f0cebd569bea5bda6cc018f`                  |
| 父提交                           | `baab8ab1de`（#1022）                                       |
| `build:docker` 含 evolution-core | **是**                                                      |
| Capsule                          | `accepted_permanent_exclusion`                              |
| Unsupported verifier             | fail-closed                                                 |

## 2. 本轮在 `678e50c1` 上重跑

| 命令                                      | 结果                      |
| ----------------------------------------- | ------------------------- |
| `pnpm --dir packages/evolution-core test` | **12 files / 55 passed**  |
| 聚焦套件                                  | **44 files / 347 passed** |
| `pnpm tsgo`                               | **pass**                  |
| `pnpm check`                              | **pass**                  |
| `pnpm build`                              | **pass**                  |
| `git diff --check`                        | **pass**                  |
| attribution `--fail-on-conflict`          | **0 conflict**            |

必含 Capsule / Verifier / Working DNA / Organization / Runtime / Skill 回归均通过。RC10 数字不得直接延用。

## 3. GitHub CI（记录，不当本地门）

<https://github.com/gmood2008/openbot/actions/runs/34121348467>

| 工作流          | 状态        |
| --------------- | ----------- |
| Workflow Sanity | success     |
| CI Gate         | success     |
| CI              | **failure** |
| Install Smoke   | in_progress |
| Docker Release  | in_progress |

CI 失败不能授权部署。祖先镜像不能代替本 tip。

## 4. 明确未执行

未 mint `provenance/sha-*`，未 cutover，未开全局 auto，未改 Capsule。

## 5. 下一步

合入本证据 PR 后：再 `git fetch origin`；等 **`678e50c1` 或更新 tip 自己的** Docker Release / Install Smoke；重跑 forward-only / alignment / ledger。首次上线仍须 assist。
