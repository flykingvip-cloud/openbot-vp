# OpenBot Diagnosis Platform — 统一窗口 carry 对齐

Date: 2026-09-05

Status: **CARRY ONLY。** 智能诊断已写入下一次官方统一窗口 carry 表，与对话历史弦线同一窗，不单独切。本文件只记录诊断侧对齐，不授权 cutover，不改 LIVE，不写 `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` / `RELEASE_RECORD.md`。

Task: `openbot-diagnosis-platform`

Related:

- [官方 carry 表](https://github.com/upbeyond/openbot/blob/main/deploy/production/NEXT_OFFICIAL_WINDOW.md)（delivery 拥有；诊断不改该未提交草稿）
- [P24.1 统一部署条件](/design/openbot-diagnosis-p24.1-2026-09-05)
- #921 <https://github.com/gmood2008/openbot/pull/921>
- #966–#974 已在 `main`；P24.2 正在合入

---

## 1. 同切项

| 同切项       | 说明                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 对话历史弦线 | 已在 `main`（#921），未上 LIVE                                                                                                       |
| 智能诊断系统 | spec `openbot-diagnosis-platform`，运行时代码 `src/diagnosis/**`（P15–P22 / #966–#970 及之后）。主干在持续合入，未上 LIVE `04690f8d` |
| 其他新组件   | 锁点前合进 `main`，同一窗                                                                                                            |

当前已在 `origin/main` 的诊断增量止于 #974 squash `8980bc7512`。主干 tip 现为 #977 `bf81b0ffcb`。P24.2（#976）按该 tip 重绑后注入统一窗口生产依赖。LIVE 仍为 `04690f8d2ed51f24a06825c153b7c1885d17182a`。

## 2. 四门 gate 仍关闭

诊断四门功能 gate 保持 false，**必须等这次统一窗口 `verify-live` 通过之后**才能开：

| Gate                                    | value |
| --------------------------------------- | ----- |
| DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED   | false |
| DIAGNOSIS_REPORT_API_DEPLOYED           | false |
| DIAGNOSIS_DAIBAI_DELIVERY_ENABLED       | false |
| DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED | false |

统一窗口 carry ≠ 开 gate ≠ 诊断单独切流 ≠ Diagnosis Platform 完成。未部署，未写账本，未补 provenance。

## 3. 诊断不拥有 cutover

- 不从诊断特征分支切生产。
- 不单独 build / publish / restart / 灰度 / 切流量。
- 锁点仍必须重新 `git fetch`，candidate 等于当时最新 `origin/main`，并通过 I1/I2。
- 其他要一起上的组件向 delivery 报名，不在本文件扩表。
