# OpenBot Diagnosis Platform — P20 delivery_ledger_owner 行动单（2026-09-05）

Date: 2026-09-05

Status: **仍有效，但执行载体已是 [PR #960](https://github.com/gmood2008/openbot/pull/960)。** 不要开第二份 Latest PR。细节见 [P20.1 行动单](/design/openbot-diagnosis-p20.1-delivery-owner-actions-2026-09-05)。[P19 行动单](/design/openbot-diagnosis-p19-delivery-owner-actions-2026-09-04) 仍过期。

Task: `openbot-diagnosis-platform`

Related: [P20 对账](/design/openbot-diagnosis-p20-2026-09-05) · #953 <https://github.com/gmood2008/openbot/pull/953>

---

## 1. 已证明的身份

| 对象           | 值                                                                                      | Diagnosis 决定                 |
| -------------- | --------------------------------------------------------------------------------------- | ------------------------------ |
| LIVE           | `04690f8d2ed51f24a06825c153b7c1885d17182a` container `builtAt=2026-09-04T13:29:54.802Z` | 容器为准                       |
| ledger seq 63  | 同 LIVE，`liveFrom=2026-09-04T13:39:37Z`，#953，`tag=main`                              | **keep；不得改写**             |
| ledger seq 62  | `81aafe1e`，已 close                                                                    | **historical**                 |
| RELEASE_RECORD | 第一个 Latest = seq 61 / `e59aede250`                                                   | **写成 seq 63 / `04690f8d2e`** |
| provenance     | 有 `provenance/sha-e59aede2506d`；无 `provenance/sha-04690f8d*`                         | **do_not_mint**                |
| candidate      | 最新 origin/main `65a8195278224840bfde4de850e4ce53f067d765`                             | 已对齐                         |

---

## 2. 允许在主干上做的事

只在已 fetch 的 `origin/main` 上做，走常规 PR。Diagnosis 不得代写。

1. 先再读一次运行容器。若 LIVE 已不是 `04690f8d2e`，停止，按新容器 SHA 重开对账；不要把 Latest 写成旧 SHA。
2. 在 LIVE 仍等于开放 ledger seq 63 时，把 **第一个** `## Latest cutover` 写成 seq 63 / `04690f8d2e`。不要改写 seq 62、seq 61 或 seq 59 的旧 Latest 段。
3. 不要改写 `releases.jsonl` seq 61、62 或 63。
4. 不要发布 `provenance/sha-04690f8d*`。seq 63 账本 `tag=main`，补 tag 会伪造既有发布史。
5. 不要执行 P19「写 seq 62 / `81aafe1e`」。
6. 合入后 `git fetch origin`，用 `--candidate-sha "$(git rev-parse origin/main)" --live-sha <容器 commit>` 重跑 preflight。

---

## 3. 明确禁止

- 把 Latest 写成 seq 62 / `81aafe1e`
- 把 Latest 写成 seq 61 / `e59aede250`、seq 60 / `457057ba2adb` 或 seq 59 / `3d03d3b4df`
- 改写 `releases.jsonl` seq 61、62 或 63
- 补发 `provenance/sha-04690f8d*` / `81aafe1e*` / `e59aede2506d`
- 打开诊断 gate、注册 live pack、生产构建 / 发布 / 重启 / 灰度 / 切流量
- 在身份链未对齐时启动 P21 依赖注入或 P22 审批
