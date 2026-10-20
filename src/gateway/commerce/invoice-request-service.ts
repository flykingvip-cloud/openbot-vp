/**
 * 发票申请业务规则（R5 + Phase 4）：
 * - 资料校验
 * - 金额与 allocations 在发票 store 锁内基于最新占用计算并落盘（防并发重复）
 * - 总余额申请持久化 allocations 覆盖全部剩余 order/bill
 */

import { listBills, getBill } from "../billing/ledger-store.js";
import { getBillingProfile, isBillingProfileComplete } from "./billing-profile-store.js";
import {
  getCommercialOrderForEnterprise,
  listCommercialOrders,
} from "./commercial-orders-store.js";
import {
  buildCommercialStatement,
  resolveInvoiceAllocations,
  type CommercialStatementStorePaths,
} from "./commercial-statement.js";
import { migrateBareTotalInvoiceAllocationsForEnterprise } from "./invoice-allocation-migrate-io.js";
import { createInvoiceRequestReserving } from "./invoice-requests-store.js";

export type CreateInvoiceRequestInput = {
  enterpriseId: string;
  orderId?: string;
  billId?: string;
  storePaths?: CommercialStatementStorePaths;
};

export async function createInvoiceRequest(input: CreateInvoiceRequestInput) {
  const orderId = input.orderId?.trim();
  const billId = input.billId?.trim();
  if (orderId && billId) {
    throw new Error("一次申请只能关联订单或账单其一");
  }

  const profile = await getBillingProfile(input.enterpriseId);
  if (!isBillingProfileComplete(profile)) {
    throw new Error("请先完善开票资料（法定名称、税号、发票类型）");
  }

  if (orderId) {
    const order = await getCommercialOrderForEnterprise(
      input.enterpriseId,
      orderId,
      input.storePaths?.orders,
    );
    if (!order) {
      throw new Error("订单不存在");
    }
    if (order.status !== "paid") {
      throw new Error("仅已支付订单可申请发票");
    }
  } else if (billId) {
    const bill = await getBill(input.enterpriseId, billId, input.storePaths?.ledger);
    if (!bill) {
      throw new Error("账单不存在");
    }
  }

  // 订单/账单快照在锁外预读；占用与余额在锁内用 active 列表重算
  const [orders, bills] = await Promise.all([
    listCommercialOrders(input.enterpriseId, undefined, input.storePaths?.orders),
    listBills(input.enterpriseId, input.storePaths?.ledger),
  ]);

  // 开票前修复裸总额脏数据，避免锁内占用视图漏计
  await migrateBareTotalInvoiceAllocationsForEnterprise(input.enterpriseId, input.storePaths);

  try {
    return await createInvoiceRequestReserving(
      {
        enterpriseId: input.enterpriseId,
        ...(orderId ? { orderId } : {}),
        ...(billId ? { billId } : {}),
        resolve: (activeOccupancies) => {
          const statement = buildCommercialStatement({
            enterpriseId: input.enterpriseId,
            orders,
            bills,
            invoiceRequests: activeOccupancies,
          });
          const { amountCents, allocations } = resolveInvoiceAllocations(statement, {
            ...(orderId ? { orderId } : {}),
            ...(billId ? { billId } : {}),
          });
          if (amountCents <= 0 || allocations.length === 0) {
            return { amountCents: 0, allocations: [] };
          }
          return { amountCents, allocations };
        },
      },
      input.storePaths?.invoices,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("无可开票余额")) {
      if (orderId) {
        throw new Error("该订单无可开票余额（可能已申请或金额为 0）", { cause: err });
      }
      if (billId) {
        throw new Error("该账单无可开票余额（可能已申请或金额为 0）", { cause: err });
      }
      throw new Error("当前无可开票余额", { cause: err });
    }
    throw err;
  }
}
