# OpenBot Diagnosis Platform — P22 人类独立批准记录

Date: 2026-09-05

Status: **Human approval recorded. Approval ≠ enable。** 人类已签署四角色与四门 gate。签署人 `Daniel / CEO`。`value_after_approval` 全部为 false。四门生产 gate 仍为 false。未开 gate。未进入 P23。standalone production-preflight 仍为 No-Go（空生产 SLO + 生产 reader/audit/quota fail-closed），不得渲染为 live 健康。

Task: `openbot-diagnosis-platform`

Related:

- [人类签署声明 JSON](/design/openbot-diagnosis-p22-human-approval-2026-09-05.json)
- [记录后审批包 JSON](/design/openbot-diagnosis-p22-human-approval-pack-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p22-human-approval-pack-2026-09-05)
- [记录后 report JSON](/design/openbot-diagnosis-p22-human-approval-report-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p22-human-approval-report-2026-09-05)
- [P22 冻结包](/design/openbot-diagnosis-p22-2026-09-05)
- [P22 #969 合入后重算](/design/openbot-diagnosis-p22-post969-2026-09-05)
- #969 <https://github.com/gmood2008/openbot/pull/969>

硬门禁：人类独立批准 ≠ 开 gate ≠ 生产部署 ≠ P23。不得补 provenance、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。`approvedForProductionCutover` 保持 false。`gatesOpened` 保持 false。

---

## 1. 基线

评估前 `git fetch origin`。LIVE 来自 `podman exec openbot-gateway-rc cat /app/dist/build-info.json`。

| 项                       | 值                                                                      |
| ------------------------ | ----------------------------------------------------------------------- |
| candidate / origin/main  | `2156a529d64cbf04bdbf2ce32f2db9f903d46460`（#969 squash）               |
| LIVE                     | `04690f8d2ed51f24a06825c153b7c1885d17182a` @ `2026-09-04T13:29:54.802Z` |
| ledger 开放行            | seq 63，同一 SHA，`liveFrom=2026-09-04T13:39:37Z`，`tag=main`           |
| 第一个 Latest            | seq 63 / `04690f8d2e`（#960）                                           |
| provenance peeled target | `04690f8d2ed51f24a06825c153b7c1885d17182a`                              |

签署声明绑定的 SHA 与重读后的 candidate / LIVE 一致。一人同时持有四个角色被接受。账本 / Latest / provenance：`keep` / `keep` / `keep`。未改 `RELEASE_RECORD.md` / `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl`。未提交 `.loom/registry.yaml`。未发布新的 `provenance/sha-*`。provenance remint：`do_not_mint` / `published=false`。

## 2. 签署结果

| 条件                                                           | 结果  |
| -------------------------------------------------------------- | ----- |
| kind=`human_independent_approval_record`                       | true  |
| acceptsClientParam / acceptsModelOutput                        | false |
| confirmHuman / confirmDoesNotOpenGate / confirmDoesNotStartP23 | true  |
| 四角色 signed=true / decision=approve / signer=`Daniel / CEO`  | true  |
| 四门 gate signed=true / valueAfterApproval=false               | true  |
| humanApprovalRecorded                                          | true  |
| pendingApprovers                                               | 空    |
| 四门 gate.value                                                | false |
| approvedForProductionCutover / gatesOpened / trafficSwitched   | false |

**结论：人类独立批准已记录。批准不等于开启。不得自行打开 gate、部署或进入 P23。**

## 3. 角色

| 角色                  | 范围                                                                           | signed | decision |
| --------------------- | ------------------------------------------------------------------------------ | ------ | -------- |
| platform_security     | adapters / report API；Da Bai allowlist 与委托；remediation executor allowlist | true   | approve  |
| enterprise_admin      | Da Bai 投送与 remediation 执行；trusted tenant 只来自 membership               | true   | approve  |
| employee              | 触及已授权 principal 的高风险修复；个人证据范围不扩大                          | true   | approve  |
| delivery_ledger_owner | 保持 ledger / Latest / provenance；do_not_mint；Diagnosis 不得掩盖 LIVE        | true   | approve  |

## 4. 四门 gate（批准后仍为 false）

| Gate                                    | 批准人                                      | value after approval | rollback                                 | signed |
| --------------------------------------- | ------------------------------------------- | -------------------- | ---------------------------------------- | ------ |
| DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED   | platform_security                           | false                | keep_flag_false                          | true   |
| DIAGNOSIS_REPORT_API_DEPLOYED           | platform_security                           | false                | keep_flag_false_revoke_live_pack         | true   |
| DIAGNOSIS_DAIBAI_DELIVERY_ENABLED       | platform_security+enterprise_admin          | false                | disable_gate_stop_delivery_keep_receipts | true   |
| DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED | platform_security+enterprise_admin+employee | false                | disable_gate_stop_tasks_keep_audit       | true   |

打开任一 gate 需要另一次显式服务端配置变更。本记录不是那次变更。

## 5. 两份观察不得混用

| 观察                            | 结果                                   |
| ------------------------------- | -------------------------------------- |
| P22 人类独立批准记录            | recorded；gates 仍 false               |
| standalone production-preflight | No-Go（空 SLO + 生产依赖 fail-closed） |
| standalone trunk-convergence    | No-Go                                  |

P22 人类批准已记录 ≠ 开 gate ≠ P23 只读报告 API 金丝雀 ≠ 生产切换 ≠ Diagnosis Platform 完成。
