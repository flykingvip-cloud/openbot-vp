# OpenBot Diagnosis Platform — P24.2 统一窗口生产依赖注入

Date: 2026-09-05

Status: **Host injection ready. Diagnosis gates stay closed。** 为统一窗口注入生产形态的 reader / audit / quota / auth。Da Bai、live conversation、remediation 继续断开，等这次统一窗口 `verify-live` 通过后再接。四门功能 gate 保持 false。不连接 LIVE 写入，不注册 live pack，不启动 P25。

Task: `openbot-diagnosis-platform`

Related:

- [统一窗口 carry 对齐](/design/openbot-diagnosis-unified-window-carry-2026-09-05)
- [P24.2 report JSON](/design/openbot-diagnosis-p24.2-report-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p24.2-report-2026-09-05)
- [P24.2 依赖清单](/design/openbot-diagnosis-p24.2-dependencies-2026-09-05)
- [P24.1 统一部署条件](/design/openbot-diagnosis-p24.1-2026-09-05)
- #973 <https://github.com/gmood2008/openbot/pull/973>
- #974 <https://github.com/gmood2008/openbot/pull/974>
- #976 <https://github.com/gmood2008/openbot/pull/976>

硬门禁：生产依赖注入 ≠ 开 gate ≠ 诊断单独切流 ≠ P25 ≠ Production Ready。standalone production-preflight 默认仍 fail-closed，不得渲染为 live 健康。

---

## 1. 决策

| 注入（暗发布 / host-shaped）                        | 仍断开，待 verify-live    |
| --------------------------------------------------- | ------------------------- |
| composite report reader（现有 Composite Diagnosis） | Da Bai delivery transport |
| audit persist（`$CONFIG_DIR/diagnosis-audit/`）     | live conversation store   |
| quota store（process-local window maps）            | remediation executor      |
| gateway auth / membership（trusted tenant only）    | 四门功能 gate             |

## 2. 基线

评估前 `git fetch origin`。LIVE 来自 `podman exec openbot-gateway-rc cat /app/dist/build-info.json`。

| 项                      | 值                                                                      |
| ----------------------- | ----------------------------------------------------------------------- |
| candidate / origin/main | `bf81b0ffcb401d26640afc65ee85134812f651ea`（#977）                      |
| 签署 candidate          | `2156a529d64cbf04bdbf2ce32f2db9f903d46460`（#969；当前 main 的祖先）    |
| LIVE                    | `04690f8d2ed51f24a06825c153b7c1885d17182a` @ `2026-09-04T13:29:54.802Z` |
| ledger / Latest         | seq 63，同一 SHA                                                        |
| #973                    | 已合入 `801c3e67d8`（P22 人类批准 + P23 + P24）                         |
| #974                    | 已合入 `8980bc7512`（P24.1 统一部署条件）                               |
| #976                    | 按 `bf81b0ffcb` 重绑，待合入                                            |

## 3. 四门 gate 仍关闭

| Gate                                    | value |
| --------------------------------------- | ----- |
| DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED   | false |
| DIAGNOSIS_REPORT_API_DEPLOYED           | false |
| DIAGNOSIS_DAIBAI_DELIVERY_ENABLED       | false |
| DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED | false |

统一窗口生产依赖注入 ≠ 开 gate ≠ 诊断单独切流 ≠ Diagnosis Platform 完成。
