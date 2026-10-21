# seq 96 到 seq 97 收尾计划

证据准备阶段已经完成。2026-09-25 已由 `cursor-independent-acceptor` 召开代理裁决会议。结论保持路径 A：insufficient_evidence，账本保持锁定。meetingHeld=true。ledgerMutationAuthorized=false。

## 已完成

- 差异清单、28 份审查单、21 条能力命题和裁决 JSON 已在主干。
- Registry 登记已合入。
- seq 97 的 shallow parent 已解释。
- 独立验收已由 `cursor-independent-acceptor` 代理 Codex 写入 `independent-acceptor-review.md`。
- decision 仍是 insufficient_evidence。ledgerMutationAuthorized=false。代理会议已把 meetingHeld 记为 true。

## 为什么停在这里

21 条能力命题的代理结论都是 insufficient_evidence。28 个生产删除里，3 个 import 重排判定为 preserved，其余 25 个判定为 insufficient_evidence。路径 B 和路径 C 没有被这次代理会议选中。

`pnpm delivery:ledger:audit` 在独立验收时以 exit 30 失败，错误是 seq 97 drops `1617926868e6`。seq 98 已由 PR #21 写入，regression acknowledgement 为空，它没有结束这个问题。

## 下一步只由对应 Owner 做

每个 Owner 对名下文件和命题只能选一个：preserved、moved、intentionally_removed、accidentally_regressed、insufficient_evidence。每条都要有审查人、reviewedAt、证据引用、理由，以及是否要求恢复。证据任务不代填。

| Owner                       | 生产删除            | 命题                                                                                                                                                                    |
| --------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evolution Owner             | 7                   | evo-shadow-read-project、evo-operator-approval-identity、evo-sot-readback、evo-replay-completion、evo-receipt-vs-proof、evo-default-governance-mode、evo-auto-apply-off |
| Enterprise Capability Owner | 9                   | ent-default-list-selection、ent-source-constraints、ent-grant-vs-install、ent-invoke-fail-closed、ent-ui-entries                                                        |
| Steward Owner               | 1                   | stw-preview-locator-path、stw-workspace-boundary、stw-no-cross-workspace-fallback、stw-preview-open-vs-exists、stw-error-semantics                                      |
| Diagnosis Owner             | 4                   | dia-live-request-scope、dia-action-dispatch-scope、dia-report-read-write、dia-smoke-and-projection                                                                      |
| Delivery Owner              | 7（清单里的 other） | 账本语义，加上 attempt、agent-runner-execution、focus-switch、cron-result-template、save-and-archive、chat、cron controller                                             |

## 会议之后才允许的三条路

- 任一关键能力仍是 unknown：维持 insufficient_evidence，ledgerMutationAuthorized=false。
- 确认是意外回归：先用恢复 PR 进入当时的最新主干，不改 seq 97，账本仍不改。
- 确认是有意回归：写明影响、时间窗、行为变化和批准人，再单独开账本变更 PR。

## 本计划不授权

不修改 https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl，不修改 RELEASE_RECORD 的发布结论，不追加发布行，不切换生产容器。代理会议没有把关键能力改成 preserved、moved、intentionally_removed 或 accidentally_regressed。
