/**
 * Tenant, capability, and version switches for new website runs.
 * An active switch blocks the next run. It does not withdraw an in-flight
 * side effect and it does not make a prior write replayable.
 */

import { randomUUID } from "node:crypto";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import type { EnterpriseDataStore, SarExecutionHalt, SarExecutionHaltScope } from "./types.js";

function haltsOf(store: EnterpriseDataStore): Record<string, SarExecutionHalt> {
  return (store.sarExecutionHalts ??= {});
}

function scopeKey(
  halt: Pick<SarExecutionHalt, "tenantId" | "scope" | "capabilityId" | "version">,
): string {
  if (halt.scope === "tenant") {
    return `tenant:${halt.tenantId}`;
  }
  if (halt.scope === "capability") {
    return `capability:${halt.tenantId}:${halt.capabilityId}`;
  }
  return `version:${halt.tenantId}:${halt.capabilityId}:${halt.version}`;
}

export function setSarExecutionHalt(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  scope: SarExecutionHaltScope;
  capabilityId?: string;
  version?: string;
  reason: string;
  haltedBy: string;
  nowIso: string;
}): SarExecutionHalt {
  const capabilityId = params.capabilityId?.trim() || undefined;
  const version = params.version?.trim() || undefined;
  const reason = params.reason.trim();
  const haltedBy = params.haltedBy.trim();
  if (!reason || !haltedBy) {
    throw new EnterpriseDataStoreError("SAR_HALT_INVALID", "Halt requires a reason and haltedBy.");
  }
  if (params.scope === "tenant" && (capabilityId || version)) {
    throw new EnterpriseDataStoreError(
      "SAR_HALT_INVALID",
      "A tenant halt does not take a capability or version.",
    );
  }
  if (params.scope === "capability" && (!capabilityId || version)) {
    throw new EnterpriseDataStoreError(
      "SAR_HALT_INVALID",
      "A capability halt requires a capabilityId and no version.",
    );
  }
  if (params.scope === "version" && (!capabilityId || !version)) {
    throw new EnterpriseDataStoreError(
      "SAR_HALT_INVALID",
      "A version halt requires capabilityId and version.",
    );
  }
  const draft = {
    tenantId: params.tenantId,
    scope: params.scope,
    capabilityId,
    version,
  };
  const key = scopeKey(draft);
  const existing = Object.values(haltsOf(params.store)).find(
    (halt) => halt.tenantId === params.tenantId && scopeKey(halt) === key,
  );
  const record: SarExecutionHalt = {
    haltId: existing?.haltId ?? randomUUID(),
    tenantId: params.tenantId,
    scope: params.scope,
    reason,
    haltedAt: params.nowIso,
    haltedBy,
  };
  if (capabilityId) {
    record.capabilityId = capabilityId;
  }
  if (version) {
    record.version = version;
  }
  haltsOf(params.store)[record.haltId] = record;
  return record;
}

export function clearSarExecutionHalt(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  haltId: string;
}): SarExecutionHalt | null {
  const halt = params.store.sarExecutionHalts?.[params.haltId];
  if (!halt || halt.tenantId !== params.tenantId) {
    return null;
  }
  delete params.store.sarExecutionHalts?.[params.haltId];
  return halt;
}

export type SarExecutionHaltDecision = {
  blocked: boolean;
  halt: SarExecutionHalt | null;
  /** Always false. A halt does not withdraw an in-flight side effect. */
  inFlightSideEffectsWithdrawn: false;
  /** Always false. Matches P4: a prior write is not replayed from this switch. */
  priorWriteMayBeReplayed: false;
  blocksNewRun: boolean;
};

/**
 * Broadest matching switch wins: tenant, then capability, then version.
 */
export function evaluateSarExecutionHalt(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  capabilityId: string;
  version: string;
}): SarExecutionHaltDecision {
  const halts = Object.values(params.store.sarExecutionHalts ?? {}).filter(
    (halt) => halt.tenantId === params.tenantId,
  );
  const tenant = halts.find((halt) => halt.scope === "tenant");
  const capability = halts.find(
    (halt) => halt.scope === "capability" && halt.capabilityId === params.capabilityId,
  );
  const version = halts.find(
    (halt) =>
      halt.scope === "version" &&
      halt.capabilityId === params.capabilityId &&
      halt.version === params.version,
  );
  const halt = tenant ?? capability ?? version ?? null;
  return {
    blocked: halt != null,
    halt,
    inFlightSideEffectsWithdrawn: false,
    priorWriteMayBeReplayed: false,
    blocksNewRun: halt != null,
  };
}
