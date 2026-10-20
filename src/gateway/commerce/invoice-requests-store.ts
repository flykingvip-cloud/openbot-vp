/**
 * 发票申请 store。
 *
 * Phase 4：
 * - 支持 allocations 占用明细
 * - listActiveInvoiceOccupanciesForEnterprise 无分页上限（供 Statement）
 * - createInvoiceRequestReserving 在同一锁内「读占用 + 写申请」
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { appendLedgerRecord } from "../billing/append-only-ledger.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import type {
  InvoiceAllocation,
  InvoiceRequest,
  InvoiceRequestEvent,
  InvoiceRequestStatus,
} from "./types.js";

const STORE_VERSION = 1;

type InvoiceRequestsStore = {
  version: number;
  requests: Record<string, InvoiceRequest>;
  events: InvoiceRequestEvent[];
};

function createEmptyStore(): InvoiceRequestsStore {
  return { version: STORE_VERSION, requests: {}, events: [] };
}

export function resolveDefaultInvoiceRequestsStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-invoice-requests.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<InvoiceRequestsStore> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultInvoiceRequestsStorePath(),
  );
  const parsed = await readJsonFile<Partial<InvoiceRequestsStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  return {
    version: STORE_VERSION,
    requests: parsed.requests ?? {},
    events: Array.isArray(parsed.events) ? parsed.events : [],
  };
}

async function saveStore(store: InvoiceRequestsStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultInvoiceRequestsStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

function appendRequestEvent(
  store: InvoiceRequestsStore,
  request: InvoiceRequest,
  fromStatus: InvoiceRequestStatus | null,
  toStatus: InvoiceRequestStatus,
  note?: string,
): void {
  store.events = appendLedgerRecord(store.events, {
    id: `inv-ev-${randomUUID()}`,
    requestId: request.id,
    enterpriseId: request.enterpriseId,
    fromStatus,
    toStatus,
    occurredAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  });
}

function normalizeAllocations(
  input: readonly InvoiceAllocation[] | undefined,
): InvoiceAllocation[] {
  if (!input?.length) {
    return [];
  }
  const out: InvoiceAllocation[] = [];
  for (const a of input) {
    const orderId = a.orderId?.trim();
    const billId = a.billId?.trim();
    const amountCents = Math.max(0, Math.round(a.amountCents));
    if (amountCents <= 0) {
      continue;
    }
    if (orderId && billId) {
      throw new Error("allocation 不能同时绑定 orderId 与 billId");
    }
    if (orderId) {
      out.push({ orderId, amountCents });
    } else if (billId) {
      out.push({ billId, amountCents });
    }
  }
  return out;
}

/**
 * 全部 pending/issued 占用记录（**无 limit**）。
 * Statement 与原子开票专用；展示列表仍用 listInvoiceRequestsForEnterprise。
 */
export async function listActiveInvoiceOccupanciesForEnterprise(
  enterpriseId: string,
  storePath?: string,
): Promise<InvoiceRequest[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return Object.values(store.requests)
    .filter(
      (request) =>
        request.enterpriseId === t && (request.status === "pending" || request.status === "issued"),
    )
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 租户全部发票申请（任意状态，无 limit）— 迁移用。 */
export async function listAllInvoiceRequestsForEnterprise(
  enterpriseId: string,
  storePath?: string,
): Promise<InvoiceRequest[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return Object.values(store.requests)
    .filter((request) => request.enterpriseId === t)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * 锁内写入 allocation patches（裸总额迁移）。
 * 仅当目标仍为裸总额时才写，保证可重入。
 */
export async function applyInvoiceAllocationPatches(
  enterpriseId: string,
  patches: readonly { requestId: string; allocations: InvoiceAllocation[] }[],
  storePath?: string,
): Promise<{ migrated: number; skipped: number }> {
  if (patches.length === 0) {
    return { migrated: 0, skipped: 0 };
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    let migrated = 0;
    let skipped = 0;
    for (const patch of patches) {
      const existing = store.requests[patch.requestId];
      if (!existing || existing.enterpriseId !== t) {
        skipped += 1;
        continue;
      }
      // 已有 allocations 则跳过（可重入）
      if (Array.isArray(existing.allocations) && existing.allocations.length > 0) {
        skipped += 1;
        continue;
      }
      const allocations = normalizeAllocations(patch.allocations);
      if (allocations.length === 0) {
        skipped += 1;
        continue;
      }
      store.requests[patch.requestId] = {
        ...existing,
        allocations,
      };
      appendRequestEvent(
        store,
        store.requests[patch.requestId],
        existing.status,
        existing.status,
        `migrate bare-total allocations (${allocations.length} lines)`,
      );
      migrated += 1;
    }
    if (migrated > 0) {
      await saveStore(store, storePath);
    }
    return { migrated, skipped };
  });
}

/**
 * 在发票 store 锁内执行：读当前全部 active 占用 → 调用方计算 allocations → 落盘。
 * 保证并发总额/定向申请不会重复占用同一余额。
 */
export async function createInvoiceRequestReserving(
  input: {
    enterpriseId: string;
    orderId?: string;
    billId?: string;
    /**
     * 在锁内、基于最新 active 占用列表计算 amount + allocations。
     * 返回 amount<=0 或空 allocations 则抛错由调用方处理前应已判断。
     */
    resolve: (activeOccupancies: InvoiceRequest[]) => {
      amountCents: number;
      allocations: InvoiceAllocation[];
    };
  },
  storePath?: string,
): Promise<InvoiceRequest> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(input.enterpriseId);
    const active = Object.values(store.requests)
      .filter(
        (request) =>
          request.enterpriseId === t &&
          (request.status === "pending" || request.status === "issued"),
      )
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));

    const resolved = input.resolve(active);
    const allocations = normalizeAllocations(resolved.allocations);
    const amountCents = Math.max(0, Math.round(resolved.amountCents));
    if (amountCents <= 0 || allocations.length === 0) {
      throw new Error("当前无可开票余额");
    }
    const allocSum = allocations.reduce((s, a) => s + a.amountCents, 0);
    if (allocSum !== amountCents) {
      // 允许 amount = sum(allocations)
      if (allocSum <= 0) {
        throw new Error("当前无可开票余额");
      }
    }
    const finalAmount = allocSum;

    const now = new Date().toISOString();
    const request: InvoiceRequest = {
      id: `inv-${randomUUID()}`,
      enterpriseId: t,
      amountCents: finalAmount,
      allocations,
      status: "pending",
      createdAt: now,
      ...(input.orderId?.trim() ? { orderId: input.orderId.trim() } : {}),
      ...(input.billId?.trim() ? { billId: input.billId.trim() } : {}),
    };
    store.requests[request.id] = request;
    appendRequestEvent(store, request, null, "pending");
    await saveStore(store, storePath);
    return request;
  });
}

/** @deprecated 优先 createInvoiceRequestReserving；保留简单写入兼容旧测试 */
export type CreateInvoiceRequestRecordInput = {
  enterpriseId: string;
  amountCents: number;
  orderId?: string;
  billId?: string;
  allocations?: InvoiceAllocation[];
};

export async function createInvoiceRequestRecord(
  input: CreateInvoiceRequestRecordInput,
  storePath?: string,
): Promise<InvoiceRequest> {
  return createInvoiceRequestReserving(
    {
      enterpriseId: input.enterpriseId,
      ...(input.orderId ? { orderId: input.orderId } : {}),
      ...(input.billId ? { billId: input.billId } : {}),
      resolve: () => {
        let allocations = normalizeAllocations(input.allocations);
        if (allocations.length === 0) {
          const orderId = input.orderId?.trim();
          const billId = input.billId?.trim();
          const amountCents = Math.max(0, Math.round(input.amountCents));
          if (orderId && amountCents > 0) {
            allocations = [{ orderId, amountCents }];
          } else if (billId && amountCents > 0) {
            allocations = [{ billId, amountCents }];
          }
        }
        const amountCents =
          allocations.length > 0
            ? allocations.reduce((s, a) => s + a.amountCents, 0)
            : Math.max(0, Math.round(input.amountCents));
        return { amountCents, allocations };
      },
    },
    storePath,
  );
}

export async function getInvoiceRequest(
  requestId: string,
  storePath?: string,
): Promise<InvoiceRequest | null> {
  const store = await loadStore(storePath);
  return store.requests[requestId] ?? null;
}

/** 租户隔离读取（Property 5）。 */
export async function getInvoiceRequestForEnterprise(
  enterpriseId: string,
  requestId: string,
  storePath?: string,
): Promise<InvoiceRequest | null> {
  const request = await getInvoiceRequest(requestId, storePath);
  if (!request) {
    return null;
  }
  return request.enterpriseId === tenant(enterpriseId) ? request : null;
}

export type ListInvoiceRequestsFilter = {
  status?: InvoiceRequestStatus;
  enterpriseId?: string;
  limit?: number;
};

/** 展示用列表（默认 limit 100）。占用计算请用 listActiveInvoiceOccupanciesForEnterprise。 */
export async function listInvoiceRequestsForEnterprise(
  enterpriseId: string,
  filter: Omit<ListInvoiceRequestsFilter, "enterpriseId"> = {},
  storePath?: string,
): Promise<InvoiceRequest[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  const limit = filter.limit && filter.limit > 0 ? filter.limit : 100;
  return Object.values(store.requests)
    .filter((request) => {
      if (request.enterpriseId !== t) {
        return false;
      }
      if (filter.status && request.status !== filter.status) {
        return false;
      }
      return true;
    })
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function listAllInvoiceRequests(
  filter: ListInvoiceRequestsFilter = {},
  storePath?: string,
): Promise<InvoiceRequest[]> {
  const store = await loadStore(storePath);
  const limit = filter.limit && filter.limit > 0 ? filter.limit : 200;
  const tenantFilter = filter.enterpriseId ? tenant(filter.enterpriseId) : null;
  return Object.values(store.requests)
    .filter((request) => {
      if (tenantFilter && request.enterpriseId !== tenantFilter) {
        return false;
      }
      if (filter.status && request.status !== filter.status) {
        return false;
      }
      return true;
    })
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function issueInvoiceRequest(
  requestId: string,
  patch: { invoiceNo: string; pdfUrl?: string },
  storePath?: string,
): Promise<InvoiceRequest | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.requests[requestId];
    if (!existing) {
      return null;
    }
    if (existing.status !== "pending") {
      throw new Error("仅待审核申请可开具");
    }
    const invoiceNo = patch.invoiceNo.trim();
    if (!invoiceNo) {
      throw new Error("invoiceNo 是必填项");
    }
    const now = new Date().toISOString();
    const updated: InvoiceRequest = {
      ...existing,
      status: "issued",
      invoiceNo,
      issuedAt: now,
      ...(patch.pdfUrl?.trim() ? { pdfUrl: patch.pdfUrl.trim() } : {}),
    };
    store.requests[requestId] = updated;
    appendRequestEvent(store, updated, existing.status, "issued", invoiceNo);
    await saveStore(store, storePath);
    return updated;
  });
}

export async function rejectInvoiceRequest(
  requestId: string,
  reason: string,
  storePath?: string,
): Promise<InvoiceRequest | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.requests[requestId];
    if (!existing) {
      return null;
    }
    if (existing.status !== "pending") {
      throw new Error("仅待审核申请可拒绝");
    }
    const rejectReason = reason.trim();
    if (!rejectReason) {
      throw new Error("拒绝原因不能为空");
    }
    const updated: InvoiceRequest = {
      ...existing,
      status: "rejected",
      rejectReason,
    };
    store.requests[requestId] = updated;
    appendRequestEvent(store, updated, existing.status, "rejected", rejectReason);
    await saveStore(store, storePath);
    return updated;
  });
}

export async function __resetInvoiceRequestsForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}

/** 测试注入历史脏数据（如裸总额无 allocations）。 */
export async function __putInvoiceRequestForTest(
  request: InvoiceRequest,
  storePath?: string,
): Promise<void> {
  await withLock(async () => {
    const store = await loadStore(storePath);
    store.requests[request.id] = {
      ...request,
      enterpriseId: tenant(request.enterpriseId),
    };
    await saveStore(store, storePath);
  });
}
