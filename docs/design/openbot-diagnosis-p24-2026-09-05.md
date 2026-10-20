# OpenBot Diagnosis Platform — P24 Da Bai 投送与对话闭环隔离金丝雀

Date: 2026-09-05

Status: **Isolated Da Bai + conversation canary passed. Production gates stay closed。** 已消费 P22 人类独立批准与 Ready 的 P23 隔离金丝雀。隔离进程内演练授权投送、回执与 P6 对话状态机。生产 `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED` 仍为 false。未绑定 live chat。未开启 remediation。未进入 P25。standalone production-preflight 仍为 No-Go（空生产 SLO + 生产 reader/audit/quota fail-closed），不得渲染为 live 健康。

Task: `openbot-diagnosis-platform`

Related:

- [P24 report JSON](/design/openbot-diagnosis-p24-report-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p24-report-2026-09-05)
- [P23 隔离金丝雀](/design/openbot-diagnosis-p23-2026-09-05)
- [P22 人类批准](/design/openbot-diagnosis-p22-human-approval-2026-09-05)
- #969 <https://github.com/gmood2008/openbot/pull/969>
- #970 <https://github.com/gmood2008/openbot/pull/970>
- #971 <https://github.com/gmood2008/openbot/pull/971>
- #972 <https://github.com/gmood2008/openbot/pull/972>

硬门禁：P24 隔离金丝雀 ≠ 开 gate ≠ 生产投送 ≠ P25。不得补 provenance、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。`approvedForProductionCutover` 保持 false。`productionCanaryStarted` 保持 false。`liveChatBound` 保持 false。

---

## 1. 基线

评估前 `git fetch origin`。LIVE 来自 `podman exec openbot-gateway-rc cat /app/dist/build-info.json`。

| 项                       | 值                                                                      |
| ------------------------ | ----------------------------------------------------------------------- |
| candidate / origin/main  | `c33589d9c73f2c5b87f4e19fdd127aa5855f65a8`（#970 squash）               |
| 签署 candidate           | `2156a529d64cbf04bdbf2ce32f2db9f903d46460`（#969；当前 main 的祖先）    |
| LIVE                     | `04690f8d2ed51f24a06825c153b7c1885d17182a` @ `2026-09-04T13:29:54.802Z` |
| ledger 开放行            | seq 63，同一 SHA                                                        |
| 第一个 Latest            | seq 63 / `04690f8d2e`（#960）                                           |
| provenance peeled target | `04690f8d2ed51f24a06825c153b7c1885d17182a`                              |
| P22 人类批准             | recorded；signer=`Daniel / CEO`；`value_after_approval=false`；祖先沿用 |
| P23 隔离金丝雀           | Ready；生产 gate 仍 false                                               |

账本 / Latest / provenance：`keep` / `keep` / `keep`。未改 `RELEASE_RECORD.md` / `releases.jsonl`。未提交 `.loom/registry.yaml`。未发布新的 `provenance/sha-*`。

P22 签署写明批准不等于开启。因此本增量**不**把 `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED` 写成 true，也**不**绑定 live chat。LIVE 未变时，签署 candidate 只要是当前 `origin/main` 的祖先即可沿用，不重签、不改 LIVE 绑定。

## 2. 隔离金丝雀

租户只来自 membership。进程内复用既有 P5 / P6 / P7 合同：`createDiagnosisDaibaiDeliveryQueue`、`createConversationDiagnosisMachine`、`createDiagnosisDelegationMachine`。

| 探针                                   | 结果                           |
| -------------------------------------- | ------------------------------ |
| platform → enterprise 批准后投送       | accepted                       |
| platform → employee 双授权未齐         | rejected / grant_inactive      |
| platform → employee 双授权齐           | accepted                       |
| enterprise → employee 批准后投送       | accepted                       |
| 缺授权                                 | rejected / delegation_required |
| 过期 / 撤销 / principal 冒用           | rejected；不入 pending         |
| WAITING_AUTHORIZATION → approve/resume | TRIAGING                       |
| deny / cancel / timeout                | INCONCLUSIVE / CANCELLED       |
| 幂等 deliveryId                        | 同键复用                       |
| 回执 / 重试 / 过期 / 审计              | queued → retried → expired     |
| 投送投影                               | 不含 Evidence payload          |
| 对话提问                               | 不写正式 RCA                   |

隔离 SLO completeness=`complete`。生产 pack preview 仍 `hold/deploy_flag_false`。

## 3. 四门 gate 仍关闭

| Gate                                    | value |
| --------------------------------------- | ----- |
| DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED   | false |
| DIAGNOSIS_REPORT_API_DEPLOYED           | false |
| DIAGNOSIS_DAIBAI_DELIVERY_ENABLED       | false |
| DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED | false |

回滚：关 gate、停止投送、保留回执与审计。未删除历史。

## 4. 两份观察不得混用

| 观察                            | 结果                                   |
| ------------------------------- | -------------------------------------- |
| P24 隔离 Da Bai + 对话金丝雀    | passed；生产 gate 仍 false             |
| standalone production-preflight | No-Go（空 SLO + 生产依赖 fail-closed） |

P24 隔离金丝雀 ≠ 开 gate ≠ P25 治理修复 ≠ 生产切换 ≠ Diagnosis Platform 完成。
