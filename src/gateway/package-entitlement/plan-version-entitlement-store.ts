/**
 * PlanVersion → EntitlementSnapshot 旁路 store。
 * 落盘：`CONFIG_DIR/openbot-plan-entitlement-snapshot.json`。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { assertPlanVersionCapabilityMutable } from "../billing/plan-version-capability-guard.js";
import type { SeatRole } from "../billing/types.js";
import {
  DEFAULT_OVERAGE_POLICY,
  defaultMaxConcurrentRuns,
  normalizeEntitlementSnapshot,
} from "./normalize-entitlement.js";
import type { EntitlementSnapshot } from "./types.js";

const STORE_VERSION = 1;

type Store = {
  version: number;
  snapshots: Record<string, EntitlementSnapshot>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, snapshots: {} };
}

export function resolveDefaultPlanEntitlementStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-plan-entitlement-snapshot.json");
}

const withLock = createAsyncLock();

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultPlanEntitlementStorePath(),
  );
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.snapshots !== "object" || parsed.snapshots === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, snapshots: parsed.snapshots };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultPlanEntitlementStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

export async function getPlanEntitlementSnapshot(
  planVersionId: string,
  storePath?: string,
): Promise<EntitlementSnapshot | null> {
  const id = planVersionId.trim();
  if (!id) {
    return null;
  }
  const store = await loadStore(storePath);
  const raw = store.snapshots[id];
  return raw ? normalizeEntitlementSnapshot(raw) : null;
}

export async function upsertPlanEntitlementSnapshot(
  input: {
    planVersionId: string;
    monthlyPriceCents: number;
    monthlyCredits: number;
    maxSeats?: Partial<Record<SeatRole, number>>;
    maxBots: number;
    aiProfileQuota?: Partial<Record<"basic" | "pro" | "elite", number>>;
    maxConcurrentRuns?: number;
    maxWorkflows?: number;
    maxKnowledgeBases?: number;
    allowedPolicies?: string[];
    allowedTiers?: string[];
    allowCustomPolicy?: boolean;
    allowPrivateModels?: boolean;
    overagePolicy?: EntitlementSnapshot["overagePolicy"];
    features?: EntitlementSnapshot["features"];
  },
  storePath?: string,
  relatedStorePaths?: { plans?: string; subscriptions?: string },
): Promise<EntitlementSnapshot> {
  const id = input.planVersionId.trim();
  if (!id) {
    throw new Error("invalid planVersionId");
  }
  if (input.monthlyPriceCents < 0 || input.monthlyCredits < 0 || input.maxBots < 0) {
    throw new Error("monthlyPriceCents / monthlyCredits / maxBots must be non-negative");
  }
  const store = await loadStore(storePath);
  const hasExistingRecord = Boolean(store.snapshots[id]);
  await assertPlanVersionCapabilityMutable(
    id,
    {
      kind: "entitlement",
      hasExistingRecord,
    },
    relatedStorePaths?.plans,
    relatedStorePaths?.subscriptions,
  );
  return withLock(async () => {
    const storeLocked = await loadStore(storePath);
    const maxBots = Math.floor(input.maxBots);
    const record: EntitlementSnapshot = normalizeEntitlementSnapshot({
      planVersionId: id,
      monthlyPriceCents: Math.floor(input.monthlyPriceCents),
      monthlyCredits: Math.floor(input.monthlyCredits),
      maxSeats: input.maxSeats ?? {},
      maxBots,
      ...(input.aiProfileQuota ? { aiProfileQuota: input.aiProfileQuota } : {}),
      maxConcurrentRuns:
        input.maxConcurrentRuns !== undefined
          ? Math.max(0, Math.floor(input.maxConcurrentRuns))
          : defaultMaxConcurrentRuns(maxBots),
      ...(input.maxWorkflows !== undefined ? { maxWorkflows: Math.floor(input.maxWorkflows) } : {}),
      ...(input.maxKnowledgeBases !== undefined
        ? { maxKnowledgeBases: Math.floor(input.maxKnowledgeBases) }
        : {}),
      allowedPolicies: dedupeStrings(input.allowedPolicies ?? []),
      allowedTiers: dedupeStrings(input.allowedTiers ?? []),
      ...(input.allowCustomPolicy !== undefined
        ? { allowCustomPolicy: input.allowCustomPolicy }
        : {}),
      ...(input.allowPrivateModels !== undefined
        ? { allowPrivateModels: input.allowPrivateModels }
        : {}),
      overagePolicy: input.overagePolicy ?? DEFAULT_OVERAGE_POLICY,
      ...(input.features ? { features: { ...input.features } } : {}),
      updatedAt: new Date().toISOString(),
    });
    storeLocked.snapshots[id] = record;
    await saveStore(storeLocked, storePath);
    return record;
  });
}

export async function deletePlanEntitlementSnapshot(
  planVersionId: string,
  storePath?: string,
): Promise<boolean> {
  const id = planVersionId.trim();
  if (!id) {
    return false;
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    if (!store.snapshots[id]) {
      return false;
    }
    delete store.snapshots[id];
    await saveStore(store, storePath);
    return true;
  });
}

export async function listPlanEntitlementSnapshots(
  storePath?: string,
): Promise<EntitlementSnapshot[]> {
  const store = await loadStore(storePath);
  return Object.values(store.snapshots).map(normalizeEntitlementSnapshot);
}
