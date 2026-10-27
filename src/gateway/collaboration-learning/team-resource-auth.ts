/**
 * TEAM-REAL review A / R2 包1 — resource ACL + trusted locator for team deliverables.
 *
 * Subject binding (resolveDeliveryAclActor) is not target authorization.
 * Reuses assertGroupMemberAccess + resolveTrustedGroupLocator + membership tenant.
 * Write action requires active non-observer membership (not read ACL renamed).
 * Auth result carries groupLocator + groupsRoot so callers use ONE trusted root.
 * Does not remount formal-root twins or invent a parallel deliverable authority.
 */
import path from "node:path";
import type { CollaborationMember, Task } from "@openbot/collaboration-core";
import { OpenBotObjectStorage } from "@openbot/collaboration-openbot-adapter";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveSecurityProfile } from "../security-profile.js";
import type { GatewayClient } from "../server-methods/types.js";
import { assertGroupMemberAccess, loadAuthoritativeGroupMembers } from "../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import { createGroupFileStore, createWorkspaceCollaborationStores } from "./shared.js";
import {
  isAclSafeTenantTrust,
  type CollaborationTenantResolution,
  resolveMembershipTenantIdForAcl,
} from "./trusted-tenant.js";

export type TeamResourceAuthOk = {
  ok: true;
  actor: string;
  tenantId: string | null;
  profile: "personal_local" | "managed_enterprise";
  /** Absolute group directory (trusted). */
  groupLocator: string;
  /** Parent of groupLocator — object/file store root for this tenant/group layout. */
  groupsRoot: string;
  governanceRole: CollaborationMember["governanceRole"] | null;
  memberStatus: CollaborationMember["status"] | null;
};

export type TeamResourceAuthDenied = {
  ok: false;
  reason: string;
  detail?: string;
};

export type TeamResourceAuthResult = TeamResourceAuthOk | TeamResourceAuthDenied;

export type TrustedGroupStores = {
  groupsRoot: string;
  groupLocator: string;
  fileStore: ReturnType<typeof createGroupFileStore>;
  objectStorage: OpenBotObjectStorage;
};

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function memberMatchesActor(
  member: CollaborationMember,
  actor: string,
  identityAliases: readonly string[] = [],
): boolean {
  const accepted = new Set(
    [actor, ...identityAliases]
      .map((entry) => (typeof entry === "string" ? normalizeIdentity(entry) : ""))
      .filter(Boolean),
  );
  const candidates = [member.userId, member.memberId, member.agentId]
    .map((entry) => (typeof entry === "string" ? normalizeIdentity(entry) : ""))
    .filter(Boolean);
  return candidates.some((id) => accepted.has(id));
}

/**
 * Build object/file stores rooted at the trusted groupsRoot from auth.
 * Callers must NOT fall back to createWorkspaceCollaborationStores(cfg) after auth.
 */
export function createTrustedGroupStores(params: {
  groupsRoot: string;
  groupLocator: string;
}): TrustedGroupStores {
  const groupsRoot = path.resolve(params.groupsRoot);
  const fileStore = createGroupFileStore(groupsRoot);
  return {
    groupsRoot,
    groupLocator: path.resolve(params.groupLocator),
    fileStore,
    objectStorage: new OpenBotObjectStorage(undefined, fileStore),
  };
}

/** Resolve stores for a group using auth result, or legacy workspace root when ACL skipped. */
export function resolveTeamDeliverableStores(params: {
  auth?: TeamResourceAuthOk | null;
  groupId: string;
  cfg?: OpenBotConfig;
}): TrustedGroupStores & { groupDir: string } {
  if (params.auth) {
    const stores = createTrustedGroupStores({
      groupsRoot: params.auth.groupsRoot,
      groupLocator: params.auth.groupLocator,
    });
    return { ...stores, groupDir: stores.groupLocator };
  }
  const cfg = params.cfg ?? loadConfig();
  const legacy = createWorkspaceCollaborationStores(cfg);
  const groupDir = path.join(legacy.groupRootDir, encodeURIComponent(compact(params.groupId)));
  return {
    groupsRoot: legacy.groupRootDir,
    groupLocator: groupDir,
    groupDir,
    fileStore: legacy.fileStore,
    objectStorage: legacy.objectStorage,
  };
}

function isWriteCapableRole(
  governanceRole: CollaborationMember["governanceRole"] | null | undefined,
  collaborationRole: CollaborationMember["collaborationRole"] | null | undefined,
): boolean {
  if (governanceRole === "observer") {
    return false;
  }
  if (collaborationRole === "observer") {
    return false;
  }
  return true;
}

/**
 * Authorize actor for group resource action. Managed requires membership tenant.
 * Never trusts client-supplied tenantId.
 * Write ≠ read: observers and non-active members are denied write.
 */
export async function authorizeTeamGroupResourceAccess(params: {
  groupId: string;
  actor: string;
  client?: GatewayClient | null;
  /** Prefer membership resolution from caller when already computed. */
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  identityAliases?: readonly string[];
  action: "read" | "write";
}): Promise<TeamResourceAuthResult> {
  const groupId = compact(params.groupId);
  const actor = compact(params.actor);
  if (!groupId || !actor) {
    return { ok: false, reason: "missing_group_or_actor" };
  }
  const cfg = params.cfg ?? loadConfig();
  const profile = resolveSecurityProfile(cfg).profile;

  let tenantId: string | null = null;
  if (params.tenant && isAclSafeTenantTrust(params.tenant.trust)) {
    tenantId = params.tenant.tenantId;
  } else {
    tenantId = await resolveMembershipTenantIdForAcl(params.client ?? null);
  }

  if (profile === "managed_enterprise" && !compact(tenantId ?? undefined)) {
    return {
      ok: false,
      reason: "trusted_tenant_required",
      detail: "managed_enterprise requires membership tenant for ACL",
    };
  }

  const denied = await assertGroupMemberAccess({
    groupId,
    userId: actor,
    tenantId,
    profile,
    cfg,
    identityAliases: params.identityAliases,
  });
  if (denied) {
    return {
      ok: false,
      reason: params.action === "write" ? "write_acl_denied" : "read_acl_denied",
      detail: denied,
    };
  }

  const members = await loadAuthoritativeGroupMembers({
    groupId,
    tenantId,
    profile,
    cfg,
  });
  const matched = members.find((row) =>
    memberMatchesActor(row, actor, params.identityAliases ?? []),
  );

  if (params.action === "write") {
    if (!matched) {
      return {
        ok: false,
        reason: "write_acl_denied",
        detail: "no authoritative membership row for write",
      };
    }
    if (matched.status !== "active") {
      return {
        ok: false,
        reason: "write_acl_denied",
        detail: `member status=${matched.status} is not write-capable (active required)`,
      };
    }
    if (!isWriteCapableRole(matched.governanceRole, matched.collaborationRole)) {
      return {
        ok: false,
        reason: "write_acl_denied",
        detail: `observer/read-only role cannot write (governance=${matched.governanceRole} collab=${matched.collaborationRole ?? "none"})`,
      };
    }
  }

  const groupLocator = resolveTrustedGroupLocator({
    groupId,
    tenantId,
    profile,
    cfg,
  });
  const groupsRoot = path.dirname(groupLocator);

  return {
    ok: true,
    actor,
    tenantId,
    profile,
    groupLocator,
    groupsRoot,
    governanceRole: matched?.governanceRole ?? null,
    memberStatus: matched?.status ?? null,
  };
}

/** Verify task exists under the SAME trusted stores as auth (no cross-tenant fallback). */
export async function assertTaskBelongsToGroup(params: {
  groupId: string;
  taskId: string;
  cfg?: OpenBotConfig;
  /** Prefer stores from authorizeTeamGroupResourceAccess. */
  stores?: Pick<TrustedGroupStores, "objectStorage"> | null;
}): Promise<{ ok: true; task: Task } | { ok: false; reason: string; detail?: string }> {
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  if (!groupId || !taskId) {
    return { ok: false, reason: "missing_group_or_task" };
  }
  const objectStorage =
    params.stores?.objectStorage ??
    createWorkspaceCollaborationStores(params.cfg ?? loadConfig()).objectStorage;
  const task = await objectStorage.readObject<Task>(groupId, "task", taskId);
  if (!task) {
    return { ok: false, reason: "task_not_found", detail: taskId };
  }
  if (compact(task.groupId) && compact(task.groupId) !== groupId) {
    return {
      ok: false,
      reason: "task_group_mismatch",
      detail: `task.groupId=${task.groupId} requested=${groupId}`,
    };
  }
  return { ok: true, task };
}
