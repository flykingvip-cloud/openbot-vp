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
  governance?: { coordinatorBotId?: string | null } | null;
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
export function isMappedDeliveryIdentity(
  state: DeliveryMembershipSource,
  actorId: string,
  publisherId?: string | null,
): boolean {
  const id = actorId.trim();
  if (!id) {
    return false;
  }
  if ((state?.governance?.coordinatorBotId ?? "").trim() === id) {
    return true;
  }
  if ((publisherId ?? "").trim() === id) {
    return true;
  }
  return (state?.memberRoleMap ?? []).some((row) => (row.memberId ?? "").trim() === id);
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
 * stamped session email (`client.user`) over `platformUserId` UUID if that
 * email is already a mapped member/coordinator. authorizedConfirmerIds are
 * usually emails (publishedBy); picking the UUID makes lead confirm fail.
 */
export function preferMappedSessionSubjects(params: {
  subjects: readonly string[];
  stampedUser?: string | null;
  state: DeliveryMembershipSource;
}): string[] {
  const subjects = params.subjects.map((subject) => subject.trim()).filter(Boolean);
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
