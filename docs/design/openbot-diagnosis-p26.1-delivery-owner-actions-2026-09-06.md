# OpenBot Diagnosis Platform — P26.1 delivery_ledger_owner 行动单（2026-09-06）

Date: 2026-09-06

Status: **#988 / #989 / #990 已在主干。下一步由 delivery 做统一窗口 cutover。Diagnosis 不切 LIVE。**

Task: `openbot-diagnosis-platform`

Related: [P26.1 复评](/design/openbot-diagnosis-p26.1-2026-09-06) · P24.3 上次窗口（`openbot-diagnosis-p24.3-2026-09-05`，未进树）

`cutoverOwner=delivery`。`diagnosisOnlyCutover=false`。

---

## 1. 已证明的身份

| 对象                  | 值                                                          | Diagnosis 决定                                               |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| LIVE                  | `7d3fdf5bfef57077f7956ccab07c3c960984331b` seq 64           | 容器为准；本机本次无法 exec 时沿用上次核过的 ledger / Latest |
| ledger seq 64         | 同 LIVE                                                     | **keep**                                                     |
| RELEASE_RECORD Latest | seq 64 / `7d3fdf5b`                                         | **keep；Diagnosis 不回填**                                   |
| provenance            | `provenance/sha-7d3fdf5bfef5` 已存在                        | **do_not_mint**                                              |
| candidate             | 最新 origin/main `7d75c0bba6ab692f1396cde3d366a10c68ae092d` | 含 #988/#989/#990                                            |
| historical P26        | `0d8a31a2`                                                  | **invalidated；祖先沿用无效**                                |

I1：`is-ancestor(LIVE, origin/main)` 已为 true。这只证明可以前进，不证明已经切过。

---

## 2. delivery 允许做的事

切之前必须再 `git fetch origin`，再读一次运行容器。若 LIVE 已不是 `7d3fdf5b`，或 `origin/main` 已不是 `7d75c0bb`，停止本单，按新 SHA 重开窗口。

1. `./deploy/production/scripts/verify-forward-only.sh --candidate "$(git rev-parse origin/main)"` 必须 allow。
2. 等 Docker Release 为该 `origin/main` tip 产出 GHCR 镜像后再 stage。不要用 dirty worktree 或侧分支 tip 构建。
3. `./deploy/production/scripts/cutover-from-ghcr.sh --stage`：image revision 与 image build-info 都必须等于当时的 `origin/main`。
4. 由 delivery 判断 recreate / overlay；保留现有 env / mounts。不要改诊断 gate 环境变量来“提前生效”。
5. 切后立刻 `./deploy/production/scripts/cutover-from-ghcr.sh --verify-live`，并跑 `./deploy/production/scripts/verify-live-image-identity.sh`（R9）。
6. `pnpm delivery:cutover:record` 只由 delivery 写下一行；Diagnosis 不代写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` / `RELEASE_RECORD.md`。
7. 新 LIVE 的 `provenance/sha-*` 只在 cutover 当时由 delivery 发布。Diagnosis 不补历史 tag。
8. `--verify-live` 通过后，再让诊断任务按新 LIVE == candidate 重签。Production Ready 仍要单独批准，不能从本单自动翻 true。

---

## 3. 明确禁止

- Diagnosis 代切 `openbot-gateway-rc`
- Diagnosis 代写 `RELEASE_RECORD.md` / `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`
- 用 `0d8a31a2`、侧分支 tip 或 dirty HEAD 当 candidate
- 把 LIVE 写成尚未发布的 `7d75c0bb` 来假装已经切过
- 再补一条历史 `provenance/sha-7d3fdf5b*` 或伪造 `provenance/sha-7d75c0bb*`
- 打开未批准的 Doctor `--fix` / Channel restart / Skill disable / 配置写入
- 部署生产 live remediation executor
- 因本单宣布 Diagnosis Platform / Production Ready
