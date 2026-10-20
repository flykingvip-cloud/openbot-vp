/**
 * Retention policy helpers (CL-P0-03). Defaults are review placeholders — not hard-coded product SLAs.
 */
import { createHash } from "node:crypto";
import type { ConversationRetentionPolicy, ConversationTenantContext } from "./types.js";

/** ISO-8601 duration strings used as config defaults (not enforced until retention.enforceEnabled). */
export const DEFAULT_RETENTION_DURATIONS = {
  activeIdleAfter: "P7D",
  warmAfter: "P30D",
  coldAfter: "P90D",
  archiveAfter: "P180D",
  purgeAfter: null as string | null,
} as const;

export function buildDefaultRetentionPolicy(
  ctx: Pick<ConversationTenantContext, "dataPlaneId" | "tenantId">,
  overrides?: Partial<ConversationRetentionPolicy>,
): ConversationRetentionPolicy {
  const policyId = createHash("sha256")
    .update(`retention-default-v1\0${ctx.dataPlaneId}\0${ctx.tenantId ?? ""}`)
    .digest("hex")
    .slice(0, 16);

  return {
    schemaVersion: 1,
    policyId: `ret_${policyId}`,
    dataPlaneId: ctx.dataPlaneId,
    tenantId: ctx.tenantId,
    activeIdleAfter: DEFAULT_RETENTION_DURATIONS.activeIdleAfter,
    warmAfter: DEFAULT_RETENTION_DURATIONS.warmAfter,
    coldAfter: DEFAULT_RETENTION_DURATIONS.coldAfter,
    archiveAfter: DEFAULT_RETENTION_DURATIONS.archiveAfter,
    purgeAfter: DEFAULT_RETENTION_DURATIONS.purgeAfter,
    archiveEnabled: true,
    memoryExtractionEnabled: true,
    archiveSearchEnabled: false,
    userExportEnabled: true,
    userDeleteMode: "ARCHIVE_ONLY",
    legalHoldEnabled: true,
    ...overrides,
  };
}

export function validateRetentionPolicy(
  policy: ConversationRetentionPolicy,
): { ok: true } | { ok: false; reasonCode: string } {
  if (policy.schemaVersion !== 1) {
    return { ok: false, reasonCode: "UNSUPPORTED_SCHEMA" };
  }
  if (!policy.dataPlaneId?.trim()) {
    return { ok: false, reasonCode: "DATA_PLANE_REQUIRED" };
  }
  if (!policy.policyId?.trim()) {
    return { ok: false, reasonCode: "POLICY_ID_REQUIRED" };
  }
  return { ok: true };
}

/** Whether user-initiated purge is allowed under policy (legal hold checked separately). */
export function userMayPurge(policy: ConversationRetentionPolicy): boolean {
  return policy.userDeleteMode === "PURGE_ALLOWED";
}

export function userMayArchive(policy: ConversationRetentionPolicy): boolean {
  return policy.archiveEnabled && policy.userDeleteMode !== "DISABLED";
}
