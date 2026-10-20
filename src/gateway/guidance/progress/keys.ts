/**
 * Progress addressing — tenantId + userId + scope + entityId.
 */

import { isGuidanceScope } from "../types.js";
import type { GuidanceProgressKey } from "./types.js";
import { GuidanceProgressValidationError } from "./types.js";

const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._@:-]{0,127}$/;

export function assertSafeProgressSegment(label: string, value: string): string {
  const trimmed = value.trim();
  if (!SAFE_SEGMENT.test(trimmed) || trimmed.includes("..")) {
    throw new GuidanceProgressValidationError(`invalid ${label}`);
  }
  return trimmed;
}

export function normalizeGuidanceProgressKey(input: {
  tenantId: string;
  userId: string;
  scope: string;
  entityId: string;
}): GuidanceProgressKey {
  if (!isGuidanceScope(input.scope)) {
    throw new GuidanceProgressValidationError("scope must be user|robot|team");
  }
  return {
    tenantId: assertSafeProgressSegment("tenantId", input.tenantId),
    userId: assertSafeProgressSegment("userId", input.userId),
    scope: input.scope,
    entityId: assertSafeProgressSegment("entityId", input.entityId),
  };
}

/** Stable string form for locks / logs (not a filesystem path). */
export function formatGuidanceProgressKey(key: GuidanceProgressKey): string {
  return `${key.tenantId}/${key.userId}/${key.scope}/${key.entityId}`;
}

export function sameGuidanceProgressKey(a: GuidanceProgressKey, b: GuidanceProgressKey): boolean {
  return (
    a.tenantId === b.tenantId &&
    a.userId === b.userId &&
    a.scope === b.scope &&
    a.entityId === b.entityId
  );
}
