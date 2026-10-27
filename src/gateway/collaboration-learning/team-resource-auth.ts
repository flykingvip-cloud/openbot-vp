/**
 * TEAM-REAL review A — resource ACL + trusted locator for team deliverables.
 *
 * Subject binding (resolveDeliveryAclActor) is not target authorization.
 * Reuses assertGroupMemberAccess + resolveTrustedGroupLocator + membership tenant.
 * Does not remount formal-root twins or invent a parallel deliverable authority.
 */
import type { Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveSecurityProfile } from "../security-profile.js";
import type { GatewayClient } from "../server-methods/types.js";
import { assertGroupMemberAccess } from "../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import { createWorkspaceCollaborationStores } from "./shared.js";
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
  groupLocator: string;
};

export type TeamResourceAuthDenied = {
  ok: false;
  reason: string;
  detail?: string;
};

export type TeamResourceAuthResult = TeamResourceAuthOk | TeamResourceAuthDenied;

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Authorize actor for group resource action. Managed requires membership tenant.
 * Never trusts client-supplied tenantId.
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

  const groupLocator = resolveTrustedGroupLocator({
    groupId,
    tenantId,
    profile,
    cfg,
  });

  return {
    ok: true,
    actor,
    tenantId,
    profile,
    groupLocator,
  };
}

/** Verify task exists under group and is not foreign. */
export async function assertTaskBelongsToGroup(params: {
  groupId: string;
  taskId: string;
  cfg?: OpenBotConfig;
}): Promise<{ ok: true; task: Task } | { ok: false; reason: string; detail?: string }> {
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  if (!groupId || !taskId) {
    return { ok: false, reason: "missing_group_or_task" };
  }
  const cfg = params.cfg ?? loadConfig();
  const stores = createWorkspaceCollaborationStores(cfg);
  const task = await stores.objectStorage.readObject<Task>(groupId, "task", taskId);
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
