/**
 * C5: tenant-scoped group ACL membership reads.
 *
 * Membership is loaded from the same trusted group locator used for file bytes:
 * - managed: tenants/<tid>/collaboration/groups/<gid>/members.json
 * - personal: legacy collaboration groups/<gid>/members.json
 *
 * Dual-tenant same groupId cannot share membership files in managed mode.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { CollaborationMember } from "@openbot/collaboration-core";
import type { OpenBotConfig } from "../../config/types.js";
import type { EmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import { resolveTrustedGroupLocator } from "./group-locator.js";
import type { CatalogCollaborationSpaceLike } from "./managed-group-members-provision.js";

function normalizeMemberIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function isActiveMember(
  member: CollaborationMember,
  userId: string,
  identityAliases: readonly string[] = [],
): boolean {
  if (member.status !== "active" && member.status !== "invited") {
    return false;
  }
  const candidate = member.userId?.trim();
  if (!candidate) {
    return false;
  }
  const accepted = new Set(
    [userId, ...identityAliases]
      .map((entry) => (typeof entry === "string" ? normalizeMemberIdentity(entry) : ""))
      .filter(Boolean),
  );
  return accepted.has(normalizeMemberIdentity(candidate));
}

async function readMembersJson(filePath: string): Promise<CollaborationMember[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as CollaborationMember[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/** Persist membership as a JSON array at the tenant (or personal) locator. */
export async function persistAuthoritativeGroupMembers(params: {
  groupId: string;
  tenantId: string;
  profile: "personal_local" | "managed_enterprise";
  cfg: OpenBotConfig;
  members: CollaborationMember[];
}): Promise<string> {
  const locator = resolveTrustedGroupLocator({
    groupId: params.groupId,
    tenantId: params.tenantId,
    profile: params.profile,
    cfg: params.cfg,
  });
  await fs.mkdir(locator, { recursive: true });
  const dest = path.join(locator, "members.json");
  await fs.writeFile(dest, `${JSON.stringify(params.members, null, 2)}\n`, "utf8");
  return dest;
}

/** Load membership from the tenant-scoped (or personal) authoritative members.json. */
export async function loadAuthoritativeGroupMembers(params: {
  groupId: string;
  tenantId: string | null;
  profile: "personal_local" | "managed_enterprise";
  cfg: OpenBotConfig;
  actor?: EmployeeWorkbenchActor | null;
  listCollaborationSpaces?: () => Promise<{ spaces?: readonly CatalogCollaborationSpaceLike[] }>;
}): Promise<CollaborationMember[]> {
  const locator = resolveTrustedGroupLocator({
    groupId: params.groupId,
    tenantId: params.tenantId,
    profile: params.profile,
    cfg: params.cfg,
  });
  const primary = await readMembersJson(path.join(locator, "members.json"));
  const members = primary;
  const actor = params.actor;
  const tenantId = params.tenantId?.trim();
  if (!actor || params.profile !== "managed_enterprise" || !tenantId) {
    return members;
  }
  const { repairManagedGroupMembersForWriteAcl } =
    await import("./managed-group-members-provision.js");
  const listCollaborationSpaces = params.listCollaborationSpaces;
  return repairManagedGroupMembersForWriteAcl({
    groupId: params.groupId,
    tenantId,
    cfg: params.cfg,
    actor,
    existingMembers: members,
    listCollaborationSpaces: listCollaborationSpaces
      ? async () => {
          const listed = await listCollaborationSpaces();
          return { spaces: listed.spaces ?? [] };
        }
      : undefined,
  });
}

/**
 * Assert the user is an active/invited member of the group.
 * Returns an error message when denied, or null when allowed.
 */
export async function assertGroupMemberAccess(params: {
  groupId: string;
  userId: string;
  tenantId: string | null;
  profile: "personal_local" | "managed_enterprise";
  cfg: OpenBotConfig;
  /** Extra accepted identities (for example the login email next to a platform user id). */
  identityAliases?: readonly string[];
}): Promise<string | null> {
  const groupId = params.groupId.trim();
  const userId = params.userId.trim();
  if (!groupId || !userId) {
    return "not authorized to read group workspace file";
  }
  if (params.profile === "managed_enterprise" && !params.tenantId?.trim()) {
    return "trusted tenant context required";
  }

  const members = await loadAuthoritativeGroupMembers({
    groupId,
    tenantId: params.tenantId,
    profile: params.profile,
    cfg: params.cfg,
  });
  if (!members.some((member) => isActiveMember(member, userId, params.identityAliases))) {
    return "not authorized to read group workspace file";
  }
  return null;
}

/** Dual-tenant negative helper: membership file path for a managed tenant. */
export function resolveManagedGroupMembersPath(params: {
  groupId: string;
  tenantId: string;
  cfg?: OpenBotConfig;
}): string {
  const locator = resolveTrustedGroupLocator({
    groupId: params.groupId,
    tenantId: params.tenantId,
    profile: "managed_enterprise",
    cfg: params.cfg ?? {},
  });
  return path.join(locator, "members.json");
}
