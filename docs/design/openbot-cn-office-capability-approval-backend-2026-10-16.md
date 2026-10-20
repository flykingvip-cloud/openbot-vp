# cn-office 完整审批后端设计

> **状态**：设计稿（本文件不实现生产后端）  
> **日期**：2026-10-16  
> **范围**：大白岗位能力预装 Stage A/B（已合入）+ Stage C（PR #752，扫描并跳转 EDC）之后，补齐「员工申请 → 企业审批 → 显式开通」闭环  
> **原则**：禁止静默 grant；批准动作本身必须是管理员（或策略指定审批人）的显式决策；开通只能走现有 Save / grant / authorize 积木

## 0. 与既有文档的关系（增量，非替代）

| 既有文档 | 关系 |
| -------- | ---- |
| `docs/design/approval-workflow-model.md` | **不同层**：那是企业数据动作 *invoke 前* 的 `NONE/ONCE/PER_REQUEST` 运行时审批。本文是 *能力开通前* 的申请单 / cn-office 策略审批。可共享审计字段习惯，**不合并状态机**。 |
| `docs/design/openbot-capability-installation-governance-*-2026-05-28.md` | **相关**：能力安装治理、大白代理安装。本文不替代安装到机器人的路径；对 `enterprise_review_required`（cn-office pack）给出与申请单对接的缺口。 |
| `docs/design/enterprise-operational-identity-three-stage-authz-2026-09-24.md` | **复用**：企业 OI 的策略 / enrollment / 运行时裁决。本文只设计「申请开通」单据，批准后仍走现有 `employee.authorize` / 管理员策略 upsert，不改三阶段模型。 |
| `docs/design/skill-inventory-starter-packs-2026-07-14.md` | **对齐**：`cn-office` pack = `enterprise_review_required`。本文把「岗位审核后开放」落到可执行的审批后端。 |

**本文件是增量设计**：不覆盖上述文档；实现时应交叉引用，避免再发明第三套「审批」名词而不标明层次。

---

## 1. 问题陈述

### 1.1 现状（以仓库代码为准，2026-10-16）

1. **Stage A**：创建大白时按岗位模板预装技能（不自动授权连接）。  
2. **Stage B**：创建成功页列出 oauth / KB / MCP / OI / seat 缺口，CTA 只跳现有显式流程。  
3. **Stage C（PR #752）**：成功页可只读调用 `enterprise-data.mcp-discovery`，按角色过滤后 CTA `mcp_scan_apply` **deeplink 到 EDC**；文案写明「cn-office 企业审核策略未在本阶段实现」。  
4. **硬约束已落地**：`mcp-mapping.upsert` 注释与实现均声明「Does not create Grant」；发现层「Nothing here installs, registers, or grants」。

### 1.2 为何缺审批后端会阻塞企业侧闭环

员工侧能「看见缺口 / 扫到 MCP」，但：

- **不能**正式提交「请企业帮我映射并授权该 MCP」的租户内申请单；
- 管理员只能在 EDC 里「碰运气」看到 deeplink 预填，或自己去发现面板找行；
- **cn-office** pack 技能虽标记 `enterprise_review_required`，员工安装路径有 `requiresApproval` 文案，却**没有**与大白 Stage C 统一的「能力开通申请」队列；
- OI / seat 缺口 CTA 指向现有页，但企业侧缺少可审计的「谁申请、谁批、批了什么」主单据（与 invoke 审批、诊断审批不是同一对象）。

结果：企业治理要求「先审后开」时，产品只能停在文案与人工口头同步，**无法验收**「申请 → 审批 → 显式开通」闭环。

### 1.3 与「不自动 grant」的关系

| 行为 | 是否允许 |
| ---- | -------- |
| Stage C 扫描后直接 `mcp-mapping.upsert` / `grants.upsert` | **禁止** |
| 员工创建申请单 | 允许 |
| 管理员在审批台点击「拒绝 / 撤回」 | 允许 |
| 管理员点击「批准」且选择「仅批准意图」（进入待开通队列） | 允许（推荐 MVP） |
| 管理员点击「批准并开通」，在 **decide 同一请求** 内调用现有 Save/grant（权限=该管理员） | 允许（与现有 `governance-approvals.decide` → `grantDataCapabilityToSeat` 同型；**不是**静默 grant） |
| 定时任务 / 扫描回调在无人点击时自行 upsert | **禁止** |

「显式」= 带租户管理员（或策略审批人）身份的写路径被人工触发；不是「系统在后台替你开」。

---

## 2. 角色与权限

### 2.1 角色

| 角色 | 标识（逻辑） | 职责 |
| ---- | ------------ | ---- |
| 申请人 | 已登录员工；常为大白创建者 / 席位绑定员工 | 起草、提交、撤回自己的申请；查看本人申请状态 |
| 审批人 | `enterprise-admin`（MVP）；后续可扩展部门负责人 | 审阅队列、批准/拒绝、选择开通模式 |
| 开通执行人 | 默认同审批人；也可拆成「批完由数据管理员 Save」 | 执行 `mcp-mapping.upsert` / grant / OI 策略或 enrollment |
| 审计读者 | enterprise-admin / 合规角色（后续） | 只读审计事件与申请快照 |

### 2.2 Tenant 边界

- 所有申请单、策略、审计事件必须带 `tenantId`；列表/决定必须 `request.tenantId === session.tenantId`。  
- 禁止跨租户 subject（MCP server 名、identityId、pack skillKey）串用。  
- 服务端从 session 解析 `employeeId` / `seatId`，**不信任**客户端传入的身份字段（与 `enterprise-data` M1 审批一致）。

### 2.3 现状缺口（权限）

今日 `enterprise-data.governance-approvals.create` / `mcp-discovery` / `mcp-mapping.upsert` 均走 **`requireResolvedEnterpriseAdminTenantId`**。  
→ 员工无法建治理申请单；Stage C 若以员工会话调 discovery，需另开「员工只读投影」或代理 RPC（见 §6、§11）。

---

## 3. 申请对象类型

与 Stage B `DaibaiGapKind` / CTA 对齐，MVP 优先前两类。

| `subjectKind`（建议） | 对应缺口 | 申请意图 | 批准后显式开通积木 |
| --------------------- | -------- | -------- | ------------------ |
| `mcp_tool_mapping` | `mcp` / `mcp_scan_apply` | 将 `mcpServer`+`mcpTool` 映射为 DataCapability，并（可选）申请席位授权 | ① `enterprise-data.mcp-mapping.upsert` ② 可选 `enterprise-data.grants.upsert` 或既有 `seat_capability_access` 治理效果 |
| `operational_identity` | `apply_personal_oi` / `apply_enterprise_oi` | 个人 OI grant 或企业 OI enrollment / 策略放行 | 个人：现有 user OI grant 流；企业：`IdentityUsagePolicy` 管理员路径 + `enterprise-operational-identity.employee.authorize` |
| `pack_skill_review` | cn-office `enterprise_review_required` 技能 | 允许该员工/机器人安装某 pack 技能 | 对接 capability governance / employee-install 已有「需企业审核」标记（非静默装齐） |
| `oauth_connection` | `oauth_authorize` | 记录「需完成某连接授权」 | **通常不经企业代批**；申请单仅作跟踪，开通仍是员工本人 oauth |
| `knowledge_binding` | `bind_knowledge` | 绑定企业知识投影 | 可复用已有 category `enterprise_knowledge_access` |
| `seat_entitlement` | `contact_admin_seat` | 席位/权益核对 | 只读检测缺口大；MVP 仅工单+通知，不自动改 entitlement |

**可扩展**：未来把 `GovernanceApprovalCategory` 增补 `mcp_tool_mapping`、`oi_enrollment`、`pack_skill_review`，或在新 store 中用统一 `CapabilityAccessRequest` 再投影到治理中心 UI。

---

## 4. 状态机

### 4.1 申请单状态（产品语义）

```text
draft ──submit──► submitted ──claim/open──► in_review
  │                  │                        │
  │                  │ cancel                   ├─approve──► approved
  │                  │                          ├─reject───► rejected
  └─discard──────────┴─cancel───────────────────┘
                                                 │
                                      approved ──┼─（可选）fulfill──► fulfilled
                                                 └─expire/revoke──► cancelled / revoked
```

| 状态 | 含义 | 谁可转入 |
| ---- | ---- | -------- |
| `draft` | 本地/服务端草稿，未进入队列 | 申请人 |
| `submitted` | 已提交，等待认领 | 申请人 submit |
| `in_review` | 审批人已打开/认领 | 审批人 |
| `approved` | 审批通过；**尚未**或**已经**开通取决于 `fulfillmentMode` | 审批人 decide |
| `rejected` | 拒绝（终态，可带 note） | 审批人 |
| `cancelled` | 申请人撤回或管理员作废 | 申请人（仅 submitted/in_review）/ 审批人 |
| `fulfilled` | 开通积木已成功执行并记账（可选子状态或并行字段） | 开通执行路径 |

实现上可用字段拆分：

- `status`: draft | submitted | in_review | approved | rejected | cancelled  
- `fulfillmentStatus`: `not_required` | `pending_admin_save` | `fulfilled` | `failed`  
- `fulfillmentMode`（决定时写入）: `approve_intent_only` | `approve_and_provision`

### 4.2 与现有 `GovernanceApprovalStatus` 的映射

现有：`pending | approved | rejected | cancelled`（无 draft/in_review/fulfilled）。

| 本文 | 映射建议 |
| ---- | -------- |
| draft | **新**；或仅客户端草稿不入库 |
| submitted / in_review | 均落为现有 `pending`，用 `reviewState` 扩展字段区分 |
| approved / rejected / cancelled | 直接复用 |
| fulfilled | **新字段** `fulfillmentStatus`，不塞进 status 以免破坏治理中心筛选 |

### 4.3 批准后如何显式开通（禁止静默）

**模式 A — MVP 推荐：`approve_intent_only`**

1. decide → `status=approved`，`fulfillmentStatus=pending_admin_save`。  
2. 审批台展示「去 EDC 开通」按钮：deeplink 带 `mcpServer`/`mcpTool`/`capabilityId`/`requestId`（复用 `mcp-discovery-deeplink`）。  
3. 管理员在 EDC **显式 Save** → `mcp-mapping.upsert`；若需席位权再显式 grant 或另开 `seat_capability_access`。  
4. Save 成功回调（或管理员点「标记已开通」）→ `fulfillmentStatus=fulfilled`，写入审计。

**模式 B — 完整态：`approve_and_provision`**

1. 审批人勾选「批准并开通」并确认风险摘要。  
2. **同一** `decide` RPC（管理员 session）内顺序调用：  
   - MCP：`upsertMcpToolMapping` →（可选）`grantDataCapabilityToSeat` / `grants.upsert`  
   - OI：仅调用**现有** authorize / policy upsert，不新写旁路凭证  
3. 任一步失败 → 申请保持 `approved` + `fulfillmentStatus=failed`，**不**假装已开通；允许重试开通而不改审批结论。

模式 B 与今日 `decideGovernanceApprovalRequest` 对 `seat_capability_access` 的 effect 一致：**批准点击 = 开通权威**，仍非静默。

### 4.4 拒绝与撤回

- **拒绝**：`rejected` + `decisionNote`；申请人可见；可基于同 subject 再提新单（受幂等规则约束，见 §6）。  
- **撤回**：仅 `submitted`/`in_review`；`cancelled`；已 `approved` 不可申请人单方撤回，需管理员 `revoked`（后续）并处理已 fulfillment 的回滚策略（MVP：不自动 revoke grant，只工单标记）。

---

## 5. 与现有积木的衔接

### 5.1 MCP 发现与映射

| 积木 | 路径 | 衔接方式 |
| ---- | ---- | -------- |
| 只读发现 | `src/gateway/enterprise-data/mcp-discovery.ts` · RPC `enterprise-data.mcp-discovery` | Stage C 继续只读；申请单 payload 引用 discovery 行的 `serverName`/`toolName`/`status` 快照 |
| 显式映射 | `mcp-mapping.ts` · `enterprise-data.mcp-mapping.upsert` | **唯一**写映射入口；审批开通必须调用它，禁止平行实现 |
| Deeplink | `ui/.../mcp-discovery-deeplink.ts` | 申请详情 / 待开通队列复用 `appendMcpDiscoveryContext` |
| EDC UI | `mcp-discovery-panel.ts`、数据治理中心 surface | 审批台可嵌「待开通」列表或深链进现有面板 |
| Grant | `enterprise-data.grants.upsert` / `grantDataCapabilityToSeat` | 映射 ≠ 授权；`mapped_pending_grant` 需第二步或 `seat_capability_access` |

### 5.2 治理审批中心（优先复用）

| 积木 | 说明 |
| ---- | ---- |
| Store | `governance-approval-store.ts`：create / decide / list / overview；decide 可 `applyGovernanceApprovalEffect` |
| RPC | `enterprise-data.governance-approvals.{list,get,create,decide,overview}`（`enterprise-data-m5.ts`） |
| UI | `enterprise-data-governance-center-surface.ts` + gateway-client |
| 已有 category | `source_onboarding` / `data_access` / `capability_exposure` / `identity_binding` / `seat_capability_access` / `enterprise_knowledge_access` |

**缺口**：无 MCP 映射申请 category；create 仅管理员；无 draft；无 fulfillment 字段；`identity_binding` 的 approve effect 为空（跨库注释已说明）。

### 5.3 运行时动作审批（勿混用）

`approval-workflow.ts` + `enterprise-data.approval.requests.*`：针对 **已有 Grant** 上的高风险 invoke。  
**不要**用它承载「还没有 mapping/grant」的开通申请。

### 5.4 OI

| 层 | 积木 |
| -- | ---- |
| 企业策略 / enrollment | `enterprise-operational-identity*.ts`、`EnterpriseSeatAssetsStore` |
| 员工 RPC | `enterprise-operational-identity.employee.authorize` / `revoke` / `enrollments` |
| 个人 OI | `user-operational-identity*`（含 `grantMode: auto\|explicit`） |
| 设计对照 | `enterprise-operational-identity-three-stage-authz-2026-09-24.md` |

申请单批准后：企业侧优先「管理员确认策略已覆盖席位」+ 员工本人 `authorize`；**禁止**审批后端直接写凭证。

### 5.5 cn-office pack / 安装治理

| 积木 | 说明 |
| ---- | ---- |
| Pack 定义 | `capability-packs/starter-packs.ts` → `PACK_CN_OFFICE`，`employeeVisibilityMode: "enterprise_review_required"` |
| 租户 entitle | `tenant-pack-entitlements`；trial/business 自动 entitle starter+cn-office（**entitle ≠ 员工可用**） |
| 安装 | `employee-install.ts` 对 `enterprise_review_required` 打 `requiresApproval` /「需要企业审核」 |
| 代理安装 stub | `agent-install-request.ts`（跨机器人安装，非企业审批主路径） |
| 技能企业审核 | `enterprise-capability.review` / proposal 流（资产发布向，与 MCP 开通不同） |

### 5.6 Seat / entitlement

- Stage B：`contact_admin_seat`，文案承认「暂无法自动检测」。  
- 只读点：`package-entitlement`、`tenant-pack-entitlements`、席位资产 store。  
- MVP：申请类型可建，开通 = 人工核对 + 审计；不自动改套餐。

---

## 6. API 草图

### 6.1 策略：扩展治理审批 vs 新 RPC 前缀

**推荐**：在 `enterprise-data.governance-approvals.*` 上**增量**扩展（复用中心 UI），另增员工可调用的 create/list-mine；长期若负载过大再拆 `enterprise-capability-access.*`。

### 6.2 新建 / 扩展方法

| 方法 | 新建/复用 | 调用方 | 说明 |
| ---- | --------- | ------ | ---- |
| `enterprise-data.governance-approvals.create` | **改** | 今日仅 admin → 改为员工可 create 限定 category | 服务端写 `requestedBy`/`requesterSeatId` |
| `enterprise-data.governance-approvals.decide` | **扩** | admin | 增加 `fulfillmentMode`；MCP/OI 新 category 的 effect 或 pending_save |
| `enterprise-data.governance-approvals.list` | 复用 | admin / 本人 | 非 admin 强制 `requestedBy=self` |
| `enterprise-data.governance-approvals.overview` | 复用 | admin | pendingByCategory 纳入新 category |
| `enterprise-data.capability-access.requests.create` | 可选新建别名 | 员工 / 大白 UI | 薄封装，内部仍写入 governance store，便于 Stage C 不直接依赖「治理」命名 |
| `enterprise-data.capability-access.requests.cancel` | 新建 | 申请人 | submitted/in_review → cancelled |
| `enterprise-data.capability-access.requests.fulfill` | 新建 | admin | `approve_intent_only` 后，在 Save 成功后标记 fulfilled（或由 mapping.upsert 钩子带 `requestId`） |
| `enterprise-data.mcp-discovery` | **扩** | 今日仅 admin | 增加员工只读：仅返回与本租户相关且按角色 hint 过滤的投影（或独立 `mcp-discovery.for-seat`） |

### 6.3 请求 / 响应字段（建议）

```ts
// create（员工）
type CapabilityAccessCreateParams = {
  category: "mcp_tool_mapping" | "oi_enrollment" | "pack_skill_review" | /* 现有 */ ...;
  // MCP
  mcpServer?: string;
  mcpTool?: string;
  discoveryStatusSnapshot?: "unmapped" | "mapped_pending_grant" | "authorized";
  // OI
  identityScope?: "personal" | "enterprise";
  identityId?: string;
  targetAgentId?: string;
  // Pack skill
  packId?: "cn-office" | string;
  skillKey?: string;
  targetRobotId?: string;
  // 通用
  reason?: string;
  catalogId?: string;      // 大白成员
  templateId?: string;     // 岗位模板
  clientRequestId?: string; // 幂等键
};

type CapabilityAccessRequest = {
  approvalId: string;
  tenantId: string;
  category: string;
  subjectId: string;       // 规范化：mcp:<server>/<tool> | oi:... | pack:...
  subjectPayload: Record<string, unknown>; // 冻结快照，供审计
  displayName: string;
  status: "draft" | "submitted" | "in_review" | "approved" | "rejected" | "cancelled";
  fulfillmentStatus: "not_required" | "pending_admin_save" | "fulfilled" | "failed";
  fulfillmentMode?: "approve_intent_only" | "approve_and_provision";
  requestedBy: string;
  requesterSeatId?: string;
  requestedAt: string;
  reason?: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
  fulfilledAt?: string;
  fulfilledBy?: string;
  provisionReceipt?: {     // 开通回执
    handlerRef?: string;
    capabilityId?: string;
    grantId?: string;
    enrollmentId?: string;
  };
  auditIdempotencyKey: string;
};
```

### 6.4 幂等与审计

- **幂等**：同一 `tenantId + category + subjectId + requestedBy` 在 `pending`（submitted/in_review）时拒绝重复 create（已有 `GOVERNANCE_APPROVAL_DUPLICATE`）；或返回已有单。`clientRequestId` 在短窗内重复提交返回同一 `approvalId`。  
- **审计事件**（建议写入 enterprise-data event bus / seat assets audit）：  
  `capability_access.submitted | review_opened | approved | rejected | cancelled | fulfill_started | fulfill_succeeded | fulfill_failed`  
  字段：tenantId、approvalId、actorId、subject 快照 digest、fulfillmentMode、provisionReceipt、timestamp。  
- **禁止**把密钥、oauth token 写入申请单或审计正文。

### 6.5 SubjectId 规范化（示例）

- MCP：`mcp:${encodeURIComponent(server)}/${encodeURIComponent(tool)}`  
- 企业 OI：`oi:enterprise:${identityId}:agent:${agentId}`  
- 个人 OI：`oi:personal:${providerOrIdentityKey}:agent:${agentId}`  
- Pack skill：`pack:${packId}:skill:${skillKey}:robot:${robotId}`

---

## 7. 审计与合规

1. **谁在何时批准了什么**：`decidedBy` + `decidedAt` + `subjectPayload` 快照 + `decisionNote`。  
2. **开通是否发生**：`fulfillmentStatus` + `provisionReceipt`；模式 A 下「已批准未开通」必须可筛。  
3. **cn-office 策略挂钩**：  
   - 租户 entitle 了 `cn-office` 不等于员工可装；  
   - `pack_skill_review` 通过后，安装路径才清除 / 满足 `requiresApproval`；  
   - 策略包可配置：哪些 category 允许 `approve_and_provision`，哪些强制 `approve_intent_only`（高风险 MCP 默认 intent_only）。  
4. **保留期**：申请单与审计事件跟随企业数据治理保留策略（具体天数实现阶段定）；rejected/cancelled 仍保留。  
5. **与 invoke 审批并列**：开通审计 ≠ 调用审计；两者用不同 event type，必要时用 `capabilityId`/`grantId` 关联。

---

## 8. 与大白 Stage C UI 的对接

### 8.1 当前行为（PR #752）

- CTA `mcp_scan_apply` → 拼 EDC deeplink（`edc=capabilities|authorization` + mcpServer/mcpTool）。  
- `scanAdminNote`：映射与席位授权需管理员；cn-office 策略未实现。

### 8.2 目标行为

1. 员工点「扫描并申请」或候选行 CTA：  
   - **先** `capability-access.requests.create`（category=`mcp_tool_mapping`，带 discovery 快照与 catalogId/templateId）；  
   - 成功后 UI 显示「已提交申请 #…」；  
   - **次要**仍可提供「打开 EDC（管理员）」深链，但不作为唯一路径。  
2. OI CTA `apply_*_oi`：同样 create（`oi_enrollment`），再跳转现有授权页完成**本人**步骤；企业策略放行走审批队列。  
3. 成功页增加「我的申请」摘要：submitted / in_review / approved(pending_save) / fulfilled。  
4. **绝不**在 CTA handler 里调 `mcp-mapping.upsert` / `grants.upsert` / OI authorize（员工会话下也不应有 admin upsert 权限）。

### 8.3 文案演进

- 从「cn-office 企业审核策略未在本阶段实现」→「已提交企业审批；通过后由管理员显式开通（不会自动授权）」。

---

## 9. 非目标

1. 自动 grant / 扫描回调写映射。  
2. 上岗培养主流程改造。  
3. 假装 registry seed / MCP remote tools/list 已齐（discovery `gap` 仍可能 `remote_tools_list_unavailable`）。  
4. 多级审批链、部门负责人角色（首版仅 `enterprise-admin`，与 M1 approval-policy 一致）。  
5. 合并 invoke 审批与开通审批为同一状态机。  
6. 本设计文档阶段实现完整生产后端（可另开实现 PR）。  
7. 自动修改 seat / billing entitlement。

---

## 10. 分期落地建议

### MVP（建议 1～2 个实现 PR）

1. 扩展 category：`mcp_tool_mapping`（+ 可选 `oi_enrollment` 占位）。  
2. 员工可 `create` + `list-mine` + `cancel`；admin `decide` 仅 `approve_intent_only`。  
3. 治理中心列表展示新 category；详情出 EDC deeplink + `requestId`。  
4. `mcp-mapping.upsert` 可选接收 `capabilityAccessRequestId`：Save 成功则 mark fulfilled。  
5. 大白 Stage C：CTA 改「提交申请」（保留管理员深链为次按钮）。  
6. 单测：幂等、租户隔离、员工不能 decide、批准不写 grant。

### 完整 cn-office 策略

1. `pack_skill_review` 与 `employeeVisibilityMode=enterprise_review_required` 打通。  
2. 租户级策略：哪些 MCP/OI/skill 强制审批、默认 fulfillmentMode。  
3. `approve_and_provision`（管理员显式）接入 mapping+grant / OI 策略。  
4. 审计报表与导出。

### 与 Stage C 深度集成

1. 员工只读 `mcp-discovery.for-seat`。  
2. 成功页申请状态轮询 / 推送。  
3. 批准后通知申请人「请完成个人 oauth / OI authorize」清单。  
4. seat 只读检测替代纯文案（仍不自动改权益）。

---

## 11. 开放问题 / 风险

1. **员工 discovery 权限**：Stage C 依赖 `mcp-discovery`，但 RPC 现为 admin-only。是放宽只读、还是网关侧 seat 投影新方法？  
2. **Registry / remote tools seed 不齐**：扫描空态依赖静态 hint；申请单是否允许「无 toolName 仅 server 级」意图？  
3. **Seat 检测**： entitlement 只读 API 是否稳定、是否跨 store？  
4. **多级审批 / 部门负责人**：产品何时需要？与 `approval-workflow-model` 的 P5+ 是否共用角色模型？  
5. **跨租户 / 平台能力**：cn-office 技能来自平台 registry 时，审批是租户内还是平台+租户双门？建议租户内单门。  
6. **已 mapped_pending_grant**：申请单是只走 grant，还是仍建 mapping 类单据？建议 category 仍 `mcp_tool_mapping` 但 `subjectPayload.desiredEffect=grant_only`。  
7. **OI identity_binding**：现有 governance effect 为空；企业 OI 申请应写 SeatAssets 还是继续人工？完整态必须定义 effect 或强制 intent_only。  
8. **与 agent-install-request stub**：避免两套「大白代理安装」队列；能力开通申请 ≠ 跨机器人安装请求。  
9. **PR #752 未合入 main 时的集成顺序**：先合 Stage C 再接申请单，或申请单 API 先行、UI 随后。  
10. **撤销已开通**：MVP 不做自动 revoke；需产品定义误批回收流程。

---

## 12. 实现锚点清单（便于开工）

```
src/gateway/enterprise-data/mcp-discovery.ts
src/gateway/enterprise-data/mcp-mapping.ts
src/gateway/enterprise-data/governance-approval-store.ts
src/gateway/enterprise-data/approval-workflow.ts          # 勿混用
src/gateway/enterprise-data/types.ts                     # GovernanceApprovalCategory
src/gateway/server-methods/enterprise-data.ts            # mcp-discovery / mapping / grants
src/gateway/server-methods/enterprise-data-m1.ts         # invoke 审批 RPC
src/gateway/server-methods/enterprise-data-m5.ts         # governance-approvals RPC
src/gateway/capability-packs/starter-packs.ts            # cn-office
src/gateway/server-methods/employee-install.ts           # requiresApproval
src/gateway/server-methods/agent-install-request.ts      # 安装 stub，非主路径
ui/.../mcp-discovery-deeplink.ts
ui/.../enterprise-data-governance-center-surface.ts
ui/.../daibai-capability-gaps.ts                         # Stage B CTAs
ui/.../daibai-mcp-scan.ts                                # Stage C（PR #752）
```

---

## 13. 验收口径（设计层）

实现后应能演示：

1. 员工从大白成功页提交 MCP 申请 → 管理员在治理中心看见 pending。  
2. 管理员拒绝 → 员工看见 rejected，EDC 无新 mapping。  
3. 管理员 `approve_intent_only` → 无新 grant；经 deeplink Save 后 mapping 出现且申请 fulfilled。  
4. 管理员 `approve_and_provision`（若已实现）→ 仅在 decide 成功响应后出现 capability；审计含 decidedBy 与 provisionReceipt。  
5. 全程无 Stage C 自动 upsert/grant。

---

*文档结束。*
