/**
 * Structured Objective candidates only. Never invent objectiveId from runId
 * or a permanent cron jobId. Missing id/revision stays incomplete.
 */

import type { ShadowCandidate } from "./types.js";

export const LOCAL_UNSCOPED_TENANT_ID = "local";

export type TenantScope = "local_unscoped" | "identified";

export function isCompleteCandidate(
  candidate: ShadowCandidate,
): candidate is ShadowCandidate & { objectiveId: string; revision: number } {
  return (
    typeof candidate.objectiveId === "string" &&
    candidate.objectiveId.trim().length > 0 &&
    typeof candidate.revision === "number" &&
    Number.isFinite(candidate.revision)
  );
}

export function conversationTaskCandidate(params: {
  taskKey: string;
  activationEpoch: number;
}): ShadowCandidate | null {
  const taskKey = params.taskKey.trim();
  if (!taskKey || !Number.isFinite(params.activationEpoch)) {
    return null;
  }
  return {
    source: "conversation_task",
    objectiveId: taskKey,
    revision: params.activationEpoch,
  };
}

export function legacyContextCandidate(params: {
  objectiveId: string;
  revision?: number;
}): ShadowCandidate | null {
  const objectiveId = params.objectiveId.trim();
  if (!objectiveId) {
    return null;
  }
  return {
    source: "legacy_context",
    objectiveId,
    ...(typeof params.revision === "number" && Number.isFinite(params.revision)
      ? { revision: params.revision }
      : {}),
  };
}

export function sharedTaskCandidate(params: {
  conversationId: string;
  revision: number;
}): ShadowCandidate | null {
  const conversationId = params.conversationId.trim();
  if (!conversationId || !Number.isFinite(params.revision)) {
    return null;
  }
  return {
    source: "collaboration",
    objectiveId: conversationId,
    revision: params.revision,
  };
}

/**
 * Parent run identity for inherit-only observation.
 * Session keys (`agent:…`, `cron:…`) are not run IDs.
 */
export function normalizeObservedRunId(value?: string | null): string | undefined {
  const id = value?.trim() ?? "";
  if (!id) {
    return undefined;
  }
  if (id.startsWith("agent:") || id.startsWith("cron:") || id.startsWith("session:")) {
    return undefined;
  }
  return id;
}

export function resolveShadowTenant(params: {
  tenantId?: string | null;
  tenantScope?: TenantScope | null;
}): { tenantId: string; tenantScope: TenantScope } | { invalidInput: "invalid_input" } {
  const raw = params.tenantId?.trim() ?? "";
  const tenantScope = params.tenantScope ?? (raw ? "identified" : "local_unscoped");
  if (tenantScope === "local_unscoped") {
    return { tenantId: raw || LOCAL_UNSCOPED_TENANT_ID, tenantScope };
  }
  if (!raw) {
    return { invalidInput: "invalid_input" };
  }
  return { tenantId: raw, tenantScope };
}
