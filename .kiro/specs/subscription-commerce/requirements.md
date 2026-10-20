# Requirements Document

> 中文名：套餐订阅商业闭环（Subscription Commerce）— 企业订购 × 平台收款 × 开票

## Introduction

本规格在既有 **cost-budget-billing**（计费内核）之上，补齐 **真实商业闭环**：

```
企业选套餐 → 下单 → 支付/核销 → 订阅生效 → 周期账单 → 申请发票
                ↑
        平台端：订单/收款/开票/租户 billingStatus 管理
```

**被替换的现状（Current State）：**

- 企业端 `subscriptions.subscribe` 为 **点击即生效**，无支付闸、无订单记录（`src/gateway/server-methods/subscriptions.ts`）。
- `Bill` 为内部成本结算账单，**不是**对客税务发票；代码库无 `Invoice` / `Payment` / `Order` 实体。
- 卓越版仅有 `sales-leads.submit` 线索落库，平台无法从线索一键转订单。
- Credits 仅随套餐周期由 `ensureTenantCreditsAllocation` 分配，无企业自助充值。
- 平台租户目录有 `billingStatus` / 生命周期展示（`ui/src/ui/ports/platform/tenants/`），但无订单/收款/开票操作面。

**依赖（Must Reuse，不得重复造轮子）：**

- 套餐/定价/版本：`cost-budget-billing`（`plans-store`、`platform-plans.*`）。
- 订阅生命周期与 entitlement 开通：`subscriptions-store`、`provisionEnterpriseSubscription`。
- 内部账单与结算：`billing.*`、`Bill` / `settleCycle`。
- 销售线索：`sales-leads.*`（Enterprise 档入口保留）。

**非目标（Out of Scope — 本期不做）：**

- 多币种跨境税务引擎、自动 VAT 计算。
- 与外部 ERP（金蝶/用友/SAP）双向同步。
- 复杂合同条款引擎（阶梯价、自定义 SLA 合同文本）。
- 退款争议自动化（仅记录状态 + 平台手工处理）。
- 替换 cost-budget-billing 的计费内核或 Bill 语义。

**默认产品决策（本规格基线，可在 design 中 override 并记录 ADR）：**

| 决策         | 默认                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| P1 支付      | 对公转账 + **平台手工核销**（`manual` provider），不接第三方支付 SDK        |
| P3 支付      | 首个在线渠道：**Stripe**（国际）或 **支付宝**（国内）二选一，由实现任务配置 |
| Trial        | ¥0 订单自动激活，不占支付闸                                                 |
| 升级差价     | 立即升级按剩余周期 **Proration** 收差价                                     |
| 降级         | 仅 `effective=next`，**不退款**，差额不抵扣                                 |
| Credits 充值 | 需 **active 订阅** 方可充值                                                 |
| 发票         | 申请制 + 平台审核开具；不对接第三方开票平台（v1）                           |

## Glossary

- **Commercial_Order（商业订单）**：一次可收款的购买行为（订阅/换套餐/续费/充值），与内部 `Bill` 分离。
- **Payment（支付记录）**：订单对应的收款尝试/结果（在线 webhook 或线下核销）。
- **Tenant_Billing_Profile（租户开票资料）**：企业法定抬头、税号、发票类型等。
- **Invoice_Request（发票申请）**：企业对已支付订单或已结算 Bill 发起的开票请求。
- **Billing_Layer**：既有 cost-budget-billing（Subscription / Usage / Bill）。
- **Commercial_Layer**：本规格新建层（Order / Payment / Invoice）。
- **Platform_Admin**：平台控制台操作主体。
- **Enterprise_Admin**：企业端成本与预算 / 订阅操作主体。

## Requirements

### Requirement 1: 商业订单（Commercial Order）

**User Story:** 作为企业管理员，我希望订阅/换套餐/续费/充值时生成明确订单与应付金额，以便完成付款并留痕。

#### Acceptance Criteria

1. WHEN Enterprise_Admin 发起 **新订阅** 并指定有效 `planId`（或 `planVersionId`）与 `billingCycle`, THE Commercial_Service SHALL 创建 `Commercial_Order`，`kind=subscribe`，`status=pending_payment`，并计算 `amountCents`（含周期折扣，R1.2）。
2. WHEN Enterprise_Admin 发起 **立即换套餐**（`effective=now`）, THE Commercial_Service SHALL 创建 `kind=change_plan` 订单，金额为新旧套餐剩余周期 **Proration 差价**（R1.3）。
3. WHEN Enterprise_Admin 发起 **续费**, THE Commercial_Service SHALL 创建 `kind=renew` 订单，金额为下一周期订阅费（R1.4）。
4. WHEN Enterprise_Admin 发起 **Credits 充值** 并指定有效 `creditPackId`, THE Commercial_Service SHALL 创建 `kind=recharge_credits` 订单（R1.5）；IF 企业无 active 订阅 THEN SHALL 拒绝。
5. IF 订单关联的 plan / pack 不存在或不可用, THEN THE Commercial_Service SHALL 拒绝并返回描述性错误。
6. THE Commercial_Service SHALL 以 append-only 方式记录订单状态变更历史（`OrderEvent`）。
7. THE Commercial_Service SHALL 以 **`PlanVersion.snapshot.basePriceCents`** 为报价真源；Plan 头改价不得影响已创建订单或已锁定订阅的 Proration（R1.8）。
8. WHERE `PlanVersion.snapshot.commercial.purchaseMode=trial_auto`, THE Commercial_Service SHALL 创建 `amountCents=0` 订单并 **自动标记 paid**，跳过支付闸（R1.6）；**不得**仅凭 `basePriceCents=0` 推断 Trial。
9. WHERE `snapshot.commercial.purchaseMode=contact_sales`（Enterprise / 面议）, THE Commercial_Service SHALL 拒绝自助下单，引导 `sales-leads.submit`（R1.7）；**不得**仅凭套餐名称别名推断。
10. WHEN 订单 paid 且 `billingCycle` 为 `semiannual` 或 `annual`, THE Subscription_Service SHALL 写入 `commercialContract`（合同起止窗），供续费与 Proration 使用（R1.9）；`monthly` 可退化为自然月窗口并显式标记。

### Requirement 2: 支付与核销（Payment）

**User Story:** 作为企业/平台，我需要完成或确认收款，以便订阅与资源开通。

#### Acceptance Criteria

1. WHEN 订单处于 `pending_payment`, THE Payment_Service SHALL 支持创建 `Payment` 记录，初始 `status=pending`（R2.1）。
2. WHEN 支付成功（在线 webhook 或平台 `manual` 核销）, THE Payment_Service SHALL 将 Payment 置为 `paid`，订单置为 `paid`，并 **幂等** 触发下游激活（R2.2）。
3. IF 同一 `providerRef` 或 `requestId` 重复回调, THEN THE Payment_Service SHALL 短路返回首次结果，不重复激活（R2.3）。
4. WHEN 订单 `paid`, THE Commercial_Service SHALL 调用既有 `provisionEnterpriseSubscription` 或等价订阅状态迁移，且 **仅此时** 将 Subscription 置为 `active`（R2.4）。
5. WHERE 支付方式为 `bank_transfer`, THE 企业端 SHALL 展示对公账户信息与订单号；平台端 SHALL 提供「确认收款」操作（R2.5）。
6. IF 支付失败或超时（可配置 TTL）, THEN 订单 MAY 置为 `failed` / `canceled`；对应 `pending` 订阅 SHALL NOT 变为 active（R2.6）。
7. THE Payment_Service SHALL NOT 在 Commercial_Layer 内重新实现 Usage/Seat 计费逻辑；收款金额来自 Order 快照（R2.7）。

### Requirement 3: 订阅与订单联动（改造既有 Subscription）

**User Story:** 作为系统，订阅生效必须与真实收款绑定，避免「未付款已开通」。

#### Acceptance Criteria

1. THE Subscription_Service SHALL 扩展状态：`pending_payment` | `active` | `suspended` | `expired` | `canceled`（R3.1）。
2. WHEN 企业通过 **旧路径** `subscriptions.subscribe` 直接调用（兼容期）, THE Gateway SHALL 默认走 **Commercial 下单流程** 而非直接 active；仅 `platform` 内部或 `legacyBypass` 配置允许直开（R3.2）。
3. WHEN 订单 paid 且 `kind=subscribe`, THE Subscription_Service SHALL 创建/激活 Subscription 并锁定 `planVersionId`（复用 R4.1 cost-budget 语义）（R3.3）。
4. WHEN 订单 paid 且 `kind=change_plan`, THE Subscription_Service SHALL 执行等价于 `subscriptions.change-plan effective=now` 的状态迁移（R3.4）。
5. WHEN 订单 paid 且 `kind=renew`, THE Subscription_Service SHALL 延长订阅周期并刷新 Credits 配额（R3.5）。
6. WHEN 订单 paid 且 `kind=recharge_credits`, THE Credits_Service SHALL 追加充值余额（与套餐周期配额分账）（R3.6）。
7. THE Subscription_Service SHALL 发布 `subscription.changed` 域事件，供平台租户 `billingStatus` 投影消费（R3.7）。

### Requirement 4: 租户开票资料（Billing Profile）

**User Story:** 作为企业管理员，我希望维护开票抬头与税号，以便申请发票。

#### Acceptance Criteria

1. WHEN Enterprise_Admin 提交开票资料, THE Commercial_Service SHALL upsert `Tenant_Billing_Profile`（enterpriseId 隔离）（R4.1）。
2. IF 必填字段缺失（法定名称、税号、发票类型）, THEN SHALL 拒绝（R4.2）。
3. THE Commercial_Service SHALL 保留资料变更 append-only 历史（R4.3）。
4. 企业端 SHALL 在首次申请发票前引导完善资料（R4.4）。

### Requirement 5: 发票申请（Invoice Request）

**User Story:** 作为企业管理员，我希望对已支付订单或已结算账单申请发票并跟踪状态。

#### Acceptance Criteria

1. WHEN Enterprise_Admin 对 **paid 订单** 或 **final Bill** 提交发票申请, THE Invoice_Service SHALL 创建 `Invoice_Request`，`status=pending`（R5.1）。
2. IF 该订单/Bill 已存在非 rejected 的申请, THEN SHALL 拒绝重复申请（R5.2）。
3. IF 开票资料不完整, THEN SHALL 拒绝并提示完善（R5.3）。
4. WHEN Platform_Admin 审核通过并登记票号, THE Invoice_Service SHALL 置 `status=issued`，记录 `invoiceNo`、`issuedAt`（R5.4）。
5. WHEN Platform_Admin 拒绝, THE Invoice_Service SHALL 置 `status=rejected` 并记录原因（R5.5）。
6. THE Invoice_Service SHALL 允许上传/关联 PDF URL（或本地存储路径），供企业下载（R5.6）。
7. **Invoice_Request 金额 SHALL 等于关联 Order/Bill 的含税应付/结算金额快照**，后续定价变更不得影响已申请金额（R5.7）。

### Requirement 6: 平台端租户商业管理

**User Story:** 作为平台管理员，我希望在租户维度查看订单、确认收款、处理发票。

#### Acceptance Criteria

1. THE Platform_Console SHALL 提供租户 **商业** 工作区：订单列表、收款状态、发票待办（R6.1）。
2. WHEN Platform_Admin 对线下订单「确认收款」, THE 行为 SHALL 等价于 Payment `manual` paid（R6.2）。
3. WHEN Platform_Admin 从 **销售线索** 创建 Enterprise 订单, THE 系统 SHALL 预填企业与套餐并生成待支付/待核销订单（R6.3）。
4. THE Platform_Console SHALL 将租户 `billingStatus`（trialing / active / past_due / suspended）与 Commercial 状态 **投影同步**（R6.4）。
5. THE Platform_Console SHALL 提供全局订单/发票队列（跨租户），支持筛选与导出（R6.5）。

### Requirement 7: 企业端商业 UI

**User Story:** 作为企业管理员，我希望在成本与预算模块内完成下单、支付、查看订单与申请发票。

#### Acceptance Criteria

1. THE 企业端订阅子页 SHALL 将「选择套餐」改为 **创建订单 → 结账** 流程（Trial 除外）（R7.1）。
2. THE 企业端 SHALL 提供 **订单历史** 子页或 Tab：状态、金额、支付方式、关联订阅（R7.2）。
3. THE 企业端 SHALL 提供 **开票资料** 与 **发票申请/记录** 入口（R7.3）。
4. WHERE 存在 `pending_payment` 订单, THE 订阅子页 SHALL 展示继续支付/对公转账指引（R7.4）。
5. THE 企业端 SHALL 保留卓越版 **联系销售** 路径，不展示自助支付（R7.5）。

### Requirement 8: RPC、权限与租户隔离

#### Acceptance Criteria

1. 所有 Commercial store 函数首参 SHALL 为 `enterpriseId`（企业）或平台全局带 tenant 过滤；禁止无租户全表泄露（R8.1）。
2. 企业写操作（下单、资料、发票申请）SHALL require Enterprise_Admin + WRITE scope（R8.2）。
3. 平台核销/开票/线索转单 SHALL require ADMIN scope（R8.3）。
4. Webhook 入口 SHALL 校验 provider 签名，且仅更新 Payment 状态（R8.4）。

### Requirement 9: 在线支付扩展（Phase 3+）

#### Acceptance Criteria

1. THE Payment_Service SHALL 通过 **provider adapter 缝** 接入 Stripe 或支付宝，不污染 Billing 内核（R9.1）。
2. WHEN provider 返回 checkout session / 二维码, THE 企业端 SHALL 跳转或展示（R9.2）。
3. THE adapter SHALL 支持 sandbox / live 配置分离（R9.3）。

## Properties（测试属性）

- **Property 1（订单金额快照不可变）**：Order 创建后 `amountCents` 与 lineItems 不受 Plan 头后续改价影响；报价依据 `PlanVersion.snapshot`（含 `basePriceCents` / `commercial`）。
- **Property 2（支付幂等）**：同一 payment 成功信号重复 N 次，Subscription 仅激活一次。
- **Property 3（未付不开通）**：无 `paid` Payment 时，Subscription 不得为 `active`（Trial 零元除外）。
- **Property 4（发票金额一致）**：Invoice_Request.amountCents == 关联 Order/Bill 快照金额。
- **Property 5（租户隔离）**：企业 A 无法读取企业 B 的 Order/Payment/Invoice。
