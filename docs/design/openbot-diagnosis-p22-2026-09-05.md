# OpenBot Diagnosis Platform — P22 独立审批包冻结

Date: 2026-09-05

Status: **Ready for independent approval。** 身份链一致。P21 隔离预生产依赖、故障注入与隔离 SLO 已通过。四角色批准事项与四门 gate 独立批准记录已冻结。签名格式只接受人类独立批准，拒绝客户端参数与模型输出。全部 `signed=false`。批准不等于开启。standalone production-preflight 仍为 No-Go（空生产 SLO + 生产 reader/audit/quota fail-closed），不得渲染为 live 健康。未开 gate。不得自行进入 P23 或打开任何生产门禁。

Task: `openbot-diagnosis-platform`

Related:

- [审批包 JSON](/design/openbot-diagnosis-p22-approval-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p22-approval-2026-09-05)
- [P22 report JSON](/design/openbot-diagnosis-p22-report-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p22-report-2026-09-05)
- [convergence JSON](/design/openbot-diagnosis-p22-convergence-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p22-convergence-2026-09-05)
- [preflight JSON](/design/openbot-diagnosis-p22-preflight-2026-09-05.json) · [Markdown](/design/openbot-diagnosis-p22-preflight-2026-09-05)
- [P21 证据](/design/openbot-diagnosis-p21-2026-09-05)
- [P14 冻结合同](/design/openbot-diagnosis-p14-independent-approval-2026-09-03)

硬门禁：P22 Ready ≠ 生产部署 ≠ 已签署。不得开 gate、不得补 provenance、不得生产构建 / 发布 / 重启 / 灰度 / 切流量。不得注册 live gateway pack。不得真实 Da Bai 投送、聊天接入、Doctor `--fix`、Channel restart。`approvedForProductionCutover` 保持 false。

---

## 1. 基线

评估前 `git fetch origin`。LIVE 来自 `podman exec openbot-gateway-rc cat /app/dist/build-info.json`。

| 项                       | 值                                                                      |
| ------------------------ | ----------------------------------------------------------------------- |
| candidate / origin/main  | `8981f2bfe999dcaaa0f17604016d90ec6c1ae304`（#968 squash）               |
| LIVE                     | `04690f8d2ed51f24a06825c153b7c1885d17182a` @ `2026-09-04T13:29:54.802Z` |
| ledger 开放行            | seq 63，同一 SHA，`liveFrom=2026-09-04T13:39:37Z`，`tag=main`           |
| 第一个 Latest            | seq 63 / `04690f8d2e`（#960）                                           |
| provenance peeled target | `04690f8d2ed51f24a06825c153b7c1885d17182a`                              |

账本 / Latest / provenance：`keep` / `keep` / `keep`。未改 `RELEASE_RECORD.md` / `releases.jsonl`。未提交 `.loom/registry.yaml`。未发布新的 `provenance/sha-*`。provenance remint：`do_not_mint` / `published=false`。

## 2. Go / No-Go

| Ready 条件                                             | 结果      |
| ------------------------------------------------------ | --------- |
| candidate == 最新 origin/main                          | true      |
| LIVE == ledger == Latest == peeled                     | true      |
| P21 隔离依赖可验证且无生产写入                         | true      |
| P21 故障注入全通过                                     | true      |
| P21 隔离 SLO completeness=complete                     | true      |
| 四角色批准事项已列出                                   | true      |
| 四门 gate 独立批准记录已冻结且 value=false             | true      |
| 签名格式拒绝 client param / model output，signed=false | true      |
| 所有生产 gate 仍为 false                               | true      |
| standalone 生产 SLO / 生产依赖可用                     | **false** |

P22 评估器消费 P21 隔离预生产证据，给出 **Ready for independent approval**。这只表示人类可以签署，不表示已签署，也不表示可以开 gate。

独立生产预检仍是准入观察：`slo.completeness=empty`，reader/audit/quota fail-closed，故 standalone `readyForIndependentApproval=false`。那份空 SLO **不得**渲染为健康，也 **不得**被 P21 / P22 数字覆盖。

**结论：Ready for independent approval。不得自行打开 gate、部署或进入 P23。**

## 3. 角色批准事项

| 角色                  | 批准事项                                                                                      | signed |
| --------------------- | --------------------------------------------------------------------------------------------- | ------ |
| platform_security     | adapters / report API；Da Bai allowlist 与委托守卫；remediation executor allowlist            | false  |
| enterprise_admin      | 共批 Da Bai 与 remediation 租户范围；确认 trusted tenant 只来自 membership                    | false  |
| employee              | 批准触及本人的高风险修复；确认个人范围证据不被企业 / 平台授权扩大                             | false  |
| delivery_ledger_owner | Latest 只写已证明 LIVE；provenance 只走正常发布路径；不得要求 Diagnosis 补 tag 或掩盖运行 SHA | false  |

## 4. 四门 gate 独立批准记录

每条记录都有前置条件、批准人、审计回执、回滚动作。`approvalDoesNotOpenGate=true`。`value=false`。`signed=false`。

| Gate                                    | 批准人                                      | 回滚                                     | signed |
| --------------------------------------- | ------------------------------------------- | ---------------------------------------- | ------ |
| DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED   | platform_security                           | keep_flag_false                          | false  |
| DIAGNOSIS_REPORT_API_DEPLOYED           | platform_security                           | keep_flag_false_revoke_live_pack         | false  |
| DIAGNOSIS_DAIBAI_DELIVERY_ENABLED       | platform_security+enterprise_admin          | disable_gate_stop_delivery_keep_receipts | false  |
| DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED | platform_security+enterprise_admin+employee | disable_gate_stop_tasks_keep_audit       | false  |

前置条件沿用 P14 冻结矩阵，并叠加 P20 身份对齐与 P21 隔离证据。批准之后仍须另一次显式服务端配置变更才能打开 gate。

## 5. 签名 / 审计格式

- kind: `human_independent_approval_record`
- acceptsClientParam: false
- acceptsModelOutput: false
- receipt: `pending_human_approval`
- 客户端参数、URL/query/body/header、模型输出都不是批准

## 6. 两份观察不得混用

| 观察                                | 结果                                     |
| ----------------------------------- | ---------------------------------------- |
| P22 独立审批包（消费 P21 隔离证据） | Ready for independent approval           |
| standalone production-preflight     | No-Go（空 SLO + 生产依赖 fail-closed）   |
| standalone trunk-convergence        | No-Go（P15 包装器未把空生产 SLO 当成绿） |

P22 Ready ≠ 已签署 ≠ 开 gate ≠ P23 只读报告 API 金丝雀 ≠ 生产切换 ≠ Diagnosis Platform 完成。
