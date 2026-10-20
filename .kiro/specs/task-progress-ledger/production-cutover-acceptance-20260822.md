# Task Progress Ledger 生产发布验收 · 2026-08-22 23:26 CST

决策摘要：**独立门禁复验后，生产发布验收仍不通过。**

用户授权「帮我批准」后，在干净工作树 `/tmp/openbot-release-wt`（`origin/main` tip，porcelain=0）与生产主机 `root@8.217.93.71` 复核。机器回执：`docs/design/evidence/task-progress-ledger-7cd74d4c-independent-reverify-20260822.json`。

## 已独立证实

| 项                                              | 值                                                         |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `origin/main`                                   | `7cd74d4c5c69e7492eb6d624531f27592d6c809a`                 |
| 容器 `/app/dist/build-info.json`.commit         | `7cd74d4c5c69e7492eb6d624531f27592d6c809a`                 |
| healthz                                         | live                                                       |
| readyz                                          | ready                                                      |
| UI pin                                          | `index-Dpg8P1UR.js` / `origin-main-7cd74d4c-item7-s18-r1`  |
| Ledger flag                                     | 未改；`gateway.progressLedger.enabled=true`                |
| `verify-forward-only.sh --candidate $CANDIDATE` | **allow**（`liveSource=container`，不依赖 RELEASE_RECORD） |

无参 `verify-delivery-alignment.sh` 在本干净工作树为 PASS=9，但检查的是 2026-07 夹具 SHA `9aceda73` / tag `rc-convergence-2026-07-20`，**不能**证明 `7cd74d4c` overlay。

## 阻断（验收不通过）

1. **三者 SHA 不一致（origin/main 记录）**：`origin/main` 的 Latest cutover 仍是 GHCR `5c221b9e` recreate，字段是 `Source` 不是 `Source revision`，正文不含 `7cd74d4c`。本地 `kiro-loom` 上的 7cd74d4c Latest 只是声明，尚未进 `origin/main`。
2. **针对 LIVE 的 alignment 失败**：`--prod-sha/--candidate-sha 7cd74d4c` + tag `provenance/sha-7cd74d4c5c69` → **FAIL=1**（`L3 SoT RELEASE_RECORD missing prod SHA 7cd74d4c…`）。
3. 主工作树仍脏；本次门禁未用它作 root。

## 生效约束

- 不把此次部署标为完整验收通过。
- 不改 Progress Ledger flag，不重启 / 不 recreate 生产容器。
- 通过条件：`origin/main` Latest 的 `Source revision` = live `build-info.commit` = `origin/main` tip，且干净工作树上 live-matched `verify-delivery-alignment.sh` FAIL=0。

---

# 2026-08-23 08:15 CST 复验（#614 合入后）

决策摘要：**`7cd74d4c` overlay 记录已可独立复核。当前 `origin/main` tip 的新生产部署门禁仍未闭合。未 archive / 未构建 / 未 cutover。**

回执：`docs/design/evidence/task-progress-ledger-7cd74d4c-origin-main-reverify-20260823.json`。合入：https://github.com/gmood2008/openbot/pull/614 → `e1cbc1e80420782e8d3720a546ebc39d9d06764b`。

## 记录缺口已闭合

| 项                       | 值                                                 |
| ------------------------ | -------------------------------------------------- |
| `parseLatestCutoverSha`  | `7cd74d4c5c69e7492eb6d624531f27592d6c809a`         |
| 容器 `build-info.commit` | `7cd74d4c5c69e7492eb6d624531f27592d6c809a`         |
| live-matched alignment   | **PASS=8 FAIL=0**（`provenance/sha-7cd74d4c5c69`） |
| `verify-forward-only`    | **allow**；`releaseRecordSha=7cd74d4c…`            |
| healthz / readyz         | live / ready                                       |
| Ledger flag              | 未改；config + `.env.docker` 仍开                  |

2026-08-22 23:26 的阻断 1–2（`origin/main` 无 `Source revision` / live-matched FAIL）已不成立。

## 新 tip 仍不能部署

| 项                                    | 值                                                                |
| ------------------------------------- | ----------------------------------------------------------------- |
| 当前 `origin/main`                    | `e1cbc1e80420782e8d3720a546ebc39d9d06764b`（#614 squash）         |
| tip alignment                         | **FAIL=3**（无 `provenance/sha-e1cbc1e80420`；Latest 不是该 SHA） |
| `check-sot --use-release-record-live` | **exit 20**（冻结 `baseline-recovery-20260725`）                  |
| 三者 SHA 相同                         | **否**（tip ≠ live；record 与 live 相同）                         |

因此：`7cd74d4c` 记录验收通过；不能把 `e1cbc1e804`（或更新 tip）标为已发布。
