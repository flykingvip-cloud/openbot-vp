# OpenBot Diagnosis Platform — P23 只读报告 API 单租户隔离金丝雀

Date: 2026-09-05

Status: **Isolated single-tenant canary passed. Production gates stay closed。** 已消费 P22 人类独立批准。隔离进程内演练 adapters + 只读 report API。生产 flag 仍为 false。未注册 live pack。未开启 Da Bai / remediation。未进入 P24。standalone production-preflight 仍为 No-Go（空生产 SLO + 生产 reader/audit/quota fail-closed），不得渲染为 live 健康。

Task: `openbot-diagnosis-platform`

Related:

- [P23 report JSON](/design/openbot-diagnosis-p23-report-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p23-report-2026-09-05)
- [P22 人类批准](/design/openbot-diagnosis-p22-human-approval-2026-09-05)
- [P22 冻结包](/design/openbot-diagnosis-p22-2026-09-05)
- #969 <https://github.com/gmood2008/openbot/pull/969>
- #971 <https://github.com/gmood2008/openbot/pull/971>

硬门禁：P23 隔离金丝雀 ≠ 开 gate ≠ 生产部署 ≠ P24。不得补 provenance、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。`approvedForProductionCutover` 保持 false。`productionCanaryStarted` 保持 false。

---

## 1. 基线

评估前 `git fetch origin`。LIVE 来自 `podman exec openbot-gateway-rc cat /app/dist/build-info.json`。

| 项                       | 值                                                                      |
| ------------------------ | ----------------------------------------------------------------------- |
| candidate / origin/main  | `2156a529d64cbf04bdbf2ce32f2db9f903d46460`（#969 squash）               |
| LIVE                     | `04690f8d2ed51f24a06825c153b7c1885d17182a` @ `2026-09-04T13:29:54.802Z` |
| ledger 开放行            | seq 63，同一 SHA                                                        |
| 第一个 Latest            | seq 63 / `04690f8d2e`（#960）                                           |
| provenance peeled target | `04690f8d2ed51f24a06825c153b7c1885d17182a`                              |
| P22 人类批准             | recorded；signer=`Daniel / CEO`；`value_after_approval=false`           |

账本 / Latest / provenance：`keep` / `keep` / `keep`。未改 `RELEASE_RECORD.md` / `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`。未提交 `.loom/registry.yaml`。未发布新的 `provenance/sha-*`。

P22 签署写明批准不等于开启。因此本增量**不**把 `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED` 或 `DIAGNOSIS_REPORT_API_DEPLOYED` 写成 true，也**不**把 `diagnosis-reports` 写入 `GATEWAY_METHOD_PACKS`。

## 2. 注册前最终预检

| 观察                   | 结果                                   |
| ---------------------- | -------------------------------------- |
| 生产 live-pack preview | `hold` / `deploy_flag_false`           |
| 隔离 preview           | `candidate` / `rehearsal_candidate`    |
| wouldRegister          | false                                  |
| livePackUnchanged      | true                                   |
| standalone preflight   | No-Go（空 SLO + 生产依赖 fail-closed） |

## 3. 隔离金丝雀

租户只来自 membership。只读 `diagnosis.reports.query` / `get`。流量 9 / 16。

| 探针            | 期望 | 结果 |
| --------------- | ---- | ---- |
| query           | 200  | 200  |
| get             | 200  | 200  |
| unauthenticated | 401  | 401  |
| forbidden       | 403  | 403  |
| unknown schema  | 400  | 400  |
| unknown method  | 404  | 404  |
| quota           | 429  | 429  |

脱敏、游标、审计、租户隔离均通过。隔离 SLO completeness=`complete`。

## 4. 四门 gate 仍关闭

| Gate                                    | value |
| --------------------------------------- | ----- |
| DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED   | false |
| DIAGNOSIS_REPORT_API_DEPLOYED           | false |
| DIAGNOSIS_DAIBAI_DELIVERY_ENABLED       | false |
| DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED | false |

回滚：关 gate、撤销 live pack、停新任务、保留审计与历史。未删除历史。

## 5. 两份观察不得混用

| 观察                            | 结果                                   |
| ------------------------------- | -------------------------------------- |
| P23 隔离单租户金丝雀            | passed；生产 gate 仍 false             |
| standalone production-preflight | No-Go（空 SLO + 生产依赖 fail-closed） |

P23 隔离金丝雀 ≠ 开 gate ≠ P24 Da Bai 投送 ≠ 生产切换 ≠ Diagnosis Platform 完成。
