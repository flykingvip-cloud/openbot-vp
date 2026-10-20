# OpenBot Diagnosis Platform — P10 只读诊断可视化

Date: 2026-09-03

Status: **平台端与企业端只读可视化投影已落地。不接生产写入、真实聊天、自动修复或生产部署。P10 ≠ Phase complete ≠ Diagnosis Platform 完成。**

Audience: Platform Architecture、Security、QA、Enterprise Admin

Task: `openbot-diagnosis-platform`

Related:

- [P6 对话诊断状态机](/design/openbot-diagnosis-p6-conversation-state-machine-2026-09-03)
- [P7 分级授权与会诊](/design/openbot-diagnosis-p7-graded-delegation-2026-09-03)
- [P8 受治理进化提案](/design/openbot-diagnosis-p8-evolution-proposal-2026-09-03)
- [P9 治理修复预览](/design/openbot-diagnosis-p9-remediation-preview-2026-09-03)

硬门禁：UI 只能消费既有 Diagnosis API / in-process projection。禁止第二套 Signal / Case / Finding / 健康 / 审计事实源。禁止显示 Evidence payload、消息正文、Prompt、Tool output 或敏感 session。平台管理员不得绕过企业授权查看员工原始 Evidence。企业管理员不得查看未授权员工的原始 Session。

---

## 1. 投影对象

`DiagnosisTimelineProjection`、`DiagnosisTrendProjection`、`DiagnosisGraphProjection`、`DiagnosisAuthorizationProjection`、`DiagnosisRemediationProjection` 都携带：

- `tenantScope`
- `redactionProfile`
- `permissionState`

入口：`projectDiagnosisVisualization(audience, catalog)`。catalog 是既有对象的引用投影，不是新的权威库。

---

## 2. 权限矩阵

| 角色       | 可信租户        | 可见范围                            |
| ---------- | --------------- | ----------------------------------- |
| platform   | `tenantId=null` | 跨企业脱敏摘要；无员工原始 Evidence |
| enterprise | 本企业          | 本企业 + 已授权员工                 |
| employee   | 本企业          | 仅本人 principal                    |

`sessionTenantId` / `claimedTenantId` 不是权威。tenant / principal / role / scope mismatch 一律 fail-closed。前端不得自行放宽角色后扩大数据范围。

授权状态 `EXPIRED` / `REVOKED` / `SUSPENDED` / `CONSUMED` / `DENIED` 立即从授权、会诊、提案、Remediation 视图隐藏。

---

## 3. 时间线、趋势与图

时间线按 timestamp 稳定排序，可追溯：

`Signal → EvidenceRef → Finding → Case → Mission → Grant → Proposal → Remediation → Verification`

趋势图声明时间窗口、采样范围和完整性。缺失桶保持 `present=false`，不得渲染为健康或已解决。

Graph 只保留权限允许的节点和关系。平台视图默认不展开员工 Evidence 节点。

空数据、过期数据、权限不足、加载失败、INCONCLUSIVE 必须显式展示。

---

## 4. 大白对话入口

从 Signal / Case 打开诊断会话时，只发送：

- `signalId`
- `caseId`
- `targetRef`

不发送 Evidence payload。授权请求展示目标、数据范围、动作、有效期和风险。批准/拒绝后只刷新既有 P6/P7 状态（`refresh: "p6_p7"`）。不直接调用真实聊天、RPC、Doctor、Channel 或 remediation executor。

报告导出入口只调用既有 `exportCompositeDiagnosisReportJson`。

---

## 5. 未做

- 未接生产 API、live pack、HTTP / RPC
- 未接真实聊天或消息主链写入
- 未执行自动修复、Doctor `--fix`、Channel restart
- 未执行生产构建、发布、重启、灰度或流量切换
- P5 大白投送合同仍未签收
