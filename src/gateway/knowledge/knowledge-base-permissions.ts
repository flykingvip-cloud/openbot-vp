import type { RetrievalContext } from "../../retrieval/types.js";
import { isKnowledgeBaseVisible } from "../../retrieval/visibility-resolver.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import {
  listKnowledgeBaseMembers,
  type KnowledgeBaseMemberRecord,
  type KnowledgeBaseMemberRole,
} from "./knowledge-base-members.js";
import { getKnowledgeBase, type KnowledgeBase } from "./knowledge-base-store.js";
import type { KnowledgeSourceContext } from "./sources/types.js";

export type KnowledgeBasePermissionActor = {
  userId: string | null;
  tenantId: string | null;
  email?: string | null;
  departmentId?: string | null;
  roleCode?: string | null;
  /** Bound robot/agent id — read-only via knowledgeBase.robotIds. */
  agentId?: string | null;
};

export type KnowledgeBasePermission = "read" | "write" | "admin";

function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase();
  return email || null;
}

function retrievalContextFromActor(actor: KnowledgeBasePermissionActor): RetrievalContext {
  return {
    userId: actor.userId,
    seatId: null,
    tenantId: actor.tenantId,
    departmentId: actor.departmentId ?? null,
    roleCodes: actor.roleCode ? [actor.roleCode] : undefined,
  };
}

function activeMemberRole(
  knowledgeBase: KnowledgeBase,
  actor: KnowledgeBasePermissionActor,
  members: KnowledgeBaseMemberRecord[] = listKnowledgeBaseMembers(knowledgeBase.id),
): KnowledgeBaseMemberRole | null {
  // Agent execution cannot convert an email invitation into stable user authority.
  if (actor.agentId?.trim()) {
    if (!actor.userId?.trim()) {
      return null;
    }
    return (
      members.find(
        (member) =>
          member.knowledgeBaseId === knowledgeBase.id &&
          member.status === "active" &&
          member.userId === actor.userId,
      )?.role ?? null
    );
  }
  const email = normalizeEmail(actor.email);
  if (!email) {
    return null;
  }
  return (
    members.find(
      (member) =>
        member.knowledgeBaseId === knowledgeBase.id &&
        member.email === email &&
        member.status === "active",
    )?.role ?? null
  );
}

export function canReadKnowledgeBase(params: {
  knowledgeBase: KnowledgeBase;
  actor: KnowledgeBasePermissionActor;
  members?: KnowledgeBaseMemberRecord[];
}): boolean {
  const { knowledgeBase, actor } = params;
  // Agent binding only narrows a trusted user's access; it never grants membership.
  if (actor.agentId?.trim()) {
    const actorTenant = canonicalizeTenantId(actor.tenantId);
    const kbTenant = canonicalizeTenantId(knowledgeBase.tenantId);
    if (
      !actor.userId?.trim() ||
      !actorTenant ||
      !kbTenant ||
      actorTenant !== kbTenant ||
      !knowledgeBase.robotIds.includes(actor.agentId.trim())
    ) {
      return false;
    }
  }
  if (actor.userId && knowledgeBase.ownerId === actor.userId) {
    return true;
  }
  if (activeMemberRole(knowledgeBase, actor, params.members)) {
    return true;
  }
  return isKnowledgeBaseVisible(retrievalContextFromActor(actor), {
    id: knowledgeBase.id,
    ownerId: knowledgeBase.ownerId,
    // Canonicalize so legacy tenant-id aliases still match the caller tenant.
    tenantId: canonicalizeTenantId(knowledgeBase.tenantId),
    visibility: knowledgeBase.visibility,
  });
}

export function canWriteKnowledgeBase(params: {
  knowledgeBase: KnowledgeBase;
  actor: KnowledgeBasePermissionActor;
  members?: KnowledgeBaseMemberRecord[];
}): boolean {
  const { knowledgeBase, actor } = params;
  if (actor.userId && knowledgeBase.ownerId === actor.userId) {
    return true;
  }
  const role = activeMemberRole(knowledgeBase, actor, params.members);
  return role === "admin" || role === "editor";
}

export function canAdminKnowledgeBase(params: {
  knowledgeBase: KnowledgeBase;
  actor: KnowledgeBasePermissionActor;
  members?: KnowledgeBaseMemberRecord[];
}): boolean {
  const { knowledgeBase, actor } = params;
  if (actor.userId && knowledgeBase.ownerId === actor.userId) {
    return true;
  }
  return activeMemberRole(knowledgeBase, actor, params.members) === "admin";
}

export function hasKnowledgeBasePermission(params: {
  knowledgeBase: KnowledgeBase;
  actor: KnowledgeBasePermissionActor;
  permission: KnowledgeBasePermission;
  members?: KnowledgeBaseMemberRecord[];
}): boolean {
  if (params.permission === "admin") {
    return canAdminKnowledgeBase(params);
  }
  if (params.permission === "write") {
    return canWriteKnowledgeBase(params);
  }
  return canReadKnowledgeBase(params);
}

export function buildKnowledgeBasePermissionActor(params: {
  context: Pick<KnowledgeSourceContext, "userId" | "tenantId" | "departmentId" | "roleCode">;
  email?: string | null;
  agentId?: string | null;
}): KnowledgeBasePermissionActor {
  return {
    userId: params.context.userId,
    tenantId: params.context.tenantId,
    email: params.email ?? null,
    departmentId: params.context.departmentId ?? null,
    roleCode: params.context.roleCode ?? null,
    ...(params.agentId?.trim() ? { agentId: params.agentId.trim() } : {}),
  };
}

export function resolveAuthorizedKnowledgeBase(params: {
  knowledgeBaseId: string;
  actor: KnowledgeBasePermissionActor;
  permission: KnowledgeBasePermission;
  storePath?: string;
}): KnowledgeBase | null {
  const knowledgeBase = getKnowledgeBase(params.knowledgeBaseId, params.storePath);
  if (!knowledgeBase) {
    return null;
  }
  if (
    !hasKnowledgeBasePermission({
      knowledgeBase,
      actor: params.actor,
      permission: params.permission,
    })
  ) {
    return null;
  }
  return knowledgeBase;
}
