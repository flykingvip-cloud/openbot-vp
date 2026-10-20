/**
 * Subscription Commerce — 商业层类型（订单 / 支付 / 开票）。
 *
 * 设计参见 `.kiro/specs/subscription-commerce/design.md`。
 * 与 billing 层 `Bill` 分离：Bill = 内部成本结算；Invoice = 对客税务文档。
 */

import type { BillingCycle } from "../billing/types.js";

export type CommercialOrderKind = "subscribe" | "change_plan" | "renew" | "recharge_credits";

export type CommercialOrderStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "failed"
  | "canceled"
  | "refunded";

export type CommercialFulfillmentStatus = "none" | "pending" | "done" | "failed";

export type CommercialPaymentMethod = "online" | "bank_transfer" | "manual";

export type CommercialOrderLineItem = {
  label: string;
  amountCents: number;
};

export type CommercialOrder = {
  id: string;
  enterpriseId: string;
  kind: CommercialOrderKind;
  status: CommercialOrderStatus;
  amountCents: number;
  currency: "CNY" | "USD";
  billingCycle?: BillingCycle;
  planId?: string;
  planVersionId?: string;
  /** change_plan：更换前的套餐 id（与 planId 一致，语义更明确）。 */
  fromPlanId?: string;
  targetPlanId?: string;
  targetPlanVersionId?: string;
  creditPackId?: string;
  lineItems: CommercialOrderLineItem[];
  subscriptionId?: string;
  pendingSubscriptionId?: string;
  salesLeadId?: string;
  paymentMethod?: CommercialPaymentMethod;
  expiresAt?: string;
  fulfilledAt?: string;
  fulfillmentStatus?: CommercialFulfillmentStatus;
  fulfillmentError?: string;
  /** 订单创建时锁定的报价版本（审计）。 */
  quotedPlanVersionIds?: string[];
  contractStart?: string;
  contractEnd?: string;
  createdAt: string;
  paidAt?: string;
};

export type CommercialOrderEvent = {
  id: string;
  orderId: string;
  enterpriseId: string;
  fromStatus: CommercialOrderStatus | null;
  toStatus: CommercialOrderStatus;
  occurredAt: string;
  note?: string;
};

export type PaymentProvider = "manual" | "stripe" | "alipay" | "wechat";

export type PaymentStatus = "pending" | "paid" | "failed" | "canceled";

export type Payment = {
  id: string;
  orderId: string;
  enterpriseId: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  amountCents: number;
  providerRef?: string;
  requestId?: string;
  checkoutUrl?: string;
  confirmedByUserId?: string;
  createdAt: string;
  paidAt?: string;
};

export type PaymentEvent = {
  id: string;
  paymentId: string;
  enterpriseId: string;
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus;
  occurredAt: string;
};

export type TenantBillingProfile = {
  enterpriseId: string;
  legalName: string;
  taxId: string;
  invoiceType: "vat_special" | "vat_normal" | "electronic";
  bankAccount?: string;
  address?: string;
  contactEmail?: string;
  updatedAt: string;
};

export type BillingProfileEvent = {
  id: string;
  enterpriseId: string;
  profile: TenantBillingProfile;
  occurredAt: string;
};

export type InvoiceRequestStatus = "pending" | "issued" | "rejected";

/**
 * 发票申请占用明细（Phase 4）。
 * 总余额开票必须写入 allocations，Statement 按 allocation 扣减可开票余额。
 * 每个元素恰好绑定 orderId 或 billId 其一。
 */
export type InvoiceAllocation = {
  orderId?: string;
  billId?: string;
  amountCents: number;
};

export type InvoiceRequest = {
  id: string;
  enterpriseId: string;
  /** 定向申请时可选顶层引用（兼容旧数据）；总余额申请可缺省 */
  orderId?: string;
  billId?: string;
  amountCents: number;
  /**
   * 本申请覆盖的开票占用明细。pending/issued 计入 Statement 占用；
   * rejected 后不再占用（释放余额）。
   */
  allocations?: InvoiceAllocation[];
  status: InvoiceRequestStatus;
  invoiceNo?: string;
  issuedAt?: string;
  pdfUrl?: string;
  rejectReason?: string;
  createdAt: string;
};

export type InvoiceRequestEvent = {
  id: string;
  requestId: string;
  enterpriseId: string;
  fromStatus: InvoiceRequestStatus | null;
  toStatus: InvoiceRequestStatus;
  occurredAt: string;
  note?: string;
};

export type CreditPack = {
  id: string;
  /** 对外展示名（任务包/容量包），禁止直接暴露 credits 作为主标题。 */
  name: string;
  credits: number;
  priceCents: number;
  status: "active" | "archived";
  updatedAt: string;
};
