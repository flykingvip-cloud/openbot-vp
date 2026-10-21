# OpenBot Diagnosis Platform — P16 #936 合入后身份链复核

Date: 2026-09-04

Status: **No-Go。#936 已合入，candidate 已精确等于最新 origin/main `e7c614eb54`。LIVE/ledger 对齐 seq 59 / `3d03d3b4df`。RELEASE_RECORD 仍停在 `37cc40e51f46`，provenance 仍缺失且 `do_not_mint`。当前树 SLO completeness=`empty`，reader/audit/quota 不可用。不得输出 Ready for independent approval。**

Task: `openbot-diagnosis-platform`

Related: [delivery-owner 行动单](/design/openbot-diagnosis-p15-delivery-owner-actions-2026-09-04) · PR #936 <https://github.com/gmood2008/openbot/pull/936> · [seq59 账本](https://github.com/gmood2008/openbot/pull/932)

硬门禁：P16 ≠ 生产部署。不得开 gate、不得补 provenance、不得改写 ledger / RELEASE_RECORD、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。批准也不等于开 gate。4.1/4.2 与 `diagnose()` 已在主干，≠ Phase 完成 ≠ Diagnosis Platform 完成。

快照：

- [convergence JSON](/design/openbot-diagnosis-p16-936-convergence-2026-09-04.json) · [Markdown](/design/openbot-diagnosis-p16-936-convergence-2026-09-04.md)
- [preflight JSON](/design/openbot-diagnosis-p16-936-preflight-2026-09-04.json) · [Markdown](/design/openbot-diagnosis-p16-936-preflight-2026-09-04.md)

---

## 1. PR #936 合入证据

| 项                 | 值                                                    |
| ------------------ | ----------------------------------------------------- |
| PR                 | <https://github.com/gmood2008/openbot/pull/936>       |
| title              | Diagnosis: land 4.1/4.2 and vertical-slice diagnose() |
| state              | `MERGED`                                              |
| mergedAt           | `2026-09-04T05:26:20Z`                                |
| squash / merge SHA | `e7c614eb54214b2f62f082c8d99dca08b8c58232`            |
| 评估时 origin/main | `e7c614eb54214b2f62f082c8d99dca08b8c58232`            |
| candidate          | `e7c614eb54214b2f62f082c8d99dca08b8c58232`            |

`candidate == origin/main` 已满足。评估未使用特征分支 tip，也未使用 dirty worktree 或旧 candidate。

\#919 / #922 / #925 / #928 / #929 / #930 / #932 / #935 / #936 均在主干上。

## 2. 六者关系

| 身份                          | SHA                                        | 来源                                                                     | 结论                                            |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------- |
| candidate                     | `e7c614eb54214b2f62f082c8d99dca08b8c58232` | `--candidate-sha` = 最新 origin/main                                     | 与 origin/main 一致                             |
| origin/main                   | `e7c614eb54214b2f62f082c8d99dca08b8c58232` | `git fetch origin` 后 `rev-parse`                                        | 4.1/4.2 + `diagnose()` 已在此                   |
| LIVE                          | `3d03d3b4df91ab0bfaa33900eba95287c1ab30d2` | 运行容器 `/app/dist/build-info.json`，`builtAt=2026-09-04T00:43:19.076Z` | 唯一运行事实；是 candidate / origin/main 的祖先 |
| ledger 开放行 seq 59          | `3d03d3b4df91ab0bfaa33900eba95287c1ab30d2` | `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`，`liveFrom=2026-09-04T02:11:42Z`      | 与 LIVE 一致；seq 58 已 close，keep             |
| RELEASE_RECORD Latest cutover | `37cc40e51f468404baf3077307e347f32f636cb1` | `liveFrom=2026-09-02T09:50:59Z`                                          | **仍落后**；未写 seq 59                         |
| provenance                    | missing                                    | 无 `provenance/sha-3d03d3b4df91`                                         | **不可证明**                                    |

Forward-only：`LIVE ⊂ candidate` 且 `LIVE ⊂ origin/main`，`forwardOnly=true`。不得把 LIVE 回写成已退役的 `6d9ea1f2d5da`。

## 3. 发布身份链

- LIVE 与 ledger 开放记录一致（seq 59 / `3d03d3b4df`）。
- `RELEASE_RECORD.md` Latest cutover **仍落后**。修复只能由 `delivery_ledger_owner` 在主干完成。
- Provenance remint plan（证据化，**未发布**）：
  - `action: do_not_mint`
  - `published: false`
  - `proposedTag: provenance/sha-3d03d3b4df91`
  - 原因：cutover 拉的是无 `provenance-sha-*` 的 GHCR `main`；现在补 tag 会伪造既有发布史。
- 禁止：伪造历史、回写错误 SHA、事后补发代表既有发布史的 tag、改写 seq 58/59。

即便 RELEASE_RECORD 对齐，缺 provenance 仍使 `liveEqualsProvenance=false`，Ready 仍为 false。

## 4. 生产准入（四门 gate 仍为 false）

| Gate                                      | default | value |
| ----------------------------------------- | ------- | ----- |
| `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED`   | false   | false |
| `DIAGNOSIS_REPORT_API_DEPLOYED`           | false   | false |
| `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED`       | false   | false |
| `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED` | false   | false |

- `diagnosis-reports` 未进入 live gateway pack。
- `coreGatewayHandlers` 无 diagnosis reports 方法。
- 真实聊天、Da Bai transport、Doctor `--fix`、Channel restart、自动修复均未接通。
- P5 合同已签；`liveDeliveryEnabled=false`。
- `gatesOpened=false`，`trafficSwitched=false`，`approvedForProductionCutover=false`。

## 5. 依赖与 SLO

Trusted tenant 只来自 membership。缺失观测不得渲染为健康。

### 当前树（standalone P12 preflight，权威）

| 依赖                      | authority of record                                    | 可用性                     |
| ------------------------- | ------------------------------------------------------ | -------------------------- |
| composite report reader   | composite projection + session/skill/agent/tool stores | **不可用，fail closed**    |
| audit persist             | `$CONFIG_DIR/diagnosis-audit/`                         | **不可用，fail closed**    |
| quota store               | injected backend or process-local windows              | **不可用，fail closed**    |
| gateway auth / membership | `server_membership_resolver`                           | 合同在；生产注入仍 pending |
| Da Bai transport          | injected allowlisted transport only                    | 未接通                     |
| conversation store        | injected in-process store                              | 无 live chat bind          |
| remediation executor      | injected allowlisted executor only                     | dry-run only               |

| 指标                                                                       | target   | observed      |
| -------------------------------------------------------------------------- | -------- | ------------- |
| success / error / latency / stale / authorization_denied / quota_exhausted | required | **未观测**    |
| queryLatencyMs                                                             | 300      | `null`        |
| inspectionSuccessRate                                                      | 0.99     | `null`        |
| deliverySuccessRate                                                        | 0.99     | `null`        |
| authorizationWaitMs                                                        | 300000   | `null`        |
| verificationSuccessRate                                                    | 0.95     | `null`        |
| falsePositiveRate                                                          | 0.05     | `null`        |
| completeness                                                               | complete | **empty**     |
| rendered health                                                            | —        | **not_ready** |

P15 convergence 内嵌的 P12 仍是 rehearsal 注入（`sloHealthy=true` 只存在于排练快照），**不得当作生产健康**。当前树 readiness 以 standalone preflight 为准：`completeness=empty`，`sloHealthy=false`。

## 6. 回归

- 4.1/4.2 只读 Diagnoser 与 `diagnose()` 六场景回放已在 `src/diagnosis` Vitest 覆盖。
- QUICK 不调度 runtime / channel / doctor Diagnoser。
- Doctor `repair` / `fix` / `yes` 仍拒绝。
- INCONCLUSIVE 的 verification 为 `null`。
- P4–P10 仍停在 preview / dry-run。

## 7. Go / No-Go

| Ready 条件                                       | 结果                   |
| ------------------------------------------------ | ---------------------- |
| candidate == 最新 origin/main                    | true                   |
| LIVE/ledger/RELEASE_RECORD/provenance 可证明一致 | **false**              |
| SLO completeness=complete（当前树）              | **false**              |
| reader / audit / quota / auth 等依赖可用         | **false**              |
| 全部授权与租户隔离检查通过                       | 合同在；生产依赖未注入 |
| 所有生产 gate 仍为 false                         | true                   |

**结论：No-Go。`readyForIndependentApproval=false`。不得输出 Ready for independent approval。**

即使日后 Ready，也不得自行开 gate、部署、重启或切流量。

## 8. 未解决 blocker 与责任人

| Blocker                                                                     | 责任人                                                | 允许动作                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| RELEASE_RECORD Latest cutover 仍 `37cc40e51f46`，未写 seq 59 / `3d03d3b4df` | `delivery_ledger_owner`                               | 仅在主干更新 Latest cutover；不得回写 `6d9ea1f2d5da`  |
| 缺 `provenance/sha-3d03d3b4df91`                                            | `delivery_ledger_owner`                               | 只保留 remint plan；`do_not_mint` / `published=false` |
| 不得改写 ledger seq 58 / 59                                                 | `delivery_ledger_owner`                               | keep                                                  |
| 当前树 SLO 全空                                                             | `production_backend_config` / 观测注入                | 缺失不得渲染为健康                                    |
| reader / audit persist / quota 不可用                                       | `p12_production_dependency_injection`                 | fail closed                                           |
| 待人类批准（开 gate ≠ 本增量）                                              | `platform_security` / `enterprise_admin` / `employee` | 批准 ≠ 开 gate                                        |

Diagnosis 侧在 #936 之后没有可推进的身份链修复。下一步只属于 `delivery_ledger_owner` 与生产依赖/观测注入。
