# OpenBot Diagnosis Platform — P19 delivery_ledger_owner 行动单（2026-09-04）

Date: 2026-09-04

Status: **已过期，勿执行。** LIVE 已前移到 seq 63 / `04690f8d2e`（#953），与本单当时的 seq 62 / `81aafe1e` 不再相等。请改看 [P20 行动单](/design/openbot-diagnosis-p20-delivery-owner-actions-2026-09-05)。若仍把 Latest 写成 `81aafe1e`，就是回写已不是容器事实的 SHA。#945 是 CLOSED，不是合入。

Task: `openbot-diagnosis-platform`

Related: [P19 重评](/design/openbot-diagnosis-p19-2026-09-04) · #948 <https://github.com/gmood2008/openbot/pull/948> · #950 <https://github.com/gmood2008/openbot/pull/950> · #945 <https://github.com/gmood2008/openbot/pull/945>

---

## 1. 已证明的身份

| 对象           | 值                                                                                      | Diagnosis 决定               |
| -------------- | --------------------------------------------------------------------------------------- | ---------------------------- |
| LIVE           | `81aafe1e218e91656c3a399edb5a9080ad00d448` container `builtAt=2026-09-04T08:27:11.537Z` | 容器为准                     |
| ledger seq 62  | 同 LIVE，`liveFrom=2026-09-04T09:05:07Z`，#950，`tag=main`                              | **keep；不得改写**           |
| ledger seq 61  | `e59aede250`，已 close                                                                  | **historical**               |
| RELEASE_RECORD | 第一个 Latest = seq 61 / `e59aede250`                                                   | **写成 seq 62 / `81aafe1e`** |
| provenance     | 有 `provenance/sha-e59aede2506d`；无 `provenance/sha-81aafe1e*`                         | **do_not_mint**              |
| candidate      | 最新 origin/main `04690f8d2ed51f24a06825c153b7c1885d17182a`                             | 已对齐                       |

---

## 2. 允许在主干上做的事

只在已 fetch 的 `origin/main` 上做，走常规 PR。Diagnosis 不得代写。

1. 先再读一次运行容器。若 LIVE 已不是 `81aafe1e`，停止，按新容器 SHA 重开对账；不要把 Latest 写成旧 SHA。
2. 在 LIVE 仍等于开放 ledger seq 62 时，把 **第一个** `## Latest cutover` 写成 seq 62 / `81aafe1e`。不要改写 seq 61 或 seq 59 的旧 Latest 段。
3. 不要改写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 61 或 seq 62。
4. 不要发布 `provenance/sha-81aafe1e*`。seq 62 账本 `tag=main`，补 tag 会伪造既有发布史。
5. 不要重开 / 合并 #945。
6. 合入后 `git fetch origin`，用 `--candidate-sha "$(git rev-parse origin/main)" --live-sha <容器 commit>` 重跑 preflight。

---

## 3. 明确禁止

- 把 Latest 写成 seq 61 / `e59aede250`
- 把 Latest 写成 seq 60 / `457057ba2adb` 或 seq 59 / `3d03d3b4df`
- 改写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 61 或 seq 62
- 补发 `provenance/sha-81aafe1e*` / `e59aede2506d` / `457057ba2adb` / `3d03d3b4df91`
- 打开诊断 gate、注册 live pack、生产构建 / 发布 / 重启 / 灰度 / 切流量
- 把 #945 CLOSED 当成合入证据
