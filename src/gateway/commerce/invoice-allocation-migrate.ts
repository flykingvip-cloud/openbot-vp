/**
 * 裸总额发票迁移：历史「无 orderId/billId 且无 allocations」的 pending/issued 申请
 * 无法占用可开票余额，导致重复开票。
 *
 * 策略（确定性、可重入）：
 * 1. 先计入已有合法占用（有 allocations 或顶层 orderId/billId）
 * 2. 按 createdAt 升序处理裸总额 active 申请
 * 3. 对每个申请，在剩余 paid order / final bill 上按稳定顺序贪心分配，
 *    直到填满 amountCents 或无剩余
 * 4. 写回 allocations（不改 amountCents / status）
 */

import type { Bill } from "../billing/types.js";
import { isActiveInvoiceOccupancy, normalizeRequestAllocations } from "./commercial-statement.js";
import type { CommercialOrder, InvoiceAllocation, InvoiceRequest } from "./types.js";

export function isBareTotalInvoiceRequest(req: InvoiceRequest): boolean {
  if (Array.isArray(req.allocations) && req.allocations.length > 0) {
    return false;
  }
  if (req.orderId?.trim() || req.billId?.trim()) {
    return false;
  }
  return Math.max(0, Math.round(req.amountCents)) > 0;
}

export type BareTotalMigrationPatch = {
  requestId: string;
  allocations: InvoiceAllocation[];
};

export type PlanBareTotalMigrationInput = {
  enterpriseId: string;
  orders: readonly CommercialOrder[];
  bills: readonly Bill[];
  /** 该租户全部发票申请（任意状态） */
  requests: readonly InvoiceRequest[];
};

function isFinalBill(bill: Bill): boolean {
  return !bill.status || bill.status === "finalized";
}

type PoolItem =
  | { kind: "order"; id: string; remaining: number; sortKey: string }
  | { kind: "bill"; id: string; remaining: number; sortKey: string };

function buildGrossPool(
  enterpriseId: string,
  orders: readonly CommercialOrder[],
  bills: readonly Bill[],
): PoolItem[] {
  const pool: PoolItem[] = [];
  for (const order of orders) {
    if (order.enterpriseId !== enterpriseId || order.status !== "paid") {
      continue;
    }
    const remaining = Math.max(0, Math.round(order.amountCents));
    if (remaining <= 0) {
      continue;
    }
    pool.push({
      kind: "order",
      id: order.id,
      remaining,
      // 0: 订单优先于账单；同层按时间
      sortKey: `0:order:${order.createdAt}:${order.id}`,
    });
  }
  for (const bill of bills) {
    if (bill.enterpriseId !== enterpriseId || !isFinalBill(bill)) {
      continue;
    }
    const remaining = Math.max(0, Math.round(bill.totalCostCents));
    if (remaining <= 0) {
      continue;
    }
    pool.push({
      kind: "bill",
      id: bill.id,
      remaining,
      sortKey: `1:bill:${bill.cycleStart}:${bill.id}`,
    });
  }
  return pool.toSorted((a, b) => a.sortKey.localeCompare(b.sortKey));
}

function applyOccupancyToPool(
  pool: PoolItem[],
  byOrderId: Record<string, number>,
  byBillId: Record<string, number>,
): void {
  for (const item of pool) {
    if (item.kind === "order") {
      item.remaining = Math.max(0, item.remaining - (byOrderId[item.id] ?? 0));
    } else {
      item.remaining = Math.max(0, item.remaining - (byBillId[item.id] ?? 0));
    }
  }
}

function accumulateAllocs(
  byOrderId: Record<string, number>,
  byBillId: Record<string, number>,
  allocs: readonly InvoiceAllocation[],
): void {
  for (const a of allocs) {
    const amount = Math.max(0, Math.round(a.amountCents));
    if (amount <= 0) {
      continue;
    }
    if (a.orderId) {
      byOrderId[a.orderId] = (byOrderId[a.orderId] ?? 0) + amount;
    }
    if (a.billId) {
      byBillId[a.billId] = (byBillId[a.billId] ?? 0) + amount;
    }
  }
}

/**
 * 从剩余池贪心切 allocation，目标金额 targetCents。
 */
export function allocateFromPool(pool: PoolItem[], targetCents: number): InvoiceAllocation[] {
  let left = Math.max(0, Math.round(targetCents));
  const out: InvoiceAllocation[] = [];
  if (left <= 0) {
    return out;
  }
  for (const item of pool) {
    if (left <= 0) {
      break;
    }
    if (item.remaining <= 0) {
      continue;
    }
    const take = Math.min(item.remaining, left);
    if (take <= 0) {
      continue;
    }
    item.remaining -= take;
    left -= take;
    if (item.kind === "order") {
      out.push({ orderId: item.id, amountCents: take });
    } else {
      out.push({ billId: item.id, amountCents: take });
    }
  }
  return out;
}

/**
 * 纯函数：规划需写回的 allocation patches（可重入：已有 allocations 的跳过）。
 */
export function planBareTotalAllocationMigration(
  input: PlanBareTotalMigrationInput,
): BareTotalMigrationPatch[] {
  const { enterpriseId, orders, bills, requests } = input;
  const tenantReqs = requests.filter((r) => r.enterpriseId === enterpriseId);
  const bareActive = tenantReqs
    .filter((r) => isActiveInvoiceOccupancy(r) && isBareTotalInvoiceRequest(r))
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  if (bareActive.length === 0) {
    return [];
  }

  // 已合法占用（非裸总额 active）
  const byOrderId: Record<string, number> = {};
  const byBillId: Record<string, number> = {};
  for (const req of tenantReqs) {
    if (!isActiveInvoiceOccupancy(req) || isBareTotalInvoiceRequest(req)) {
      continue;
    }
    accumulateAllocs(byOrderId, byBillId, normalizeRequestAllocations(req));
  }

  const pool = buildGrossPool(enterpriseId, orders, bills);
  applyOccupancyToPool(pool, byOrderId, byBillId);

  const patches: BareTotalMigrationPatch[] = [];
  for (const bare of bareActive) {
    const target = Math.max(0, Math.round(bare.amountCents));
    const allocations = allocateFromPool(pool, target);
    if (allocations.length === 0) {
      // 无剩余可映射：写空数组标记已处理？仍无法占用。
      // 用特殊标记：allocations: [] 与「未迁移」难区分。
      // 采用 allocations 含 0 元不合法；改为跳过不写，避免假成功。
      // 若 target>0 但池空：仍跳过（数据不足，保持裸状态由运维补单）
      continue;
    }
    patches.push({ requestId: bare.id, allocations });
    // 池已在 allocateFromPool 内扣减；同步 by* 供后续逻辑一致
    accumulateAllocs(byOrderId, byBillId, allocations);
  }
  return patches;
}

/**
 * 将 patches 应用到请求列表（不可变返回新数组）。
 */
export function applyBareTotalAllocationPatches(
  requests: readonly InvoiceRequest[],
  patches: readonly BareTotalMigrationPatch[],
): InvoiceRequest[] {
  if (patches.length === 0) {
    return [...requests];
  }
  const map = new Map(patches.map((p) => [p.requestId, p.allocations]));
  return requests.map((req) => {
    const allocs = map.get(req.id);
    if (!allocs) {
      return req;
    }
    return { ...req, allocations: allocs };
  });
}
