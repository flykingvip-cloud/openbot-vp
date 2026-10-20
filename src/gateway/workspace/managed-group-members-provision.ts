/**
 * C5 repair: materialize tenant members.json from the list/visibility catalog.
 *
 * Managed spaces.list may keep catalog-visible spaces when members.json is
 * missing, `{members:[]}`-wrapped, empty, or email-only. chat.send used to
 * treat that as `unknown collaboration space`. This helper writes a JSON array
 * of UUID userIds (same persist path as updateGatewayCollaborationSpaceMembers)
 * so list and send stay aligned for every listed space — not a single group.
 *
 * Never fail-open without writing C5. Never persist a stranger who is not
 * owner/member on the catalog (isCollaborationSpaceVisibleToEmployeeUser).
 */
import type { CollaborationMember } from "@openbot/collaboration-core";
import type { OpenBotConfig } from "../../config/types.js";
import {
  canEmployeeActorWriteCollaborationSpace,
  isCollaborationSpaceVisibleToEmployeeUser,
  type EmployeeWorkbenchActor,
} from "../employee-workbench-scope.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../platform-auth.js";
import { loadAuthoritativeGroupMembers, persistAuthoritativeGroupMembers } from "./group-acl.js";

export type CatalogCollaborationSpaceLike = {
  id?: string | null;
  groupId?: string | null;
  ownerUserId?: string | null;
  members?: {
    humans?: Array<{
      userId?: string | null;
      email?: string | null;
      handle?: string | null;
      name?: string | null;
      status?: string | null;
    }> | null;
    bots?: Array<{
      agentId?: string | null;
      name?: string | null;
      ownerUserId?: string | null;
      status?: string | null;
    }> | null;
  } | null;
};

export type ManagedGroupMembersProvisionResult = {
  groupId: string;
  members: CollaborationMember[];
  materialized: boolean;
};

const WRITABLE_HUMAN_STATUSES = new Set(["", "active", "paused"]);

export function catalogIdentityLooksLikeEmail(value: string | null | undefined): boolean {
  return typeof value === "string" && value.includes("@");
}

/** Empty, wrapper-as-empty, or email-only human ids are not a durable C5 roster. */
export function managedGroupMembersNeedC5Materialize(members: CollaborationMember[]): boolean {
  if (members.length === 0) {
    return true;
  }
  return members.some(
    (member) => member.memberKind === "human" && catalogIdentityLooksLikeEmail(member.userId),
  );
}

export function resolveCatalogIdentityToUserId(
  identity: string | null | undefined,
  actor?: EmployeeWorkbenchActor | null,
  emailToUserId?: ReadonlyMap<string, string>,
): string | null {
  const raw = identity?.trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase();
  const actorUserId = actor?.userId?.trim();
  const actorEmail = actor?.userEmail?.trim().toLowerCase();
  if (
    actorUserId &&
    (normalized === actorUserId.toLowerCase() || (actorEmail && normalized === actorEmail))
  ) {
    return actorUserId;
  }
  if (raw.includes("@")) {
    const mapped = emailToUserId?.get(normalized)?.trim();
    return mapped || null;
  }
  return raw;
}

export async function loadPlatformEmailToUserIdMap(
  cfg: OpenBotConfig,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
    if (!authConfig?.enabled) {
      return map;
    }
    const store = await loadPlatformAuthStore(authConfig);
    for (const user of Object.values(store.users)) {
      const email = (user.normalizedEmail || user.email || "").trim().toLowerCase();
      const userId = user.id?.trim();
      if (email && userId && email.includes("@")) {
        map.set(email, userId);
      }
    }
  } catch {
    return map;
  }
  return map;
}

function catalogHumanIsWritable(status?: string | null): boolean {
  const normalized = status?.trim().toLowerCase() ?? "";
  return WRITABLE_HUMAN_STATUSES.has(normalized);
}

function spaceGroupId(space: CatalogCollaborationSpaceLike): string {
  const groupId = typeof space.groupId === "string" ? space.groupId.trim() : "";
  if (groupId) {
    return groupId;
  }
  const id = typeof space.id === "string" ? space.id.trim() : "";
  return id.replace(/^space:/, "");
}

function collaborationSpaceLikeFromMembers(
  groupId: string,
  members: CollaborationMember[],
): Parameters<typeof canEmployeeActorWriteCollaborationSpace>[0] {
  const owner =
    members.find((member) => member.memberKind === "human" && member.governanceRole === "owner")
      ?.userId ??
    members.find((member) => member.memberKind === "human")?.userId ??
    null;
  return {
    id: `space:${groupId}`,
    groupId,
    ownerUserId: owner,
    members: {
      humans: members
        .filter((member) => member.memberKind === "human" && typeof member.userId === "string")
        .map((human) => ({
          userId: human.userId as string,
          name: human.name ?? (human.userId as string),
          status: human.status,
          ...(catalogIdentityLooksLikeEmail(human.userId) ? { email: human.userId } : {}),
        })),
    },
  };
}

export function actorMayProvisionManagedGroupMembers(params: {
  actor: EmployeeWorkbenchActor;
  space?: CatalogCollaborationSpaceLike | null;
  existingMembers?: CollaborationMember[];
  groupId: string;
}): boolean {
  if (params.space && isCollaborationSpaceVisibleToEmployeeUser(params.space, params.actor)) {
    return true;
  }
  const existing = params.existingMembers ?? [];
  if (existing.length === 0) {
    return false;
  }
  return canEmployeeActorWriteCollaborationSpace(
    collaborationSpaceLikeFromMembers(params.groupId, existing),
    params.actor,
  );
}

export function buildAuthoritativeMembersFromCatalogSpace(params: {
  space?: CatalogCollaborationSpaceLike | null;
  existingMembers?: CollaborationMember[];
  actor?: EmployeeWorkbenchActor | null;
  emailToUserId?: ReadonlyMap<string, string>;
  now?: number;
}): CollaborationMember[] {
  const now = params.now ?? Date.now();
  const seen = new Set<string>();
  const members: CollaborationMember[] = [];

  const addHuman = (
    identity: string | null | undefined,
    extraIdentities: Array<string | null | undefined>,
    name: string | null | undefined,
    status: CollaborationMember["status"],
    governanceRole: CollaborationMember["governanceRole"],
  ) => {
    const resolved =
      resolveCatalogIdentityToUserId(identity, params.actor, params.emailToUserId) ??
      extraIdentities
        .map((entry) => resolveCatalogIdentityToUserId(entry, params.actor, params.emailToUserId))
        .find((entry): entry is string => Boolean(entry));
    if (!resolved) {
      return;
    }
    const key = resolved.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    members.push({
      memberId: `human:${resolved}`,
      memberKind: "human",
      userId: resolved,
      name: name?.trim() || resolved,
      governanceRole,
      status,
      updatedAtMs: now,
    });
  };

  const space = params.space;
  const ownerIdentity = space?.ownerUserId;
  const ownerResolved = resolveCatalogIdentityToUserId(
    ownerIdentity,
    params.actor,
    params.emailToUserId,
  );
  if (ownerIdentity) {
    addHuman(ownerIdentity, [], undefined, "active", "owner");
  }

  for (const human of space?.members?.humans ?? []) {
    if (!catalogHumanIsWritable(human.status)) {
      continue;
    }
    const status = human.status?.trim().toLowerCase() === "paused" ? "paused" : "active";
    const humanUserId = resolveCatalogIdentityToUserId(
      human.userId,
      params.actor,
      params.emailToUserId,
    );
    const isOwner =
      Boolean(ownerResolved) && humanUserId?.toLowerCase() === ownerResolved?.toLowerCase();
    addHuman(
      human.userId,
      [human.email, human.handle],
      human.name,
      status,
      isOwner ? "owner" : "member",
    );
  }

  for (const bot of space?.members?.bots ?? []) {
    const agentId = bot.agentId?.trim();
    if (!agentId) {
      continue;
    }
    if (!catalogHumanIsWritable(bot.status)) {
      continue;
    }
    const key = `bot:${agentId.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const ownerUserId = resolveCatalogIdentityToUserId(
      bot.ownerUserId,
      params.actor,
      params.emailToUserId,
    );
    members.push({
      memberId: `bot:${agentId}`,
      memberKind: "bot",
      agentId,
      ...(ownerUserId ? { ownerUserId } : {}),
      name: bot.name?.trim() || agentId,
      governanceRole: "member",
      status: bot.status?.trim().toLowerCase() === "paused" ? "paused" : "active",
      updatedAtMs: now,
    });
  }

  if (members.length === 0) {
    for (const existing of params.existingMembers ?? []) {
      if (existing.memberKind !== "human" || !catalogHumanIsWritable(existing.status)) {
        continue;
      }
      addHuman(
        existing.userId,
        [],
        existing.name,
        existing.status === "paused" ? "paused" : "active",
        existing.governanceRole === "owner" ? "owner" : "member",
      );
    }
  }

  const actorUserId = params.actor?.userId?.trim();
  if (actorUserId && !seen.has(actorUserId.toLowerCase())) {
    const actorIsOwner =
      ownerResolved != null && ownerResolved.toLowerCase() === actorUserId.toLowerCase();
    members.push({
      memberId: `human:${actorUserId}`,
      memberKind: "human",
      userId: actorUserId,
      name: params.actor?.userEmail || actorUserId,
      governanceRole: actorIsOwner ? "owner" : "member",
      status: "active",
      updatedAtMs: now,
    });
    seen.add(actorUserId.toLowerCase());
  }

  return members.map((member) => {
    if (member.memberKind !== "human") {
      return member;
    }
    if (ownerResolved && member.userId?.toLowerCase() === ownerResolved.toLowerCase()) {
      return { ...member, governanceRole: "owner" };
    }
    if (member.governanceRole === "owner" && ownerResolved) {
      return { ...member, governanceRole: "member" };
    }
    return member;
  });
}

async function persistAndReload(params: {
  groupId: string;
  tenantId: string;
  cfg: OpenBotConfig;
  members: CollaborationMember[];
}): Promise<CollaborationMember[]> {
  await persistAuthoritativeGroupMembers({
    groupId: params.groupId,
    tenantId: params.tenantId,
    profile: "managed_enterprise",
    cfg: params.cfg,
    members: params.members,
  });
  return loadAuthoritativeGroupMembers({
    groupId: params.groupId,
    tenantId: params.tenantId,
    profile: "managed_enterprise",
    cfg: params.cfg,
  });
}

/**
 * Materialize C5 for one catalog-visible space. Returns null when the actor is
 * a stranger (do not silent-create). Callers must treat null as unknown space.
 */
export async function provisionManagedGroupMembersFromCatalog(params: {
  groupId: string;
  tenantId: string;
  cfg: OpenBotConfig;
  actor: EmployeeWorkbenchActor;
  space?: CatalogCollaborationSpaceLike | null;
  existingMembers?: CollaborationMember[];
  emailToUserId?: ReadonlyMap<string, string>;
}): Promise<ManagedGroupMembersProvisionResult | null> {
  const groupId = params.groupId.trim();
  if (!groupId) {
    return null;
  }
  if (
    !actorMayProvisionManagedGroupMembers({
      actor: params.actor,
      space: params.space,
      existingMembers: params.existingMembers,
      groupId,
    })
  ) {
    return null;
  }

  const emailToUserId = params.emailToUserId ?? (await loadPlatformEmailToUserIdMap(params.cfg));
  const members = buildAuthoritativeMembersFromCatalogSpace({
    space: params.space,
    existingMembers: params.existingMembers,
    actor: params.actor,
    emailToUserId,
  });
  if (members.length === 0) {
    return null;
  }

  const reloaded = await persistAndReload({
    groupId,
    tenantId: params.tenantId,
    cfg: params.cfg,
    members,
  });
  return { groupId, members: reloaded, materialized: true };
}

/**
 * One-shot / gateway path: provision C5 for every listed space that still has
 * missing, wrapped, empty, or email-only tenant members.json.
 */
export async function provisionManagedGroupMembersForListedSpaces(params: {
  tenantId: string;
  cfg: OpenBotConfig;
  spaces: readonly CatalogCollaborationSpaceLike[];
  actor?: EmployeeWorkbenchActor | null;
  emailToUserId?: ReadonlyMap<string, string>;
}): Promise<ManagedGroupMembersProvisionResult[]> {
  const emailToUserId = params.emailToUserId ?? (await loadPlatformEmailToUserIdMap(params.cfg));
  const results: ManagedGroupMembersProvisionResult[] = [];
  for (const space of params.spaces) {
    const groupId = spaceGroupId(space);
    if (!groupId) {
      continue;
    }
    if (params.actor && !isCollaborationSpaceVisibleToEmployeeUser(space, params.actor)) {
      continue;
    }

    let existing: CollaborationMember[] = [];
    try {
      existing = await loadAuthoritativeGroupMembers({
        groupId,
        tenantId: params.tenantId,
        profile: "managed_enterprise",
        cfg: params.cfg,
      });
    } catch {
      continue;
    }
    if (!managedGroupMembersNeedC5Materialize(existing)) {
      results.push({ groupId, members: existing, materialized: false });
      continue;
    }

    if (params.actor) {
      const provisioned = await provisionManagedGroupMembersFromCatalog({
        groupId,
        tenantId: params.tenantId,
        cfg: params.cfg,
        actor: params.actor,
        space,
        existingMembers: existing,
        emailToUserId,
      });
      if (provisioned) {
        results.push(provisioned);
      }
      continue;
    }

    const members = buildAuthoritativeMembersFromCatalogSpace({
      space,
      existingMembers: existing,
      actor: null,
      emailToUserId,
    });
    if (members.length === 0) {
      continue;
    }
    const reloaded = await persistAndReload({
      groupId,
      tenantId: params.tenantId,
      cfg: params.cfg,
      members,
    });
    results.push({ groupId, members: reloaded, materialized: true });
  }
  return results;
}

function findListedSpace(
  spaces: readonly CatalogCollaborationSpaceLike[],
  groupId: string,
): CatalogCollaborationSpaceLike | null {
  const normalizedGroupId = groupId.trim().toLowerCase();
  return (
    spaces.find(
      (entry) =>
        (entry.groupId ?? "").trim().toLowerCase() === normalizedGroupId ||
        (entry.id ?? "")
          .trim()
          .toLowerCase()
          .replace(/^space:/, "") === normalizedGroupId,
    ) ?? null
  );
}

/**
 * chat.send write-ACL hook: repair C5 for one list-visible space without
 * adding P1/P5 locators in chat.ts. Returns [] when the actor is a stranger
 * (caller treats that as unknown collaboration space).
 */
export async function repairManagedGroupMembersForWriteAcl(params: {
  groupId: string;
  tenantId: string;
  cfg: OpenBotConfig;
  actor: EmployeeWorkbenchActor;
  existingMembers: CollaborationMember[];
  listCollaborationSpaces?: () => Promise<{ spaces: readonly CatalogCollaborationSpaceLike[] }>;
}): Promise<CollaborationMember[]> {
  if (!managedGroupMembersNeedC5Materialize(params.existingMembers)) {
    return params.existingMembers;
  }
  const listSpaces =
    params.listCollaborationSpaces ??
    (await import("../collaboration-learning.js")).listGatewayCollaborationSpaces;
  const listed = await listSpaces();
  const provisioned = await provisionManagedGroupMembersFromCatalog({
    groupId: params.groupId,
    tenantId: params.tenantId,
    cfg: params.cfg,
    actor: params.actor,
    space: findListedSpace(listed.spaces ?? [], params.groupId),
    existingMembers: params.existingMembers,
  });
  return provisioned?.members ?? [];
}
