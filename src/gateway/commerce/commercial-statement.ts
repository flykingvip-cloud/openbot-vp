/**
 * Phase 4：统一 Statement — 聚合 Order 预付 + Bill 消费，计算可开票余额。
 *
 * 占用扣减：
 * - 优先 InvoiceRequest.allocations（总余额 / 定向均应持久化）
 * - 兼容旧数据：仅有顶层 orderId/billId 时按 amountCents 全额占用该引用
 * - rejected 不占用；pending+issued 占用
 */

import { listBills } from "../billing/ledger-store.js";
import type { Bill } from "../billing/types.js";
import { listCommercialOrders } from "./commercial-orders-store.js";
import { migrateBareTotalInvoiceAllocationsForEnterprise } from "./invoice-allocation-migrate-io.js";
import { listActiveInvoiceOccupanciesForEnterprise } from "./invoice-requests-store.js";
import type { CommercialOrder, InvoiceAllocation, InvoiceRequest } from "./types.js";

export type StatementLineType =
  | "base_prepaid"
  | "cycle_discount"
  | "seat"
  | "usage_included"
  | "usage_overage"
  | "adjustment"
  | "payment_applied";

export type StatementLine = {
  id: string;
  type: StatementLineType;
  label: string;
  /** 正=费用；负=回款/抵扣 */
  amountCents: number;
  occurredAt: string;
  orderId?: string;
  billId?: string;
  planVersionId?: string;
  cycleStart?: string;
  cycleEnd?: string;
};

export type CommercialStatement = {
  enterpriseId: string;
  generatedAt: string;
  lines: StatementLine[];
  chargesCents: number;
  creditsCents: number;
  /** pending + issued 发票占用金额合计（allocation 之和） */
  invoicedCents: number;
  /** 账面结余应付 max(0, sum(lines)) */
  balanceDueCents: number;
  /** 可开票余额 */
  invoiceableCents: number;
  invoiceableOrdersCents: number;
  invoiceableBillsCents: number;
  invoiceableByOrderId: Record<string, number>;
  invoiceableByBillId: Record<string, number>;
};

export type CommercialStatementInput = {
  enterpriseId: string;
  orders?: readonly CommercialOrder[];
  bills?: readonly Bill[];
  invoiceRequests?: readonly InvoiceRequest[];
  now?: Date;
};

function isFinalBill(bill: Bill): boolean {
  if (!bill.status || bill.status === "finalized") {
    return true;
  }
  return false;
}

export function isActiveInvoiceOccupancy(req: Pick<InvoiceRequest, "status">): boolean {
  return req.status === "pending" || req.status === "issued";
}

/**
 * 汇总 pending/issued 对 order/bill 的占用金额（支持 allocations + 旧顶层引用）。
 */
export function collectInvoiceOccupancy(
  invoices: readonly InvoiceRequest[],
  enterpriseId: string,
): {
  byOrderId: Record<string, number>;
  byBillId: Record<string, number>;
  totalOccupiedCents: number;
} {
  const byOrderId: Record<string, number> = {};
  const byBillId: Record<string, number> = {};
  let totalOccupiedCents = 0;

  for (const inv of invoices) {
    if (inv.enterpriseId !== enterpriseId || !isActiveInvoiceOccupancy(inv)) {
      continue;
    }
    const allocs = normalizeRequestAllocations(inv);
    for (const a of allocs) {
      const amount = Math.max(0, Math.round(a.amountCents));
      if (amount <= 0) {
        continue;
      }
      totalOccupiedCents += amount;
      if (a.orderId) {
        byOrderId[a.orderId] = (byOrderId[a.orderId] ?? 0) + amount;
      }
      if (a.billId) {
        byBillId[a.billId] = (byBillId[a.billId] ?? 0) + amount;
      }
    }
  }
  return { byOrderId, byBillId, totalOccupiedCents };
}

/**
 * 将申请规范为 allocation 列表。
 * - 有 allocations → 用 allocations
 * - 否则旧数据：顶层 orderId/billId + amountCents
 */
export function normalizeRequestAllocations(req: InvoiceRequest): InvoiceAllocation[] {
  if (Array.isArray(req.allocations) && req.allocations.length > 0) {
    const out: InvoiceAllocation[] = [];
    for (const a of req.allocations) {
      const orderId = a.orderId?.trim();
      const billId = a.billId?.trim();
      const amountCents = Math.max(0, Math.round(a.amountCents));
      if (amountCents <= 0) {
        continue;
      }
      if (orderId && !billId) {
        out.push({ orderId, amountCents });
        continue;
      }
      if (billId && !orderId) {
        out.push({ billId, amountCents });
      }
    }
    return out;
  }
  const orderId = req.orderId?.trim();
  const billId = req.billId?.trim();
  const amountCents = Math.max(0, Math.round(req.amountCents));
  if (amountCents <= 0) {
    return [];
  }
  if (orderId && !billId) {
    return [{ orderId, amountCents }];
  }
  if (billId && !orderId) {
    return [{ billId, amountCents }];
  }
  // 裸总额：由 invoice-allocation-migrate 补写 allocations 后再占用；迁移前返回 []
  return [];
}

/**
 * 从当前可开票 map 生成总余额申请的覆盖明细（全额占用剩余）。
 */
export function buildTotalBalanceAllocations(statement: CommercialStatement): InvoiceAllocation[] {
  const out: InvoiceAllocation[] = [];
  for (const [orderId, amountCents] of Object.entries(statement.invoiceableByOrderId)) {
    if (amountCents > 0) {
      out.push({ orderId, amountCents });
    }
  }
  for (const [billId, amountCents] of Object.entries(statement.invoiceableByBillId)) {
    if (amountCents > 0) {
      out.push({ billId, amountCents });
    }
  }
  return out.toSorted((a, b) => {
    const ak = a.orderId ? `o:${a.orderId}` : `b:${a.billId}`;
    const bk = b.orderId ? `o:${b.orderId}` : `b:${b.billId}`;
    return ak.localeCompare(bk);
  });
}

/** 纯函数：由订单/账单/发票投影 Statement。 */
export function buildCommercialStatement(input: CommercialStatementInput): CommercialStatement {
  const enterpriseId = input.enterpriseId;
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const orders = (input.orders ?? []).filter((o) => o.enterpriseId === enterpriseId);
  const bills = (input.bills ?? []).filter(
    (b) => b.enterpriseId === enterpriseId && isFinalBill(b),
  );
  const invoices = (input.invoiceRequests ?? []).filter(
    (r) => r.enterpriseId === enterpriseId && isActiveInvoiceOccupancy(r),
  );

  const lines: StatementLine[] = [];

  const paidOrders = orders
    .filter((o) => o.status === "paid")
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const order of paidOrders) {
    const amount = Math.max(0, Math.round(order.amountCents));
    if (amount <= 0) {
      continue;
    }
    const at = order.paidAt ?? order.createdAt;
    lines.push({
      id: `order:${order.id}:base_prepaid`,
      type: "base_prepaid",
      label: `预付订单 ${order.kind} ${order.id}`,
      amountCents: amount,
      occurredAt: at,
      orderId: order.id,
      planVersionId: order.planVersionId ?? order.targetPlanVersionId,
    });
    lines.push({
      id: `order:${order.id}:payment_applied`,
      type: "payment_applied",
      label: `回款订单 ${order.id}`,
      amountCents: -amount,
      occurredAt: at,
      orderId: order.id,
    });
  }

  const finalBills = bills.toSorted((a, b) => a.cycleStart.localeCompare(b.cycleStart));
  for (const bill of finalBills) {
    const at = bill.generatedAt;
    if (bill.seatCostCents > 0) {
      lines.push({
        id: `bill:${bill.id}:seat`,
        type: "seat",
        label: `席位费用 ${bill.cycleStart.slice(0, 10)}–${bill.cycleEnd.slice(0, 10)}`,
        amountCents: Math.round(bill.seatCostCents),
        occurredAt: at,
        billId: bill.id,
        planVersionId: bill.planVersionId,
        cycleStart: bill.cycleStart,
        cycleEnd: bill.cycleEnd,
      });
    }
    if (bill.usageCostCents > 0) {
      lines.push({
        id: `bill:${bill.id}:usage_included`,
        type: "usage_included",
        label: `用量费用 ${bill.cycleStart.slice(0, 10)}–${bill.cycleEnd.slice(0, 10)}`,
        amountCents: Math.round(bill.usageCostCents),
        occurredAt: at,
        billId: bill.id,
        planVersionId: bill.planVersionId,
        cycleStart: bill.cycleStart,
        cycleEnd: bill.cycleEnd,
      });
    }
    if (bill.extraCostCents > 0) {
      lines.push({
        id: `bill:${bill.id}:usage_overage`,
        type: "usage_overage",
        label: `超额费用 ${bill.cycleStart.slice(0, 10)}–${bill.cycleEnd.slice(0, 10)}`,
        amountCents: Math.round(bill.extraCostCents),
        occurredAt: at,
        billId: bill.id,
        planVersionId: bill.planVersionId,
        cycleStart: bill.cycleStart,
        cycleEnd: bill.cycleEnd,
      });
    }
  }

  lines.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));

  let chargesCents = 0;
  let creditsCents = 0;
  let net = 0;
  for (const line of lines) {
    net += line.amountCents;
    if (line.amountCents > 0) {
      chargesCents += line.amountCents;
    } else if (line.amountCents < 0) {
      creditsCents += -line.amountCents;
    }
  }
  const balanceDueCents = Math.max(0, net);

  const occupied = collectInvoiceOccupancy(invoices, enterpriseId);

  const invoiceableByOrderId: Record<string, number> = {};
  let invoiceableOrdersCents = 0;
  for (const order of paidOrders) {
    const gross = Math.max(0, Math.round(order.amountCents));
    const used = occupied.byOrderId[order.id] ?? 0;
    const remaining = Math.max(0, gross - used);
    if (remaining > 0) {
      invoiceableByOrderId[order.id] = remaining;
      invoiceableOrdersCents += remaining;
    }
  }

  const invoiceableByBillId: Record<string, number> = {};
  let invoiceableBillsCents = 0;
  for (const bill of finalBills) {
    const gross = Math.max(0, Math.round(bill.totalCostCents));
    const used = occupied.byBillId[bill.id] ?? 0;
    const remaining = Math.max(0, gross - used);
    if (remaining > 0) {
      invoiceableByBillId[bill.id] = remaining;
      invoiceableBillsCents += remaining;
    }
  }

  return {
    enterpriseId,
    generatedAt,
    lines,
    chargesCents,
    creditsCents,
    invoicedCents: occupied.totalOccupiedCents,
    balanceDueCents,
    invoiceableCents: invoiceableOrdersCents + invoiceableBillsCents,
    invoiceableOrdersCents,
    invoiceableBillsCents,
    invoiceableByOrderId,
    invoiceableByBillId,
  };
}

export function resolveInvoiceRequestAmountCents(
  statement: CommercialStatement,
  ref: { orderId?: string; billId?: string },
): number {
  const orderId = ref.orderId?.trim();
  const billId = ref.billId?.trim();
  if (orderId && billId) {
    throw new Error("一次申请只能关联订单或账单其一");
  }
  if (!orderId && !billId) {
    return statement.invoiceableCents;
  }
  if (orderId) {
    return statement.invoiceableByOrderId[orderId] ?? 0;
  }
  if (billId) {
    return statement.invoiceableByBillId[billId] ?? 0;
  }
  return 0;
}

/**
 * 解析本次申请应持久化的 allocations + 金额。
 */
export function resolveInvoiceAllocations(
  statement: CommercialStatement,
  ref: { orderId?: string; billId?: string },
): { amountCents: number; allocations: InvoiceAllocation[] } {
  const orderId = ref.orderId?.trim();
  const billId = ref.billId?.trim();
  if (orderId && billId) {
    throw new Error("一次申请只能关联订单或账单其一");
  }
  if (orderId) {
    const amountCents = statement.invoiceableByOrderId[orderId] ?? 0;
    return {
      amountCents,
      allocations: amountCents > 0 ? [{ orderId, amountCents }] : [],
    };
  }
  if (billId) {
    const amountCents = statement.invoiceableByBillId[billId] ?? 0;
    return {
      amountCents,
      allocations: amountCents > 0 ? [{ billId, amountCents }] : [],
    };
  }
  const allocations = buildTotalBalanceAllocations(statement);
  const amountCents = allocations.reduce((s, a) => s + a.amountCents, 0);
  return { amountCents, allocations };
}

export type CommercialStatementStorePaths = {
  orders?: string;
  ledger?: string;
  invoices?: string;
};

/** IO：加载租户订单/账单/发票并投影 Statement（发票占用无分页上限）。 */
export async function loadCommercialStatement(
  enterpriseId: string,
  storePaths?: CommercialStatementStorePaths,
): Promise<CommercialStatement> {
  // 先迁移裸总额脏数据，再读占用（可重入）
  await migrateBareTotalInvoiceAllocationsForEnterprise(enterpriseId, storePaths);
  const [orders, bills, invoiceRequests] = await Promise.all([
    listCommercialOrders(enterpriseId, undefined, storePaths?.orders),
    listBills(enterpriseId, storePaths?.ledger),
    listActiveInvoiceOccupanciesForEnterprise(enterpriseId, storePaths?.invoices),
  ]);
  return buildCommercialStatement({
    enterpriseId,
    orders,
    bills,
    invoiceRequests,
  });
}
