# OpenBot Diagnosis Platform — P26.1 合入后复评

Date: 2026-09-06

Status: **合入后隔离闭环仍成立。Production Ready = No-Go。** #988 / #989 / #990 已在主干 `7d75c0bb`。历史 P26 冻结的 candidate `0d8a31a2` 已不是最新 `origin/main`，祖先沿用无效。LIVE 仍是 `7d3fdf5b`。生产 SLO 仍是 `empty`。live executor 仍 undeployed。不绑 Doctor `--fix` / Channel restart。不切 LIVE。不宣布 Production Ready。cutoverOwner=`delivery`。

Task: `openbot-diagnosis-platform`

Related:

- [P26 闭环验收](/design/openbot-diagnosis-p26-2026-09-06)
- [P26.1 readiness](/design/openbot-diagnosis-p26.1-readiness-2026-09-06)
- [P26.1 delivery 行动单](/design/openbot-diagnosis-p26.1-delivery-owner-actions-2026-09-06)
- #988 <https://github.com/gmood2008/openbot/pull/988>
- #989 <https://github.com/gmood2008/openbot/pull/989>
- #990 <https://github.com/gmood2008/openbot/pull/990>

硬门禁：合入主干 ≠ LIVE 已切 ≠ Production Ready。诊断任务不单独切流。

---

## 1. Identity (exact match)

评估前 `git fetch origin`。LIVE 只来自 `podman exec openbot-gateway-rc cat /app/dist/build-info.json`。本机本次无法再 exec 容器时，沿用上次核过的 ledger / RELEASE_RECORD Latest seq 64。

| 项                       | 值                                                         |
| ------------------------ | ---------------------------------------------------------- |
| candidate / origin/main  | `7d75c0bba6ab692f1396cde3d366a10c68ae092d`（Merge #990）   |
| LIVE                     | `7d3fdf5bfef57077f7956ccab07c3c960984331b` seq 64          |
| historical P26 candidate | `0d8a31a2c4e91e13a9acff64ce57511efd694135` **invalidated** |
| liveEqualsCandidate      | false                                                      |
| productionSloComplete    | false                                                      |
| p26ProductionReady       | false                                                      |
| cutoverOwner             | delivery                                                   |
| diagnosisOnlyCutover     | false                                                      |

祖先沿用无效。不改写旧 P22 / P24.5–P26 JSON。不重写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` / `RELEASE_RECORD.md`。不补 `provenance/sha-*`。

## 2. 本增量做了什么

1. 记录 #988 / #989 / #990 已合入最新 `origin/main`
2. 作废历史 P26 在 `0d8a31a2` 上的身份锁，要求按新 tip 重签评估（不是重签 Production Ready）
3. 进程内重跑 P25 隔离 canary + P26 闭环链路，不调用历史 P26 的 SHA 闸门
4. 生产 `resolveProductionRemediationExecutor({ allowlisted: true })` 仍抛 `remediation_live_executor_undeployed`
5. 写出 delivery 统一窗口 cutover 行动单；诊断不执行 cutover

## 3. Blockers

- `live_not_equal_candidate`
- `production_slo_empty`
- `live_executor_undeployed`
- `live_cutover_pending`
- `production_ready_not_separately_approved`
- `historical_p26_invalidated`

## 4. After this increment

诊断任务不单独切流、不改账本、不补 provenance、不宣布平台完成。LIVE 仍是 seq 64 旧镜像，直到 **delivery** 用 `7d75c0bb`（或当时最新 `origin/main`）做统一窗口 cutover + `--verify-live`。只有 LIVE == candidate、生产 SLO 完整、且另有单独人类声明 `confirmProductionReady: true` 之后，才允许后续增量考虑 Production Ready。
