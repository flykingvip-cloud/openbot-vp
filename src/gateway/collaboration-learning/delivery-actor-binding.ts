/**
 * Delivery ACL actor binding + shared trusted principal resolution.
 *
 * Auth primary key: trusted tenantId + platform userId; bots use in-tenant
 * canonical agentId. Email/name are display / verified aliases only — never
 * long-term auth PK. Alias links come from trusted auth context (handshake
 * session subjects) or from one authoritative members roster row
 * (userId + memberId + agentId on the same row). Morphology expands
 * human:/bot:/agent: prefixes only and cannot prove UUID ≡ email.
 *
 * Dual-form members.json rows (writing both UUID and email memberIds as a
 * productized identity bus) are forbidden as the normal fix path — keep ACL
 * and wake permission duties separate; share only principal resolution.
 *
 * `client.connect.user` (and displayName / client id) is caller-chosen.
 * Handshake stamps the authenticated principal on `platformUserId`,
 * `sessionMembershipId`, and `user` via `resolveClientSessionIdentity`.
 */

import { createWorkspaceCollaborationStores, readGroupOperatingState } from "./shared.js";

export const DELIVERY_ACTOR_NOT_AUTHENTICATED = "actor_not_authenticated";

const UNBOUND_MESSAGE =
  "actor_not_authenticated: claimed member identity is not bound to the authenticated session";

export type DeliveryActorClient = {
  user?: string;
  platformUserId?: string;
  sessionMembershipId?: string;
  connect?: {
    user?: unknown;
    client?: { displayName?: string; id?: string };
  } | null;
};

export type DeliveryMembershipSource = {
  governance?: { coordinatorBotId?: string | null; ownerUserId?: string | null } | null;
  memberRoleMap?: ReadonlyArray<{ memberId?: string | null }> | null;
} | null;

function normalize(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeUnknown(value: unknown): string | undefined {
  return typeof value === "string" ? normalize(value) : undefined;
}

/** Caller-chosen connect identity. Not an authenticated subject. */
export function claimedConnectActorId(client: DeliveryActorClient | null): string | undefined {
  const connect = client?.connect;
  const legacyConnectUser =
    connect && typeof connect === "object" && "user" in connect
      ? normalizeUnknown(connect.user)
      : undefined;
  return (
    legacyConnectUser ?? normalize(connect?.client?.displayName) ?? normalize(connect?.client?.id)
  );
}

/**
 * Subjects the gateway stamped from a validated session.
 * Never reads `connect.user`.
 */
export function authenticatedSessionSubjects(client: DeliveryActorClient | null): string[] {
  const ids = [
    normalize(client?.platformUserId),
    normalize(client?.sessionMembershipId),
    normalize(client?.user),
  ];
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/**
 * True when `actorId` is an identity the delivery ACL would treat as a known
 * member, coordinator, or publisher. A missing operating-state row is not
 * privileged by itself; publisher ids are passed in by the caller when known.
 */

/**
 * True when operating state exposes a membership surface (coordinator, owner,
 * or memberRoleMap rows). Used by dispatch auth recheck to decide whether to
 * enforce mapping without reading governance fields in collaboration-dispatch.
 */
export function hasDeliveryMembershipSurface(state: DeliveryMembershipSource): boolean {
  if (!state) {
    return false;
  }
  if ((state.governance?.coordinatorBotId ?? "").trim()) {
    return true;
  }
  if ((state.governance?.ownerUserId ?? "").trim()) {
    return true;
  }
  return (state.memberRoleMap?.length ?? 0) > 0;
}

/**
 * Confirmer / membership id equality: exact, human:<id> ↔ <id>, and bot:/agent:
 * needle forms used on boards vs OS rows.
 */
export function deliveryActorIdsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = (left ?? "").trim();
  const b = (right ?? "").trim();
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  if (a.startsWith("human:") && a.slice("human:".length) === b) {
    return true;
  }
  if (b.startsWith("human:") && b.slice("human:".length) === a) {
    return true;
  }
  const needle = (value: string): string => {
    if (value.startsWith("bot:")) {
      return value.slice(4).trim();
    }
    if (value.startsWith("agent:")) {
      return value.slice("agent:".length).trim();
    }
    return value;
  };
  const na = needle(a);
  const nb = needle(b);
  return na !== "" && na === nb;
}

/** Expand one id into confirmer-comparable aliases (bare / human: / bot needle). */
export function expandDeliveryActorAliases(actorId: string | null | undefined): string[] {
  const id = (actorId ?? "").trim();
  if (!id) {
    return [];
  }
  const out = new Set<string>([id]);
  if (id.startsWith("human:")) {
    const bare = id.slice("human:".length).trim();
    if (bare) {
      out.add(bare);
    }
  } else if (!id.includes("@") && !id.startsWith("bot:") && !id.startsWith("agent:")) {
    out.add(`human:${id}`);
  }
  if (id.startsWith("bot:")) {
    const bare = id.slice(4).trim();
    if (bare) {
      out.add(bare);
    }
  } else if (id.startsWith("agent:")) {
    const bare = id.slice("agent:".length).trim();
    if (bare) {
      out.add(bare);
      out.add(`bot:${bare}`);
    }
  } else if (!id.includes("@") && !id.startsWith("human:")) {
    out.add(`bot:${id}`);
  }
  return [...out];
}

/**
 * One authoritative members.json / roster row. Fields on the SAME row are the
 * same principal (trusted roster context). Do not invent cross-row UUID↔email.
 */
export type TrustedPrincipalRosterEntry = {
  userId?: string | null;
  memberId?: string | null;
  agentId?: string | null;
};

export type TrustedPrincipalResolutionInput = {
  actor: string | null | undefined;
  /** Handshake-stamped subjects (platformUserId / user email / membershipId). */
  trustedAuthSubjects?: readonly string[] | null;
  /** Extra aliases already proven by trusted auth (e.g. employee workbench). */
  trustedAliases?: readonly string[] | null;
  /**
   * Authoritative roster rows. userId+memberId+agentId on one row link that
   * principal; never treat dual-form members.json as a productized bus.
   */
  roster?: readonly TrustedPrincipalRosterEntry[] | null;
};

/** Morphological expansion of one roster row into comparable aliases. */
export function resolveRosterPrincipalAliases(
  entry: TrustedPrincipalRosterEntry | null | undefined,
): string[] {
  if (!entry) {
    return [];
  }
  const seeds = [entry.userId, entry.memberId, entry.agentId]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  const out = new Set<string>();
  for (const seed of seeds) {
    for (const alias of expandDeliveryActorAliases(seed)) {
      out.add(alias);
    }
  }
  return [...out];
}

/**
 * Platform userIds attested on one roster row (userId, else non-email memberId).
 * Used only for ambiguity checks — never as a cross-row chain key by itself.
 */
function rosterPlatformUserIds(entry: TrustedPrincipalRosterEntry): string[] {
  const rawUserId = (entry.userId ?? "").trim();
  if (rawUserId) {
    const bare = rawUserId.startsWith("human:")
      ? rawUserId.slice("human:".length).trim()
      : rawUserId;
    if (bare && !bare.includes("@") && !bare.startsWith("bot:") && !bare.startsWith("agent:")) {
      return [bare];
    }
  }
  const rawMemberId = (entry.memberId ?? "").trim();
  if (rawMemberId) {
    const bare = rawMemberId.startsWith("human:")
      ? rawMemberId.slice("human:".length).trim()
      : rawMemberId;
    if (bare && !bare.includes("@") && !bare.startsWith("bot:") && !bare.startsWith("agent:")) {
      return [bare];
    }
  }
  return [];
}

function addUniquePlatformId(into: string[], candidate: string): void {
  if (into.some((existing) => deliveryActorIdsEqual(existing, candidate))) {
    return;
  }
  into.push(candidate);
}

/**
 * Shared trusted principal alias set for ACL and wake.
 * Session subjects link UUID↔email only when the actor is already one of them;
 * roster links only within a single members row. Morphology never proves identity.
 *
 * Matcher seed is an **immutable** authentication-subject set (actor + trusted
 * auth subjects + trustedAliases). Newly discovered roster aliases are never
 * fed back into the matcher (no cross-row chaining / no row-order dependence).
 * When the same auth alias hits multiple roster rows with distinct platform
 * UUIDs, reject roster expansion (fail closed) rather than picking by order.
 */
export function resolveTrustedPrincipalAliases(params: TrustedPrincipalResolutionInput): string[] {
  const actor = (params.actor ?? "").trim();
  if (!actor) {
    return [];
  }
  const subjects = (params.trustedAuthSubjects ?? [])
    .map((subject) => subject.trim())
    .filter(Boolean);
  const linked = subjects.some((subject) => deliveryActorIdsEqual(subject, actor));
  const seeds = linked ? [actor, ...subjects] : [actor];
  // Immutable auth-context matcher — do not grow this while scanning roster.
  const authAliases = new Set<string>();
  for (const seed of seeds) {
    for (const alias of expandDeliveryActorAliases(seed)) {
      authAliases.add(alias);
    }
  }
  for (const raw of params.trustedAliases ?? []) {
    const alias = typeof raw === "string" ? raw.trim() : "";
    if (!alias) {
      continue;
    }
    for (const expanded of expandDeliveryActorAliases(alias)) {
      authAliases.add(expanded);
    }
  }
  const authAliasList = [...authAliases];
  const matchesAuth = (candidate: string): boolean =>
    authAliasList.some((alias) => deliveryActorIdsEqual(alias, candidate));

  const matchedRows: TrustedPrincipalRosterEntry[] = [];
  for (const row of params.roster ?? []) {
    const rowAliases = resolveRosterPrincipalAliases(row);
    if (rowAliases.length === 0) {
      continue;
    }
    // Same-row proof only: row must intersect the immutable auth set.
    if (rowAliases.some((rowAlias) => matchesAuth(rowAlias))) {
      matchedRows.push(row);
    }
  }

  const distinctPlatformIds: string[] = [];
  for (const row of matchedRows) {
    for (const id of rosterPlatformUserIds(row)) {
      addUniquePlatformId(distinctPlatformIds, id);
    }
  }
  // Ambiguous shared alias → multiple platform UUIDs: reject roster fold.
  if (distinctPlatformIds.length > 1) {
    return authAliasList;
  }

  const out = new Set(authAliases);
  for (const row of matchedRows) {
    for (const rowAlias of resolveRosterPrincipalAliases(row)) {
      out.add(rowAlias);
    }
  }
  return [...out];
}

/** True when candidate equals any trusted principal alias (morphology-aware). */
export function trustedPrincipalMatches(
  candidate: string | null | undefined,
  principalAliases: readonly string[],
): boolean {
  const id = (candidate ?? "").trim();
  if (!id || principalAliases.length === 0) {
    return false;
  }
  return principalAliases.some((alias) => deliveryActorIdsEqual(alias, id));
}

/**
 * When `actor` is one of the handshake-stamped session subjects (email / uuid /
 * membership id), every subject is the same person — expand all of them so
 * Owner email can match authorized `human:<uuid>` (and vice versa).
 * Delegates to shared {@link resolveTrustedPrincipalAliases}.
 */
export function sessionConfirmerAliases(params: {
  actor: string;
  sessionSubjects?: readonly string[] | null;
}): string[] {
  return resolveTrustedPrincipalAliases({
    actor: params.actor,
    trustedAuthSubjects: params.sessionSubjects,
  });
}

/**
 * True when the RPC actor (optionally with session subjects) matches an
 * authorized confirmer id. Does not invent email↔uuid links without session proof.
 */
export function actorMatchesAuthorizedConfirmer(params: {
  actor: string;
  authorizedConfirmerIds: readonly string[];
  sessionSubjects?: readonly string[] | null;
}): boolean {
  const aliases = sessionConfirmerAliases({
    actor: params.actor,
    sessionSubjects: params.sessionSubjects,
  });
  if (aliases.length === 0) {
    return false;
  }
  for (const allowed of params.authorizedConfirmerIds) {
    const id = allowed.trim();
    if (!id) {
      continue;
    }
    if (aliases.some((alias) => deliveryActorIdsEqual(alias, id))) {
      return true;
    }
  }
  return false;
}

/** Canonical memberRoleMap / governance id matching any session subject, if any. */
export function canonicalMappedDeliveryMemberId(
  state: DeliveryMembershipSource,
  subjects: readonly string[],
  publisherId?: string | null,
): string | undefined {
  const candidates = [
    (state?.governance?.coordinatorBotId ?? "").trim(),
    (publisherId ?? "").trim(),
    ...(state?.memberRoleMap ?? []).map((row) => (row.memberId ?? "").trim()),
  ].filter(Boolean);
  for (const subject of subjects) {
    const s = subject.trim();
    if (!s) {
      continue;
    }
    for (const candidate of candidates) {
      if (deliveryActorIdsEqual(candidate, s)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function isMappedDeliveryIdentity(
  state: DeliveryMembershipSource,
  actorId: string,
  publisherId?: string | null,
  resolution?: Omit<TrustedPrincipalResolutionInput, "actor"> | null,
): boolean {
  const id = actorId.trim();
  if (!id) {
    return false;
  }
  const aliases = resolveTrustedPrincipalAliases({
    actor: id,
    trustedAuthSubjects: resolution?.trustedAuthSubjects,
    trustedAliases: resolution?.trustedAliases,
    roster: resolution?.roster,
  });
  if (trustedPrincipalMatches(state?.governance?.coordinatorBotId, aliases)) {
    return true;
  }
  if (trustedPrincipalMatches(publisherId, aliases)) {
    return true;
  }
  // Owner surface is also a membership-bound identity (often platform userId).
  if (trustedPrincipalMatches(state?.governance?.ownerUserId, aliases)) {
    return true;
  }
  return (state?.memberRoleMap ?? []).some((row) => trustedPrincipalMatches(row.memberId, aliases));
}

export function bindDeliveryActor(params: {
  claimedId?: string;
  subjects: readonly string[];
  privileged: boolean;
}): string | undefined {
  const claimed = normalize(params.claimedId);
  const subjects = params.subjects.map((subject) => subject.trim()).filter(Boolean);
  if (params.privileged) {
    if (!claimed || !subjects.includes(claimed)) {
      throw new Error(UNBOUND_MESSAGE);
    }
    return claimed;
  }
  const subject = subjects[0];
  if (subject && claimed && subject !== claimed) {
    return subject;
  }
  return subject || claimed;
}

async function claimedDeliveryIdentityIsPrivileged(
  groupId: string,
  claimedId: string,
): Promise<boolean> {
  const group = groupId.trim();
  const id = claimedId.trim();
  if (!group || !id) {
    return false;
  }
  try {
    const { fileStore } = createWorkspaceCollaborationStores();
    const state = await readGroupOperatingState({ fileStore, groupId: group });
    return isMappedDeliveryIdentity(state, id);
  } catch {
    // Unreadable membership cannot prove the id is unprivileged.
    return true;
  }
}

/**
 * When connect claimed a non-member label (e.g. "Chrome · Mac"), prefer the
 * OS-canonical mapped member id (often `human:<uuid>`) when a session subject
 * maps to it. Fall back to stamped session email over `platformUserId` only
 * when that email itself is the mapped member/coordinator (legacy publishedBy).
 */
export function preferMappedSessionSubjects(params: {
  subjects: readonly string[];
  stampedUser?: string | null;
  state: DeliveryMembershipSource;
}): string[] {
  const subjects = params.subjects.map((subject) => subject.trim()).filter(Boolean);
  // Prefer OS-canonical member id (e.g. human:<uuid>) when a session subject maps,
  // so confirmTodolist actors match authorizedConfirmerIds that use human: form.
  const canonical = canonicalMappedDeliveryMemberId(params.state, subjects);
  if (canonical) {
    return [canonical, ...subjects.filter((subject) => subject !== canonical)];
  }
  const email = normalize(params.stampedUser ?? undefined);
  if (!email || !subjects.includes(email)) {
    return subjects;
  }
  if (!isMappedDeliveryIdentity(params.state, email)) {
    return subjects;
  }
  return [email, ...subjects.filter((subject) => subject !== email)];
}

async function loadDeliveryMembershipState(groupId: string): Promise<DeliveryMembershipSource> {
  const group = groupId.trim();
  if (!group) {
    return null;
  }
  try {
    const { fileStore } = createWorkspaceCollaborationStores();
    return await readGroupOperatingState({ fileStore, groupId: group });
  } catch {
    return null;
  }
}

/**
 * Actor for delivery ACL RPCs. Mapped members require a matching session
 * subject. Other connect ids stay available for non-member callers.
 */
export async function resolveDeliveryAclActor(
  client: DeliveryActorClient | null,
  groupId: unknown,
): Promise<string | undefined> {
  const claimed = claimedConnectActorId(client);
  let subjects = authenticatedSessionSubjects(client);
  const group = typeof groupId === "string" ? groupId : "";
  const privileged = claimed ? await claimedDeliveryIdentityIsPrivileged(group, claimed) : false;
  if (!privileged) {
    const state = await loadDeliveryMembershipState(group);
    subjects = preferMappedSessionSubjects({
      subjects,
      stampedUser: client?.user,
      state,
    });
    // Even without a readable membership map, prefer stamped email over UUID so
    // confirmer ids that are emails can match after fillClientUserFromPlatformUserId.
    if (!state) {
      const email = normalize(client?.user);
      if (email && subjects.includes(email) && subjects[0] !== email) {
        subjects = [email, ...subjects.filter((subject) => subject !== email)];
      }
    }
  }
  return bindDeliveryActor({ claimedId: claimed, subjects, privileged });
}
