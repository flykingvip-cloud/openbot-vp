import {
  buildKnowledgeBasePermissionActor,
  resolveAuthorizedKnowledgeBase,
  type KnowledgeBasePermission,
} from "./knowledge-base-permissions.js";
import { listKnowledgeBases, type KnowledgeBase } from "./knowledge-base-store.js";
import type { KnowledgeSourceContext } from "./sources/types.js";

export function clientKnowledgeEmail(
  client: { user?: string | null } | null | undefined,
): string | null {
  return typeof client?.user === "string" ? client.user : null;
}

export function authorizeKnowledgeBaseAccess(params: {
  knowledgeBaseId: string;
  context: KnowledgeSourceContext;
  email?: string | null;
  permission: KnowledgeBasePermission;
}): KnowledgeBase | null {
  const userId = params.context.userId?.trim();
  const knowledgeBaseId = params.knowledgeBaseId.trim();
  if (!userId || !knowledgeBaseId) {
    return null;
  }
  return resolveAuthorizedKnowledgeBase({
    knowledgeBaseId,
    actor: buildKnowledgeBasePermissionActor({
      context: params.context,
      email: params.email,
    }),
    permission: params.permission,
  });
}

export function isAuthorizedKnowledgeBaseId(
  knowledgeBaseId: string | null | undefined,
  context: KnowledgeSourceContext,
  email: string | null | undefined,
  permission: KnowledgeBasePermission,
): boolean {
  if (!knowledgeBaseId?.trim()) {
    return false;
  }
  return Boolean(
    authorizeKnowledgeBaseAccess({
      knowledgeBaseId,
      context,
      email,
      permission,
    }),
  );
}

export function createKnowledgeBaseAccessCache(params: {
  context: KnowledgeSourceContext;
  email?: string | null;
  permission: KnowledgeBasePermission;
}): (knowledgeBaseId: string | null | undefined) => boolean {
  const cache = new Map<string, boolean>();
  return (knowledgeBaseId) => {
    const id = knowledgeBaseId?.trim();
    if (!id) {
      return false;
    }
    const hit = cache.get(id);
    if (hit !== undefined) {
      return hit;
    }
    const allowed = isAuthorizedKnowledgeBaseId(
      id,
      params.context,
      params.email,
      params.permission,
    );
    cache.set(id, allowed);
    return allowed;
  };
}

/**
 * POLICY-PRE02: canReadKnowledgeBase is the sole fail-closed authoritative
 * read gate. isKnowledgeBaseVisible remains only a fallback inside that gate.
 */
export function listReadableKnowledgeBaseIds(params: {
  context: KnowledgeSourceContext;
  email?: string | null;
}): string[] {
  const canRead = createKnowledgeBaseAccessCache({
    context: params.context,
    email: params.email,
    permission: "read",
  });
  return listKnowledgeBases()
    .map((base) => base.id)
    .filter((id) => canRead(id));
}

export function resolveReadableKnowledgeBaseScope(params: {
  context: KnowledgeSourceContext;
  email?: string | null;
  knowledgeBaseId?: string;
}): { authorized: boolean; kbId?: string; allowedKbIds: readonly string[] } {
  const canRead = createKnowledgeBaseAccessCache({
    context: params.context,
    email: params.email,
    permission: "read",
  });
  if (params.knowledgeBaseId) {
    if (!canRead(params.knowledgeBaseId)) {
      return { authorized: false, allowedKbIds: [] };
    }
    return {
      authorized: true,
      kbId: params.knowledgeBaseId,
      allowedKbIds: [params.knowledgeBaseId],
    };
  }
  return { authorized: true, allowedKbIds: listReadableKnowledgeBaseIds(params) };
}
