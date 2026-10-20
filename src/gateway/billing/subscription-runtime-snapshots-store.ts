/**
 * Subscription Runtime Snapshot — 订阅生效后的运行时商业事实单对象真相。
 *
 * 归属链（P0 冻结语义，P1 正式落地 ownerSeatId）：
 *   Enterprise -> Seat -> Bot -> Run
 *
 * 落盘：`CONFIG_DIR/openbot-subscription-runtime-snapshots.json`。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import type { EnterpriseBillingMode } from "../package-entitlement/billing-mode.js";
import type {
  EntitlementOveragePolicy,
  EntitlementSnapshot,
} from "../package-entitlement/types.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import type { BillingCycle } from "./types.js";

const STORE_VERSION = 1;

/** P1 扩展 ConcurrencyPolicy；P0 仅 block 硬并发。 */
export type RuntimeConcurrencyPolicy = {
  includedRuns: number;
  maxBurstRuns: number;
  overagePricePerRunCents?: number;
  mode: "block" | "queue" | "pay_as_you_go";
};

export type RuntimeEntitlementSnapshot = {
  maxSeats: EntitlementSnapshot["maxSeats"];
  maxBots: number;
  maxConcurrentRuns: number;
  concurrencyPolicy?: RuntimeConcurrencyPolicy;
  monthlyCredits: number;
  allowedTiers: string[];
  allowedPolicies: string[];
  allowCustomPolicy?: boolean;
  allowPrivateModels?: boolean;
  overagePolicy: EntitlementOveragePolicy;
  maxWorkflows?: number;
  maxKnowledgeBases?: number;
  features?: EntitlementSnapshot["features"];
};

export type RuntimeModelBindingSnapshot = {
  allowedModelIds: string[];
  allowedTiers: string[];
  allowedPolicies: string[];
  policyId?: string;
};

export type SubscriptionRuntimeSnapshot = {
  id: string;
  enterpriseId: string;
  subscriptionId: string;
  planId: string;
  planVersionId: string;
  pricingSnapshot: {
    billingCycle: BillingCycle;
    basePriceCents: number;
  };
  entitlementSnapshot: RuntimeEntitlementSnapshot;
  modelBindingSnapshot: RuntimeModelBindingSnapshot;
  billingMode: EnterpriseBillingMode;
  effectiveAt: string;
  expiresAt?: string;
  createdAt: string;
};

type Store = {
  version: number;
  /** key = snapshot id */
  snapshots: Record<string, SubscriptionRuntimeSnapshot>;
  /** enterpriseId -> active snapshot id */
  activeByEnterprise: Record<string, string>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, snapshots: {}, activeByEnterprise: {} };
}

export function resolveDefaultSubscriptionRuntimeSnapshotsStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-subscription-runtime-snapshots.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultSubscriptionRuntimeSnapshotsStorePath(),
  );
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.snapshots !== "object" || parsed.snapshots === null) {
    return createEmptyStore();
  }
  return {
    version: STORE_VERSION,
    snapshots: parsed.snapshots,
    activeByEnterprise: parsed.activeByEnterprise ?? {},
  };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultSubscriptionRuntimeSnapshotsStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

export async function getSubscriptionRuntimeSnapshot(
  snapshotId: string,
  storePath?: string,
): Promise<SubscriptionRuntimeSnapshot | null> {
  const id = snapshotId.trim();
  if (!id) {
    return null;
  }
  const store = await loadStore(storePath);
  return store.snapshots[id] ?? null;
}

/** 读取企业当前生效的 runtime snapshot。 */
export async function getActiveSubscriptionRuntimeSnapshot(
  enterpriseId: string,
  storePath?: string,
): Promise<SubscriptionRuntimeSnapshot | null> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  const activeId = store.activeByEnterprise[t];
  if (!activeId) {
    return null;
  }
  return store.snapshots[activeId] ?? null;
}

export type AppendSubscriptionRuntimeSnapshotInput = {
  enterpriseId: string;
  subscriptionId: string;
  planId: string;
  planVersionId: string;
  pricingSnapshot: SubscriptionRuntimeSnapshot["pricingSnapshot"];
  entitlementSnapshot: RuntimeEntitlementSnapshot;
  modelBindingSnapshot: RuntimeModelBindingSnapshot;
  billingMode: EnterpriseBillingMode;
  effectiveAt?: string;
  expiresAt?: string;
};

/** 追加新 snapshot 并设为该企业当前生效快照（历史快照保留可审计）。 */
export async function appendSubscriptionRuntimeSnapshot(
  input: AppendSubscriptionRuntimeSnapshotInput,
  storePath?: string,
): Promise<SubscriptionRuntimeSnapshot> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(input.enterpriseId);
    const now = new Date().toISOString();
    const snapshot: SubscriptionRuntimeSnapshot = {
      id: `srs-${randomUUID()}`,
      enterpriseId: t,
      subscriptionId: input.subscriptionId.trim(),
      planId: input.planId.trim(),
      planVersionId: input.planVersionId.trim(),
      pricingSnapshot: input.pricingSnapshot,
      entitlementSnapshot: input.entitlementSnapshot,
      modelBindingSnapshot: input.modelBindingSnapshot,
      billingMode: input.billingMode,
      effectiveAt: input.effectiveAt ?? now,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      createdAt: now,
    };
    store.snapshots[snapshot.id] = snapshot;
    store.activeByEnterprise[t] = snapshot.id;
    await saveStore(store, storePath);
    return snapshot;
  });
}

export async function listSubscriptionRuntimeSnapshotsForEnterprise(
  enterpriseId: string,
  storePath?: string,
): Promise<SubscriptionRuntimeSnapshot[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return Object.values(store.snapshots)
    .filter((s) => s.enterpriseId === t)
    .toSorted((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
}

export async function __resetSubscriptionRuntimeSnapshotsForTest(
  storePath?: string,
): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
