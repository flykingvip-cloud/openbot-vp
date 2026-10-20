/**
 * Per-tenant capability pack entitlements.
 *
 * Stored under CONFIG_DIR/governance/tenant-pack-entitlements.json so it rides
 * alongside the global capability registry on single-operator and SaaS hosts.
 */

import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import {
  DEFAULT_NEW_TENANT_PACK_IDS,
  findPackIdsForSkillKey,
  getPackById,
  resolveAutoEntitlePackIds,
  skillKeysForPackIds,
  type CapabilityPackId,
} from "./starter-packs.js";

const ENTITLEMENTS_FILE = path.join(CONFIG_DIR, "governance", "tenant-pack-entitlements.json");

export type TenantPackEntitlementRecord = {
  tenantId: string;
  packIds: CapabilityPackId[];
  plan?: string;
  source: "auto-provision" | "seed" | "manual" | "import";
  createdAt: string;
  updatedAt: string;
};

type EntitlementsStore = {
  version: 1;
  tenants: Record<string, TenantPackEntitlementRecord>;
};

function ensureDir(): void {
  const dir = path.dirname(ENTITLEMENTS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readStore(): EntitlementsStore {
  try {
    if (!fs.existsSync(ENTITLEMENTS_FILE)) {
      return { version: 1, tenants: {} };
    }
    const raw = JSON.parse(fs.readFileSync(ENTITLEMENTS_FILE, "utf-8")) as EntitlementsStore;
    if (!raw || typeof raw !== "object" || !raw.tenants || typeof raw.tenants !== "object") {
      return { version: 1, tenants: {} };
    }
    return { version: 1, tenants: raw.tenants };
  } catch {
    return { version: 1, tenants: {} };
  }
}

function writeStore(store: EntitlementsStore): void {
  ensureDir();
  fs.writeFileSync(ENTITLEMENTS_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

function normalizePackIds(packIds: Iterable<string>): CapabilityPackId[] {
  const out: CapabilityPackId[] = [];
  for (const id of packIds) {
    const pack = getPackById(id);
    if (pack && !out.includes(pack.id)) {
      out.push(pack.id);
    }
  }
  return out;
}

export function getTenantPackEntitlement(tenantId: string): TenantPackEntitlementRecord | null {
  const id = tenantId.trim();
  if (!id) {
    return null;
  }
  return readStore().tenants[id] ?? null;
}

export function listTenantPackEntitlements(): TenantPackEntitlementRecord[] {
  return Object.values(readStore().tenants);
}

/**
 * Upsert pack entitlement for a tenant. Replaces packIds unless merge=true.
 */
export function grantTenantPacks(params: {
  tenantId: string;
  packIds: Iterable<string>;
  plan?: string;
  source?: TenantPackEntitlementRecord["source"];
  merge?: boolean;
}): TenantPackEntitlementRecord {
  const tenantId = params.tenantId.trim();
  if (!tenantId) {
    throw new Error("tenantId is required");
  }
  const store = readStore();
  const now = new Date().toISOString();
  const existing = store.tenants[tenantId];
  const incoming = normalizePackIds(params.packIds);
  const packIds =
    params.merge && existing
      ? normalizePackIds([...existing.packIds, ...incoming])
      : incoming.length > 0
        ? incoming
        : [...DEFAULT_NEW_TENANT_PACK_IDS];

  const record: TenantPackEntitlementRecord = {
    tenantId,
    packIds,
    ...(params.plan?.trim()
      ? { plan: params.plan.trim() }
      : existing?.plan
        ? { plan: existing.plan }
        : {}),
    source: params.source ?? "manual",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  store.tenants[tenantId] = record;
  writeStore(store);
  return record;
}

/** Grant default packs for a plan (trial/business/…). Idempotent merge. */
export function entitleTenantForPlan(params: {
  tenantId: string;
  plan?: string | null;
  source?: TenantPackEntitlementRecord["source"];
  /** When set, overrides plan-name defaults (from EntitlementSnapshot.capabilityPackIds). */
  packIds?: Iterable<string>;
}): TenantPackEntitlementRecord {
  const packIds = params.packIds ? [...params.packIds] : resolveAutoEntitlePackIds(params.plan);
  return grantTenantPacks({
    tenantId: params.tenantId,
    packIds,
    plan: params.plan ?? undefined,
    source: params.source ?? "auto-provision",
    merge: true,
  });
}

/**
 * Apply pack entitlements from a plan version snapshot when available;
 * otherwise fall back to plan-name defaults.
 */
export async function entitleTenantFromPlanVersion(params: {
  tenantId: string;
  planVersionId?: string | null;
  planName?: string | null;
  source?: TenantPackEntitlementRecord["source"];
}): Promise<TenantPackEntitlementRecord> {
  const planVersionId = params.planVersionId?.trim();
  if (planVersionId) {
    try {
      const { resolvePlanVersionEntitlement } =
        await import("../package-entitlement/resolve-plan-version-entitlement.js");
      const snapshot = await resolvePlanVersionEntitlement(planVersionId);
      if (snapshot?.capabilityPackIds && snapshot.capabilityPackIds.length > 0) {
        return entitleTenantForPlan({
          tenantId: params.tenantId,
          plan: params.planName ?? snapshot.planVersionId,
          packIds: snapshot.capabilityPackIds,
          source: params.source ?? "auto-provision",
        });
      }
    } catch {
      // fall through to plan-name defaults
    }
  }
  return entitleTenantForPlan({
    tenantId: params.tenantId,
    plan: params.planName,
    source: params.source ?? "auto-provision",
  });
}

/**
 * Skill keys the tenant is allowed to see/install from official packs.
 * If the tenant has no entitlement row yet, fall back to default new-tenant packs
 * so a blank center is avoided without granting the entire global registry.
 */
export function resolveEntitledSkillKeys(tenantId: string | null | undefined): Set<string> {
  const id = tenantId?.trim();
  if (!id) {
    return skillKeysForPackIds(DEFAULT_NEW_TENANT_PACK_IDS);
  }
  const record = getTenantPackEntitlement(id);
  if (!record || record.packIds.length === 0) {
    return skillKeysForPackIds(DEFAULT_NEW_TENANT_PACK_IDS);
  }
  return skillKeysForPackIds(record.packIds);
}

/**
 * Whether a registry skillKey is entitled for the tenant.
 * Non-pack / enterprise-contributed skills (no pack membership) remain visible
 * so local contributions are not hidden.
 */
export function isSkillKeyEntitledForTenant(params: {
  tenantId: string | null | undefined;
  skillKey: string;
  /** When true, skills not listed in any official pack stay visible. Default true. */
  allowNonPackSkills?: boolean;
}): boolean {
  const key = params.skillKey.trim();
  if (!key) {
    return false;
  }
  const entitled = resolveEntitledSkillKeys(params.tenantId);
  if (entitled.has(key)) {
    return true;
  }
  const allowNonPack = params.allowNonPackSkills !== false;
  if (!allowNonPack) {
    return false;
  }
  // Not in any official pack → treat as enterprise/personal contribution surface.
  return findPackIdsForSkillKey(key).length === 0;
}
