import {
  extractEmployeeStewardUserIdFromSessionKey,
  isEmployeeBuiltinStewardSessionOwnedByUser,
  isGlobalBuiltinStewardSessionKey,
} from "../agents/builtin-steward/employee-isolation.js";
import {
  BUILTIN_STEWARD_AGENT_ID,
  isBuiltinStewardAgent,
  withEmployeeUniversalStewardAgentIds,
} from "../agents/builtin-steward/identity.js";
import { loadConfig } from "../config/config.js";
import {
  deriveSessionChatType,
  isOrganizationAgentSessionKey,
  parseAgentSessionKey,
} from "../sessions/session-key-utils.js";
import { assembleEmployeePositionAgentIds } from "./employee-position-bots.js";
import { listEmployeeSessionVisibilitySpaces } from "./employee-session-visibility-policy.js";
import { buildEmployeeAccessSnapshot } from "./enterprise-seat-assets-store.js";
import { listOwnershipRecords } from "./ownership-store.js";
import { resolveAuthoritativeEnterpriseScopeForClient } from "./platform-auth/active-membership-scope.js";
import { resolvePlatformAuthConfig } from "./platform-auth/config.js";
import { loadSeatAssetsStoreForTenantId } from "./platform-auth/seat-store-loader.js";
import { loadStore } from "./platform-auth/store.js";
import { resolveRequestSessionSurface } from "./platform-auth/target-surface.js";
import type { GatewayClient } from "./server-methods/types.js";
import { listAgentsForGateway, type GatewayAgentRow } from "./session-utils.js";

export type EmployeeWorkbenchActor = {
  userId: string;
  userEmail: string;
  tenantId?: string;
  /** Active enterprise seat binding for this employee, when present. */
  currentSeatId?: string;
  /**
   * Position bot set for this employee's active seat (`seatId` = stable
   * position id), plus the universal steward. Despite the legacy name, this
   * is the only agent roster for assistant entry and settings robots.
   * User id / email ownership is not included.
   */
  seatAgentIds: string[];
  /**
   * Group/space ids from ownership ∪ seat grants (asset binding).
   * Collaboration chat participation also includes roster membership — see
   * {@link collectVisibleCollaborationSpaceIdsForActor} /
   * docs/design/collaboration-space-authority-convergence-2026-08-08.md.
   */
  seatSpaceIds: string[];
};

/** Personal workbench surfaces (employee + enterprise-admin self-view). */
const PERSONAL_WORKBENCH_SESSION_DOMAINS = new Set<NonNullable<GatewayClient["sessionDomain"]>>([
  "employee",
  "enterprise",
]);

/**
 * True when the connection is a personal-workbench session (employee or
 * enterprise self-view). Such sessions MUST be scoped to an actor; if actor
 * resolution fails the caller must deny / return empty rather than fall through
 * to an unscoped platform-wide view (which would leak other tenants' data).
 */
export function isPersonalWorkbenchClient(client: GatewayClient | null | undefined): boolean {
  return Boolean(
    client?.sessionDomain && PERSONAL_WORKBENCH_SESSION_DOMAINS.has(client.sessionDomain),
  );
}

type CollaborationSpaceBotLike = {
  agentId?: string | null;
  ownerUserId?: string | null;
  status?: string | null;
};

type CollaborationSpaceLike = {
  id?: string | null;
  groupId?: string | null;
  ownerUserId?: string | null;
  lifecycleStatus?: string | null;
  operatingState?: {
    governance?: {
      ownerUserId?: string | null;
    } | null;
    groupProfile?: {
      ownerUserId?: string | null;
      lifecycleStatus?: string | null;
    } | null;
    memberRoleMap?: Array<{
      memberId?: string | null;
      memberKind?: string | null;
      governanceRole?: string | null;
      label?: string | null;
      status?: string | null;
    }> | null;
  } | null;
  members?: {
    humans?: Array<{
      userId?: string | null;
      email?: string | null;
      handle?: string | null;
      status?: string | null;
      governanceRole?: string | null;
    }> | null;
    bots?: CollaborationSpaceBotLike[] | null;
  } | null;
  invites?: {
    humans?: Array<{
      userId?: string | null;
      email?: string | null;
      handle?: string | null;
      status?: string | null;
    }> | null;
    bots?: CollaborationSpaceBotLike[] | null;
  } | null;
};

type SessionRowLike = {
  key: string;
  kind?: string | null;
  groupId?: string | null;
  chatType?: string | null;
};

/**
 * Minimal collaboration space roster shape needed to compute owner-audit
 * visibility. Kept structural to avoid importing the heavier snapshot types.
 */
type GroupBotRosterLike = {
  id?: string | null;
  groupId?: string | null;
  ownerUserId?: string | null;
  members?: {
    bots?: Array<{ agentId?: string | null; status?: string | null }> | null;
  } | null;
};

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function buildActorIdentities(actor: EmployeeWorkbenchActor): Set<string> {
  return new Set(
    [actor.userId, actor.userEmail].map((entry) => normalizeIdentity(entry)).filter(Boolean),
  );
}

/**
 * Match a human roster row against actor identities. Single identity predicate
 * for gateway + UI mirrors: userId ∪ email ∪ handle vs actor userId ∪ email.
 */
export function humanRosterMemberMatchesActorIdentities(
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

function collectSpaceOwnerIdentities(space: CollaborationSpaceLike): Set<string> {
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
  // Same person: owner UUID ↔ email/handle via the human roster.
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
  space: CollaborationSpaceLike,
  identities: ReadonlySet<string>,
): boolean {
  for (const ownerId of collectSpaceOwnerIdentities(space)) {
    if (identities.has(ownerId)) {
      return true;
    }
  }
  return false;
}

function resolveCollaborationSpaceIdentity(space: CollaborationSpaceLike): string {
  return normalizeIdentity(space.groupId) || normalizeIdentity(space.id?.replace(/^space:/, ""));
}

/**
 * Space ids the actor may treat as full group-session participants.
 * Derived from the same predicate as {@link isCollaborationSpaceVisibleToEmployeeUser}
 * (owner ∪ seat ∪ active/paused human roster), unioned with seatSpaceIds so a
 * seat-granted id missing from the list snapshot is not dropped.
 */
export function collectVisibleCollaborationSpaceIdsForActor(
  actor: EmployeeWorkbenchActor,
  spaces: CollaborationSpaceLike[],
): Set<string> {
  const ids = new Set<string>();
  for (const seatSpaceId of actor.seatSpaceIds) {
    const normalized = normalizeIdentity(seatSpaceId);
    if (normalized) {
      ids.add(normalized);
    }
  }
  for (const space of spaces) {
    if (!isCollaborationSpaceVisibleToEmployeeUser(space, actor)) {
      continue;
    }
    const spaceIdentity = resolveCollaborationSpaceIdentity(space);
    if (spaceIdentity) {
      ids.add(spaceIdentity);
    }
  }
  return ids;
}

export function isAgentOwnedByEmployeeUser(
  agent: Pick<GatewayAgentRow, "id" | "ownerId" | "scope"> & { tenantId?: string | null },
  actor: EmployeeWorkbenchActor,
): boolean {
  if (actor.seatAgentIds.includes(agent.id)) {
    return true;
  }
  const scope = normalizeIdentity(agent.scope);
  if (scope === "shared" || scope === "team") {
    return false;
  }
  // Enterprise sessions: the position set is the grant. Matching ownerId to
  // the signed-in user or email is not org ownership (creator stays audit-only).
  if (normalizeIdentity(actor.tenantId)) {
    return false;
  }
  const ownerId = normalizeIdentity(agent.ownerId);
  const identities = buildActorIdentities(actor);
  if (!ownerId || !identities.has(ownerId)) {
    return false;
  }
  // No enterprise tenant on the actor: local owner match only.
  return true;
}

export function isAgentVisibleToEmployeeUser(
  agent: Pick<GatewayAgentRow, "id" | "ownerId" | "scope">,
  actor: EmployeeWorkbenchActor,
): boolean {
  if (isBuiltinStewardAgent(agent.id)) {
    return true;
  }
  return isAgentOwnedByEmployeeUser(agent, actor);
}

function isPendingInviteStatus(status: string | null | undefined): boolean {
  const normalized = normalizeIdentity(status);
  return normalized === "invited" || normalized === "pending";
}

/**
 * True when the actor has a pending human invite into this space (not yet active).
 * Used for workbench list / invite-approval surfaces — not for chat write ACL.
 */
export function actorHasPendingHumanInviteInSpace(
  space: CollaborationSpaceLike,
  actor: EmployeeWorkbenchActor,
): boolean {
  const identities = buildActorIdentities(actor);
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
 * True when the actor owns a bot that is still awaiting confirmation in this space.
 * Used so bot owners can open the member-governance approval surface from 待办事项
 * even when they are not human members of the group.
 */
export function actorOwnsPendingBotInviteInSpace(
  space: CollaborationSpaceLike,
  actor: EmployeeWorkbenchActor,
): boolean {
  const identities = buildActorIdentities(actor);
  const ownedBotIds = new Set(
    actor.seatAgentIds
      .map((id) => normalizeIdentity(id))
      .filter((id) => id && !isBuiltinStewardAgent(id)),
  );
  if (ownedBotIds.size === 0 && identities.size === 0) {
    return false;
  }
  for (const bot of [...(space.members?.bots ?? []), ...(space.invites?.bots ?? [])]) {
    if (!isPendingInviteStatus(bot.status)) {
      continue;
    }
    const agentId = normalizeIdentity(bot.agentId);
    // Universal builtin steward is shared across employees — never treat its
    // pending invite as a personal owned-bot approval surface (would leak
    // foreign groups into every stamped ownerUserId's collaboration nav).
    if (!agentId || isBuiltinStewardAgent(agentId)) {
      continue;
    }
    if (ownedBotIds.has(agentId)) {
      return true;
    }
    const ownerUserId = normalizeIdentity(bot.ownerUserId);
    if (ownerUserId && identities.has(ownerUserId)) {
      return true;
    }
  }
  return false;
}

export function isCollaborationSpaceVisibleToEmployeeUser(
  space: CollaborationSpaceLike,
  actor: EmployeeWorkbenchActor,
): boolean {
  if (isArchivedCollaborationSpace(space)) {
    return false;
  }
  const identities = buildActorIdentities(actor);
  if (actorMatchesSpaceOwner(space, identities)) {
    return true;
  }
  const spaceIdentity =
    normalizeIdentity(space.groupId) || normalizeIdentity(space.id?.replace(/^space:/, ""));
  if (
    spaceIdentity &&
    actor.seatSpaceIds.some((seatSpaceId) => normalizeIdentity(seatSpaceId) === spaceIdentity)
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

/**
 * Workbench spaces.list / invite deep-link visibility. Broader than chat write ACL:
 * includes pending human invites and owned-bot invite approvals so todos / member
 * governance can load the space. Nav surfaces should still filter to
 * {@link isCollaborationSpaceVisibleToEmployeeUser} so invite-only groups are
 * not presented as chat-ready collaboration entries.
 */
export function isCollaborationSpaceListedForEmployeeUser(
  space: CollaborationSpaceLike,
  actor: EmployeeWorkbenchActor,
): boolean {
  return (
    isCollaborationSpaceVisibleToEmployeeUser(space, actor) ||
    actorHasPendingHumanInviteInSpace(space, actor) ||
    actorOwnsPendingBotInviteInSpace(space, actor)
  );
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
  if (deriveSessionChatType(normalized) === "group") {
    return rest || null;
  }
  return null;
}

/**
 * Builds the set of `"<agentId>::<spaceId>"` pairs the actor may audit: group
 * bot sessions whose bot is an asset the actor owns AND is an active/paused
 * member of that space. This is the "owner oversight" channel — it grants
 * read-only visibility into the actor's OWN bot's transcript inside a group the
 * actor is not a human member of. The universal builtin steward is excluded so
 * its globally-shared sessions never leak through this path.
 */
export function buildAuditableGroupBotSessionSet(
  actor: EmployeeWorkbenchActor,
  spaces: GroupBotRosterLike[],
): Set<string> {
  const ownedBotIds = new Set(
    actor.seatAgentIds
      .map((id) => normalizeIdentity(id))
      .filter((id) => id && !isBuiltinStewardAgent(id)),
  );
  const result = new Set<string>();
  if (ownedBotIds.size === 0) {
    return result;
  }
  for (const space of spaces) {
    const spaceId =
      normalizeIdentity(space.groupId) || normalizeIdentity(space.id?.replace(/^space:/, ""));
    if (!spaceId) {
      continue;
    }
    for (const bot of space.members?.bots ?? []) {
      const status = normalizeIdentity(bot.status);
      if (status && status !== "active" && status !== "paused") {
        continue;
      }
      const agentId = normalizeIdentity(bot.agentId);
      if (agentId && ownedBotIds.has(agentId)) {
        result.add(`${agentId}::${spaceId}`);
      }
    }
  }
  return result;
}

export const COLLABORATION_OBSERVER_WRITE_DENIAL =
  "you may observe this group but cannot post, execute, or approve";

/** Stable client-facing denial when collaboration space catalog/members cannot be resolved. */
export const COLLABORATION_SPACE_PERMISSIONS_DENIAL =
  "failed to resolve collaboration space permissions";

export class CollaborationSpacePermissionsError extends Error {
  constructor() {
    super(COLLABORATION_SPACE_PERMISSIONS_DENIAL);
    this.name = "CollaborationSpacePermissionsError";
  }
}

export function resolveActorGovernanceRoleInSpace(
  space: CollaborationSpaceLike,
  actor: EmployeeWorkbenchActor,
): string | null {
  const identities = buildActorIdentities(actor);
  for (const human of space.members?.humans ?? []) {
    const status = normalizeIdentity(human.status);
    if (status && status !== "active" && status !== "paused") {
      continue;
    }
    if (humanRosterMemberMatchesActorIdentities(human, identities) && human.governanceRole) {
      return normalizeIdentity(human.governanceRole);
    }
  }
  for (const entry of space.operatingState?.memberRoleMap ?? []) {
    if (normalizeIdentity(entry.memberKind) !== "human") {
      continue;
    }
    const status = normalizeIdentity(entry.status);
    if (status && status !== "active" && status !== "paused") {
      continue;
    }
    const candidates = [entry.memberId, entry.label];
    const matches = candidates.some((value) => {
      const identity = normalizeIdentity(value?.replace(/^human:/, ""));
      return Boolean(identity && identities.has(identity));
    });
    if (matches && entry.governanceRole) {
      return normalizeIdentity(entry.governanceRole);
    }
  }
  return null;
}

/**
 * Write-permission gate for employee/enterprise personal-workbench actors.
 * Writing into a collaboration group requires genuine membership (owner / seat /
 * human member) — owning a bot that participates in the group grants read-only
 * audit visibility ONLY, never the right to post as a non-member.
 * Observers remain visible (canRead) but cannot respond / execute / approve.
 */
export function canEmployeeActorWriteCollaborationSpace(
  space: CollaborationSpaceLike,
  actor: EmployeeWorkbenchActor,
): boolean {
  if (!isCollaborationSpaceVisibleToEmployeeUser(space, actor)) {
    return false;
  }
  const role = resolveActorGovernanceRoleInSpace(space, actor);
  if (role === "owner" || role === "admin") {
    return true;
  }
  return role !== "observer";
}

export function resolveCollaborationSpaceWriteDenialForActor(
  space: CollaborationSpaceLike,
  actor: EmployeeWorkbenchActor,
): string | null {
  if (canEmployeeActorWriteCollaborationSpace(space, actor)) {
    return null;
  }
  if (
    isCollaborationSpaceVisibleToEmployeeUser(space, actor) &&
    resolveActorGovernanceRoleInSpace(space, actor) === "observer"
  ) {
    return COLLABORATION_OBSERVER_WRITE_DENIAL;
  }
  return "you may audit your bot's activity in this group but cannot post as a non-member";
}

/**
 * Pure object ACL for mutate RPCs: unknown groupId = create (allow);
 * existing space requires {@link isCollaborationSpaceVisibleToEmployeeUser}.
 */
export function resolveCollaborationSpaceMutateDenialForActor(params: {
  actor: EmployeeWorkbenchActor;
  groupId: string;
  spaces: CollaborationSpaceLike[];
}): string | null {
  const normalizedGroupId = normalizeIdentity(params.groupId);
  if (!normalizedGroupId) {
    return "collaboration space mutate requires groupId";
  }
  const space = params.spaces.find((entry) => {
    const id =
      normalizeIdentity(entry.groupId) || normalizeIdentity(entry.id?.replace(/^space:/, ""));
    return id === normalizedGroupId;
  });
  if (!space) {
    return null;
  }
  // Full members/owners may mutate; invitees / bot owners with a pending invite
  // may accept/reject without chat write (chat write stays denied separately).
  if (
    !isCollaborationSpaceVisibleToEmployeeUser(space, params.actor) &&
    !actorOwnsPendingBotInviteInSpace(space, params.actor) &&
    !actorHasPendingHumanInviteInSpace(space, params.actor)
  ) {
    return "you do not have permission to access this collaboration space";
  }
  return null;
}

/**
 * Object ACL for personal-workbench mutate RPCs that take a groupId.
 * Unknown groupId is allowed (create / first upsert). Existing spaces require
 * the same visibility predicate as spaces.list / chat write.
 */
export async function resolveCollaborationSpaceMutateDenial(params: {
  client: GatewayClient | null | undefined;
  groupId: string;
  listCollaborationSpaces?: () => Promise<{ spaces: CollaborationSpaceLike[] }>;
}): Promise<string | null> {
  if (!requiresEmployeeAssetScope(params.client)) {
    return null;
  }
  const actor = await resolveEmployeeWorkbenchActor(params.client);
  if (!actor) {
    return "collaboration space mutate requires a resolved employee actor";
  }
  let spaces: CollaborationSpaceLike[];
  try {
    const listed = await (params.listCollaborationSpaces ?? listEmployeeSessionVisibilitySpaces)();
    spaces = listed.spaces ?? [];
  } catch {
    return "failed to resolve collaboration spaces for mutate ACL";
  }
  return resolveCollaborationSpaceMutateDenialForActor({
    actor,
    groupId: params.groupId,
    spaces,
  });
}

export function isSessionVisibleToEmployeeUser(
  session: SessionRowLike,
  actor: EmployeeWorkbenchActor,
  visibleAgentIds: Set<string>,
  visibleSpaceIds: Set<string>,
  auditableGroupBotSessions: Set<string> = new Set(),
): boolean {
  const key = session.key.trim();
  if (!key) {
    return false;
  }
  if (isOrganizationAgentSessionKey(key)) {
    return false;
  }
  const cfg = loadConfig();
  if (isGlobalBuiltinStewardSessionKey(key, cfg) || normalizeIdentity(key) === "main") {
    return false;
  }
  const stewardOwner = extractEmployeeStewardUserIdFromSessionKey(key);
  if (stewardOwner) {
    return (
      isEmployeeBuiltinStewardSessionOwnedByUser({
        sessionKey: key,
        platformUserId: actor.userId,
      }) && visibleAgentIds.has(normalizeIdentity(BUILTIN_STEWARD_AGENT_ID))
    );
  }
  const parsed = parseAgentSessionKey(key);
  if (parsed && isBuiltinStewardAgent(parsed.agentId)) {
    const spaceIdentity =
      extractSpaceIdentityFromSessionKey(key) ?? normalizeIdentity(session.groupId);
    const isGroupSession =
      Boolean(spaceIdentity) &&
      (session.kind === "group" ||
        session.chatType === "group" ||
        deriveSessionChatType(key) === "group");
    if (!isGroupSession) {
      return false;
    }
  }
  if (parsed) {
    if (!visibleAgentIds.has(parsed.agentId)) {
      return false;
    }
    const spaceIdentity =
      extractSpaceIdentityFromSessionKey(key) ?? normalizeIdentity(session.groupId);
    // Fail closed: any row that names a collaboration space (key or groupId)
    // must clear the same space ACL as explicit group sessions.
    if (spaceIdentity) {
      // Messages and shared group rows stay inside the roster. Owning a bot
      // that participates is not membership and does not grant a read.
      void auditableGroupBotSessions;
      return visibleSpaceIds.has(spaceIdentity);
    }
    return true;
  }
  if (key.startsWith("space:")) {
    const spaceId = key.slice("space:".length).trim();
    return visibleSpaceIds.has(normalizeIdentity(spaceId));
  }
  const normalizedKey = normalizeIdentity(key);
  return visibleAgentIds.has(normalizedKey);
}

/**
 * Resolves the subjects (agents / groups) a user OWNS, independent of any seat
 * binding lifecycle. Group ids from these records still feed collaboration
 * visibility. They are not the employee bot roster — that roster is the
 * position bot set ({@link assembleEmployeePositionAgentIds}).
 *
 * `currentManagerUserId` may be stored as a platform user id (UUID) or an email
 * depending on when the record was written, so we match against both actor
 * identities. Revoked ownerships are excluded; transferred records correctly
 * point at the new manager, so matching `currentManagerUserId` already hands the
 * asset to whoever owns it now.
 */
export function resolveUserOwnedSubjectIds(params: {
  records: ReadonlyArray<{
    tenantId: string;
    subjectKind: string;
    subjectId: string;
    currentManagerUserId: string;
    bindingStatus: string;
  }>;
  tenantId: string;
  identities: Set<string>;
}): { agentIds: string[]; groupIds: string[] } {
  const agentIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const record of params.records) {
    if (record.tenantId !== params.tenantId || record.bindingStatus === "revoked") {
      continue;
    }
    const ownerIdentity = normalizeIdentity(record.currentManagerUserId);
    if (!ownerIdentity || !params.identities.has(ownerIdentity)) {
      continue;
    }
    const subjectId = record.subjectId.trim();
    if (!subjectId) {
      continue;
    }
    if (record.subjectKind === "agent") {
      agentIds.add(subjectId);
    } else if (record.subjectKind === "group") {
      groupIds.add(subjectId);
    }
  }
  return { agentIds: [...agentIds], groupIds: [...groupIds] };
}

export async function resolveEmployeeWorkbenchActor(
  client: GatewayClient | null | undefined,
): Promise<EmployeeWorkbenchActor | null> {
  if (!client?.sessionDomain || !PERSONAL_WORKBENCH_SESSION_DOMAINS.has(client.sessionDomain)) {
    return null;
  }
  const userEmail = client.user?.trim();
  if (!userEmail) {
    return null;
  }
  const config = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
  if (!config) {
    return null;
  }
  const store = await loadStore(config);
  const scope = resolveAuthoritativeEnterpriseScopeForClient({
    store,
    client,
    canonicalize: (value) => value?.trim() || null,
  });
  if (scope.kind === "deny" || scope.kind === "no-platform-identity") {
    // Ambiguous or suspended context must not fall back to a tenant hint.
    return null;
  }
  const user = scope.user;
  const tenantId =
    scope.kind === "authoritative" ? scope.enterpriseId : client.sessionTenantId?.trim();
  if (!tenantId) {
    return {
      userId: user.id,
      userEmail: user.email,
      seatAgentIds: withEmployeeUniversalStewardAgentIds([]),
      seatSpaceIds: [],
    };
  }
  // Hard rule: under shared tenant addressing, seat grants come from the
  // tenant control-plane store — never the process-global seat-assets file
  // (docs/design/agent-seat-binding-tenant-isolation-2026-08-04.md).
  const seatStore = await loadSeatAssetsStoreForTenantId(tenantId);
  const access = buildEmployeeAccessSnapshot({
    store: seatStore,
    tenantId,
    employeeId: user.id,
  });
  // Group visibility may still consult ownership rows. Agent ids from those
  // rows are not merged into the bot roster.
  const identities = new Set(
    [user.id, user.email].map((entry) => normalizeIdentity(entry)).filter(Boolean),
  );
  const ownedGroups = resolveUserOwnedSubjectIds({
    records: listOwnershipRecords(),
    tenantId,
    identities,
  }).groupIds;
  const currentSeatId = access.currentSeat?.seatId?.trim() ?? "";
  const seatAgentIds = assembleEmployeePositionAgentIds({
    positionId: currentSeatId || null,
    grantedAgentIds: access.agentIds,
    configAgents: listAgentsForGateway(loadConfig()).agents,
  });
  return {
    userId: user.id,
    userEmail: user.email,
    tenantId,
    currentSeatId: currentSeatId || undefined,
    seatAgentIds,
    seatSpaceIds: [...new Set([...ownedGroups, ...access.defaultSpaceIds])],
  };
}

export function filterAgentsForEmployeeActor(
  agents: GatewayAgentRow[],
  actor: EmployeeWorkbenchActor,
): GatewayAgentRow[] {
  return agents.filter((agent) => isAgentVisibleToEmployeeUser(agent, actor));
}

/** True when the connection must never see install-wide employee assets. */
export function requiresEmployeeAssetScope(client: GatewayClient | null | undefined): boolean {
  return Boolean(
    isPersonalWorkbenchClient(client) || (client?.user && client.sessionDomain !== "platform"),
  );
}

/**
 * True when the socket's public host is the employee or enterprise shell.
 * A platform `sessionDomain` on that host is the wrong domain: `agents.list`
 * must still fail closed. Missing host stays ambiguous so the platform
 * console can keep the install roster.
 */
export function isAuthoritativePersonalWorkbenchSurface(
  client: GatewayClient | null | undefined,
): boolean {
  if (!client) {
    return false;
  }
  const raw = (client.connect as { pagePath?: unknown } | undefined)?.pagePath;
  const pathname = typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
  const resolution = resolveRequestSessionSurface({
    origin: client.upgradeRequestOrigin,
    host: client.upgradeRequestHost,
    pathname,
  });
  return (
    resolution.kind === "authoritative" &&
    (resolution.surface === "employee" || resolution.surface === "enterprise")
  );
}

function stewardOnlyAgents(client: GatewayClient | null | undefined, agents: GatewayAgentRow[]) {
  const fallbackEmail = client?.user?.trim() ?? "";
  return filterAgentsForEmployeeActor(agents, {
    userId: fallbackEmail,
    userEmail: fallbackEmail,
    seatAgentIds: withEmployeeUniversalStewardAgentIds([]),
    seatSpaceIds: [],
  });
}

/**
 * Pure roster filter for a resolved (or null) actor. Used by
 * {@link resolveScopedAgentsForClient} and unit tests.
 *
 * Personal-workbench / authenticated non-platform sessions MUST NOT fall through
 * to the install-wide roster when actor is null — return steward-only.
 * The same fail-closed result applies when the public host is www/gw/biz even
 * if `sessionDomain` is still `platform` or missing.
 */
export function scopeAgentsForClientActor(
  client: GatewayClient | null | undefined,
  agents: GatewayAgentRow[],
  actor: EmployeeWorkbenchActor | null,
): GatewayAgentRow[] {
  if (actor) {
    return filterAgentsForEmployeeActor(agents, actor);
  }
  if (requiresEmployeeAssetScope(client) || isAuthoritativePersonalWorkbenchSurface(client)) {
    return stewardOnlyAgents(client, agents);
  }
  return agents;
}

/**
 * Single roster-scope entry for personal agent lists (hard rule:
 * docs/design/isolation-layers-hard-rules-2026-08-06.md).
 *
 * Always scopes to the caller's position bot set plus the steward — including
 * `sessionDomain=enterprise`. Enterprise-admin sessions used to receive the
 * tenant-wide mesh roster here. A platform-ranked session on www/gw did the
 * same after surface projection was removed: the identity was stripped or left
 * as `platform`, and this function then returned the install roster.
 *
 * Tenant-wide mesh enumeration belongs on dedicated mesh/growth RPCs
 * (`listTenantMeshGrowthAgents` / `filterAgentsForEnterpriseTenantClient`), not
 * on `agents.list` / personal robot-workspace access checks.
 */
export async function resolveScopedAgentsForClient(
  client: GatewayClient | null | undefined,
  agents: GatewayAgentRow[],
): Promise<GatewayAgentRow[]> {
  const actor = await resolveEmployeeWorkbenchActor(client);
  return scopeAgentsForClientActor(client, agents, actor);
}

export function filterCollaborationSpacesForEmployeeActor<T extends CollaborationSpaceLike>(
  spaces: T[],
  actor: EmployeeWorkbenchActor,
): T[] {
  return spaces.filter((space) => isCollaborationSpaceListedForEmployeeUser(space, actor));
}

export function isArchivedCollaborationSpace(space: CollaborationSpaceLike): boolean {
  // Fail closed: either profile or operating-state saying archived wins.
  // Blank operating-state must not resurrect a profile-archived space.
  const fromOperatingState = normalizeIdentity(space.operatingState?.groupProfile?.lifecycleStatus);
  const fromProfile = normalizeIdentity(space.lifecycleStatus);
  return fromOperatingState === "archived" || fromProfile === "archived";
}

export function buildArchivedCollaborationGroupIdSet(
  spaces: CollaborationSpaceLike[],
): Set<string> {
  const archivedGroupIds = new Set<string>();
  for (const space of spaces) {
    if (!isArchivedCollaborationSpace(space)) {
      continue;
    }
    const groupId = normalizeIdentity(space.groupId);
    const spaceId = normalizeIdentity(space.id?.replace(/^space:/, ""));
    if (groupId) {
      archivedGroupIds.add(groupId);
    }
    if (spaceId) {
      archivedGroupIds.add(spaceId);
    }
  }
  return archivedGroupIds;
}

function sessionBelongsToArchivedCollaborationGroup(
  session: SessionRowLike,
  archivedGroupIds: Set<string>,
): boolean {
  if (archivedGroupIds.size === 0) {
    return false;
  }
  const spaceIdentity =
    extractSpaceIdentityFromSessionKey(session.key) ?? normalizeIdentity(session.groupId);
  return Boolean(spaceIdentity && archivedGroupIds.has(spaceIdentity));
}

export type EmployeeSessionVisibilityContext = {
  actor: EmployeeWorkbenchActor;
  visibleAgentIds: Set<string>;
  visibleSpaceIds: Set<string>;
  auditableGroupBotSessions: Set<string>;
  archivedGroupIds: Set<string>;
};

/** Apply the complete employee session policy to one row. */
export function isSessionVisibleToEmployeeActor(
  session: SessionRowLike,
  context: EmployeeSessionVisibilityContext,
): boolean {
  if (sessionBelongsToArchivedCollaborationGroup(session, context.archivedGroupIds)) {
    return false;
  }
  return isSessionVisibleToEmployeeUser(
    session,
    context.actor,
    context.visibleAgentIds,
    context.visibleSpaceIds,
    context.auditableGroupBotSessions,
  );
}

export function filterSessionsForEmployeeActor<T extends SessionRowLike>(
  sessions: T[],
  actor: EmployeeWorkbenchActor,
  visibleAgents: Array<Pick<GatewayAgentRow, "id">>,
  auditableGroupBotSessions: Set<string> = new Set(),
  archivedGroupIds: Set<string> = new Set(),
  spaces: CollaborationSpaceLike[] = [],
): T[] {
  const context: EmployeeSessionVisibilityContext = {
    actor,
    visibleAgentIds: new Set(
      visibleAgents.map((agent) => normalizeIdentity(agent.id)).filter(Boolean),
    ),
    visibleSpaceIds: collectVisibleCollaborationSpaceIdsForActor(actor, spaces),
    auditableGroupBotSessions,
    archivedGroupIds,
  };
  return sessions.filter((session) => isSessionVisibleToEmployeeActor(session, context));
}

type EmployeeSessionVisibilitySpaceList = { spaces: CollaborationSpaceLike[] };

export async function buildEmployeeSessionVisibilityContextForActor(params: {
  actor: EmployeeWorkbenchActor;
  visibleAgents: Array<Pick<GatewayAgentRow, "id">>;
  logGateway?: { warn?: (message: string) => void } | null;
  listCollaborationSpaces?: () => Promise<EmployeeSessionVisibilitySpaceList>;
}): Promise<EmployeeSessionVisibilityContext | null> {
  let spaces: EmployeeSessionVisibilitySpaceList;
  try {
    spaces = await (params.listCollaborationSpaces ?? listEmployeeSessionVisibilitySpaces)();
  } catch (err) {
    params.logGateway?.warn?.(`failed to resolve employee session visibility: ${String(err)}`);
    return null;
  }

  const activeSpaces = spaces.spaces.filter((space) => !isArchivedCollaborationSpace(space));
  return {
    actor: params.actor,
    visibleAgentIds: new Set(
      params.visibleAgents.map((agent) => normalizeIdentity(agent.id)).filter(Boolean),
    ),
    visibleSpaceIds: collectVisibleCollaborationSpaceIdsForActor(params.actor, activeSpaces),
    auditableGroupBotSessions: buildAuditableGroupBotSessionSet(
      params.actor,
      activeSpaces as GroupBotRosterLike[],
    ),
    archivedGroupIds: buildArchivedCollaborationGroupIdSet(spaces.spaces),
  };
}

/** Build employee session visibility sets for RPC scoping (security P1.1). */
export async function buildEmployeeSessionVisibilityContext(params: {
  client: GatewayClient | null | undefined;
  logGateway?: { warn?: (message: string) => void } | null;
}): Promise<EmployeeSessionVisibilityContext | null> {
  let actor: EmployeeWorkbenchActor | null;
  let visibleAgents: GatewayAgentRow[];
  try {
    actor = await resolveEmployeeWorkbenchActor(params.client);
    if (!actor) {
      return null;
    }
    visibleAgents = filterAgentsForEmployeeActor(listAgentsForGateway(loadConfig()).agents, actor);
  } catch (err) {
    params.logGateway?.warn?.(
      `failed to resolve employee session visibility actor: ${String(err)}`,
    );
    return null;
  }
  return await buildEmployeeSessionVisibilityContextForActor({
    actor,
    visibleAgents,
    logGateway: params.logGateway,
  });
}
