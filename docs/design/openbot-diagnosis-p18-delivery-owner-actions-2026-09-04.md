# OpenBot Diagnosis Platform — P18 delivery_ledger_owner 行动单（2026-09-04）

Date: 2026-09-04

Status: **已过期，勿执行。** LIVE 其后又前移到 seq 63 / `04690f8d2e`（#953）。请改看 [P20 行动单](/design/openbot-diagnosis-p20-delivery-owner-actions-2026-09-05)。[P19 行动单](/design/openbot-diagnosis-p19-delivery-owner-actions-2026-09-04) 同样过期。若仍按本单对账 `e59aede250` 或 seq 60，就是回写已不是容器事实的 SHA。#945 是 CLOSED，不是合入。

Task: `openbot-diagnosis-platform`

---

## 1. 已证明的身份

| 对象           | 值                                                                                      | Diagnosis 决定                         |
| -------------- | --------------------------------------------------------------------------------------- | -------------------------------------- |
| LIVE           | `e59aede2506dbe8c571f0019f7e1bac0687778b6` container `builtAt=2026-09-04T06:19:02.441Z` | 容器为准                               |
| ledger seq 60  | `457057ba2adb`，仍开放                                                                  | **keep；不得改写成 LIVE**              |
| ledger seq 59  | `3d03d3b4df`，已 close                                                                  | **historical**                         |
| RELEASE_RECORD | 仍 `37cc40e51f46`                                                                       | 在 LIVE==ledger 之前 **不得改 Latest** |
| provenance     | 无 `provenance/sha-e59aede2506d`                                                        | **do_not_mint**                        |
| candidate      | 最新 origin/main `330d922074`                                                           | 已对齐                                 |

---

## 2. 允许在主干上做的事

只在已 fetch 的 `origin/main` 上做，走常规 PR。

1. 先让开放 ledger 行等于容器 LIVE。两条诚实路径，二选一：
   - 若 `e59aede250` 是一次已授权 cutover：追加 **新的** seq（不要改写 seq 59/60），再把 Latest 写成该 SHA；
   - 若容器不该离开 seq 60：把运行容器收回 `457057ba2adb`，再把 Latest 写成 seq 60。
2. 在 LIVE 与开放 ledger 行相等之前，不要改 `RELEASE_RECORD.md`。
3. 关闭或明确拒绝 #941。不要把 Latest 写成 seq 59。
4. 不要发布代表既有发布史的 `provenance/sha-*`。
5. 合入后 `git fetch origin`，用 `--candidate-sha "$(git rev-parse origin/main)"` 重跑 preflight。

---

## 3. 明确禁止

- 合并 #941 / 把 Latest 写成 `3d03d3b4df`
- 在 LIVE 仍是 `e59aede250` 时把 Latest 写成 `457057ba2adb`
- 改写 `releases.jsonl` seq 59 或 seq 60
- 打开诊断 gate、注册 live pack、生产构建 / 发布 / 重启 / 灰度 / 切流量
