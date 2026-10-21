# OpenBot Diagnosis Platform — P20.1 delivery_ledger_owner 行动单（2026-09-05）

Date: 2026-09-05

Status: **Latest 回填已由 #960 合入主干。** 当前 LIVE 仍是 seq 63 / `04690f8d2e`，不要再写第二次 Latest。后续见 [P20.2 对账](/design/openbot-diagnosis-p20.2-2026-09-05)。

Task: `openbot-diagnosis-platform`

Related: [P20.1 对账](/design/openbot-diagnosis-p20.1-2026-09-05) · [P20 行动单](/design/openbot-diagnosis-p20-delivery-owner-actions-2026-09-05)

---

## 1. 已证明的身份

| 对象           | 值                                                                                      | Diagnosis 决定                         |
| -------------- | --------------------------------------------------------------------------------------- | -------------------------------------- |
| LIVE           | `04690f8d2ed51f24a06825c153b7c1885d17182a` container `builtAt=2026-09-04T13:29:54.802Z` | 容器为准                               |
| ledger seq 63  | 同 LIVE，#953，`tag=main`                                                               | **keep**                               |
| RELEASE_RECORD | 主干第一个 Latest = seq 61 / `e59aede250`                                               | **由 #960 写成 seq 63 / `04690f8d2e`** |
| provenance     | annotated `provenance/sha-04690f8d2ed5` 已存在；剥开后是 LIVE                           | **do_not_mint；不要再补一条**          |
| candidate      | 最新 origin/main `e106c3e168a1c2f09fcb3017d887f841ed881bdf`                             | 已对齐                                 |

---

## 2. 允许在主干上做的事

1. 合入前再读一次运行容器。若 LIVE 已不是 `04690f8d2e`，停止 #960，按新容器 SHA 重开对账。
2. 只合入 #960 这一份 Latest 回填。第一个 `## Latest cutover` 写成 seq 63 / `04690f8d2e`。不要改写或删除 seq 61/59 旧段。
3. 不要改写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` seq 61/62/63。
4. 不要再发布 `provenance/sha-04690f8d*`。现有 tag 已指向 LIVE。
5. 合入后 `git fetch origin`，用 `--candidate-sha "$(git rev-parse origin/main)" --live-sha <容器 commit>` 重跑 preflight。
6. 在 Latest 上主干且 SLO/依赖完整之前，不要启动 P21。

---

## 3. 明确禁止

- Diagnosis 代写 `RELEASE_RECORD.md`
- 第二份 Latest PR
- 把 Latest 写成 seq 62 / `81aafe1e` 或 seq 61 / `e59aede250`
- 再补一条历史 `provenance/sha-*`
- 打开诊断 gate、注册 live pack、生产构建 / 发布 / 重启 / 灰度 / 切流量
