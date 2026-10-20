/**
 * 平台从销售线索创建待支付订单（B2B 首要路径）。
 */

import { getSalesLead } from "../billing/sales-leads-store.js";
import type { BillingCycle } from "../billing/types.js";
import { createSubscribeCommercialOrder } from "./create-order-service.js";

export type CreateOrderFromSalesLeadInput = {
  leadId: string;
  enterpriseId: string;
  planId?: string;
  planVersionId?: string;
  billingCycle?: BillingCycle;
  /** 平台议价金额（分）；缺省按 PlanVersion 快照报价。 */
  amountCents?: number;
  actorUserId?: string;
};

export async function createOrderFromSalesLead(input: CreateOrderFromSalesLeadInput) {
  const lead = await getSalesLead(input.leadId);
  if (!lead) {
    throw new Error(`销售线索不存在：${input.leadId}`);
  }
  const planId = input.planId ?? lead.planId;
  const planVersionId = input.planVersionId;
  if (!planId && !planVersionId) {
    throw new Error("必须指定 planId 或 planVersionId（线索未关联套餐时需手动指定）");
  }

  const commerce = await createSubscribeCommercialOrder({
    enterpriseId: input.enterpriseId,
    ...(planVersionId ? { planVersionId } : {}),
    ...(planId ? { planId } : {}),
    ...(input.billingCycle ? { billingCycle: input.billingCycle } : {}),
    ...(input.amountCents !== undefined ? { amountCentsOverride: input.amountCents } : {}),
    salesLeadId: lead.id,
    paymentMethod: "bank_transfer",
    platformFromLead: true,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
  });

  return { lead, ...commerce };
}
