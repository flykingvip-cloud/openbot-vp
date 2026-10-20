# OpenBot Diagnosis Platform — P26.3 delivery_ledger_owner 行动单（2026-09-06）

Date: 2026-09-06

Status: **#993 已在主干 `91d4247e`。I1 allow。祖先镜像 `040e714c` 已 success，禁止当 candidate。当前 tip GHCR 未证明。Diagnosis 停等，不切 LIVE。**

Task: `openbot-diagnosis-platform`

Related: [P26.3 hold](/design/openbot-diagnosis-p26.3-2026-09-06)

`cutoverOwner=delivery`。`diagnosisOnlyCutover=false`。`deliveryMayStage=false`。`nextOfficialStep=delivery_wait_ghcr_then_cutover`。

---

## 1. 已证明的身份

| 对象                      | 值                                                                          | Diagnosis 决定                         |
| ------------------------- | --------------------------------------------------------------------------- | -------------------------------------- |
| LIVE                      | `7d3fdf5bfef57077f7956ccab07c3c960984331b` seq 64                           | keep                                   |
| candidate                 | `91d4247ee21604f60b37fb1de3cc30209443ef76`                                  | 含 #993                                |
| `040e714c` Docker Release | <https://github.com/gmood2008/openbot/actions/runs/34008239864> **success** | **不是当前 tip，禁止 stage**           |
| `91d4247e` Docker Release | <https://github.com/gmood2008/openbot/actions/runs/34009706071> in_progress | 等 success；若本 PR 再合入，改等新 tip |
| I1                        | allow                                                                       | 只证明可以前进                         |

合入本增量后，`origin/main` 会再前移。delivery 必须以**切之前新鲜 fetch 的** `origin/main` 为准，不要锁死本文件里的 `91d4247e`。

---

## 2. delivery 允许做的事

1. `git fetch origin`。candidate = `git rev-parse origin/main`。不要用 `040e714c`。
2. 再读一次运行容器。LIVE 仍应以 `podman exec openbot-gateway-rc cat /app/dist/build-info.json` 为准。
3. 等该 candidate 的 Docker Release success。祖先成功镜像不算数。
4. `./deploy/production/scripts/verify-forward-only.sh --candidate "$(git rev-parse origin/main)"` 必须 allow。
5. `./deploy/production/scripts/cutover-from-ghcr.sh --stage`：image revision 与 image build-info 都必须等于当时的 `origin/main`。
6. delivery 判断 recreate / overlay；保留现有 env / mounts。不要改诊断 gate 环境变量。
7. `--verify-live` + `verify-live-image-identity.sh`（R9）。
8. `pnpm delivery:cutover:record` 只由 delivery 写。新 `provenance/sha-*` 只在 cutover 当时发布。

---

## 3. 明确禁止

- 用 `040e714c` / `7d75c0bb` / `0d8a31a2` 当 candidate
- Diagnosis 代切、代写账本、补 provenance
- 诊断在 cutover 前再开下一刀纯 SHA 重签
- 宣布 Production Ready
