/**
 * 商业订单 store（append-only 状态事件）。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { appendLedgerRecord } from "../billing/append-only-ledger.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import type {
  CommercialOrder,
  CommercialOrderEvent,
  CommercialOrderKind,
  CommercialOrderStatus,
  CommercialPaymentMethod,
} from "./types.js";

const STORE_VERSION = 1;

type CommercialOrdersStore = {
  version: number;
  orders: Record<string, CommercialOrder>;
  events: CommercialOrderEvent[];
};

function createEmptyStore(): CommercialOrdersStore {
  return { version: STORE_VERSION, orders: {}, events: [] };
}

export function resolveDefaultCommercialOrdersStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-commercial-orders.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<CommercialOrdersStore> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultCommercialOrdersStorePath(),
  );
  const parsed = await readJsonFile<Partial<CommercialOrdersStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  return {
    version: STORE_VERSION,
    orders: parsed.orders ?? {},
    events: Array.isArray(parsed.events) ? parsed.events : [],
  };
}

async function saveStore(store: CommercialOrdersStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultCommercialOrdersStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

function appendOrderEvent(
  store: CommercialOrdersStore,
  order: CommercialOrder,
  fromStatus: CommercialOrderStatus | null,
  toStatus: CommercialOrderStatus,
  note?: string,
): void {
  store.events = appendLedgerRecord(store.events, {
    id: `ord-ev-${randomUUID()}`,
    orderId: order.id,
    enterpriseId: order.enterpriseId,
    fromStatus,
    toStatus,
    occurredAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  });
}

export type CreateCommercialOrderInput = {
  enterpriseId: string;
  kind: CommercialOrderKind;
  amountCents: number;
  lineItems: CommercialOrder["lineItems"];
  billingCycle?: CommercialOrder["billingCycle"];
  planId?: string;
  planVersionId?: string;
  fromPlanId?: string;
  targetPlanId?: string;
  targetPlanVersionId?: string;
  creditPackId?: string;
  subscriptionId?: string;
  pendingSubscriptionId?: string;
  paymentMethod?: CommercialPaymentMethod;
  initialStatus?: CommercialOrderStatus;
  quotedPlanVersionIds?: string[];
  salesLeadId?: string;
};

export async function createCommercialOrder(
  input: CreateCommercialOrderInput,
  storePath?: string,
): Promise<CommercialOrder> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(input.enterpriseId);
    const now = new Date().toISOString();
    const status = input.initialStatus ?? "pending_payment";
    const order: CommercialOrder = {
      id: `ord-${randomUUID()}`,
      enterpriseId: t,
      kind: input.kind,
      status,
      amountCents: Math.max(0, Math.round(input.amountCents)),
      currency: "CNY",
      lineItems: input.lineItems,
      createdAt: now,
      ...(input.billingCycle ? { billingCycle: input.billingCycle } : {}),
      ...(input.planId ? { planId: input.planId } : {}),
      ...(input.planVersionId ? { planVersionId: input.planVersionId } : {}),
      ...(input.fromPlanId ? { fromPlanId: input.fromPlanId } : {}),
      ...(input.targetPlanId ? { targetPlanId: input.targetPlanId } : {}),
      ...(input.targetPlanVersionId ? { targetPlanVersionId: input.targetPlanVersionId } : {}),
      ...(input.creditPackId ? { creditPackId: input.creditPackId } : {}),
      ...(input.subscriptionId ? { subscriptionId: input.subscriptionId } : {}),
      ...(input.pendingSubscriptionId
        ? { pendingSubscriptionId: input.pendingSubscriptionId }
        : {}),
      ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
      ...(input.quotedPlanVersionIds?.length
        ? { quotedPlanVersionIds: input.quotedPlanVersionIds }
        : {}),
      ...(input.salesLeadId ? { salesLeadId: input.salesLeadId } : {}),
      fulfillmentStatus: status === "paid" ? "pending" : "none",
      ...(status === "paid" ? { paidAt: now } : {}),
    };
    store.orders[order.id] = order;
    appendOrderEvent(store, order, null, status);
    await saveStore(store, storePath);
    return order;
  });
}

export async function getCommercialOrder(
  enterpriseId: string,
  orderId: string,
  storePath?: string,
): Promise<CommercialOrder | null> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  const order = store.orders[orderId];
  return order && order.enterpriseId === t ? order : null;
}

export async function getCommercialOrderById(
  orderId: string,
  storePath?: string,
): Promise<CommercialOrder | null> {
  const store = await loadStore(storePath);
  return store.orders[orderId] ?? null;
}

/** 租户隔离读取：enterpriseId 不匹配返回 null（Property 5）。 */
export async function getCommercialOrderForEnterprise(
  enterpriseId: string,
  orderId: string,
  storePath?: string,
): Promise<CommercialOrder | null> {
  const order = await getCommercialOrder(enterpriseId, orderId, storePath);
  return order;
}

export async function listCommercialOrders(
  enterpriseId: string,
  opts?: { status?: CommercialOrderStatus; limit?: number },
  storePath?: string,
): Promise<CommercialOrder[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  let rows = Object.values(store.orders).filter((order) => order.enterpriseId === t);
  if (opts?.status) {
    rows = rows.filter((order) => order.status === opts.status);
  }
  rows = rows.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (opts?.limit && opts.limit > 0) {
    rows = rows.slice(0, opts.limit);
  }
  return rows;
}

export async function listAllCommercialOrders(
  opts?: { status?: CommercialOrderStatus; limit?: number },
  storePath?: string,
): Promise<CommercialOrder[]> {
  const store = await loadStore(storePath);
  let rows = Object.values(store.orders);
  if (opts?.status) {
    rows = rows.filter((order) => order.status === opts.status);
  }
  rows = rows.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (opts?.limit && opts.limit > 0) {
    rows = rows.slice(0, opts.limit);
  }
  return rows;
}

export async function transitionCommercialOrderStatus(
  enterpriseId: string,
  orderId: string,
  toStatus: CommercialOrderStatus,
  patch?: Partial<
    Pick<
      CommercialOrder,
      | "paidAt"
      | "fulfilledAt"
      | "subscriptionId"
      | "fulfillmentStatus"
      | "fulfillmentError"
      | "contractStart"
      | "contractEnd"
    >
  >,
  storePath?: string,
): Promise<CommercialOrder | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    const existing = store.orders[orderId];
    if (!existing || existing.enterpriseId !== t) {
      return null;
    }
    const now = new Date().toISOString();
    const updated: CommercialOrder = {
      ...existing,
      status: toStatus,
      ...(patch?.paidAt ? { paidAt: patch.paidAt } : {}),
      ...(patch?.fulfilledAt ? { fulfilledAt: patch.fulfilledAt } : {}),
      ...(patch?.subscriptionId ? { subscriptionId: patch.subscriptionId } : {}),
      ...(patch?.fulfillmentStatus ? { fulfillmentStatus: patch.fulfillmentStatus } : {}),
      ...(patch?.fulfillmentError !== undefined
        ? { fulfillmentError: patch.fulfillmentError }
        : {}),
      ...(patch?.contractStart ? { contractStart: patch.contractStart } : {}),
      ...(patch?.contractEnd ? { contractEnd: patch.contractEnd } : {}),
    };
    if (toStatus === "paid" && !updated.paidAt) {
      updated.paidAt = now;
    }
    store.orders[orderId] = updated;
    appendOrderEvent(store, updated, existing.status, toStatus);
    await saveStore(store, storePath);
    return updated;
  });
}

export async function hasOrderFulfillmentEvent(
  orderId: string,
  storePath?: string,
): Promise<boolean> {
  const store = await loadStore(storePath);
  return store.events.some(
    (event) => event.orderId === orderId && event.note === "fulfillment:done",
  );
}

export async function markOrderFulfilled(
  enterpriseId: string,
  orderId: string,
  subscriptionId?: string,
  storePath?: string,
): Promise<CommercialOrder | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    const existing = store.orders[orderId];
    if (!existing || existing.enterpriseId !== t) {
      return null;
    }
    if (store.events.some((e) => e.orderId === orderId && e.note === "fulfillment:done")) {
      return existing;
    }
    const now = new Date().toISOString();
    const updated: CommercialOrder = {
      ...existing,
      fulfilledAt: now,
      fulfillmentStatus: "done",
      fulfillmentError: undefined,
      ...(subscriptionId ? { subscriptionId } : {}),
    };
    store.orders[orderId] = updated;
    appendOrderEvent(store, updated, existing.status, existing.status, "fulfillment:done");
    await saveStore(store, storePath);
    return updated;
  });
}

export async function listPaidUnfulfilledOrders(storePath?: string): Promise<CommercialOrder[]> {
  const store = await loadStore(storePath);
  return Object.values(store.orders).filter(
    (order) =>
      order.status === "paid" &&
      order.fulfillmentStatus !== "done" &&
      !store.events.some((e) => e.orderId === order.id && e.note === "fulfillment:done"),
  );
}

export async function __resetCommercialOrdersForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
