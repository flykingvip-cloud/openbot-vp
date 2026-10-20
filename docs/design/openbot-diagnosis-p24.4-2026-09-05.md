# OpenBot Diagnosis Platform — P24.4 统一窗口发布后重评

Date: 2026-09-05

Status: **统一窗口暗发布已验证，功能保持关闭。** candidate=`08cbb0681f`（最新 `origin/main`）。LIVE=seq 64 / `7d3fdf5bfe`。P22 因 candidate 与 LIVE 均已变化而失效，须重新签署。四门功能 gate 保持 false。未启用 Da Bai、live conversation 或 remediation。未宣称 Production Ready。未进入 P25。P24.4 待验收勾选。

Task: `openbot-diagnosis-platform`

Related:

- [P24.4 report](/design/openbot-diagnosis-p24.4-report-2026-09-05)
- [P24.4 verify-live](/design/openbot-diagnosis-p24.4-verify-live-2026-09-05)
- [P24.4 preflight](/design/openbot-diagnosis-p24.4-preflight-2026-09-05)
- [P24.4 convergence](/design/openbot-diagnosis-p24.4-convergence-2026-09-05)
- P24.3 verify-live（`openbot-diagnosis-p24.3-verify-live-2026-09-05`，未进树）

硬门禁：发布后重评 ≠ 开 gate ≠ 诊断单独切流 ≠ P25 ≠ Production Ready。禁止使用旧 candidate `bf81b0ffcb`。

---

## 1. 锁点

评估前 `git fetch origin`。candidate 锁定为当时最新 `origin/main`。LIVE 只来自 `podman exec openbot-gateway-rc cat /app/dist/build-info.json`。

| 项                      | 值                                                                         |
| ----------------------- | -------------------------------------------------------------------------- |
| candidate / origin/main | `08cbb0681f085397a033a6b7746b20d10cbfb212`（#979）                         |
| 已发布窗口 / 容器 LIVE  | `7d3fdf5bfef57077f7956ccab07c3c960984331b`                                 |
| ledger 打开行           | seq 64 / `7d3fdf5b` / `provenance/sha-7d3fdf5bfef5` / `liveVerified=true`  |
| RELEASE_RECORD Latest   | seq 64 / `7d3fdf5bfe`                                                      |
| provenance peeled       | `provenance/sha-7d3fdf5bfef5` → `7d3fdf5bfef57077f7956ccab07c3c960984331b` |
| 禁止旧 candidate        | `bf81b0ffcb401d26640afc65ee85134812f651ea`                                 |

LIVE 是已发布窗口，也是当前 `origin/main` 的祖先。**不要把当前 tip 再切到线上。**

## 2. P22

签署包 `docs/design/openbot-diagnosis-p22-human-approval-2026-09-05.json` 未改写。

| 项        | 签署值                                     | 当前值                                     |
| --------- | ------------------------------------------ | ------------------------------------------ |
| candidate | `2156a529d64cbf04bdbf2ce32f2db9f903d46460` | `08cbb0681f085397a033a6b7746b20d10cbfb212` |
| LIVE      | `04690f8d2ed51f24a06825c153b7c1885d17182a` | `7d3fdf5bfef57077f7956ccab07c3c960984331b` |

P24.4 只接受精确 SHA 匹配。祖先沿用无效。`p22Reusable=false`，`p22Invalidated=true`，`p22RequiresResign=true`。失效不等于开 gate。

## 3. 仍关闭

| Gate                                    | value |
| --------------------------------------- | ----- |
| DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED   | false |
| DIAGNOSIS_REPORT_API_DEPLOYED           | false |
| DIAGNOSIS_DAIBAI_DELIVERY_ENABLED       | false |
| DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED | false |

live pack 未注册。`coreGatewayHandlers` 无 `diagnosis.` methods。Da Bai / live conversation / remediation 仍 disconnected。容器无 `DIAGNOSIS_*` / `OPENBOT_DIAGNOSIS_*` 环境变量。

`2026-09-05T14:32:00Z` 重跑：

| 检查                 | 结果                                                                |
| -------------------- | ------------------------------------------------------------------- |
| forward-only         | allow（candidate 含 LIVE 历史）                                     |
| delivery-alignment   | PASS=3 WARN=3 FAIL=0                                                |
| production-preflight | standalone **No-Go**（空 SLO / 默认 fail-closed，不得当 live 健康） |
| trunk convergence    | 身份链 LIVE=ledger=Latest=provenance=`7d3fdf5b`；enablement 仍关闭  |

未改历史账本，未补发 provenance。等待逐 gate 独立批准。未进入 P25/P26。

统一窗口暗发布已验证，功能保持关闭。
