import { resolveEnterpriseEntitlement } from "./billing/resolve-enterprise-entitlement.js";
import type { ResolvedEnterpriseEntitlement } from "./billing/resolve-enterprise-entitlement.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";
import {
  getTenantRecord,
  listTenantRecords,
  type TenantIsolation,
  type TenantRecord,
} from "./tenant-registry-store.js";

/**
 * Tenant isolation entitlement -> drift (hybrid-gateway-isolation F5).
 *
 * POLICY / MECHANISM split (R7): the Enterprise/VIP ENTITLEMENT (`features.dedicatedIsolation`)
 * determines the DESIRED isolation topology; the tenant registry (`TenantRecord.isolation`) is the
 * ACTUAL topology set by the MECHANISM (setIsolation / migration, F1/F3/F4). This module is a
 * READ-ONLY projection of desired-vs-actual — it NEVER runs a migration. It mirrors the billing
 * `OverAllocationState` pattern (entitlement desired vs actual resource -> observable drift): an
 * operator/infra reviews the drift and drives the F4 promote/demote. This keeps entitlement changes
 * (policy) fully decoupled from the physical move (mechanism).
 *
 * `enterpriseId === tenantId` (canonicalized) in this codebase, so the entitlement for a tenant is
 * `resolveEnterpriseEntitlement(tenantId)`.
 */

/** What the tenant's subscription entitles it to. */
export type IsolationDriftStatus = "in_sync" | "drift";

/** What an operator/infra should do to reconcile actual with desired (F4). Never auto-run. */
export type IsolationReconcileAction = "promote" | "demote" | "none";

export type TenantIsolationDrift = {
  tenantId: string;
  /** From the entitlement (POLICY). */
  desired: TenantIsolation;
  /** From the tenant registry (MECHANISM / actual). */
  actual: TenantIsolation;
  status: IsolationDriftStatus;
  /** promote when desired=dedicated>actual=shared; demote on downgrade; none when in sync. */
  recommendedAction: IsolationReconcileAction;
  /** True when a promote/demote is already in flight (F4 marker) — do not start another. */
  migrating: boolean;
};

/** Minimal shape of the entitlement fields this module reads (keeps the dep surface tiny). */
export type IsolationEntitlementView = {
  features?: { dedicatedIsolation?: boolean } | undefined;
} | null;

export type IsolationEntitlementInput = IsolationEntitlementView | ResolvedEnterpriseEntitlement;

/**
 * DESIRED isolation from an entitlement (pure POLICY): `dedicated` iff the subscription grants the
 * dedicated-isolation feature, else `shared`. A missing entitlement (no active subscription) is
 * `shared` — the default pool — so an unsubscribed tenant never "wants" a dedicated instance.
 */
export function desiredIsolationFromEntitlement(
  entitlement: IsolationEntitlementInput,
): TenantIsolation {
  const features = entitlement?.features as
    | { dedicatedIsolation?: boolean; vpcIsolation?: boolean }
    | undefined;
  if (features?.dedicatedIsolation === true || features?.vpcIsolation === true) {
    return "dedicated";
  }
  return "shared";
}

/**
 * Pure drift projection (fully testable with no I/O): compare desired (entitlement) vs actual
 * (registry) and recommend the reconciling action. Recommends but never executes — mechanism stays
 * decoupled (R7.4). When a migration is already in flight, the recommendation is `none` (let the
 * in-flight move finish; do not stack migrations).
 */
export function computeIsolationDrift(args: {
  tenantId: string;
  desired: TenantIsolation;
  actual: TenantIsolation;
  migrating?: boolean;
}): TenantIsolationDrift {
  const { tenantId, desired, actual } = args;
  const migrating = args.migrating === true;
  const inSync = desired === actual;
  let recommendedAction: IsolationReconcileAction = "none";
  if (!inSync && !migrating) {
    // desired=dedicated, actual=shared -> promote; desired=shared, actual=dedicated -> demote.
    recommendedAction = desired === "dedicated" ? "promote" : "demote";
  }
  return {
    tenantId,
    desired,
    actual,
    status: inSync ? "in_sync" : "drift",
    recommendedAction,
    migrating,
  };
}

type IsolationDriftDeps = {
  resolveEntitlement?: (tenantId: string) => Promise<IsolationEntitlementInput | null>;
  getRecord?: (tenantId: string) => Promise<TenantRecord | null>;
  /** Registry lister for `listTenantIsolationDrift` (e.g. the operator CLI `--tenants-root`). */
  listRecords?: () => Promise<TenantRecord[]>;
};

/** Actual isolation for a tenant: its registry record, or `shared` when unrecorded (F2 default). */
function actualIsolationOf(record: TenantRecord | null): {
  isolation: TenantIsolation;
  migrating: boolean;
} {
  return {
    isolation: record?.isolation ?? "shared",
    migrating: record?.migration !== undefined,
  };
}

/**
 * Resolve the isolation drift for one tenant (I/O; resolvers injectable for tests). Reads the
 * entitlement (policy) and the registry record (actual), then projects the drift.
 */
export async function resolveTenantIsolationDrift(
  tenantId: string,
  deps: IsolationDriftDeps = {},
): Promise<TenantIsolationDrift> {
  const canonical = canonicalizeTenantId(tenantId) ?? tenantId;
  const resolveEntitlement = deps.resolveEntitlement ?? resolveEnterpriseEntitlement;
  const getRecord = deps.getRecord ?? ((tid: string) => getTenantRecord(tid));
  const [entitlement, record] = await Promise.all([
    resolveEntitlement(canonical),
    getRecord(canonical),
  ]);
  const { isolation: actual, migrating } = actualIsolationOf(record);
  return computeIsolationDrift({
    tenantId: canonical,
    desired: desiredIsolationFromEntitlement(entitlement),
    actual,
    migrating,
  });
}

/**
 * Drift for every tenant in the registry (the observability surface, R7.4). Registry-authoritative:
 * only recorded tenants are projected — an unrecorded tenant is shared/shared (in sync) and needs no
 * row. Sorted by tenantId (stable output).
 */
export async function listTenantIsolationDrift(
  deps: IsolationDriftDeps = {},
): Promise<TenantIsolationDrift[]> {
  const listRecords = deps.listRecords ?? (() => listTenantRecords());
  const records = await listRecords();
  const resolveEntitlement = deps.resolveEntitlement ?? resolveEnterpriseEntitlement;
  return Promise.all(
    records.map(async (record) => {
      const { isolation: actual, migrating } = actualIsolationOf(record);
      return computeIsolationDrift({
        tenantId: record.tenantId,
        desired: desiredIsolationFromEntitlement(await resolveEntitlement(record.tenantId)),
        actual,
        migrating,
      });
    }),
  );
}
