import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";
import { assertSafeTenantId, resolveTenantsRoot } from "./tenant-store-paths.js";

/**
 * Platform-global tenant registry (hybrid-gateway-isolation F1).
 *
 * One record per tenant carrying its isolation topology assignment (`shared` | `dedicated`) plus
 * reserved routing fields (`region`/`endpoint`). Persisted as a single platform-global JSON at the
 * tenants volume root (`<tenantsRoot>/.tenants.json`) so it travels with the volume — mirroring the
 * import-job ledger (`.import-jobs.json`, see `platform-tenant.ts`). `storePath` is injectable for
 * tests.
 *
 * This is the app-side source of truth the routing / provisioning / migration flows read (F2/F3/F4):
 * "given a tenant, is it shared or dedicated, and where is its dedicated endpoint?". Assignment is
 * the MECHANISM here; the POLICY (Enterprise entitlement -> dedicated) is layered on later (F5).
 * A missing record means the tenant is on the shared pool (default `shared`).
 */

export const TENANT_REGISTRY_STORE_VERSION = 1;

export type TenantIsolation = "shared" | "dedicated";

/** promote = shared -> dedicated; demote = dedicated -> shared (hybrid-gateway-isolation F4). */
export type TenantMigrationDirection = "promote" | "demote";

/**
 * In-flight promote/demote marker (F4). Its ONLY role is to signal the drain window to infra / the
 * reverse proxy — it never changes the authoritative route (`isolation` + `endpoint`). The route
 * flips exactly once, atomically, via an explicit `isolation` commit (see `upsertTenantRecord`), so
 * there is always exactly one authoritative location and an abort is a clean rollback (no
 * split-brain, R6.4).
 */
export type TenantMigrationState = {
  direction: TenantMigrationDirection;
  startedAt: string;
};

export type TenantRecord = {
  tenantId: string;
  isolation: TenantIsolation;
  /** Reserved (F2/F3): dedicated instance endpoint, backfilled by infra after provisioning. */
  endpoint?: string;
  /** Reserved: data-residency region. Semantics defined later. */
  region?: string;
  /** Set while a promote/demote is in flight (F4); cleared on commit or abort. */
  migration?: TenantMigrationState;
  createdAt: string;
  updatedAt: string;
};

export type TenantRegistryStore = {
  version: number;
  tenants: Record<string, TenantRecord>;
};

const REGISTRY_FILENAME = ".tenants.json";

/** Platform-global registry path at the tenants volume root (travels with the volume). */
export function resolveDefaultTenantRegistryStorePath(env?: NodeJS.ProcessEnv): string {
  return path.join(resolveTenantsRoot(env), REGISTRY_FILENAME);
}

/**
 * Registry path for an explicit tenants-root override (operator CLI `--tenants-root`). Keeps the
 * registry filename encapsulated in this module (single source of truth).
 */
export function resolveTenantRegistryStorePathForRoot(tenantsRoot: string): string {
  return path.join(tenantsRoot, REGISTRY_FILENAME);
}

export function isTenantIsolation(value: unknown): value is TenantIsolation {
  return value === "shared" || value === "dedicated";
}

export function isTenantMigrationDirection(value: unknown): value is TenantMigrationDirection {
  return value === "promote" || value === "demote";
}

function normalizeIsolation(value: unknown): TenantIsolation {
  return value === "dedicated" ? "dedicated" : "shared";
}

function normalizeMigration(raw: unknown): TenantMigrationState | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<TenantMigrationState>;
  if (!isTenantMigrationDirection(candidate.direction)) {
    return undefined;
  }
  return {
    direction: candidate.direction,
    startedAt: typeof candidate.startedAt === "string" ? candidate.startedAt : "",
  };
}

function normalizeRecord(
  tenantId: string,
  raw: Partial<TenantRecord> | undefined,
  now: string,
): TenantRecord {
  const migration = normalizeMigration(raw?.migration);
  return {
    tenantId,
    isolation: normalizeIsolation(raw?.isolation),
    ...(raw?.endpoint ? { endpoint: raw.endpoint } : {}),
    ...(raw?.region ? { region: raw.region } : {}),
    ...(migration ? { migration } : {}),
    createdAt: raw?.createdAt ?? now,
    updatedAt: raw?.updatedAt ?? now,
  };
}

function normalizeStore(
  parsed: Partial<TenantRegistryStore> | null | undefined,
): TenantRegistryStore {
  const now = new Date().toISOString();
  const tenants: Record<string, TenantRecord> = {};
  for (const [tid, rec] of Object.entries(parsed?.tenants ?? {})) {
    tenants[tid] = normalizeRecord(tid, rec as Partial<TenantRecord>, now);
  }
  return { version: parsed?.version ?? TENANT_REGISTRY_STORE_VERSION, tenants };
}

function resolvePath(storePath?: string): string {
  return storePath?.trim() || resolveDefaultTenantRegistryStorePath();
}

export async function loadTenantRegistry(storePath?: string): Promise<TenantRegistryStore> {
  return normalizeStore(await readJsonFile<Partial<TenantRegistryStore>>(resolvePath(storePath)));
}

async function saveStore(store: TenantRegistryStore, storePath?: string): Promise<void> {
  await writeJsonAtomic(resolvePath(storePath), {
    ...store,
    version: TENANT_REGISTRY_STORE_VERSION,
  });
}

export async function getTenantRecord(
  tenantId: string,
  storePath?: string,
): Promise<TenantRecord | null> {
  const store = await loadTenantRegistry(storePath);
  return store.tenants[canonicalizeTenantId(tenantId) ?? tenantId] ?? null;
}

export async function listTenantRecords(storePath?: string): Promise<TenantRecord[]> {
  const store = await loadTenantRegistry(storePath);
  return Object.values(store.tenants).toSorted((a, b) => (a.tenantId < b.tenantId ? -1 : 1));
}

/**
 * Insert or update a tenant record; `createdAt` is preserved across updates and `updatedAt` is
 * refreshed. `isolation` defaults to the existing value (or `shared` for a new record). `endpoint`
 * and `region` are updated when provided and otherwise preserved.
 */
export async function upsertTenantRecord(
  record: {
    tenantId: string;
    isolation?: TenantIsolation;
    endpoint?: string;
    region?: string;
  },
  storePath?: string,
): Promise<TenantRecord> {
  // Canonicalize so a legacy alias and its canonical id map to ONE record (hybrid-gateway-isolation
  // F1) — the runtime derives canonical ids from membership, so the registry must key the same way.
  const tenantId = canonicalizeTenantId(record.tenantId) ?? record.tenantId;
  assertSafeTenantId(tenantId);
  const store = await loadTenantRegistry(storePath);
  const now = new Date().toISOString();
  const existing = store.tenants[tenantId];
  const endpoint = record.endpoint ?? existing?.endpoint;
  const region = record.region ?? existing?.region;
  // Commit rule (F4 anti-split-brain): an EXPLICIT isolation write commits the target state and ends
  // any in-flight migration — this is the single, atomic route flip. An OMITTED isolation (idempotent
  // ensure-provision) preserves the existing migration marker so a mid-migration re-provision cannot
  // silently clear the drain window.
  const migration = record.isolation === undefined ? existing?.migration : undefined;
  const next: TenantRecord = {
    tenantId,
    isolation: record.isolation ?? existing?.isolation ?? "shared",
    ...(endpoint ? { endpoint } : {}),
    ...(region ? { region } : {}),
    ...(migration ? { migration } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  store.tenants[tenantId] = next;
  await saveStore(store, storePath);
  return next;
}

/**
 * Begin an in-flight promote/demote (F4). Records a `migration` marker WITHOUT touching the
 * authoritative route (`isolation`/`endpoint`), so the source location keeps serving until the
 * atomic commit (`upsertTenantRecord` with an explicit isolation). Fail-closed:
 *  - the tenant must already be provisioned (a record must exist);
 *  - it must not already be migrating (no concurrent/re-entrant migration);
 *  - the direction must match the current isolation (promote requires `shared`, demote `dedicated`).
 */
export async function beginTenantMigration(
  tenantId: string,
  direction: TenantMigrationDirection,
  storePath?: string,
): Promise<TenantRecord> {
  const canonical = canonicalizeTenantId(tenantId) ?? tenantId;
  assertSafeTenantId(canonical);
  const store = await loadTenantRegistry(storePath);
  const existing = store.tenants[canonical];
  if (!existing) {
    throw new Error(`tenant not provisioned: ${canonical}`);
  }
  if (existing.migration) {
    throw new Error(`tenant already migrating (${existing.migration.direction}): ${canonical}`);
  }
  const requiredFrom: TenantIsolation = direction === "promote" ? "shared" : "dedicated";
  if (existing.isolation !== requiredFrom) {
    throw new Error(
      `cannot ${direction} a ${existing.isolation} tenant (requires ${requiredFrom}): ${canonical}`,
    );
  }
  const next: TenantRecord = {
    ...existing,
    migration: { direction, startedAt: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  };
  store.tenants[canonical] = next;
  await saveStore(store, storePath);
  return next;
}

/**
 * Clear an in-flight migration marker WITHOUT changing the authoritative route (F4). Used to ABORT
 * (rollback): the route never flipped, so the tenant simply stays at its source location — no
 * split-brain. Idempotent: clearing when nothing is in flight is a no-op success.
 */
export async function clearTenantMigration(
  tenantId: string,
  storePath?: string,
): Promise<TenantRecord> {
  const canonical = canonicalizeTenantId(tenantId) ?? tenantId;
  assertSafeTenantId(canonical);
  const store = await loadTenantRegistry(storePath);
  const existing = store.tenants[canonical];
  if (!existing) {
    throw new Error(`tenant not provisioned: ${canonical}`);
  }
  const { migration: _dropped, ...rest } = existing;
  const next: TenantRecord = { ...rest, updatedAt: new Date().toISOString() };
  store.tenants[canonical] = next;
  await saveStore(store, storePath);
  return next;
}
