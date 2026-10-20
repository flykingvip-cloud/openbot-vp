/**
 * Subscription Commerce RPC 类型（平台核销 + 线索转单）。
 */

import type { BillingCycle } from "../cost-budget-billing/endpoints.ts";

export type CommercialOrderStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "failed"
  | "canceled"
  | "refunded";

export type CommercialFulfillmentStatus = "none" | "pending" | "done" | "failed";

export type CommercialOrder = {
  id: string;
  enterpriseId: string;
  kind: "subscribe" | "change_plan" | "renew" | "recharge_credits";
  status: CommercialOrderStatus;
  amountCents: number;
  currency: "CNY" | "USD";
  billingCycle?: BillingCycle;
  planId?: string;
  planVersionId?: string;
  lineItems: Array<{ label: string; amountCents: number }>;
  salesLeadId?: string;
  paymentMethod?: "online" | "bank_transfer" | "manual";
  fulfillmentStatus?: CommercialFulfillmentStatus;
  fulfillmentError?: string;
  createdAt: string;
  paidAt?: string;
};

export type Payment = {
  id: string;
  orderId: string;
  enterpriseId: string;
  provider: "manual" | "stripe" | "alipay" | "wechat";
  status: "pending" | "paid" | "failed" | "canceled";
  amountCents: number;
  createdAt: string;
  paidAt?: string;
};

export type InvoiceRequest = {
  id: string;
  enterpriseId: string;
  orderId?: string;
  billId?: string;
  amountCents: number;
  status: "pending" | "issued" | "rejected";
  invoiceNo?: string;
  issuedAt?: string;
  pdfUrl?: string;
  rejectReason?: string;
  createdAt: string;
};

export type SalesLead = {
  id: string;
  planId?: string;
  company: string;
  contact: string;
  phone: string;
  scale?: string;
  requirements?: string;
  createdAt: string;
};

export const SUBSCRIPTION_COMMERCE_ENDPOINTS = {
  reconcileQueue: "platform-commerce.reconcile-queue",
  fromLead: "platform-commerce.from-lead",
  confirmManual: "payments.confirm-manual",
  fulfillmentRetry: "platform-commerce.fulfillment-retry",
  salesLeadsList: "sales-leads.list",
  plansList: "platform-plans.list",
  invoicesListPlatform: "invoices.list-platform",
  invoicesIssue: "invoices.issue",
  invoicesReject: "invoices.reject",
} as const;

export type ReconcileQueueResponse = {
  pendingPayment: CommercialOrder[];
  paidUnfulfilled: CommercialOrder[];
  orders: CommercialOrder[];
  paymentsByOrderId?: Record<string, Payment>;
};

export type FromLeadRequest = {
  leadId: string;
  enterpriseId: string;
  planId?: string;
  planVersionId?: string;
  billingCycle?: BillingCycle;
  amountCents?: number;
};

export type FromLeadResponse = {
  lead: SalesLead;
  order: CommercialOrder;
  payment: Payment | null;
  autoPaid: boolean;
};

export type SalesLeadsListResponse = {
  leads: SalesLead[];
};

export type InvoicesListPlatformResponse = {
  requests: InvoiceRequest[];
};
