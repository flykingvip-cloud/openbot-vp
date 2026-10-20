/**
 * Authorize progress access: actor may only touch their own userId within tenant.
 */

import { normalizeGuidanceProgressKey, sameGuidanceProgressKey } from "./keys.js";
import {
  GuidanceProgressAuthError,
  GuidanceProgressValidationError,
  type GuidanceProgressKey,
} from "./types.js";

export type GuidanceProgressActor = {
  /** Authenticated platform user id (client.user). Required for mutating ops. */
  userId: string;
  /** Optional resolved tenant; when set, must match the progress key tenant. */
  tenantId?: string | null;
};

export function authorizeGuidanceProgressAccess(params: {
  actor: GuidanceProgressActor | null | undefined;
  key: GuidanceProgressKey;
  /** When true, missing actor fails closed. */
  requireActor?: boolean;
}): GuidanceProgressKey {
  const { actor, key, requireActor = true } = params;
  if (!actor?.userId?.trim()) {
    if (requireActor) {
      throw new GuidanceProgressAuthError("authenticated user required for guidance progress");
    }
    return key;
  }
  const actorUserId = actor.userId.trim();
  if (actorUserId.toLowerCase() !== key.userId.toLowerCase()) {
    throw new GuidanceProgressAuthError("guidance progress is user-isolated");
  }
  const actorTenant = actor.tenantId?.trim();
  if (actorTenant && actorTenant !== key.tenantId) {
    throw new GuidanceProgressAuthError("guidance progress is tenant-isolated");
  }
  return key;
}

export function resolveAuthorizedProgressKey(params: {
  actor: GuidanceProgressActor | null | undefined;
  tenantId: string;
  userId: string;
  scope: string;
  entityId: string;
}): GuidanceProgressKey {
  let key: GuidanceProgressKey;
  try {
    key = normalizeGuidanceProgressKey({
      tenantId: params.tenantId,
      userId: params.userId,
      scope: params.scope,
      entityId: params.entityId,
    });
  } catch (err) {
    if (err instanceof GuidanceProgressValidationError) {
      throw err;
    }
    throw new GuidanceProgressValidationError(
      err instanceof Error ? err.message : "invalid progress key",
    );
  }
  return authorizeGuidanceProgressAccess({ actor: params.actor, key, requireActor: true });
}

/** Cross-tenant / cross-user forgery guard for read-after-write assertions in tests. */
export function assertProgressRecordMatchesKey(
  record: GuidanceProgressKey,
  key: GuidanceProgressKey,
): void {
  if (!sameGuidanceProgressKey(record, key)) {
    throw new GuidanceProgressAuthError("progress record key mismatch");
  }
}
