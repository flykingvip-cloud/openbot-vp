/**
 * 裸总额 allocations 迁移 IO：读 orders/bills/requests → 规划 → 锁内写回。
 */

import { listBills } from "../billing/ledger-store.js";
import { listCommercialOrders } from "./commercial-orders-store.js";
import { planBareTotalAllocationMigration } from "./invoice-allocation-migrate.js";
import {
  applyInvoiceAllocationPatches,
  listAllInvoiceRequestsForEnterprise,
} from "./invoice-requests-store.js";

export type MigrateBareTotalStorePaths = {
  orders?: string;
  ledger?: string;
  invoices?: string;
};

export type MigrateBareTotalResult = {
  enterpriseId: string;
  migrated: number;
  skipped: number;
  planned: number;
};

/**
 * 将租户下 pending/issued 的裸总额申请补写 allocations。
 * 可重入；无脏数据时 no-op。
 */
export async function migrateBareTotalInvoiceAllocationsForEnterprise(
  enterpriseId: string,
  storePaths?: MigrateBareTotalStorePaths,
): Promise<MigrateBareTotalResult> {
  const [orders, bills, requests] = await Promise.all([
    listCommercialOrders(enterpriseId, undefined, storePaths?.orders),
    listBills(enterpriseId, storePaths?.ledger),
    listAllInvoiceRequestsForEnterprise(enterpriseId, storePaths?.invoices),
  ]);

  const patches = planBareTotalAllocationMigration({
    enterpriseId,
    orders,
    bills,
    requests,
  });

  if (patches.length === 0) {
    return { enterpriseId, migrated: 0, skipped: 0, planned: 0 };
  }

  const result = await applyInvoiceAllocationPatches(
    enterpriseId,
    patches.map((p) => ({ requestId: p.requestId, allocations: p.allocations })),
    storePaths?.invoices,
  );

  return {
    enterpriseId,
    migrated: result.migrated,
    skipped: result.skipped,
    planned: patches.length,
  };
}
