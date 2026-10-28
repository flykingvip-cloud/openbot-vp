/**
 * Delivery ACL actor binding.
 *
 * `client.connect.user` (and displayName / client id) is caller-chosen.
 * Handshake stamps the authenticated principal on `platformUserId`,
 * `sessionMembershipId`, and `user` via `resolveClientSessionIdentity`.
 * When the claimed id is already a memberRoleMap row, the operating-state
 * coordinator, or would be accepted as that string, the session subject
 * must match. There is no alias table from email/uuid to memberId.
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
 * When `actor` is one of the handshake-stamped session subjects (email / uuid /
 * membership id), every subject is the same person — expand all of them so
 * Owner email can match authorized `human:<uuid>` (and vice versa).
 */
export function sessionConfirmerAliases(params: {
  actor: string;
  sessionSubjects?: readonly string[] | null;
}): string[] {
  const actor = params.actor.trim();
  if (!actor) {
    return [];
  }
  const subjects = (params.sessionSubjects ?? []).map((subject) => subject.trim()).filter(Boolean);
  const linked = subjects.some((subject) => deliveryActorIdsEqual(subject, actor));
  const seeds = linked ? [actor, ...subjects] : [actor];
  const out = new Set<string>();
  for (const seed of seeds) {
    for (const alias of expandDeliveryActorAliases(seed)) {
      out.add(alias);
    }
  }
  return [...out];
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
): boolean {
  const id = actorId.trim();
  if (!id) {
    return false;
  }
  if (deliveryActorIdsEqual(state?.governance?.coordinatorBotId, id)) {
    return true;
  }
  if (deliveryActorIdsEqual(publisherId, id)) {
    return true;
  }
  return (state?.memberRoleMap ?? []).some((row) => deliveryActorIdsEqual(row.memberId, id));
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
