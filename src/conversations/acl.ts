/**
 * Conversation ACL (CL-P0-03).
 * Order: Tenant → Principal → Seat → Ownership/membership → Lifecycle/legal hold → Source visibility.
 */
import type {
  ConversationPermissionAction,
  ConversationRecord,
  ConversationSessionBinding,
  ConversationTenantContext,
} from "./types.js";

export type ConversationAccessDecision = {
  allowed: boolean;
  reasonCode: string;
};

function deny(reasonCode: string): ConversationAccessDecision {
  return { allowed: false, reasonCode };
}

function allow(reasonCode = "OK"): ConversationAccessDecision {
  return { allowed: true, reasonCode };
}

function isAdmin(ctx: ConversationTenantContext): boolean {
  return ctx.roles.some((r) => r === "admin" || r === "tenant_admin" || r === "governance_admin");
}

function sameTenant(ctx: ConversationTenantContext, record: ConversationRecord): boolean {
  // Local personal: both null tenant is ok when data planes match.
  if (ctx.dataPlaneId !== record.dataPlaneId) {
    return false;
  }
  if (ctx.mode === "managed") {
    return Boolean(ctx.tenantId && record.tenantId && ctx.tenantId === record.tenantId);
  }
  // Local: allow null/null or matching tenantId
  if (record.tenantId == null) {
    return true;
  }
  return ctx.tenantId == null || ctx.tenantId === record.tenantId;
}

function ownsOrMember(ctx: ConversationTenantContext, record: ConversationRecord): boolean {
  if (isAdmin(ctx)) {
    return true;
  }
  switch (record.ownershipScopeType) {
    case "USER":
      return (
        ctx.principalId === record.ownershipScopeId || ctx.principalId === record.createdByUserId
      );
    case "SEAT":
      return Boolean(ctx.seatId && ctx.seatId === record.ownershipScopeId);
    case "GROUP":
      return ctx.groupIds.includes(record.ownershipScopeId);
    default:
      return false;
  }
}

/**
 * Authorize a conversation action. Fail closed on lifecycle/legal hold conflicts.
 */
export function authorizeConversationAction(params: {
  ctx: ConversationTenantContext;
  record: ConversationRecord;
  action: ConversationPermissionAction;
  binding?: ConversationSessionBinding | null;
}): ConversationAccessDecision {
  const { ctx, record, action, binding } = params;

  if (!sameTenant(ctx, record)) {
    return deny("CROSS_TENANT_OR_DATA_PLANE");
  }

  if (record.lifecycleStatus === "DELETED" && action !== "export") {
    // Purge receipt / audit may still need export; default deny others.
    if (action !== "read" || !isAdmin(ctx)) {
      return deny("CONVERSATION_DELETED");
    }
  }

  if (record.retentionState === "PURGE_PENDING") {
    if (action === "write" || action === "archive" || action === "restore") {
      return deny("PURGE_PENDING");
    }
  }

  if (record.retentionState === "LEGAL_HOLD") {
    if (action === "purge") {
      return deny("LEGAL_HOLD_BLOCKS_PURGE");
    }
    // legal hold does not block authorized read/export
  }

  if (action === "read_execution_stream") {
    if (!binding || binding.role !== "AGENT_EXECUTION") {
      return deny("NOT_EXECUTION_BINDING");
    }
    if (!isAdmin(ctx) && !ctx.roles.includes("execution_stream_reader")) {
      return deny("EXECUTION_STREAM_FORBIDDEN");
    }
    return ownsOrMember(ctx, record) ? allow("EXECUTION_STREAM") : deny("NOT_OWNER_OR_MEMBER");
  }

  if (!ownsOrMember(ctx, record)) {
    return deny("NOT_OWNER_OR_MEMBER");
  }

  if (record.lifecycleStatus === "ARCHIVED") {
    if (action === "write") {
      return deny("ARCHIVED_READ_ONLY");
    }
  }

  if (action === "purge") {
    if (!isAdmin(ctx) && !ctx.roles.includes("purge")) {
      // Owner may purge only when policy allows (checked by caller via retention policy).
      if (record.ownershipScopeType === "GROUP" && !ctx.roles.includes("group_owner")) {
        return deny("PURGE_FORBIDDEN");
      }
    }
  }

  if (action === "legal_hold" && !isAdmin(ctx) && !ctx.roles.includes("governance_admin")) {
    return deny("LEGAL_HOLD_FORBIDDEN");
  }

  return allow();
}

/**
 * Default history binding roles visible without extra governance permission.
 */
export function isUserVisibleBindingRole(role: ConversationSessionBinding["role"]): boolean {
  return role === "PRIMARY" || role === "GROUP_PUBLIC";
}
