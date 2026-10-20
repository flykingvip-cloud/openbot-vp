/**
 * CollabDispatch Sprint D4 — broadcast authorization.
 *
 * Reuses existing tenant/role patterns (SeatRole, membershipRole → tenant-admin,
 * space governance owner/admin). Does not invent a parallel ACL system.
 *
 * Design: docs/design/org-collab-dispatch-dev-2026-09-27.md §5.2 / Sprint D4.
 */

import type { SeatRole } from "../shared/seat-role.js";
import type { CollabDispatch, CollabDispatchAudienceMode } from "./collab-dispatch-store.js";

/** Roles already used elsewhere for org / space / tenant gates. */
export type CollabDispatchSpaceGovernanceRole = "owner" | "admin" | "member" | "observer";

export type CollabDispatchMembershipRole = "enterprise-admin" | "member";

export type CollabDispatchBroadcastAuthzContext = {
  /** Billing SeatRole on the actor's active seat (viewer|creator|admin). */
  seatRole?: SeatRole | null;
  /** Platform membership role (enterprise-admin maps to tenant-admin). */
  membershipRole?: CollabDispatchMembershipRole | null;
  /**
   * Collaboration-space governance role for the target space
   * (same values as employee-workbench-scope resolveActorGovernanceRoleInSpace).
   */
  spaceGovernanceRole?: CollabDispatchSpaceGovernanceRole | null;
  /**
   * RuntimeIdentity.permissions-style flags (e.g. "admin", "coordinate") —
   * same admin set used by mention-authority.
   */
  permissions?: readonly string[] | null;
};

export type CollabDispatchBroadcastAuthzResult = { ok: true } | { ok: false; reason: string };

const ADMIN_PERMISSIONS = new Set(["coordinate", "admin"]);

function hasAdminPermission(permissions: readonly string[] | null | undefined): boolean {
  if (!permissions || permissions.length === 0) {
    return false;
  }
  return permissions.some((perm) => ADMIN_PERMISSIONS.has(perm));
}

function isTenantBroadcastAuthorized(ctx: CollabDispatchBroadcastAuthzContext): boolean {
  if (ctx.membershipRole === "enterprise-admin") {
    return true;
  }
  if (ctx.seatRole === "admin") {
    return true;
  }
  if (hasAdminPermission(ctx.permissions)) {
    return true;
  }
  return false;
}

function isSpaceBroadcastAuthorized(ctx: CollabDispatchBroadcastAuthzContext): boolean {
  const role = ctx.spaceGovernanceRole;
  if (role === "owner" || role === "admin") {
    return true;
  }
  // Tenant/seat admins may broadcast into a space they can already govern.
  return isTenantBroadcastAuthorized(ctx);
}

/** Pure check: roster always allowed; space|tenant need elevated roles. */
export function authorizeCollabDispatchBroadcast(params: {
  audienceMode: CollabDispatchAudienceMode;
  spaceId?: string | null;
  authz: CollabDispatchBroadcastAuthzContext;
}): CollabDispatchBroadcastAuthzResult {
  const mode = params.audienceMode;
  if (mode === "roster") {
    return { ok: true };
  }
  if (mode === "space") {
    const spaceId = params.spaceId?.trim();
    if (!spaceId) {
      return { ok: false, reason: "audience.mode=space requires audience.spaceId" };
    }
    if (!isSpaceBroadcastAuthorized(params.authz)) {
      return {
        ok: false,
        reason:
          "space broadcast requires space owner/admin governance role, seat admin, or enterprise-admin",
      };
    }
    return { ok: true };
  }
  if (mode === "tenant") {
    if (!isTenantBroadcastAuthorized(params.authz)) {
      return {
        ok: false,
        reason:
          "tenant broadcast requires seat admin, enterprise-admin, or admin/coordinate permission",
      };
    }
    return { ok: true };
  }
  return { ok: false, reason: `unsupported audience.mode: ${String(mode)}` };
}

export function authorizeCollabDispatchBroadcastForDispatch(
  dispatch: CollabDispatch,
  authz: CollabDispatchBroadcastAuthzContext,
): CollabDispatchBroadcastAuthzResult {
  return authorizeCollabDispatchBroadcast({
    audienceMode: dispatch.audience.mode,
    spaceId: dispatch.audience.spaceId,
    authz,
  });
}

/** Human-readable blast radius for organizer confirmation copy (§5.2). */
export function describeCollabDispatchBlastRadius(dispatch: CollabDispatch): string {
  const recipientCount = Math.max(0, dispatch.recipients.length - 1);
  if (dispatch.audience.mode === "tenant") {
    return `租户广播（tenant=${dispatch.tenantId}，名单 ${recipientCount} 人）`;
  }
  if (dispatch.audience.mode === "space") {
    const space = dispatch.audience.spaceId?.trim() || "(未指定 space)";
    return `协作空间广播（space=${space}，名单 ${recipientCount} 人）`;
  }
  return recipientCount > 0 ? `定向名单 ${recipientCount} 人` : "仅发起人";
}
