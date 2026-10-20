# OpenBot Diagnosis Platform — P11 受控灰度与回滚演练

Date: 2026-09-03

Status: **生产切换演练包已落地，全部 gate 默认关闭。未执行生产构建、发布、重启、灰度或流量切换。P11 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Architecture、Security、SRE、QA

Task: `openbot-diagnosis-platform`

Related:

- [P3.10 生产接入审批包](/design/openbot-diagnosis-p3.10-production-approval-pack-2026-09-02)
- [P10 只读诊断可视化](/design/openbot-diagnosis-p10-visualization-2026-09-03)
- [开发交付链路标准](/design/openbot-dev-delivery-pipeline-standard-2026-07-20)

硬门禁：未获独立批准前，不得打开任何生产 gate，不得注册 live pack，不得调用真实聊天 / RPC / Doctor / Channel，不得自动修复。Trusted tenant 只来自服务端 membership。禁止新增 Report DB / Skill Health DB / 平行诊断事实源。

---

## 1. Feature gates

| Gate                                      | 默认  | 批准人                                          | 审计回执               | 回滚                        |
| ----------------------------------------- | ----- | ----------------------------------------------- | ---------------------- | --------------------------- |
| `DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED`   | false | platform_security                               | pending_human_approval | 保持 false                  |
| `DIAGNOSIS_REPORT_API_DEPLOYED`           | false | platform_security                               | pending_human_approval | 保持 false 并撤销 live pack |
| `DIAGNOSIS_DAIBAI_DELIVERY_ENABLED`       | false | platform_security + enterprise_admin            | pending_human_approval | 关 gate、停投送、保留回执   |
| `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED` | false | platform_security + enterprise_admin + employee | pending_human_approval | 关 gate、停新任务、保留审计 |

真实 executor / Da Bai transport 必须单独注入并通过 allowlist。模型输出不能直接触发运行时写入。Evolution 只生成 `EvolutionProposal`，继续走 suggest → approve → apply → verify → rollback。

---

## 2. Canary 与 SLO

第一阶段只允许 `internal_single_tenant`。扩大范围必须再批准。`canary.started` 恒为 false。

SLO 字段：查询延迟、巡检成功率、投送成功率、授权等待时长、Verification 成功率、误报率。缺失观测时 `completeness=empty`，不得视为达标。

---

## 3. 回滚触发

- 任一租户隔离失败
- 审计缺失
- quota 失效
- 未授权投送或执行
- reader stale / schema 错误
- remediation 验证回归

回滚动作：关闭全部 gate、撤销 live pack、停止新任务、保留审计。禁止删除历史数据。

---

## 4. 未做

- 未打开 `GATEWAY_METHOD_PACKS` / `coreGatewayHandlers` 的 diagnosis live 入口
- 未执行生产构建、发布、重启、灰度或流量切换
- 未接真实聊天、Doctor `--fix`、Channel restart
- P5 大白投送合同仍未签收
