/**
 * Preflight Credits reservation — durable hold keyed by runId.
 *
 * Lifecycle: held → settled | released
 * Idempotent: same runId re-reserve returns existing held/settled record.
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";

const STORE_VERSION = 1;

export type CreditReservationStatus = "held" | "settled" | "released";

export type CreditReservation = {
  reservationId: string;
  runId: string;
  enterpriseId: string;
  authorizationDecisionId: string;
  subscriptionId: string;
  subscriptionSnapshotId: string;
  planId: string;
  planVersionId: string;
  reservedCredits: number;
  status: CreditReservationStatus;
  heldAt: string;
  settledAt?: string;
  releasedAt?: string;
  actualCredits?: number;
};

type Store = {
  version: number;
  byRunId: Record<string, CreditReservation>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, byRunId: {} };
}

export function resolveDefaultCreditReservationStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-credit-reservations.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolved = resolveUserPath(storePath?.trim() || resolveDefaultCreditReservationStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolved);
  if (!parsed || typeof parsed.byRunId !== "object" || parsed.byRunId === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, byRunId: parsed.byRunId };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolved = resolveUserPath(storePath?.trim() || resolveDefaultCreditReservationStorePath());
  await writeJsonAtomic(resolved, store);
}

export async function getCreditReservation(
  runId: string,
  storePath?: string,
): Promise<CreditReservation | null> {
  const id = runId.trim();
  if (!id) {
    return null;
  }
  const store = await loadStore(storePath);
  return store.byRunId[id] ?? null;
}

export type TryHoldCreditReservationResult =
  | { ok: true; reservation: CreditReservation }
  | {
      ok: false;
      reason: "INSUFFICIENT_CREDITS";
      available: number;
      held: number;
      required: number;
    };

function sumHeldInStore(store: Store, enterpriseId: string, excludeRunId?: string): number {
  let total = 0;
  for (const record of Object.values(store.byRunId)) {
    if (record.status !== "held") {
      continue;
    }
    if (record.enterpriseId !== enterpriseId) {
      continue;
    }
    if (excludeRunId && record.runId === excludeRunId) {
      continue;
    }
    total += record.reservedCredits;
  }
  return total;
}

/**
 * Atomically recompute held total + write hold under one lock.
 * `availableCredits` is the tenant ledger remaining **before** any holds
 * (not reduced by held); held is recomputed inside the lock so concurrent
 * authorize cannot both pass against the last credit.
 */
export async function tryHoldCreditReservation(input: {
  runId: string;
  enterpriseId: string;
  authorizationDecisionId: string;
  subscriptionId: string;
  subscriptionSnapshotId: string;
  planId: string;
  planVersionId: string;
  reservedCredits: number;
  /** Ledger remaining excluding holds (from tenant credits status). */
  availableCredits: number;
  /** PAYG: allow hold even when available - held < required. */
  allowOverage?: boolean;
  storePath?: string;
}): Promise<TryHoldCreditReservationResult> {
  const runId = input.runId.trim();
  if (!runId) {
    throw new Error("runId is required for credit reservation");
  }
  const enterpriseId = canonicalizeTenantId(input.enterpriseId) ?? input.enterpriseId.trim();
  const reservedCredits = Math.max(0, Math.floor(input.reservedCredits));
  const availableCredits = Math.max(0, Math.floor(input.availableCredits));

  return withLock(async () => {
    const store = await loadStore(input.storePath);
    const existing = store.byRunId[runId];
    if (existing && (existing.status === "held" || existing.status === "settled")) {
      return { ok: true, reservation: existing };
    }

    const held = sumHeldInStore(store, enterpriseId, runId);
    const free = Math.max(0, availableCredits - held);
    if (reservedCredits > free && !input.allowOverage) {
      return {
        ok: false,
        reason: "INSUFFICIENT_CREDITS",
        available: free,
        held,
        required: reservedCredits,
      };
    }

    const now = new Date().toISOString();
    const record: CreditReservation = {
      reservationId: `cresv-${runId}`,
      runId,
      enterpriseId,
      authorizationDecisionId: input.authorizationDecisionId,
      subscriptionId: input.subscriptionId,
      subscriptionSnapshotId: input.subscriptionSnapshotId,
      planId: input.planId,
      planVersionId: input.planVersionId,
      reservedCredits,
      status: "held",
      heldAt: now,
    };
    store.byRunId[runId] = record;
    await saveStore(store, input.storePath);
    return { ok: true, reservation: record };
  });
}

/** Unconditional hold (tests / callers that already serialized checks). Prefer tryHold. */
export async function holdCreditReservation(input: {
  runId: string;
  enterpriseId: string;
  authorizationDecisionId: string;
  subscriptionId: string;
  subscriptionSnapshotId: string;
  planId: string;
  planVersionId: string;
  reservedCredits: number;
  storePath?: string;
}): Promise<CreditReservation> {
  const result = await tryHoldCreditReservation({
    ...input,
    availableCredits: Number.MAX_SAFE_INTEGER,
    allowOverage: true,
  });
  if (!result.ok) {
    throw new Error("holdCreditReservation failed unexpectedly");
  }
  return result.reservation;
}

export async function settleCreditReservation(input: {
  runId: string;
  actualCredits: number;
  storePath?: string;
}): Promise<CreditReservation | null> {
  const runId = input.runId.trim();
  if (!runId) {
    return null;
  }
  const actualCredits = Math.max(0, Math.floor(input.actualCredits));
  return withLock(async () => {
    const store = await loadStore(input.storePath);
    const existing = store.byRunId[runId];
    if (!existing) {
      return null;
    }
    if (existing.status === "settled") {
      return existing;
    }
    if (existing.status === "released") {
      return existing;
    }
    const now = new Date().toISOString();
    const next: CreditReservation = {
      ...existing,
      status: "settled",
      actualCredits,
      settledAt: now,
    };
    store.byRunId[runId] = next;
    await saveStore(store, input.storePath);
    return next;
  });
}

export async function releaseCreditReservation(input: {
  runId: string;
  storePath?: string;
}): Promise<CreditReservation | null> {
  const runId = input.runId.trim();
  if (!runId) {
    return null;
  }
  return withLock(async () => {
    const store = await loadStore(input.storePath);
    const existing = store.byRunId[runId];
    if (!existing) {
      return null;
    }
    if (existing.status === "settled" || existing.status === "released") {
      return existing;
    }
    const now = new Date().toISOString();
    const next: CreditReservation = {
      ...existing,
      status: "released",
      releasedAt: now,
    };
    store.byRunId[runId] = next;
    await saveStore(store, input.storePath);
    return next;
  });
}

/** Sum of held reserved credits for an enterprise (excludes settled/released). */
export async function sumHeldReservationsForEnterprise(
  enterpriseId: string,
  storePath?: string,
): Promise<number> {
  const tid = canonicalizeTenantId(enterpriseId) ?? enterpriseId.trim();
  const store = await loadStore(storePath);
  let total = 0;
  for (const record of Object.values(store.byRunId)) {
    if (record.status === "held" && record.enterpriseId === tid) {
      total += record.reservedCredits;
    }
  }
  return total;
}
