/**
 * 支付记录 store。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { appendLedgerRecord } from "../billing/append-only-ledger.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import type { Payment, PaymentEvent, PaymentProvider, PaymentStatus } from "./types.js";

const STORE_VERSION = 1;

type PaymentsStore = {
  version: number;
  payments: Record<string, Payment>;
  events: PaymentEvent[];
};

function createEmptyStore(): PaymentsStore {
  return { version: STORE_VERSION, payments: {}, events: [] };
}

export function resolveDefaultPaymentsStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-commercial-payments.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<PaymentsStore> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultPaymentsStorePath());
  const parsed = await readJsonFile<Partial<PaymentsStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  return {
    version: STORE_VERSION,
    payments: parsed.payments ?? {},
    events: Array.isArray(parsed.events) ? parsed.events : [],
  };
}

async function saveStore(store: PaymentsStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultPaymentsStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

function appendPaymentEvent(
  store: PaymentsStore,
  payment: Payment,
  fromStatus: PaymentStatus | null,
  toStatus: PaymentStatus,
): void {
  store.events = appendLedgerRecord(store.events, {
    id: `pay-ev-${randomUUID()}`,
    paymentId: payment.id,
    enterpriseId: payment.enterpriseId,
    fromStatus,
    toStatus,
    occurredAt: new Date().toISOString(),
  });
}

export type CreatePaymentInput = {
  orderId: string;
  enterpriseId: string;
  provider: PaymentProvider;
  amountCents: number;
  requestId?: string;
};

export async function createPayment(
  input: CreatePaymentInput,
  storePath?: string,
): Promise<Payment> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    if (input.requestId) {
      const existing = Object.values(store.payments).find(
        (payment) => payment.requestId === input.requestId,
      );
      if (existing) {
        return existing;
      }
    }
    const now = new Date().toISOString();
    const payment: Payment = {
      id: `pay-${randomUUID()}`,
      orderId: input.orderId,
      enterpriseId: tenant(input.enterpriseId),
      provider: input.provider,
      status: "pending",
      amountCents: Math.max(0, Math.round(input.amountCents)),
      createdAt: now,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    };
    store.payments[payment.id] = payment;
    appendPaymentEvent(store, payment, null, "pending");
    await saveStore(store, storePath);
    return payment;
  });
}

export async function getPayment(paymentId: string, storePath?: string): Promise<Payment | null> {
  const store = await loadStore(storePath);
  return store.payments[paymentId] ?? null;
}

/** 租户隔离读取（Property 5）。 */
export async function getPaymentForEnterprise(
  enterpriseId: string,
  paymentId: string,
  storePath?: string,
): Promise<Payment | null> {
  const payment = await getPayment(paymentId, storePath);
  if (!payment) {
    return null;
  }
  const t = tenant(enterpriseId);
  return payment.enterpriseId === t ? payment : null;
}

export async function listPaymentsForOrder(
  enterpriseId: string,
  orderId: string,
  storePath?: string,
): Promise<Payment[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return Object.values(store.payments)
    .filter((payment) => payment.orderId === orderId && payment.enterpriseId === t)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function findPaymentByProviderRef(
  providerRef: string,
  storePath?: string,
): Promise<Payment | null> {
  const store = await loadStore(storePath);
  return (
    Object.values(store.payments).find((payment) => payment.providerRef === providerRef) ?? null
  );
}

export async function patchPayment(
  paymentId: string,
  patch: Partial<Pick<Payment, "checkoutUrl" | "providerRef">>,
  storePath?: string,
): Promise<Payment | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.payments[paymentId];
    if (!existing) {
      return null;
    }
    const updated: Payment = {
      ...existing,
      ...(patch.checkoutUrl !== undefined ? { checkoutUrl: patch.checkoutUrl } : {}),
      ...(patch.providerRef !== undefined ? { providerRef: patch.providerRef } : {}),
    };
    store.payments[paymentId] = updated;
    await saveStore(store, storePath);
    return updated;
  });
}

export async function transitionPaymentStatus(
  paymentId: string,
  toStatus: PaymentStatus,
  patch?: Partial<Pick<Payment, "paidAt" | "confirmedByUserId" | "providerRef">>,
  storePath?: string,
): Promise<Payment | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.payments[paymentId];
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    const updated: Payment = {
      ...existing,
      status: toStatus,
      ...(patch?.confirmedByUserId ? { confirmedByUserId: patch.confirmedByUserId } : {}),
      ...(patch?.providerRef ? { providerRef: patch.providerRef } : {}),
      ...(patch?.paidAt ? { paidAt: patch.paidAt } : {}),
    };
    if (toStatus === "paid" && !updated.paidAt) {
      updated.paidAt = now;
    }
    store.payments[paymentId] = updated;
    appendPaymentEvent(store, updated, existing.status, toStatus);
    await saveStore(store, storePath);
    return updated;
  });
}

export async function __resetPaymentsForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
