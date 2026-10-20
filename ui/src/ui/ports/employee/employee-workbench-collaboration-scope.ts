import { parseAgentSessionKey } from "../../../../../src/sessions/session-key-utils.ts";
import type { CollaborationSpacesListResult, SessionsListResult } from "../../types.ts";
import type { WorkbenchCollaborationSpaceSnapshot } from "./views/workbench-types.ts";

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeValue(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function extractSpaceIdentityFromSessionKey(sessionKey: string): string | null {
  const normalized = sessionKey.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("space:")) {
    return normalized.slice("space:".length).trim() || null;
  }
  const parsed = parseAgentSessionKey(normalized);
  if (!parsed) {
    return null;
  }
  const rest = parsed.rest.trim();
  if (rest.startsWith("space:")) {
    return rest.slice("space:".length).trim() || null;
  }
  return null;
}

export type EmployeeWorkbenchCollaborationScopeParams = {
  userId: string | null;
  userEmail: string | null;
  seatSpaceIds: readonly string[] | null | undefined;
  /** True once platformAuthState.employeeAccess has hydrated. */
  grantsHydrated?: boolean;
};

function buildActorIdentities(params: EmployeeWorkbenchCollaborationScopeParams): Set<string> {
  return new Set(
    [params.userId, params.userEmail].map((entry) => normalizeIdentity(entry)).filter(Boolean),
  );
}

function isArchivedCollaborationSpace(
  space: Pick<WorkbenchCollaborationSpaceSnapshot, "operatingState">,
): boolean {
  return normalizeIdentity(space.operatingState?.groupProfile?.lifecycleStatus) === "archived";
}

/**
 * Client-side mirror of gateway `isCollaborationSpaceVisibleToEmployeeUser`.
 * Filters bootstrap / briefly-unscoped collaboration.spaces.list payloads so
 * foreign tenants' groups never reach the 协调空间 nav.
 */
type EmployeeWorkbenchCollaborationMemberScopeInput = {
  humans?: Array<{
    userId: string;
    email?: string | null;
    handle?: string | null;
    status?: string | null;
  }>;
  bots?: unknown[];
} | null;

/** Mirror of gateway `humanRosterMemberMatchesActorIdentities`. */
function humanRosterMemberMatchesActorIdentities(
  human: {
    userId?: string | null;
    email?: string | null;
    handle?: string | null;
  },
  identities: ReadonlySet<string>,
): boolean {
  for (const raw of [human.userId, human.email, human.handle]) {
    const identity = normalizeIdentity(raw);
    if (identity && identities.has(identity)) {
      return true;
    }
  }
  return false;
}

function collectSpaceOwnerIdentities(
  space: EmployeeWorkbenchCollaborationSpaceScopeInput,
): Set<string> {
  const owners = new Set(
    [
      space.ownerUserId,
      space.operatingState?.governance?.ownerUserId,
      space.operatingState?.groupProfile?.ownerUserId,
    ]
      .map((entry) => normalizeIdentity(entry))
      .filter(Boolean),
  );
  if (owners.size === 0) {
    return owners;
  }
  for (const human of space.members?.humans ?? []) {
    const humanIds = [human.userId, human.email, human.handle]
      .map((entry) => normalizeIdentity(entry))
      .filter(Boolean);
    if (humanIds.some((id) => owners.has(id))) {
      for (const id of humanIds) {
        owners.add(id);
      }
    }
  }
  return owners;
}

function actorMatchesSpaceOwner(
  space: EmployeeWorkbenchCollaborationSpaceScopeInput,
  identities: ReadonlySet<string>,
): boolean {
  for (const ownerId of collectSpaceOwnerIdentities(space)) {
    if (identities.has(ownerId)) {
      return true;
    }
  }
  return false;
}

type EmployeeWorkbenchCollaborationSpaceScopeInput = Pick<
  WorkbenchCollaborationSpaceSnapshot,
  "id" | "groupId" | "ownerUserId" | "operatingState"
> & {
  members?: EmployeeWorkbenchCollaborationMemberScopeInput;
  invites?: EmployeeWorkbenchCollaborationMemberScopeInput;
};

export function isEmployeeWorkbenchCollaborationSpaceVisible(
  space: EmployeeWorkbenchCollaborationSpaceScopeInput,
  params: EmployeeWorkbenchCollaborationScopeParams,
): boolean {
  if (isArchivedCollaborationSpace(space)) {
    return false;
  }
  const identities = buildActorIdentities(params);
  const hasSeatSnapshot = params.seatSpaceIds != null;
  if (!hasSeatSnapshot && identities.size === 0) {
    // Bootstrap: trust gateway-scoped payloads until employeeAccess hydrates.
    return true;
  }
  if (identities.size === 0) {
    return false;
  }
  if (actorMatchesSpaceOwner(space, identities)) {
    return true;
  }
  const spaceIdentity =
    normalizeIdentity(space.groupId) || normalizeIdentity(space.id?.replace(/^space:/, ""));
  const seatSpaceIds = params.seatSpaceIds ?? [];
  if (
    spaceIdentity &&
    seatSpaceIds.some((seatSpaceId) => normalizeIdentity(seatSpaceId) === spaceIdentity)
  ) {
    return true;
  }
  for (const human of space.members?.humans ?? []) {
    const status = normalizeIdentity(human.status);
    if (status && status !== "active" && status !== "paused") {
      continue;
    }
    if (humanRosterMemberMatchesActorIdentities(human, identities)) {
      return true;
    }
  }
  return false;
}

function isPendingInviteStatus(status: string | null | undefined): boolean {
  const normalized = normalizeIdentity(status);
  return normalized === "invited" || normalized === "pending";
}

function actorHasPendingHumanInviteInSpace(
  space: EmployeeWorkbenchCollaborationSpaceScopeInput,
  identities: ReadonlySet<string>,
): boolean {
  for (const human of [...(space.members?.humans ?? []), ...(space.invites?.humans ?? [])]) {
    if (!isPendingInviteStatus(human.status)) {
      continue;
    }
    if (humanRosterMemberMatchesActorIdentities(human, identities)) {
      return true;
    }
  }
  return false;
}

/**
 * Broader than {@link isEmployeeWorkbenchCollaborationSpaceVisible}: include
 * pending human invites so invitee deep-links can open member governance.
 * Nav still hides invite-only spaces via the collaboration read-model.
 */
export function isEmployeeWorkbenchCollaborationSpaceListed(
  space: EmployeeWorkbenchCollaborationSpaceScopeInput,
  params: EmployeeWorkbenchCollaborationScopeParams,
): boolean {
  if (isEmployeeWorkbenchCollaborationSpaceVisible(space, params)) {
    return true;
  }
  const identities = buildActorIdentities(params);
  return identities.size > 0 && actorHasPendingHumanInviteInSpace(space, identities);
}

export function filterCollaborationSpacesSnapshotForEmployeeWorkbench(
  snapshot: { spaces: WorkbenchCollaborationSpaceSnapshot[]; archivedGroupIds?: string[] },
  params: EmployeeWorkbenchCollaborationScopeParams,
): { spaces: WorkbenchCollaborationSpaceSnapshot[]; archivedGroupIds: string[] } {
  if (params.grantsHydrated || params.seatSpaceIds != null) {
    return {
      spaces: snapshot.spaces,
      archivedGroupIds: snapshot.archivedGroupIds ?? [],
    };
  }
  const spaces = snapshot.spaces.filter((space) =>
    isEmployeeWorkbenchCollaborationSpaceListed(space, params),
  );
  if (spaces.length === snapshot.spaces.length) {
    return {
      spaces: snapshot.spaces,
      archivedGroupIds: snapshot.archivedGroupIds ?? [],
    };
  }
  return {
    spaces,
    archivedGroupIds: snapshot.archivedGroupIds ?? [],
  };
}

export function filterCollaborationSpacesListForEmployeeWorkbench(
  list: CollaborationSpacesListResult | null | undefined,
  params: EmployeeWorkbenchCollaborationScopeParams,
): CollaborationSpacesListResult | null {
  if (!list) {
    return null;
  }
  const spaces = (list.spaces ?? []).filter((space) => {
    const id = normalizeValue(space.id) ?? normalizeValue(space.groupId);
    if (!id) {
      return false;
    }
    return isEmployeeWorkbenchCollaborationSpaceListed(
      {
        id,
        groupId: normalizeValue(space.groupId),
        ownerUserId: normalizeValue(space.ownerUserId),
        operatingState: space.operatingState ?? null,
        members: space.members ?? null,
        invites: space.invites ?? null,
      },
      params,
    );
  });
  if (spaces.length === (list.spaces ?? []).length) {
    return list;
  }
  return { ...list, spaces };
}

/**
 * Defensive session filter for employee workbench nav surfaces. When the gateway
 * briefly returns an install-wide sessions.list, keep only rows tied to the
 * actor's visible agents or collaboration spaces.
 */
export function filterSessionsListForEmployeeWorkbench(
  list: SessionsListResult | null | undefined,
  params: EmployeeWorkbenchCollaborationScopeParams & {
    visibleAgentIds: readonly string[];
    visibleSpaceIds?: readonly string[];
  },
): SessionsListResult | null {
  if (!list) {
    return null;
  }
  const identities = buildActorIdentities(params);
  if (identities.size === 0 && params.visibleAgentIds.length === 0) {
    return list;
  }
  const visibleAgents = new Set(
    params.visibleAgentIds.map((entry) => normalizeIdentity(entry)).filter(Boolean),
  );
  const visibleSpaces = new Set(
    [...(params.seatSpaceIds ?? []), ...(params.visibleSpaceIds ?? [])]
      .map((entry) => normalizeIdentity(entry))
      .filter(Boolean),
  );
  const sessions = (list.sessions ?? []).filter((session) => {
    const key = normalizeValue(session.key);
    if (!key || normalizeIdentity(key) === "main") {
      return false;
    }
    if (key.startsWith("space:")) {
      const spaceId = normalizeIdentity(key.slice("space:".length));
      return visibleSpaces.has(spaceId);
    }
    const parsed = parseAgentSessionKey(key);
    if (!parsed) {
      return false;
    }
    if (!visibleAgents.has(normalizeIdentity(parsed.agentId))) {
      return false;
    }
    const spaceIdentity =
      extractSpaceIdentityFromSessionKey(key) ?? normalizeIdentity(session.groupId);
    const isGroupSession =
      session.kind === "group" ||
      session.chatType === "group" ||
      session.chatType === "channel" ||
      Boolean(spaceIdentity);
    if (isGroupSession) {
      return Boolean(spaceIdentity && visibleSpaces.has(spaceIdentity));
    }
    return true;
  });
  if (sessions.length === (list.sessions ?? []).length) {
    return list;
  }
  return { ...list, sessions, count: sessions.length };
}
