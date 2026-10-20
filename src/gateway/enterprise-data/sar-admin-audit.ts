/**
 * Allowlist audit for SAR admin ops (bridge upsert / halt / resume).
 * Reuses the E5 enterprise data store. Does not claim in-flight withdrawal.
 */

import { randomUUID } from "node:crypto";
import type {
  EnterpriseDataStore,
  SarAdminAuditAction,
  SarAdminAuditEvent,
  SarExecutionHaltScope,
} from "./types.js";

function auditsOf(store: EnterpriseDataStore): Record<string, SarAdminAuditEvent> {
  return (store.sarAdminAuditEvents ??= {});
}

export function recordSarAdminAudit(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  action: SarAdminAuditAction;
  actorId: string;
  nowIso: string;
  subjectId?: string;
  capabilityId?: string;
  version?: string;
  haltScope?: SarExecutionHaltScope;
  summary: string;
  /** When recording halt_set, always persist the honest non-withdrawal flags. */
  recordHaltSemantics?: boolean;
}): SarAdminAuditEvent {
  const event: SarAdminAuditEvent = {
    auditId: randomUUID(),
    tenantId: params.tenantId,
    action: params.action,
    actorId: params.actorId.trim() || "unknown",
    summary: params.summary.trim() || params.action,
    recordedAt: params.nowIso,
  };
  if (params.subjectId?.trim()) {
    event.subjectId = params.subjectId.trim();
  }
  if (params.capabilityId?.trim()) {
    event.capabilityId = params.capabilityId.trim();
  }
  if (params.version?.trim()) {
    event.version = params.version.trim();
  }
  if (params.haltScope) {
    event.haltScope = params.haltScope;
  }
  if (params.recordHaltSemantics || params.action === "halt_set") {
    event.inFlightSideEffectsWithdrawn = false;
    event.priorWriteMayBeReplayed = false;
  }
  auditsOf(params.store)[event.auditId] = event;
  return event;
}

export function listSarAdminAuditEvents(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  action?: SarAdminAuditAction;
  limit?: number;
}): SarAdminAuditEvent[] {
  return Object.values(params.store.sarAdminAuditEvents ?? {})
    .filter((event) => {
      if (event.tenantId !== params.tenantId) {
        return false;
      }
      if (params.action && event.action !== params.action) {
        return false;
      }
      return true;
    })
    .toSorted((left, right) => right.recordedAt.localeCompare(left.recordedAt))
    .slice(0, params.limit ?? 100);
}
