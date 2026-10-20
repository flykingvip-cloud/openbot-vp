import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";
import { resolveTenantsRoot } from "./tenant-store-paths.js";

/**
 * Platform operational status for a tenant (`active` | `inactive` | `suspended`).
 *
 * This ledger is the source for `platform.tenant.pause` / `platform.tenant.resume`.
 * It is not `PlatformAuthEnterprise.status` (trial / paid / expired) and it is not
 * `agent-runtime.update-lifecycle`. Pause records `suspended` and audits `reason`.
 * It does not drain running agents.
 *
 * Open product questions (do not invent answers here):
 * - Should pause also flip commercial enterprise status, which hard-stops runs?
 * - Should pause drain in-flight agents on that tenant?
 * A missing row means `active`. `inactive` is preserved when already stored; pause
 * and resume only write `suspended` or `active`.
 */

export const TENANT_OPERATIONAL_STATUSES = ["active", "inactive", "suspended"] as const;
export type TenantOperationalStatus = (typeof TENANT_OPERATIONAL_STATUSES)[number];

export type TenantOperationalStatusAudit = {
  at: string;
  actor: string;
  reason: string;
  from: TenantOperationalStatus;
  to: TenantOperationalStatus;
};

type TenantOperationalStatusRecord = {
  tenantId: string;
  status: TenantOperationalStatus;
  updatedAt: string;
  audits: TenantOperationalStatusAudit[];
};

type TenantOperationalStatusStore = {
  version: 1;
  tenants: Record<string, TenantOperationalStatusRecord>;
};

const STORE_VERSION = 1;
const MAX_AUDITS = 20;
const STORE_FILENAME = ".tenant-operational-status.json";

export function resolveTenantOperationalStatusStorePath(env?: NodeJS.ProcessEnv): string {
  return path.join(resolveTenantsRoot(env), STORE_FILENAME);
}

export function isTenantOperationalStatus(value: unknown): value is TenantOperationalStatus {
  return value === "active" || value === "inactive" || value === "suspended";
}

function resolvePath(storePath?: string): string {
  return storePath?.trim() || resolveTenantOperationalStatusStorePath();
}

function normalizeRecord(
  tenantId: string,
  raw: Partial<TenantOperationalStatusRecord> | undefined,
): TenantOperationalStatusRecord | null {
  if (!isTenantOperationalStatus(raw?.status)) {
    return null;
  }
  const audits = Array.isArray(raw?.audits)
    ? raw.audits.filter(
        (entry): entry is TenantOperationalStatusAudit =>
          !!entry &&
          typeof entry === "object" &&
          typeof entry.at === "string" &&
          typeof entry.actor === "string" &&
          typeof entry.reason === "string" &&
          isTenantOperationalStatus(entry.from) &&
          isTenantOperationalStatus(entry.to),
      )
    : [];
  return {
    tenantId,
    status: raw.status,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    audits: audits.slice(-MAX_AUDITS),
  };
}

async function loadStore(storePath?: string): Promise<TenantOperationalStatusStore> {
  const parsed = await readJsonFile<Partial<TenantOperationalStatusStore>>(resolvePath(storePath));
  const tenants: Record<string, TenantOperationalStatusRecord> = {};
  for (const [tenantId, raw] of Object.entries(parsed?.tenants ?? {})) {
    const record = normalizeRecord(tenantId, raw);
    if (record) {
      tenants[tenantId] = record;
    }
  }
  return { version: STORE_VERSION, tenants };
}

export async function readTenantOperationalStatus(
  tenantId: string,
  storePath?: string,
): Promise<TenantOperationalStatus> {
  const canonical = canonicalizeTenantId(tenantId) ?? tenantId;
  const store = await loadStore(storePath);
  return store.tenants[canonical]?.status ?? "active";
}

export async function setTenantOperationalStatus(
  params: {
    tenantId: string;
    status: "active" | "suspended";
    reason: string;
    actor: string;
  },
  storePath?: string,
): Promise<{
  tenantId: string;
  status: "active" | "suspended";
  previousStatus: TenantOperationalStatus;
}> {
  const tenantId = canonicalizeTenantId(params.tenantId) ?? params.tenantId;
  const store = await loadStore(storePath);
  const existing = store.tenants[tenantId];
  const previousStatus = existing?.status ?? "active";
  const now = new Date().toISOString();
  const audit: TenantOperationalStatusAudit = {
    at: now,
    actor: params.actor.trim() || "operator",
    reason: params.reason.trim(),
    from: previousStatus,
    to: params.status,
  };
  const audits = [...(existing?.audits ?? []), audit].slice(-MAX_AUDITS);
  store.tenants[tenantId] = {
    tenantId,
    status: params.status,
    updatedAt: now,
    audits,
  };
  await writeJsonAtomic(resolvePath(storePath), { ...store, version: STORE_VERSION });
  return { tenantId, status: params.status, previousStatus };
}

export async function readTenantOperationalStatusAudits(
  tenantId: string,
  storePath?: string,
): Promise<TenantOperationalStatusAudit[]> {
  const canonical = canonicalizeTenantId(tenantId) ?? tenantId;
  const store = await loadStore(storePath);
  return store.tenants[canonical]?.audits ?? [];
}
