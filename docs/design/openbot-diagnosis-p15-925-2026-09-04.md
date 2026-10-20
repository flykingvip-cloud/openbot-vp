# OpenBot Diagnosis Platform — P15 #925 合入后重评

Date: 2026-09-04

Status: **No-Go。#925 已合入，candidate 已等于最新 origin/main `3d03d3b4df`，但 RELEASE_RECORD 落后且 provenance 缺失。readyForIndependentApproval=false。未开 gate。P15 仍不能签收。**

Task: `openbot-diagnosis-platform`

Related: [delivery-owner 行动单](/design/openbot-diagnosis-p15-delivery-owner-actions-2026-09-03) · PR #925 <https://github.com/gmood2008/openbot/pull/925>

硬门禁：candidate 已收敛仍不得开 gate、不得补 provenance、不得改写 ledger / RELEASE_RECORD、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。

快照：

- [convergence JSON](/design/openbot-diagnosis-p15-925-convergence-2026-09-04.json) · [Markdown](/design/openbot-diagnosis-p15-925-convergence-2026-09-04.md)
- [preflight JSON](/design/openbot-diagnosis-p15-925-preflight-2026-09-04.json) · [Markdown](/design/openbot-diagnosis-p15-925-preflight-2026-09-04.md)

复跑：

```text
git fetch origin
bun src/diagnosis/production-trunk-convergence.cli.ts \
  --candidate-sha "$(git rev-parse origin/main)" \
  --pull-request-url https://github.com/gmood2008/openbot/pull/925 \
  --json-out docs/design/openbot-diagnosis-p15-925-convergence-2026-09-04.json \
  --md-out docs/design/openbot-diagnosis-p15-925-convergence-2026-09-04.md
```

---

## 合入证据

| 项                 | 值                                                              |
| ------------------ | --------------------------------------------------------------- |
| PR                 | <https://github.com/gmood2008/openbot/pull/925>                 |
| state              | `MERGED`                                                        |
| mergedAt           | `2026-09-03T21:58:24Z`                                          |
| mergeCommit        | `14738979ff2bb9f2ce8b3555892994bb690e5ba6`                      |
| 评估时 origin/main | `3d03d3b4df91ab0bfaa33900eba95287c1ab30d2`（#927 之后，含 925） |

\#919 / #922 / #925 均在 `origin/main` 祖先中。容器 LIVE 未变：`6d9ea1f2d5da` @ `2026-09-03T01:37:57.887Z`。

## 身份

| 身份                    | SHA            | 结论                              |
| ----------------------- | -------------- | --------------------------------- |
| candidate / origin/main | `3d03d3b4df`   | 已对齐                            |
| LIVE / ledger seq 58    | `6d9ea1f2d5da` | 一致                              |
| RELEASE_RECORD          | `37cc40e51f46` | 仍落后                            |
| provenance              | missing        | `do_not_mint` / `published=false` |

`candidateEqualsOriginMain=true`。阻断只剩 RELEASE_RECORD 与 provenance。下一步仍只属于 `delivery_ledger_owner`。P15 仍不能签收，不得进入独立批准或任何生产步骤。
