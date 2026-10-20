# OpenBot Diagnosis Platform — P3.10 生产接入审批包

Date: 2026-09-02

Status: **审批准备已落地，未批准、未部署。P3.10 完成 ≠ Phase 3 完成 ≠ 生产部署 ≠ Diagnosis Platform 完成。**

Audience: Platform Architecture、Gateway、Security、SRE、Data Governance、QA

Task: `openbot-diagnosis-platform`

Related:

- [P3.9 生产配置注入预演](/design/openbot-diagnosis-p3.9-production-rehearsal-2026-09-02)
- [P3.8 生产适配器](/design/openbot-diagnosis-p3.8-production-adapters-2026-09-02)
- [P3.7 生产接入评审](/design/openbot-diagnosis-p3.7-production-integration-review-2026-09-02)

硬门禁：`DIAGNOSIS_REPORT_API_DEPLOYED=false`，`DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED=false`。不注册 live pack，不构建、发布、重启、灰度或切流量。生产 backend 仍须显式注入和人工审批。

---

## 1. 审批 manifest

机器可读对象：`DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST`。`approvedForProductionCutover` 恒为 `false`。

覆盖增量：P3.5 / P3.6 / P3.7 / P3.8 / P3.9。

| 域        | 冻结内容                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------- |
| API       | `diagnosis.reports.query` / `get`；schemaVersion=1；cursor `pq1.`；200/400/401/403/404/429/503 |
| Auth      | trusted tenant 只来自 membership；禁止 URL/query/body/header/`sessionTenantId`                 |
| Reader    | 现有 Composite Diagnosis 投影；schema / tenant / maxAge / payload；无平行 Report DB            |
| Audit     | 异步 `persist()` 必须 await；允许 principal/tenant/mode/digest 等；禁止 Evidence payload       |
| Quota     | `consumeWindow` / `releaseWindow`；60s / tenant 64 / principal 16 / 并发 4；unavailable → 503  |
| Redaction | administrator / user / system_local                                                            |
| Gates     | 两 flag 为 false；live pack 未注册；无 HTTP/RPC/UI 真实入口；无主链/Skill/Doctor/Channel 写入  |

`dependenciesRequireExplicitInjectionAndApproval=true`：report / audit / quota backend 不得从代码或环境变量隐式接通。

---

## 2. 合并前安全门禁

`evaluateDiagnosisProductionApproval()` / `isDiagnosisProductionApprovalReady()` 要求：

- deploy flag 与 adapter gate 均为 false
- `GATEWAY_METHOD_PACKS` / manifest 无 `diagnosis-reports`
- `coreGatewayHandlers` 无 `diagnosis.reports.query` / `get`
- P3.9 rehearsal predicate 通过
- P3.7 release candidate `livePackRegistration=false`

静态扫描禁止：`appendSkillInvocationEvent`、Doctor `--fix`、Channel restart、真实 URL、`process.env` 生产连接。

归属：`scripts/agent-attribution.ts` 对诊断脏文件不得出现 UNATTRIBUTED / CONFLICT。本任务不提交 `.loom/registry.yaml`。

---

## 3. 下一步必须人工批准

以下任一项都不是 P3.10 的范围，必须另批：

1. 真实 backend 配置
2. live gateway pack 注册
3. 生产构建
4. 重启
5. 灰度与流量切换

回滚：保持 flag=false；禁止注册 live pack；禁止发布、重启、切流量、自动修复。

---

## 4. 未做

- 未翻转部署开关或 adapter gate
- 未注册 live pack / 未写入 `coreGatewayHandlers`
- 未注入生产 backend
- 未生产构建、发布、重启、灰度或切流量
