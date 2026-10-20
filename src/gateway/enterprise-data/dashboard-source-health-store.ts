// Enterprise Data Capability Center — rich DataSource health aggregator (Task 4.1).
// Spec: .kiro/specs/enterprise-data-capability-center/tasks.md
//
// Five-state health grounded in real signals (no fabrication):
//   - disconnected   : DataSource.status === "disconnected"
//   - error          : DataSource.status === "error"
//   - token_expiring : a bound operational identity is expired / reauth_required
//   - sync_delayed   : connected and lastMaterializedAt is older than the sync SLA
//   - normal         : connected, with no stale materialization
// updatedAt is a record edit. It is not sync evidence. Missing lastMaterializedAt
// is not "sync delayed" and is not an ingest.

import { resolveDataSourceOperationalIdentityBindings } from "../enterprise-operational-identity-access.js";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { listDataSources } from "./data-source-store.js";
import type { EnterpriseDataStore } from "./types.js";

export type DataSourceHealthStatus =
  | "normal"
  | "sync_delayed"
  | "token_expiring"
  | "error"
  | "disconnected";

export type DataSourceHealthRow = {
  sourceId: string;
  displayName: string;
  category: string;
  status: DataSourceHealthStatus;
};

/** Default freshness SLA: a connected source whose lastMaterializedAt is older than 24h is "sync_delayed". */
const DEFAULT_SYNC_SLA_MS = 24 * 60 * 60 * 1000;

export function resolveDataSourceHealthRows(params: {
  store: EnterpriseDataStore;
  seatStore: EnterpriseSeatAssetsStore;
  tenantId: string;
  nowIso: string;
  syncSlaMs?: number;
}): DataSourceHealthRow[] {
  const { store, seatStore, tenantId, nowIso } = params;
  const syncSlaMs = params.syncSlaMs ?? DEFAULT_SYNC_SLA_MS;
  const nowMs = Date.parse(nowIso);

  return listDataSources({ store, tenantId }).map((source) => {
    let status: DataSourceHealthStatus;
    if (source.status === "disconnected") {
      status = "disconnected";
    } else if (source.status === "error") {
      status = "error";
    } else {
      // connected — refine with credential + sync freshness signals.
      const bindings = resolveDataSourceOperationalIdentityBindings({
        seatStore,
        tenantId,
        sourceId: source.sourceId,
        nowIso,
      });
      const hasCredentialIssue = bindings.some(
        (binding) => binding.status === "expired" || binding.status === "reauth_required",
      );
      const materializedMs = source.lastMaterializedAt
        ? Date.parse(source.lastMaterializedAt)
        : Number.NaN;
      const isStale =
        Number.isFinite(materializedMs) &&
        Number.isFinite(nowMs) &&
        nowMs - materializedMs > syncSlaMs;
      if (hasCredentialIssue) {
        status = "token_expiring";
      } else if (isStale) {
        status = "sync_delayed";
      } else {
        status = "normal";
      }
    }
    return {
      sourceId: source.sourceId,
      displayName: source.displayName,
      category: source.category,
      status,
    };
  });
}
