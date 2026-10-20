/**
 * 租户开票资料 store（append-only 变更历史）。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { appendLedgerRecord } from "../billing/append-only-ledger.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import type { BillingProfileEvent, TenantBillingProfile } from "./types.js";

const STORE_VERSION = 1;

type BillingProfilesStore = {
  version: number;
  profiles: Record<string, TenantBillingProfile>;
  events: BillingProfileEvent[];
};

function createEmptyStore(): BillingProfilesStore {
  return { version: STORE_VERSION, profiles: {}, events: [] };
}

export function resolveDefaultBillingProfilesStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-billing-profiles.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<BillingProfilesStore> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultBillingProfilesStorePath(),
  );
  const parsed = await readJsonFile<Partial<BillingProfilesStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  return {
    version: STORE_VERSION,
    profiles: parsed.profiles ?? {},
    events: Array.isArray(parsed.events) ? parsed.events : [],
  };
}

async function saveStore(store: BillingProfilesStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultBillingProfilesStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

export function isBillingProfileComplete(
  profile: TenantBillingProfile | null | undefined,
): boolean {
  if (!profile) {
    return false;
  }
  return Boolean(profile.legalName.trim() && profile.taxId.trim() && profile.invoiceType);
}

export type UpsertBillingProfileInput = {
  enterpriseId: string;
  legalName: string;
  taxId: string;
  invoiceType: TenantBillingProfile["invoiceType"];
  bankAccount?: string;
  address?: string;
  contactEmail?: string;
};

export async function getBillingProfile(
  enterpriseId: string,
  storePath?: string,
): Promise<TenantBillingProfile | null> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return store.profiles[t] ?? null;
}

export async function upsertBillingProfile(
  input: UpsertBillingProfileInput,
  storePath?: string,
): Promise<TenantBillingProfile> {
  const legalName = input.legalName.trim();
  const taxId = input.taxId.trim();
  if (!legalName || !taxId || !input.invoiceType) {
    throw new Error("法定名称、税号与发票类型为必填项");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(input.enterpriseId);
    const now = new Date().toISOString();
    const profile: TenantBillingProfile = {
      enterpriseId: t,
      legalName,
      taxId,
      invoiceType: input.invoiceType,
      updatedAt: now,
      ...(input.bankAccount?.trim() ? { bankAccount: input.bankAccount.trim() } : {}),
      ...(input.address?.trim() ? { address: input.address.trim() } : {}),
      ...(input.contactEmail?.trim() ? { contactEmail: input.contactEmail.trim() } : {}),
    };
    store.profiles[t] = profile;
    store.events = appendLedgerRecord(store.events, {
      id: `bp-ev-${randomUUID()}`,
      enterpriseId: t,
      profile,
      occurredAt: now,
    });
    await saveStore(store, storePath);
    return profile;
  });
}

export async function listBillingProfileEvents(
  enterpriseId: string,
  storePath?: string,
): Promise<BillingProfileEvent[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return store.events.filter((event) => event.enterpriseId === t);
}

export async function __resetBillingProfilesForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
