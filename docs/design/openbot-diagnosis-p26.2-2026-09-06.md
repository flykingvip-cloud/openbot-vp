# OpenBot Diagnosis Platform — P26.2 统一窗口 cutover 就绪

Date: 2026-09-06

Status: **I1 允许前进。GHCR 未证明。Production Ready = No-Go。** #992 已在主干 `040e714c`。历史 P26.1 冻结的 candidate `7d75c0bb` 已不是最新 `origin/main`，祖先沿用无效。LIVE 仍是 `7d3fdf5b`。Docker Release 对 `040e714c` 评估时仍 in_progress，不得把 `7d75c0bb` 的已成功镜像当成当前 tip。不绑 Doctor `--fix` / Channel restart。不切 LIVE。不宣布 Production Ready。cutoverOwner=`delivery`。

Task: `openbot-diagnosis-platform`

Related:

- [P26.1 合入后复评](/design/openbot-diagnosis-p26.1-2026-09-06)
- [P26.2 readiness](/design/openbot-diagnosis-p26.2-readiness-2026-09-06)
- [P26.2 delivery 行动单](/design/openbot-diagnosis-p26.2-delivery-owner-actions-2026-09-06)
- #992 <https://github.com/gmood2008/openbot/pull/992>

硬门禁：合入主干 ≠ GHCR 已出图 ≠ LIVE 已切 ≠ Production Ready。诊断任务不单独切流。

---

## 1. Identity (exact match)

评估前 `git fetch origin`。LIVE 只来自 `podman exec openbot-gateway-rc cat /app/dist/build-info.json`。本机本次无法再 exec 容器时，沿用上次核过的 ledger / RELEASE_RECORD Latest seq 64。

| 项                         | 值                                                         |
| -------------------------- | ---------------------------------------------------------- |
| candidate / origin/main    | `040e714cfc1266cb9becaa2b42a159dd503a9b89`（Merge #992）   |
| LIVE                       | `7d3fdf5bfef57077f7956ccab07c3c960984331b` seq 64          |
| historical P26.1 candidate | `7d75c0bba6ab692f1396cde3d366a10c68ae092d` **invalidated** |
| liveEqualsCandidate        | false                                                      |
| I1 forward-only            | allow（injected LIVE；candidate contains LIVE history）    |
| GHCR for this tip          | unproven（Docker Release 34008239864 in_progress）         |
| deliveryMayStage           | false                                                      |
| p26ProductionReady         | false                                                      |
| cutoverOwner               | delivery                                                   |

祖先沿用无效。不要用已成功的 `7d75c0bb` Docker Release 去切当前 tip。不改写旧 P22 / P24.5–P26.1 JSON。不重写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` / `RELEASE_RECORD.md`。不补 `provenance/sha-*`。

## 2. 本增量做了什么

1. 记录 #992 已合入最新 `origin/main`
2. 作废历史 P26.1 在 `7d75c0bb` 上的身份锁
3. 进程内重跑 P25 隔离 canary + P26 闭环链路
4. 只读跑 `verify-forward-only.sh --candidate 040e714c --live-sha 7d3fdf5b`，verdict=`allow`
5. 观察 Docker Release 尚未证明 `040e714c` 的 GHCR 镜像
6. 更新 delivery 行动单：可计划，不可 stage / swap，直到该 tip 的镜像发布

## 3. Blockers

- `live_not_equal_candidate`
- `production_slo_empty`
- `live_executor_undeployed`
- `live_cutover_pending`
- `production_ready_not_separately_approved`
- `historical_p26_1_invalidated`
- `ghcr_image_unproven`

## 4. After this increment

诊断任务不单独切流、不改账本、不补 provenance、不宣布平台完成。LIVE 仍是 seq 64 旧镜像。delivery 必须等 `040e714c`（或当时最新 `origin/main`）的 Docker Release 成功后，才能 `--stage`，再由 delivery 判断 recreate。`--verify-live` 通过后，才允许后续增量按新 LIVE == candidate 重签。Production Ready 仍要单独批准。
