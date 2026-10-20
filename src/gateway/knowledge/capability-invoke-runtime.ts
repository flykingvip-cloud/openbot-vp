import { resolveCapabilitySupplyFreshness } from "../enterprise-data/capability-supply-freshness.js";
import { findDataCapability } from "../enterprise-data/data-capability-store.js";
import { listDataSources } from "../enterprise-data/data-source-store.js";
import { listSeatActionGrants } from "../enterprise-data/seat-action-grant-store.js";
import { loadEnterpriseDataStore } from "../enterprise-data/store.js";
import type { EnterpriseDataStore } from "../enterprise-data/types.js";
import { recordCapabilityInvokeShadow } from "../governance/adapters/capability-invoke-adapter.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_ENTERPRISE_DATA_FILE } from "../tenant-store-paths.js";
import {
  countCapabilityInvocations,
  recordCapabilityInvocation,
} from "./capability-invocation-store.js";
import {
  type CapabilityAccessState,
  resolveCapabilityAccessForKnowledge,
} from "./sources/capability-access-resolver.js";
import { mapCapabilityScenarios } from "./sources/capability-scenario-mapper.js";
import type { KnowledgeSourceContext } from "./sources/types.js";

/**
 * Governed capability invoke (boundary-preserving). An agent/runtime "invokes" a data
 * capability and receives the capability's ALREADY-MATERIALIZED, governed metadata —
 * gated by seat access, rate-limited by quota, and recorded for audit. It NEVER performs
 * a live connector call: live-connector invoke is a separate, boundary-opening track that
 * requires explicit sign-off. This keeps the consumption boundary intact while giving
 * agents a controlled, attributable access path over pre-governed data.
 */

export type CapabilityInvocationOutcome = {
  ok: boolean;
  capabilityId: string;
  accessState: CapabilityAccessState | "unknown";
  reason?: "not-authorized" | "not-found" | "no-tenant" | "no-seat" | "quota-exceeded";
  data?: {
    title: string;
    summary: string;
    sourceSystems: string[];
    scenarios: string[];
    freshness: "fresh" | "stale" | "unknown";
  };
  auditId?: string;
};

const DEFAULT_INVOCATION_QUOTA = 200;
const DEFAULT_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Opt-in governance shadow. Flag off returns the same object with no sink I/O.
 * The invoke result is the original outcome.
 */
function publishKnowledgeCapabilityInvokeShadow(
  outcome: CapabilityInvocationOutcome,
  context: { tenantId?: string | null; seatId?: string | null },
): CapabilityInvocationOutcome {
  void recordCapabilityInvokeShadow({
    outcome: {
      entry: "E12",
      ok: outcome.ok,
      reason: outcome.reason,
      capabilityId: outcome.capabilityId,
      auditId: outcome.auditId,
      tenantId: context.tenantId ?? undefined,
      seatId: context.seatId ?? undefined,
    },
  });
  return outcome;
}

export async function invokeKnowledgeCapability(params: {
  capabilityId: string;
  context: KnowledgeSourceContext;
  client?: GatewayClient | null;
  store?: EnterpriseDataStore;
  quotaLimit?: number;
  quotaWindowMs?: number;
  auditStorePath?: string;
}): Promise<CapabilityInvocationOutcome> {
  const capabilityId = params.capabilityId.trim();
  const tenantId = params.context.tenantId;
  const seatId = params.context.seatId;
  const publish = (outcome: CapabilityInvocationOutcome) =>
    publishKnowledgeCapabilityInvokeShadow(outcome, { tenantId, seatId });
  if (!tenantId) {
    return publish({ ok: false, capabilityId, accessState: "unknown", reason: "no-tenant" });
  }
  if (!seatId) {
    return publish({ ok: false, capabilityId, accessState: "unknown", reason: "no-seat" });
  }

  const store =
    params.store ??
    (await loadEnterpriseDataStore(
      await resolveControlPlaneStorePathForClient(
        params.client ?? null,
        TENANT_ENTERPRISE_DATA_FILE,
      ),
    ));
  const capability = findDataCapability(store, tenantId, capabilityId);
  if (!capability) {
    return publish({ ok: false, capabilityId, accessState: "unknown", reason: "not-found" });
  }

  const sourcesById = new Map(
    listDataSources({ store, tenantId }).map((source) => [source.sourceId, source]),
  );
  const grants = listSeatActionGrants({ store, tenantId, seatId });
  const accessState = resolveCapabilityAccessForKnowledge({
    store,
    capability,
    context: {
      tenantId,
      seatId,
      departmentId: params.context.departmentId,
      roleCode: params.context.roleCode,
    },
    grants,
  });

  if (accessState !== "granted") {
    const denied = recordCapabilityInvocation(
      { tenantId, seatId, capabilityId, ok: false, reason: "not-authorized" },
      params.auditStorePath,
    );
    return publish({
      ok: false,
      capabilityId,
      accessState,
      reason: "not-authorized",
      auditId: denied.id,
    });
  }

  const quota = params.quotaLimit ?? DEFAULT_INVOCATION_QUOTA;
  const windowMs = params.quotaWindowMs ?? DEFAULT_QUOTA_WINDOW_MS;
  const used = countCapabilityInvocations(
    { tenantId, seatId, capabilityId, sinceMs: Date.now() - windowMs, okOnly: true },
    params.auditStorePath,
  );
  if (used >= quota) {
    const blocked = recordCapabilityInvocation(
      { tenantId, seatId, capabilityId, ok: false, reason: "quota-exceeded" },
      params.auditStorePath,
    );
    return publish({
      ok: false,
      capabilityId,
      accessState,
      reason: "quota-exceeded",
      auditId: blocked.id,
    });
  }

  // Governed catalog metadata. Freshness is persisted FeedItem supply metadata,
  // never live DataSource connection state, and this path does not call Gateway.
  const data = {
    title: capability.displayName,
    summary: capability.description,
    sourceSystems: capability.sourceIds
      .map((sourceId) => sourcesById.get(sourceId)?.displayName)
      .filter((value): value is string => Boolean(value)),
    scenarios: mapCapabilityScenarios(capability.capabilityKey),
    freshness: resolveCapabilitySupplyFreshness({
      store,
      tenantId,
      capabilityId,
    }),
  };
  const audit = recordCapabilityInvocation(
    { tenantId, seatId, capabilityId, ok: true },
    params.auditStorePath,
  );
  return publish({ ok: true, capabilityId, accessState, data, auditId: audit.id });
}
