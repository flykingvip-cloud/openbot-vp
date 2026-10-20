/**
 * Schema validation for Conversation domain objects (CL-P0-01).
 */
import {
  LIFECYCLE_STATUSES,
  RETENTION_STATES,
  STORAGE_TIERS,
  type ConversationRecord,
  type ConversationSessionBinding,
  type MemorySourceIdentity,
} from "./types.js";

export type ValidationResult = { ok: true } | { ok: false; reasonCode: string; detail?: string };

function requireNonEmpty(value: string | null | undefined, code: string): ValidationResult | null {
  if (value == null || !String(value).trim()) {
    return { ok: false, reasonCode: code };
  }
  return null;
}

export function validateConversationRecord(record: ConversationRecord): ValidationResult {
  if (record.schemaVersion !== 1) {
    return { ok: false, reasonCode: "UNSUPPORTED_SCHEMA" };
  }
  for (const [field, code] of [
    [record.conversationId, "CONVERSATION_ID_REQUIRED"],
    [record.dataPlaneId, "DATA_PLANE_REQUIRED"],
    [record.ownershipScopeId, "OWNERSHIP_SCOPE_REQUIRED"],
    [record.createdByUserId, "CREATED_BY_REQUIRED"],
    [record.title, "TITLE_REQUIRED"],
    [record.etag, "ETAG_REQUIRED"],
  ] as const) {
    const err = requireNonEmpty(field, code);
    if (err) {
      return err;
    }
  }
  if (!LIFECYCLE_STATUSES.includes(record.lifecycleStatus)) {
    return { ok: false, reasonCode: "INVALID_LIFECYCLE" };
  }
  if (!STORAGE_TIERS.includes(record.storageTier)) {
    return { ok: false, reasonCode: "INVALID_STORAGE_TIER" };
  }
  if (!RETENTION_STATES.includes(record.retentionState)) {
    return { ok: false, reasonCode: "INVALID_RETENTION_STATE" };
  }
  if (record.surfaceType === "AGENT" && !record.agentId) {
    return { ok: false, reasonCode: "AGENT_ID_REQUIRED" };
  }
  if (record.surfaceType === "COLLABORATION_GROUP" && !record.groupId) {
    return { ok: false, reasonCode: "GROUP_ID_REQUIRED" };
  }
  return { ok: true };
}

export function validateBinding(binding: ConversationSessionBinding): ValidationResult {
  if (binding.schemaVersion !== 1) {
    return { ok: false, reasonCode: "UNSUPPORTED_SCHEMA" };
  }
  for (const [field, code] of [
    [binding.bindingId, "BINDING_ID_REQUIRED"],
    [binding.dataPlaneId, "DATA_PLANE_REQUIRED"],
    [binding.conversationId, "CONVERSATION_ID_REQUIRED"],
    [binding.sessionKey, "SESSION_KEY_REQUIRED"],
    [binding.sessionId, "SESSION_ID_REQUIRED"],
  ] as const) {
    const err = requireNonEmpty(field, code);
    if (err) {
      return err;
    }
  }
  if (binding.role === "LEGACY_ALIAS" && !binding.aliasTargetBindingId) {
    return { ok: false, reasonCode: "ALIAS_TARGET_REQUIRED" };
  }
  return { ok: true };
}

export function validateMemorySourceIdentity(identity: MemorySourceIdentity): ValidationResult {
  if (identity.schemaVersion !== 1) {
    return { ok: false, reasonCode: "UNSUPPORTED_SCHEMA" };
  }
  if (identity.sourceType !== "TRANSCRIPT_RANGE") {
    return { ok: false, reasonCode: "INVALID_SOURCE_TYPE" };
  }
  for (const [field, code] of [
    [identity.sourceIdentityId, "SOURCE_IDENTITY_ID_REQUIRED"],
    [identity.dataPlaneId, "DATA_PLANE_REQUIRED"],
    [identity.conversationId, "CONVERSATION_ID_REQUIRED"],
    [identity.bindingId, "BINDING_ID_REQUIRED"],
    [identity.sessionId, "SESSION_ID_REQUIRED"],
    [identity.firstTurnId, "FIRST_TURN_REQUIRED"],
    [identity.lastTurnId, "LAST_TURN_REQUIRED"],
  ] as const) {
    const err = requireNonEmpty(field, code);
    if (err) {
      return err;
    }
  }
  // Turn ids must be stable logical ids, never filesystem paths.
  for (const turnId of [identity.firstTurnId, identity.lastTurnId]) {
    if (turnId.includes("/") || turnId.includes("\\") || /^[a-zA-Z]:/.test(turnId)) {
      return { ok: false, reasonCode: "TURN_ID_MUST_NOT_BE_PATH", detail: "use stable turn ids" };
    }
  }
  return { ok: true };
}

/**
 * Cardinality rules: one PRIMARY for agent; one GROUP_PUBLIC for collab (+ optional AGENT_EXECUTION).
 */
export function validateBindingCardinality(
  bindings: ConversationSessionBinding[],
  surfaceType: ConversationRecord["surfaceType"],
): ValidationResult {
  const active = bindings.filter((b) => b.role !== "LEGACY_ALIAS" && b.endedAt == null);
  if (surfaceType === "AGENT") {
    const primaries = active.filter((b) => b.role === "PRIMARY");
    if (primaries.length !== 1) {
      return {
        ok: false,
        reasonCode: "PRIMARY_CARDINALITY",
        detail: `expected 1 PRIMARY, got ${primaries.length}`,
      };
    }
  }
  if (surfaceType === "COLLABORATION_GROUP") {
    const publics = active.filter((b) => b.role === "GROUP_PUBLIC");
    if (publics.length !== 1) {
      return {
        ok: false,
        reasonCode: "GROUP_PUBLIC_CARDINALITY",
        detail: `expected 1 GROUP_PUBLIC, got ${publics.length}`,
      };
    }
  }
  return { ok: true };
}
