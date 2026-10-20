# OpenBot Diagnosis Platform — P26.2 delivery_ledger_owner 行动单（2026-09-06）

Date: 2026-09-06

Status: **#992 已在主干 `040e714c`。I1 allow。该 tip 的 GHCR 评估时尚未证明。Diagnosis 不切 LIVE。**

Task: `openbot-diagnosis-platform`

Related: [P26.2 就绪](/design/openbot-diagnosis-p26.2-2026-09-06) · [P26.1 旧单](/design/openbot-diagnosis-p26.1-delivery-owner-actions-2026-09-06)

`cutoverOwner=delivery`。`diagnosisOnlyCutover=false`。`deliveryMayStage=false`。

---

## 1. 已证明的身份

| 对象                      | 值                                                                          | Diagnosis 决定                                               |
| ------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| LIVE                      | `7d3fdf5bfef57077f7956ccab07c3c960984331b` seq 64                           | 容器为准；本机本次无法 exec 时沿用上次核过的 ledger / Latest |
| ledger seq 64             | 同 LIVE                                                                     | **keep**                                                     |
| RELEASE_RECORD Latest     | seq 64 / `7d3fdf5b`                                                         | **keep；Diagnosis 不回填**                                   |
| provenance                | `provenance/sha-7d3fdf5bfef5` 已存在                                        | **do_not_mint**                                              |
| candidate                 | 最新 origin/main `040e714cfc1266cb9becaa2b42a159dd503a9b89`                 | 含 #992                                                      |
| historical P26.1          | `7d75c0bb`                                                                  | **invalidated；不要切这个旧 tip**                            |
| I1                        | `verify-forward-only --candidate 040e714c --live-sha 7d3fdf5b` → allow      | 只证明可以前进                                               |
| Docker Release `040e714c` | <https://github.com/gmood2008/openbot/actions/runs/34008239864> in_progress | **等 success，再 stage**                                     |
| Docker Release `7d75c0bb` | 已 success                                                                  | **禁止当作当前 candidate 的镜像**                            |

---

## 2. delivery 允许做的事

切之前必须再 `git fetch origin`，再读一次运行容器。若 LIVE 已不是 `7d3fdf5b`，或 `origin/main` 已不是 `040e714c`，停止本单，按新 SHA 重开窗口。

1. 等 Docker Release 对**当时的** `origin/main` tip 产出 GHCR。不要用 `7d75c0bb` 的旧成功 run。
2. `./deploy/production/scripts/verify-forward-only.sh --candidate "$(git rev-parse origin/main)"` 必须 allow。LIVE 以容器为准。
3. `./deploy/production/scripts/cutover-from-ghcr.sh --stage`：image revision 与 image build-info 都必须等于当时的 `origin/main`。
4. 由 delivery 判断 recreate / overlay；保留现有 env / mounts。不要改诊断 gate 环境变量来“提前生效”。
5. 切后立刻 `--verify-live`，并跑 `./deploy/production/scripts/verify-live-image-identity.sh`（R9）。
6. `pnpm delivery:cutover:record` 只由 delivery 写下一行。
7. 新 LIVE 的 `provenance/sha-*` 只在 cutover 当时由 delivery 发布。
8. `--verify-live` 通过后，再让诊断任务按新 LIVE == candidate 重签。Production Ready 仍要单独批准。

---

## 3. 明确禁止

- Diagnosis 代切 `openbot-gateway-rc`
- Diagnosis 代写 `RELEASE_RECORD.md` / `releases.jsonl`
- 用 `7d75c0bb`、`0d8a31a2`、侧分支 tip 或 dirty HEAD 当 candidate
- 在 Docker Release 未 success 前 `--stage`
- 把 LIVE 写成尚未发布的 `040e714c` 来假装已经切过
- 再补历史 `provenance/sha-*`
- 打开未批准的 Doctor `--fix` / Channel restart / Skill disable / 配置写入
- 部署生产 live remediation executor
- 因本单宣布 Diagnosis Platform / Production Ready
