# OpenBot Diagnosis Platform — P26.3 统一窗口 cutover hold

Date: 2026-09-06

Status: **停在主干等 delivery。Production Ready = No-Go。** #993 已在主干 `91d4247e`。历史 P26.2 冻结的 `040e714c` 已不是最新 `origin/main`。该祖先 tip 的 Docker Release 已 success，**禁止当作当前 candidate 去 stage**。当前 tip 的 GHCR 评估时仍 in_progress。不绑 Doctor `--fix` / Channel restart。不切 LIVE。不宣布 Production Ready。cutoverOwner=`delivery`。诊断不得再开下一刀 SHA 重签，除非 delivery 已切，或 `origin/main` 因非诊断原因前移。

Task: `openbot-diagnosis-platform`

Related:

- [P26.2 就绪](/design/openbot-diagnosis-p26.2-2026-09-06)
- [P26.3 hold](/design/openbot-diagnosis-p26.3-readiness-2026-09-06)
- [P26.3 delivery 行动单](/design/openbot-diagnosis-p26.3-delivery-owner-actions-2026-09-06)
- #993 <https://github.com/gmood2008/openbot/pull/993>

硬门禁：合入主干 ≠ 可用祖先镜像切流 ≠ LIVE 已切 ≠ Production Ready。

---

## 1. Identity (exact match)

| 项                            | 值                                                                |
| ----------------------------- | ----------------------------------------------------------------- |
| candidate / origin/main       | `91d4247ee21604f60b37fb1de3cc30209443ef76`（Merge #993）          |
| LIVE                          | `7d3fdf5bfef57077f7956ccab07c3c960984331b` seq 64                 |
| historical P26.2              | `040e714cfc1266cb9becaa2b42a159dd503a9b89` **invalidated**        |
| ancestor GHCR                 | `040e714c` Docker Release **success**，**forbidden as candidate** |
| current GHCR                  | unproven（Docker Release 34009706071 in_progress）                |
| I1 forward-only               | allow                                                             |
| deliveryMayStage              | false                                                             |
| nextOfficialStep              | `delivery_wait_ghcr_then_cutover`                                 |
| furtherDiagnosisResignBlocked | true                                                              |
| p26ProductionReady            | false                                                             |

本机本次无法 exec 容器；LIVE 沿用上次核过的 ledger / RELEASE_RECORD Latest seq 64。

## 2. 为什么停

每合入一刀诊断 SHA 重签，`origin/main` 就前移，刚成功的 GHCR 立刻变成祖先镜像。继续这样只会把 cutover 窗口往后推。

本增量之后，诊断任务默认停止。下一动作是 delivery：等**当时最新** `origin/main` 的 Docker Release success，再 `--stage` / `--verify-live`。不要用 `040e714c` 的已成功镜像去切。

## 3. Blockers

- `live_not_equal_candidate`
- `production_slo_empty`
- `live_executor_undeployed`
- `live_cutover_pending`
- `production_ready_not_separately_approved`
- `historical_p26_2_invalidated`
- `ancestor_image_not_candidate`
- `further_diagnosis_resign_blocked`
- `ghcr_image_unproven`
