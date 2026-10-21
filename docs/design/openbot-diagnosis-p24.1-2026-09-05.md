# OpenBot Diagnosis Platform — P24.1 统一生产部署条件

Date: 2026-09-05

Status: **Unified production deploy conditions open. Diagnosis gates stay closed。** 只开放「诊断代码可随其他新组件一起进入下一次 `origin/main` 统一生产发布」的条件。诊断不拥有 cutover，不以诊断单独切流量。四门功能 gate 保持 false。代码可以暗发布。不启动 P25 受治理修复灰度，不输出 P26 Production Ready。功能启用仍要后续独立批准。

Task: `openbot-diagnosis-platform`

Related:

- [P24.2 统一窗口生产依赖](/design/openbot-diagnosis-p24.2-2026-09-05)
- [统一窗口 carry 对齐](/design/openbot-diagnosis-unified-window-carry-2026-09-05)
- [P24.1 report JSON](/design/openbot-diagnosis-p24.1-report-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p24.1-report-2026-09-05)
- [P24 隔离金丝雀](/design/openbot-diagnosis-p24-2026-09-05)
- [P23 隔离金丝雀](/design/openbot-diagnosis-p23-2026-09-05)
- [P22 人类批准](/design/openbot-diagnosis-p22-human-approval-2026-09-05)
- #971 <https://github.com/gmood2008/openbot/pull/971>
- #972 <https://github.com/gmood2008/openbot/pull/972>
- #973 <https://github.com/gmood2008/openbot/pull/973>
- #974 <https://github.com/gmood2008/openbot/pull/974>

硬门禁：统一部署条件 ≠ 开 gate ≠ 诊断单独切流 ≠ P25 ≠ Production Ready。不得补 provenance、不得由诊断任务执行生产构建 / 发布 / 重启 / 灰度 / 切流量。`approvedForProductionCutover` 保持 false。`diagnosisOnlyCutover` 保持 false。`cutoverOwner=delivery`。

---

## 1. 决策

官方统一窗口已把智能诊断写入 carry 表，与对话历史弦线同一窗，不单独切。因此本增量**只作为同窗乘客**，不单独打开诊断功能。四门 gate 必须等这次统一窗口 `verify-live` 通过之后才能开：

| 打开                                        | 不打开                                    |
| ------------------------------------------- | ----------------------------------------- |
| 诊断代码可随下一次统一 cutover 进入生产镜像 | `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED`   |
| 暗发布 / dark ship                          | `DIAGNOSIS_REPORT_API_DEPLOYED`           |
| 与其他新组件同一 `origin/main` 发布窗口     | `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED`       |
|                                             | `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED` |
|                                             | 诊断单独灰度 / 切流量                     |
|                                             | P25 受治理修复启用                        |
|                                             | P26 Production Ready                      |

## 2. 基线

评估前 `git fetch origin`。LIVE 来自 `podman exec openbot-gateway-rc cat /app/dist/build-info.json`。

| 项                       | 值                                                                      |
| ------------------------ | ----------------------------------------------------------------------- |
| candidate / origin/main  | `c33589d9c73f2c5b87f4e19fdd127aa5855f65a8`（#970 squash）               |
| 签署 candidate           | `2156a529d64cbf04bdbf2ce32f2db9f903d46460`（#969；当前 main 的祖先）    |
| LIVE                     | `04690f8d2ed51f24a06825c153b7c1885d17182a` @ `2026-09-04T13:29:54.802Z` |
| ledger 开放行            | seq 63，同一 SHA                                                        |
| 第一个 Latest            | seq 63 / `04690f8d2e`（#960）                                           |
| provenance peeled target | `04690f8d2ed51f24a06825c153b7c1885d17182a`                              |
| P22 / P23 / P24          | 人类批准已记录；隔离金丝雀 Ready；gate 仍 false                         |

账本 / Latest / provenance：`keep` / `keep` / `keep`。未改 `RELEASE_RECORD.md` / `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`。未提交 `.loom/registry.yaml`。

## 3. 条件

`productionDeployConditionsOpen=true`。身份对齐。P22 签署 `value_after_approval=false`。P23/P24 隔离金丝雀 Ready。live pack 未注册。cutover 由 delivery 拥有，诊断只作为乘客。

## 4. 四门 gate 仍关闭

| Gate                                    | value |
| --------------------------------------- | ----- |
| DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED   | false |
| DIAGNOSIS_REPORT_API_DEPLOYED           | false |
| DIAGNOSIS_DAIBAI_DELIVERY_ENABLED       | false |
| DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED | false |

统一生产部署条件 ≠ 开 gate ≠ 诊断单独切流 ≠ Diagnosis Platform 完成。
