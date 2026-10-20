/**
 * 账本 store（Bills + CostSnapshots，按 enterpriseId 隔离，纯追加禁改禁删）。
 *
 * 所有写入经 `appendLedgerRecord`，重复 id 抛 `LedgerImmutabilityError`（R10 / R11 / R22）。
 * estimated 与 final 快照均以追加方式并存（R22.6）。
 *
 * 落盘：`CONFIG_DIR/openbot-billing-ledger.json`。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { appendLedgerRecord } from "./append-only-ledger.js";
import type { Bill, CostSnapshot, SnapshotType } from "./types.js";

const LEDGER_STORE_VERSION = 1;

type LedgerStore = {
  version: number;
  bills: Bill[]; // append-only
  snapshots: CostSnapshot[]; // append-only
};

function createEmptyStore(): LedgerStore {
  return { version: LEDGER_STORE_VERSION, bills: [], snapshots: [] };
}

export function resolveDefaultLedgerStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-billing-ledger.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<LedgerStore> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultLedgerStorePath());
  const parsed = await readJsonFile<Partial<LedgerStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  return {
    version: LEDGER_STORE_VERSION,
    bills: Array.isArray(parsed.bills) ? parsed.bills : [],
    snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
  };
}

async function saveStore(store: LedgerStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultLedgerStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

/** 追加一条账单（不可覆盖既有 id，R11.5）。 */
export async function appendBill(bill: Bill, storePath?: string): Promise<Bill> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    store.bills = appendLedgerRecord(store.bills, bill);
    await saveStore(store, storePath);
    return bill;
  });
}

/** 按 settlementKey 查找企业账单（租户隔离）。 */
export async function findBillBySettlementKey(
  enterpriseId: string,
  settlementKey: string,
  storePath?: string,
): Promise<Bill | null> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return store.bills.find((b) => b.enterpriseId === t && b.settlementKey === settlementKey) ?? null;
}

/**
 * 幂等追加 final 账单：若 settlementKey 已存在则返回既有记录。
 * 锁内完成「查找 → 追加」，避免并发双写。
 * @deprecated 优先使用 appendFinalSettlementIdempotent（Bill+Snapshot 原子）。
 */
export async function appendBillIdempotentBySettlementKey(
  bill: Bill,
  storePath?: string,
): Promise<{ bill: Bill; deduped: boolean }> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(bill.enterpriseId);
    if (bill.settlementKey) {
      const existing = store.bills.find(
        (b) => b.enterpriseId === t && b.settlementKey === bill.settlementKey,
      );
      if (existing) {
        return { bill: existing, deduped: true };
      }
    }
    const byId = store.bills.find((b) => b.id === bill.id);
    if (byId) {
      return { bill: byId, deduped: true };
    }
    store.bills = appendLedgerRecord(store.bills, bill);
    await saveStore(store, storePath);
    return { bill, deduped: false };
  });
}

/**
 * 原子幂等写入 final Bill + final Snapshot（同一锁、同一次落盘）。
 * 并发去重后返回 **持久化** 的同一组 Bill/Snapshot，不合成临时 snapshot。
 */
export async function appendFinalSettlementIdempotent(
  bill: Bill,
  snapshot: CostSnapshot,
  storePath?: string,
): Promise<{ bill: Bill; snapshot: CostSnapshot; deduped: boolean }> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(bill.enterpriseId);
    const existingBill =
      (bill.settlementKey
        ? store.bills.find((b) => b.enterpriseId === t && b.settlementKey === bill.settlementKey)
        : undefined) ?? store.bills.find((b) => b.id === bill.id);

    if (existingBill) {
      const existingSnap =
        store.snapshots.find(
          (s) =>
            s.enterpriseId === t &&
            (s.billId === existingBill.id ||
              (bill.settlementKey != null && s.settlementKey === bill.settlementKey) ||
              s.id === snapshot.id),
        ) ?? null;
      if (!existingSnap) {
        // 历史仅有 Bill：补写 snapshot（仍在锁内，保持可回读）
        const repaired: CostSnapshot = {
          ...snapshot,
          billId: existingBill.id,
          settlementKey: existingBill.settlementKey ?? bill.settlementKey,
          seatCostCents: existingBill.seatCostCents,
          usageCostCents: existingBill.usageCostCents,
          totalCostCents: existingBill.totalCostCents,
        };
        store.snapshots = appendLedgerRecord(store.snapshots, repaired);
        await saveStore(store, storePath);
        return { bill: existingBill, snapshot: repaired, deduped: true };
      }
      return { bill: existingBill, snapshot: existingSnap, deduped: true };
    }

    const linkedSnapshot: CostSnapshot = {
      ...snapshot,
      billId: bill.id,
      settlementKey: bill.settlementKey,
      snapshotType: "final",
    };
    store.bills = appendLedgerRecord(store.bills, bill);
    store.snapshots = appendLedgerRecord(store.snapshots, linkedSnapshot);
    await saveStore(store, storePath);
    return { bill, snapshot: linkedSnapshot, deduped: false };
  });
}

/** 按 settlementKey 取 final Bill + 关联 Snapshot。 */
export async function findFinalSettlementByKey(
  enterpriseId: string,
  settlementKey: string,
  storePath?: string,
): Promise<{ bill: Bill; snapshot: CostSnapshot } | null> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  const bill =
    store.bills.find((b) => b.enterpriseId === t && b.settlementKey === settlementKey) ?? null;
  if (!bill) {
    return null;
  }
  const snapshot =
    store.snapshots.find(
      (s) => s.enterpriseId === t && (s.settlementKey === settlementKey || s.billId === bill.id),
    ) ?? null;
  if (!snapshot) {
    return null;
  }
  return { bill, snapshot };
}

export type LedgerStorePaths = string;

/** 追加一条成本快照（estimated/final 并存）。 */
export async function appendSnapshot(
  snapshot: CostSnapshot,
  storePath?: string,
): Promise<CostSnapshot> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    store.snapshots = appendLedgerRecord(store.snapshots, snapshot);
    await saveStore(store, storePath);
    return snapshot;
  });
}

export async function listBills(enterpriseId: string, storePath?: string): Promise<Bill[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  // 按周期倒序（R19.1）。
  return store.bills
    .filter((b) => b.enterpriseId === t)
    .toSorted((a, b) => b.cycleStart.localeCompare(a.cycleStart));
}

export async function getBill(
  enterpriseId: string,
  billId: string,
  storePath?: string,
): Promise<Bill | null> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  const bill = store.bills.find((b) => b.id === billId);
  return bill && bill.enterpriseId === t ? bill : null;
}

export type ListSnapshotsFilter = {
  snapshotType?: SnapshotType;
  date?: string;
};

export async function listSnapshots(
  enterpriseId: string,
  filter: ListSnapshotsFilter = {},
  storePath?: string,
): Promise<CostSnapshot[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return store.snapshots
    .filter((s) => {
      if (s.enterpriseId !== t) {
        return false;
      }
      if (filter.snapshotType && s.snapshotType !== filter.snapshotType) {
        return false;
      }
      if (filter.date && s.date !== filter.date) {
        return false;
      }
      return true;
    })
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 取某企业某日最新快照（按 createdAt，可指定类型）。用于看板展示最近估算值。 */
export async function getLatestSnapshot(
  enterpriseId: string,
  filter: ListSnapshotsFilter = {},
  storePath?: string,
): Promise<CostSnapshot | null> {
  const snapshots = await listSnapshots(enterpriseId, filter, storePath);
  return snapshots.at(-1) ?? null;
}

export async function __resetLedgerForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
