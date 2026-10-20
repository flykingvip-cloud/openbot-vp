/**
 * Enterprise seat-assets persistence backends.
 *
 * - **Default engine: JSON** (`class=D` control-plane document).
 * - **Optional engine: SQLite** (same logical store payload; not a relational remodel).
 * - Multi-tenant: prefer per-tenant paths via tenant-context
 *   (`tenants/<tid>/control-plane/seat-assets.json`); global CONFIG_DIR files are
 *   single-instance / fallback defaults only.
 *
 * Config: `gateway.enterpriseSeatAssets.{ backend, store, sqliteBusyTimeoutMs }`.
 * Docs: `docs/design/openbot-enterprise-seat-assets-storage-2026-07-13.md`.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { loadConfig } from "../config/config.js";
import { readJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import { requireNodeSqlite } from "../memory/sqlite.js";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";
import type {
  OperationalIdentityTenantGrantMode,
  OperationalIdentityTenantSettings,
} from "./enterprise-operational-identity-types.js";
import type { EnterpriseSeatAssetsStore } from "./enterprise-seat-assets-store.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";

export interface EnterpriseSeatAssetsBackend {
  load(): Promise<Partial<EnterpriseSeatAssetsStore> | null>;
  save(store: EnterpriseSeatAssetsStore): Promise<void>;
}

export type EnterpriseSeatAssetsMigrationSummary = {
  sourcePath: string;
  targetPath: string;
  seats: number;
  bindings: number;
  accessPolicies: number;
  assetBindings: number;
  credentialBindings: number;
  handovers: number;
  offers: number;
  auditEvents: number;
  enterpriseIdentities: number;
  identityUsagePolicies: number;
  dataSourceIdentityBindings: number;
};

export type EnterpriseSeatAssetsBackendKind = "json" | "sqlite";

export type EnterpriseSeatAssetsJsonBackendOptions = {
  storePath?: string;
};

export type EnterpriseSeatAssetsSqliteBackendOptions = {
  storePath?: string;
  busyTimeoutMs?: number;
};

export type EnterpriseSeatAssetsBackendOptions =
  | ({ kind?: "json" } & EnterpriseSeatAssetsJsonBackendOptions)
  | ({ kind: "sqlite" } & EnterpriseSeatAssetsSqliteBackendOptions);

const SQLITE_STATE_TABLE = "enterprise_seat_assets_state";
const SQLITE_CANONICAL_KEY = "canonical";

export function resolveDefaultEnterpriseSeatAssetsStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-enterprise-seat-assets.json");
}

export function resolveDefaultEnterpriseSeatAssetsSqlitePath(): string {
  return path.join(CONFIG_DIR, "openbot-enterprise-seat-assets.sqlite");
}

export function resolveEnterpriseSeatAssetsBackendPath(storePath?: string): string {
  return resolveUserPath(storePath?.trim() || resolveDefaultEnterpriseSeatAssetsStorePath());
}

export function createEnterpriseSeatAssetsJsonBackend(
  options: EnterpriseSeatAssetsJsonBackendOptions = {},
): EnterpriseSeatAssetsBackend {
  const resolvedPath = resolveEnterpriseSeatAssetsBackendPath(options.storePath);
  return {
    async load() {
      return readJsonFile<Partial<EnterpriseSeatAssetsStore>>(resolvedPath);
    },
    async save(store) {
      await writeJsonAtomic(resolvedPath, store);
    },
  };
}

function normalizeBusyTimeoutMs(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 5000;
  }
  return Math.max(0, Math.trunc(value as number));
}

function bootstrapEnterpriseSeatAssetsSqlite(db: DatabaseSync): void {
  db.exec("pragma journal_mode = wal;");
  db.exec("pragma foreign_keys = on;");
  db.exec(
    `create table if not exists ${SQLITE_STATE_TABLE} (
      store_key text primary key,
      version integer not null,
      payload text not null,
      updated_at integer not null
    )`,
  );
}

export function createEnterpriseSeatAssetsSqliteBackend(
  options: EnterpriseSeatAssetsSqliteBackendOptions = {},
): EnterpriseSeatAssetsBackend {
  const resolvedPath = resolveUserPath(
    options.storePath?.trim() || resolveDefaultEnterpriseSeatAssetsSqlitePath(),
  );
  const busyTimeoutMs = normalizeBusyTimeoutMs(options.busyTimeoutMs);
  let db: DatabaseSync | null = null;

  function ensureDb(): DatabaseSync {
    if (db) {
      return db;
    }
    mkdirSync(path.dirname(resolvedPath), { recursive: true, mode: 0o700 });
    const { DatabaseSync } = requireNodeSqlite();
    db = new DatabaseSync(resolvedPath);
    db.exec(`pragma busy_timeout = ${busyTimeoutMs};`);
    bootstrapEnterpriseSeatAssetsSqlite(db);
    return db;
  }

  return {
    async load() {
      const row = ensureDb()
        .prepare(`select payload from ${SQLITE_STATE_TABLE} where store_key = ? limit 1`)
        .get(SQLITE_CANONICAL_KEY) as { payload?: string } | undefined;
      if (!row?.payload) {
        return null;
      }
      return JSON.parse(row.payload) as Partial<EnterpriseSeatAssetsStore>;
    },
    async save(store) {
      const database = ensureDb();
      database.exec("begin immediate;");
      try {
        database
          .prepare(
            `insert into ${SQLITE_STATE_TABLE}
              (store_key, version, payload, updated_at)
             values (?, ?, ?, ?)
             on conflict (store_key) do update
             set version = excluded.version,
                 payload = excluded.payload,
                 updated_at = excluded.updated_at`,
          )
          .run(SQLITE_CANONICAL_KEY, store.version, JSON.stringify(store), Date.now());
        database.exec("commit;");
      } catch (error) {
        try {
          database.exec("rollback;");
        } catch {}
        throw error;
      }
    },
  };
}

export function createEnterpriseSeatAssetsBackend(
  options: EnterpriseSeatAssetsBackendOptions = {},
): EnterpriseSeatAssetsBackend {
  if (options.kind === "sqlite") {
    return createEnterpriseSeatAssetsSqliteBackend(options);
  }
  return createEnterpriseSeatAssetsJsonBackend(options);
}

export function resolveEnterpriseSeatAssetsBackendFromConfig(): EnterpriseSeatAssetsBackend {
  const cfg = loadConfig();
  const configured = cfg.gateway?.enterpriseSeatAssets;
  if (configured?.backend === "sqlite") {
    return createEnterpriseSeatAssetsSqliteBackend({
      storePath: configured.store,
      busyTimeoutMs: configured.sqliteBusyTimeoutMs,
    });
  }
  return createEnterpriseSeatAssetsJsonBackend({
    storePath: configured?.store,
  });
}

export function normalizeEnterpriseSeatAssetsStore(
  parsed: Partial<EnterpriseSeatAssetsStore> | null | undefined,
  version: number,
): EnterpriseSeatAssetsStore {
  const seats = Object.fromEntries(
    Object.entries(parsed?.seats ?? {}).map(([seatId, seat]) => [
      seatId,
      {
        ...seat,
        tenantId: canonicalizeTenantId(seat.tenantId) ?? seat.tenantId,
      },
    ]),
  );
  const bindings = Object.fromEntries(
    Object.entries(parsed?.bindings ?? {}).map(([bindingId, binding]) => [
      bindingId,
      {
        ...binding,
        tenantId: canonicalizeTenantId(binding.tenantId) ?? binding.tenantId,
      },
    ]),
  );
  const accessPolicies = Object.fromEntries(
    Object.entries(parsed?.accessPolicies ?? {}).map(([policyId, policy]) => [
      policyId,
      {
        ...policy,
        tenantId: canonicalizeTenantId(policy.tenantId) ?? policy.tenantId,
      },
    ]),
  );
  const assetBindings = Object.fromEntries(
    Object.entries(parsed?.assetBindings ?? {}).map(([assetBindingId, binding]) => [
      assetBindingId,
      {
        ...binding,
        tenantId: canonicalizeTenantId(binding.tenantId) ?? binding.tenantId,
      },
    ]),
  );
  const credentialBindings = Object.fromEntries(
    Object.entries(parsed?.credentialBindings ?? {}).map(([credentialBindingId, binding]) => [
      credentialBindingId,
      {
        ...binding,
        tenantId: canonicalizeTenantId(binding.tenantId) ?? binding.tenantId,
      },
    ]),
  );
  const handovers = Object.fromEntries(
    Object.entries(parsed?.handovers ?? {}).map(([handoverCaseId, handover]) => [
      handoverCaseId,
      {
        ...handover,
        tenantId: canonicalizeTenantId(handover.tenantId) ?? handover.tenantId,
      },
    ]),
  );
  const offers = Object.fromEntries(
    Object.entries(parsed?.offers ?? {}).map(([offerId, offer]) => [
      offerId,
      {
        ...offer,
        tenantId: canonicalizeTenantId(offer.tenantId) ?? offer.tenantId,
      },
    ]),
  );
  const auditEvents = Object.fromEntries(
    Object.entries(parsed?.auditEvents ?? {}).map(([auditEventId, event]) => [
      auditEventId,
      {
        ...event,
        tenantId: canonicalizeTenantId(event.tenantId) ?? event.tenantId,
      },
    ]),
  );
  const enterpriseIdentities = Object.fromEntries(
    Object.entries(parsed?.enterpriseIdentities ?? {}).map(([identityId, identity]) => [
      identityId,
      {
        ...identity,
        tenantId: canonicalizeTenantId(identity.tenantId) ?? identity.tenantId,
      },
    ]),
  );
  const identityUsagePolicies = Object.fromEntries(
    Object.entries(parsed?.identityUsagePolicies ?? {}).map(([policyId, policy]) => [
      policyId,
      {
        ...policy,
        tenantId: canonicalizeTenantId(policy.tenantId) ?? policy.tenantId,
      },
    ]),
  );
  const dataSourceIdentityBindings = Object.fromEntries(
    Object.entries(parsed?.dataSourceIdentityBindings ?? {}).map(([bindingId, binding]) => [
      bindingId,
      {
        ...binding,
        tenantId: canonicalizeTenantId(binding.tenantId) ?? binding.tenantId,
      },
    ]),
  );
  const employeeIdentityEnrollments = Object.fromEntries(
    Object.entries(parsed?.employeeIdentityEnrollments ?? {}).map(([enrollmentId, enrollment]) => [
      enrollmentId,
      {
        ...enrollment,
        tenantId: canonicalizeTenantId(enrollment.tenantId) ?? enrollment.tenantId,
        status: enrollment.status ?? "active",
        grantMode: enrollment.grantMode ?? "explicit_owner_grant",
        ...(enrollment.policyVersionAtGrant
          ? { policyVersionAtGrant: enrollment.policyVersionAtGrant }
          : {}),
      },
    ]),
  );
  const identityUsagePoliciesNormalized = Object.fromEntries(
    Object.entries(identityUsagePolicies).map(([policyId, policy]) => [
      policyId,
      {
        ...policy,
        policyVersion: policy.policyVersion?.trim() || "1",
      },
    ]),
  );
  const collaborationIdentityDelegations = Object.fromEntries(
    Object.entries(parsed?.collaborationIdentityDelegations ?? {}).map(
      ([delegationId, delegation]) => [
        delegationId,
        {
          ...delegation,
          tenantId: canonicalizeTenantId(delegation.tenantId) ?? delegation.tenantId,
          status: delegation.status ?? "active",
          allowedActions: [...(delegation.allowedActions ?? [])],
        },
      ],
    ),
  );
  const operationalIdentityTenantSettings: Record<string, OperationalIdentityTenantSettings> =
    Object.fromEntries(
      Object.entries(parsed?.operationalIdentityTenantSettings ?? {}).map(
        ([tenantKey, settings]) => {
          const tenantId =
            canonicalizeTenantId(settings.tenantId) ?? settings.tenantId ?? tenantKey;
          const grantMode: OperationalIdentityTenantGrantMode =
            settings.grantMode === "explicit_owner_grant"
              ? "explicit_owner_grant"
              : "seat_inherit_until_curated";
          const normalized: OperationalIdentityTenantSettings = {
            tenantId,
            grantMode,
            updatedAt: settings.updatedAt,
            ...(settings.updatedByEmployeeId
              ? { updatedByEmployeeId: settings.updatedByEmployeeId }
              : {}),
          };
          return [tenantId, normalized];
        },
      ),
    );
  const organizationDepartments = Object.fromEntries(
    Object.entries(parsed?.organizationDepartments ?? {}).map(([departmentId, department]) => [
      departmentId,
      {
        ...department,
        tenantId: canonicalizeTenantId(department.tenantId) ?? department.tenantId,
      },
    ]),
  );
  return {
    version,
    seats,
    bindings,
    accessPolicies,
    assetBindings,
    credentialBindings,
    handovers,
    offers,
    auditEvents,
    enterpriseIdentities,
    identityUsagePolicies: identityUsagePoliciesNormalized,
    dataSourceIdentityBindings,
    employeeIdentityEnrollments,
    collaborationIdentityDelegations,
    operationalIdentityTenantSettings,
    organizationDepartments,
    organizationChildOrders: parsed?.organizationChildOrders ?? {},
  };
}

export function summarizeEnterpriseSeatAssetsStore(params: {
  sourcePath: string;
  targetPath: string;
  store: EnterpriseSeatAssetsStore;
}): EnterpriseSeatAssetsMigrationSummary {
  return {
    sourcePath: params.sourcePath,
    targetPath: params.targetPath,
    seats: Object.keys(params.store.seats).length,
    bindings: Object.keys(params.store.bindings).length,
    accessPolicies: Object.keys(params.store.accessPolicies).length,
    assetBindings: Object.keys(params.store.assetBindings).length,
    credentialBindings: Object.keys(params.store.credentialBindings).length,
    handovers: Object.keys(params.store.handovers).length,
    offers: Object.keys(params.store.offers).length,
    auditEvents: Object.keys(params.store.auditEvents).length,
    enterpriseIdentities: Object.keys(params.store.enterpriseIdentities).length,
    identityUsagePolicies: Object.keys(params.store.identityUsagePolicies).length,
    dataSourceIdentityBindings: Object.keys(params.store.dataSourceIdentityBindings).length,
  };
}

export async function migrateEnterpriseSeatAssetsJsonToSqlite(params: {
  sourcePath: string;
  targetPath: string;
  busyTimeoutMs?: number;
}): Promise<EnterpriseSeatAssetsMigrationSummary> {
  const jsonBackend = createEnterpriseSeatAssetsJsonBackend({ storePath: params.sourcePath });
  const sqliteBackend = createEnterpriseSeatAssetsSqliteBackend({
    storePath: params.targetPath,
    busyTimeoutMs: params.busyTimeoutMs,
  });
  const parsed = await jsonBackend.load();
  const normalized = normalizeEnterpriseSeatAssetsStore(parsed, 4);
  await sqliteBackend.save(normalized);
  return summarizeEnterpriseSeatAssetsStore({
    sourcePath: resolveEnterpriseSeatAssetsBackendPath(params.sourcePath),
    targetPath: resolveUserPath(params.targetPath),
    store: normalized,
  });
}
