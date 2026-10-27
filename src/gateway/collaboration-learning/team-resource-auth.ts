/**
 * TEAM-REAL review A / R2 包1 — resource ACL + trusted locator for team deliverables.
 *
 * Subject binding (resolveDeliveryAclActor) is not target authorization.
 * Reuses assertGroupMemberAccess + resolveTrustedGroupLocator + membership tenant.
 * Write action requires active non-observer membership (not read ACL renamed).
 * Auth result carries groupLocator + groupsRoot so callers use ONE trusted root.
 * Does not remount formal-root twins or invent a parallel deliverable authority.
 * Dual-root cleanup: team stores NEVER fall back to createWorkspaceCollaborationStores
 * (host ~/.openbot/collaboration). Managed writes use tenants/<tid>/collaboration only.
 */
import path from "node:path";
import type { CollaborationMember, Task } from "@openbot/collaboration-core";
import {
  OpenBotGroupStorage,
  OpenBotLearningStorage,
  OpenBotMemoryStorage,
  OpenBotMetadataStorage,
  OpenBotObjectStorage,
} from "@openbot/collaboration-openbot-adapter";
import { loadConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveSecurityProfile } from "../security-profile.js";
import type { GatewayClient } from "../server-methods/types.js";
import { assertGroupMemberAccess, loadAuthoritativeGroupMembers } from "../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import { createGroupFileStore, createWorkspaceGroupStoreFunctions } from "./shared.js";
import {
  isAclSafeTenantTrust,
  type CollaborationTenantResolution,
  resolveMembershipTenantIdForAcl,
} from "./trusted-tenant.js";

/** Team APIs must never silently fall back to host ~/.openbot/collaboration as SoT. */
export const LEGACY_COLLABORATION_ROOT_REJECTED = "legacy_collaboration_root_rejected";
export const TRUSTED_GROUP_LOCATOR_REQUIRED = "trusted_group_locator_required";

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
  groupStorage: OpenBotGroupStorage;
  learningStorage: OpenBotLearningStorage;
  memoryStorage: OpenBotMemoryStorage;
  metadataStorage: OpenBotMetadataStorage;
  /** Always false for team SoT — personal_local locator is explicit profile, not silent legacy. */
  usedLegacyWorkspaceFallback: false;
};

export type ResolveTeamStoresOk = TrustedGroupStores & { groupDir: string; ok: true };
export type ResolveTeamStoresDenied = {
  ok: false;
  reason: string;
  detail?: string;
};
export type ResolveTeamStoresResult = ResolveTeamStoresOk | ResolveTeamStoresDenied;

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
 * True when absolutePath sits under the host STATE_DIR collaboration tree
 * (typically ~/.openbot/collaboration) — the stripped dual-root / personal_local legacy SoT.
 */
export function isHostLegacyCollaborationPath(
  absolutePath: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const resolved = path.resolve(absolutePath);
  const legacyRoot = path.resolve(path.join(resolveStateDir(env), "collaboration"));
  const rel = path.relative(legacyRoot, resolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Build object/file/OS stores rooted at the trusted groupsRoot from auth.
 * Callers must NOT fall back to createWorkspaceCollaborationStores(cfg) after auth.
 */
export function createTrustedGroupStores(params: {
  groupsRoot: string;
  groupLocator: string;
}): TrustedGroupStores {
  const groupsRoot = path.resolve(params.groupsRoot);
  const fileStore = createGroupFileStore(groupsRoot);
  const stateDir = resolveStateDir();
  const groupStoreFunctions = createWorkspaceGroupStoreFunctions(fileStore, stateDir, groupsRoot);
  return {
    groupsRoot,
    groupLocator: path.resolve(params.groupLocator),
    fileStore,
    objectStorage: new OpenBotObjectStorage(undefined, fileStore),
    groupStorage: new OpenBotGroupStorage(undefined, groupStoreFunctions),
    learningStorage: new OpenBotLearningStorage(undefined, fileStore),
    memoryStorage: new OpenBotMemoryStorage(undefined, fileStore),
    metadataStorage: new OpenBotMetadataStorage(undefined, fileStore),
    usedLegacyWorkspaceFallback: false,
  };
}

/**
 * Resolve team stores from auth / explicit trusted locator / profile-aware trusted locator.
 * NEVER calls createWorkspaceCollaborationStores (silent ~/.openbot/collaboration fallthrough).
 * Managed without tenant/auth → rejected. Managed path under host legacy root → rejected.
 */
export function resolveTeamDeliverableStores(params: {
  auth?: TeamResourceAuthOk | null;
  /** Explicit trusted locator when ACL is skipped in unit tests — still not legacy fallthrough. */
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  groupId: string;
  cfg?: OpenBotConfig;
  /** Optional tenant for personal_local→managed-aware locator when auth omitted. */
  tenantId?: string | null;
}): ResolveTeamStoresResult {
  const cfg = params.cfg ?? loadConfig();
  const profile = resolveSecurityProfile(cfg).profile;
  const groupId = compact(params.groupId);

  let groupsRoot: string;
  let groupLocator: string;

  if (params.auth) {
    groupsRoot = params.auth.groupsRoot;
    groupLocator = params.auth.groupLocator;
  } else if (params.trusted?.groupsRoot && params.trusted.groupLocator) {
    groupsRoot = params.trusted.groupsRoot;
    groupLocator = params.trusted.groupLocator;
  } else {
    if (!groupId) {
      return { ok: false, reason: TRUSTED_GROUP_LOCATOR_REQUIRED, detail: "groupId required" };
    }
    if (profile === "managed_enterprise" && !compact(params.tenantId ?? undefined)) {
      return {
        ok: false,
        reason: TRUSTED_GROUP_LOCATOR_REQUIRED,
        detail:
          "managed_enterprise team stores require authorizeTeamGroupResourceAccess or explicit tenant-scoped locator; host ~/.openbot/collaboration fallback removed",
      };
    }
    try {
      groupLocator = resolveTrustedGroupLocator({
        groupId,
        tenantId: params.tenantId ?? null,
        profile,
        cfg,
      });
      groupsRoot = path.dirname(groupLocator);
    } catch (error) {
      return {
        ok: false,
        reason: TRUSTED_GROUP_LOCATOR_REQUIRED,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (profile === "managed_enterprise" && isHostLegacyCollaborationPath(groupsRoot)) {
    return {
      ok: false,
      reason: LEGACY_COLLABORATION_ROOT_REJECTED,
      detail:
        "managed team SoT must be $OPENBOT_TENANTS_ROOT/<tenantId>/collaboration; host ~/.openbot/collaboration is not team authority",
    };
  }

  const stores = createTrustedGroupStores({ groupsRoot, groupLocator });
  return { ...stores, groupDir: stores.groupLocator, ok: true };
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
 * Composition-root helper: authorize actor then return auth + trusted stores.
 * Handlers call this once and pass `auth` into existing service APIs — do not
 * invent a parallel optional-param surface or re-resolve host dual-root.
 */
export async function resolveHandlerTrustedTeamContext(params: {
  groupId: string;
  actor: string;
  client?: GatewayClient | null;
  tenant?: CollaborationTenantResolution | null;
  action: "read" | "write";
  cfg?: OpenBotConfig;
  identityAliases?: readonly string[];
}): Promise<
  | {
      ok: true;
      auth: TeamResourceAuthOk;
      stores: TrustedGroupStores;
      trusted: { groupsRoot: string; groupLocator: string };
    }
  | { ok: false; reason: string; detail?: string }
> {
  const auth = await authorizeTeamGroupResourceAccess(params);
  if (!auth.ok) {
    return { ok: false, reason: auth.reason, detail: auth.detail };
  }
  const stores = createTrustedGroupStores({
    groupsRoot: auth.groupsRoot,
    groupLocator: auth.groupLocator,
  });
  return {
    ok: true,
    auth,
    stores,
    trusted: { groupsRoot: auth.groupsRoot, groupLocator: auth.groupLocator },
  };
}

/**
 * Prefer authority.namespace.groupLocator (already tenant-scoped). Never fall
 * through to createWorkspaceCollaborationStores for managed team SoT.
 */
export function resolveStoresFromGroupLocator(params: {
  groupLocator?: string | null;
  cfg?: OpenBotConfig;
  /** When true (default for managed callers), missing locator is a hard error. */
  requireTrusted?: boolean;
}): ResolveTeamStoresResult {
  const locator = compact(params.groupLocator ?? undefined);
  if (!locator) {
    return {
      ok: false,
      reason: TRUSTED_GROUP_LOCATOR_REQUIRED,
      detail: "groupLocator required to resolve team stores",
    };
  }
  return resolveTeamDeliverableStores({
    trusted: { groupsRoot: path.dirname(locator), groupLocator: locator },
    groupId: path.basename(locator),
    cfg: params.cfg,
  });
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

/** Verify task exists under the SAME trusted stores as auth (no cross-tenant / legacy fallback). */
export async function assertTaskBelongsToGroup(params: {
  groupId: string;
  taskId: string;
  cfg?: OpenBotConfig;
  /** Required — callers must pass stores from resolveTeamDeliverableStores / auth. */
  stores?: Pick<TrustedGroupStores, "objectStorage"> | null;
}): Promise<{ ok: true; task: Task } | { ok: false; reason: string; detail?: string }> {
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  if (!groupId || !taskId) {
    return { ok: false, reason: "missing_group_or_task" };
  }
  if (!params.stores?.objectStorage) {
    return {
      ok: false,
      reason: TRUSTED_GROUP_LOCATOR_REQUIRED,
      detail: "assertTaskBelongsToGroup refuses createWorkspaceCollaborationStores fallback",
    };
  }
  const task = await params.stores.objectStorage.readObject<Task>(groupId, "task", taskId);
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
