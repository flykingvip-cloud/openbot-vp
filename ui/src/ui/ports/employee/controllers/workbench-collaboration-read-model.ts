import {
  canonicalizeWorkbenchChatSessionKey,
  toCollaborationSpaceSessionKey,
} from "../../../../../../src/sessions/session-key-utils.ts";
import type { SessionsListResult } from "../../../types.ts";
import {
  isEmployeeWorkbenchCollaborationSpaceVisible,
  type EmployeeWorkbenchCollaborationScopeParams,
} from "../employee-workbench-collaboration-scope.ts";
import type { WorkbenchTeamEntry } from "../views/workbench-home-model.ts";
import type {
  WorkbenchCollaborationSpaceSnapshot,
  WorkbenchCollaborationSpacesSnapshot,
  WorkbenchCollaborationReadModel,
} from "../views/workbench-types.ts";
import { isArchivedWorkbenchCollaborationSpace } from "./workbench-collaboration-spaces-snapshot.ts";

function normalizeValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function extractSpaceIdentity(value: string | null | undefined) {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("space:")) {
    return normalized.slice("space:".length).trim() || null;
  }
  const scopedMatch = normalized.match(/(?:^|:)space:([^:]+)$/);
  return scopedMatch?.[1]?.trim() || null;
}

function normalizeKey(value: string | null | undefined) {
  return normalizeValue(value)?.toLowerCase() ?? null;
}

function uniqueValues(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => normalizeValue(value)).filter(Boolean) as string[])];
}

function buildIdentityVariants(identity: string) {
  const normalizedIdentity = normalizeKey(identity);
  if (!normalizedIdentity) {
    return [];
  }
  return [normalizedIdentity, `space:${normalizedIdentity}`, `space-${normalizedIdentity}`];
}

export function isGeneratedSpaceTitle(
  value: string | null | undefined,
  identities: Iterable<string> = [],
) {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return false;
  }
  const normalizedTitle = normalized.toLowerCase();
  if (
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(normalizedTitle) ||
    /^space[:-][0-9a-f]{8}(?:-[0-9a-f]{4}){2,}[0-9a-f-]*$/i.test(normalizedTitle) ||
    /^space[:-][a-z0-9]{8,}(?:-[a-z0-9]{4,}){2,}$/i.test(normalizedTitle)
  ) {
    return true;
  }
  return [...identities].some((identity) =>
    buildIdentityVariants(identity).includes(normalizedTitle),
  );
}

function findMeaningfulTitle(
  values: Array<string | null | undefined>,
  identities: Iterable<string> = [],
) {
  return values.find((value) => {
    const normalized = normalizeValue(value);
    return normalized && !isGeneratedSpaceTitle(normalized, identities);
  });
}

function resolveLegacyEntryIdentities(entry: WorkbenchTeamEntry) {
  return new Set(
    [
      normalizeValue(entry.id),
      normalizeValue(entry.entityId),
      normalizeValue(entry.groupId),
      normalizeValue(entry.key),
      normalizeValue(entry.selectionKey),
      extractSpaceIdentity(entry.key),
      extractSpaceIdentity(entry.selectionKey),
    ].filter(Boolean) as string[],
  );
}

function buildLegacyEntryIndexes(teamSpaces: WorkbenchTeamEntry[]) {
  const byIdentity = new Map<string, WorkbenchTeamEntry>();
  const byTitle = new Map<string, WorkbenchTeamEntry>();
  for (const entry of teamSpaces) {
    for (const identity of resolveLegacyEntryIdentities(entry)) {
      if (!byIdentity.has(identity)) {
        byIdentity.set(identity, entry);
      }
    }
    const title = normalizeValue(entry.title)?.toLowerCase();
    if (title && !byTitle.has(title)) {
      byTitle.set(title, entry);
    }
  }
  return { byIdentity, byTitle };
}

function resolveSpaceIdentities(space: WorkbenchCollaborationSpaceSnapshot) {
  return uniqueValues([
    normalizeValue(space.id),
    normalizeValue(space.groupId),
    extractSpaceIdentity(space.id),
    extractSpaceIdentity(space.groupId),
  ]);
}

function findMatchingLegacyEntry(
  space: WorkbenchCollaborationSpaceSnapshot,
  indexes: ReturnType<typeof buildLegacyEntryIndexes>,
) {
  for (const identity of resolveSpaceIdentities(space)) {
    const direct = indexes.byIdentity.get(identity);
    if (direct) {
      return direct;
    }
  }
  const normalizedTitle = normalizeValue(space.title)?.toLowerCase();
  if (!normalizedTitle) {
    return null;
  }
  return indexes.byTitle.get(normalizedTitle) ?? null;
}

function findMatchingLegacyEntryBySessionContext(params: {
  space: WorkbenchCollaborationSpaceSnapshot;
  teamSpaces: WorkbenchTeamEntry[];
  sessionsResult: SessionsListResult | null | undefined;
  matchedLegacyEntries: Set<WorkbenchTeamEntry>;
}) {
  const matchedSessions = collectMatchedSpaceSessions(params.space, null, params.sessionsResult);
  if (matchedSessions.length === 0) {
    return null;
  }

  const sessionKeys = new Set(
    matchedSessions.map((session) => normalizeValue(session.key)).filter(Boolean) as string[],
  );
  const sessionTitles = new Set(
    matchedSessions
      .flatMap((session) => collectSessionTitleCandidates(session))
      .map((value) => normalizeValue(value)?.toLowerCase())
      .filter(Boolean) as string[],
  );

  return (
    params.teamSpaces.find((entry) => {
      if (params.matchedLegacyEntries.has(entry)) {
        return false;
      }
      if (entry.sessionKeys.some((key) => sessionKeys.has(normalizeValue(key) ?? ""))) {
        return true;
      }
      const title = normalizeValue(entry.title);
      if (!title) {
        return false;
      }
      return (
        !isGeneratedSpaceTitle(title, resolveLegacyEntryIdentities(entry)) &&
        sessionTitles.has(title.toLowerCase())
      );
    }) ?? null
  );
}

function collectSpaceIdentities(
  space: WorkbenchCollaborationSpaceSnapshot,
  legacyEntry: WorkbenchTeamEntry | null,
) {
  return new Set([
    ...resolveSpaceIdentities(space),
    ...(legacyEntry ? [...resolveLegacyEntryIdentities(legacyEntry)] : []),
  ]);
}

function collectSessionIdentities(session: SessionsListResult["sessions"][number]) {
  return uniqueValues([
    session.groupId,
    session.space,
    extractSpaceIdentity(session.key),
    session.collaborationGroupProfile?.groupId,
    session.collaborationParticipationOverlay?.groupId,
  ]);
}

function collectSessionTitleCandidates(session: SessionsListResult["sessions"][number]) {
  return uniqueValues([session.displayName, session.derivedTitle, session.subject, session.label]);
}

function matchesSpaceIdentity(
  session: SessionsListResult["sessions"][number],
  identities: Set<string>,
) {
  const sessionKey = normalizeValue(session.key);
  if (!sessionKey) {
    return false;
  }
  const sessionIdentities = new Set(collectSessionIdentities(session));
  return [...identities].some(
    (identity) =>
      sessionKey === `space:${identity}` ||
      sessionKey.endsWith(`:space:${identity}`) ||
      sessionIdentities.has(identity),
  );
}

function collectMatchedSpaceSessions(
  space: WorkbenchCollaborationSpaceSnapshot,
  legacyEntry: WorkbenchTeamEntry | null,
  sessionsResult: SessionsListResult | null | undefined,
) {
  const identities = collectSpaceIdentities(space, legacyEntry);
  const titleMatches = new Set(
    uniqueValues([space.title, legacyEntry?.title])
      .filter((title) => !isGeneratedSpaceTitle(title, identities))
      .map((title) => title.toLowerCase()),
  );
  return (sessionsResult?.sessions ?? []).filter((session) => {
    if (matchesSpaceIdentity(session, identities)) {
      return true;
    }
    if (!legacyEntry || titleMatches.size === 0) {
      return false;
    }
    return collectSessionTitleCandidates(session).some((title) =>
      titleMatches.has(title.toLowerCase()),
    );
  });
}

function collectSpaceSessionKeys(
  space: WorkbenchCollaborationSpaceSnapshot,
  legacyEntry: WorkbenchTeamEntry | null,
  _sessionsResult: SessionsListResult | null | undefined,
) {
  const identity =
    normalizeValue(space.groupId) ||
    normalizeValue(space.id) ||
    normalizeValue(legacyEntry?.groupId) ||
    extractSpaceIdentity(legacyEntry?.key);
  const destination = toCollaborationSpaceSessionKey(identity);
  return destination ? [destination] : [];
}

function countSpaceRosterEntries(space: WorkbenchCollaborationSpaceSnapshot) {
  return (
    (space.members.humans?.length ?? 0) +
    (space.members.bots?.length ?? 0) +
    (space.invites.humans?.length ?? 0) +
    (space.invites.bots?.length ?? 0)
  );
}

function collectSessionsForFallbackEntry(
  entry: WorkbenchTeamEntry,
  sessionsResult: SessionsListResult | null | undefined,
) {
  const sessionKeys = new Set(
    [entry.key, entry.selectionKey, ...entry.sessionKeys]
      .map((value) => normalizeValue(value))
      .filter(Boolean) as string[],
  );
  return (sessionsResult?.sessions ?? []).filter((session) => sessionKeys.has(session.key));
}

/**
 * External chat-channel group sessions (telegram/wecom/discord/slack/...) flow
 * through the same `chatType: "group"` derivation as OpenBot collaboration
 * spaces. Without this guard they would surface in the workbench "我的协作小组"
 * list and the left-side "协作空间" navigation, even though the user never
 * created them in OpenBot. We reserve those entries for an external-chat
 * surface and only retain entries whose session evidence points to an OpenBot
 * collaboration space (`space:`-prefixed keys or a space-shaped groupId).
 */
function isExternalChannelOnlyEntry(
  entry: WorkbenchTeamEntry,
  sessionsResult: SessionsListResult | null | undefined,
) {
  const candidateKeys = [entry.key, entry.selectionKey, ...entry.sessionKeys]
    .map((value) => normalizeValue(value))
    .filter(Boolean) as string[];

  if (candidateKeys.length === 0) {
    return false;
  }

  // OpenBot collaboration spaces are addressed via `space:<groupId>` either at
  // the root or scoped under an agent. If any candidate key carries that
  // marker we consider the entry collaboration-shaped and keep it.
  const looksLikeOpenBotSpace = candidateKeys.some((key) => {
    const lower = key.toLowerCase();
    return lower.startsWith("space:") || lower.includes(":space:");
  });
  if (looksLikeOpenBotSpace) {
    return false;
  }

  const groupIdToken = normalizeValue(entry.groupId)?.toLowerCase() ?? "";
  if (groupIdToken && groupIdToken.startsWith("space-")) {
    return false;
  }

  // Check the underlying session rows. If every related session declares an
  // explicit non-collaboration surface (telegram/wecom/discord/...) we treat
  // the entry as an external chat group and exclude it from collaboration UI.
  const relatedSessions = collectSessionsForFallbackEntry(entry, sessionsResult);
  if (relatedSessions.length === 0) {
    // No session evidence to confirm collaboration intent. Be conservative and
    // exclude only when the candidate key shape itself looks like an external
    // channel group (e.g. `agent:bot:wecom:group:<id>`).
    return candidateKeys.some((key) => /(^|:)([a-z0-9_-]+):group:/i.test(key));
  }

  return relatedSessions.every((session) => {
    const surface = normalizeValue(session.surface)?.toLowerCase() ?? null;
    const channel = normalizeValue(session.channel)?.toLowerCase() ?? null;
    const sessionKey = normalizeValue(session.key)?.toLowerCase() ?? "";
    const looksLikeChannelGroup = /(^|:)[a-z0-9_-]+:group:/.test(sessionKey);
    const space = normalizeValue(session.space) ?? null;
    const sessionGroupId = normalizeValue(session.groupId)?.toLowerCase() ?? "";
    const collaborationShaped =
      sessionKey.startsWith("space:") ||
      sessionKey.includes(":space:") ||
      sessionGroupId.startsWith("space-") ||
      Boolean(session.collaborationGroupProfile) ||
      Boolean(session.collaborationParticipationOverlay) ||
      Boolean(space);
    if (collaborationShaped) {
      return false;
    }
    // A non-collaboration `chatType: group` session usually carries an
    // external surface like `wecom`, `telegram`, etc. If we cannot identify
    // any external surface but the key shape still looks like a channel group
    // we still treat it as external.
    return Boolean(surface) || Boolean(channel) || looksLikeChannelGroup;
  });
}

function resolveFallbackEntryTitle(
  entry: WorkbenchTeamEntry,
  sessionsResult: SessionsListResult | null | undefined,
) {
  const identities = resolveLegacyEntryIdentities(entry);
  const sessionTitles = collectSessionsForFallbackEntry(entry, sessionsResult).flatMap((session) =>
    collectSessionTitleCandidates(session),
  );
  return (
    findMeaningfulTitle([entry.title, ...sessionTitles], identities) ||
    normalizeValue(entry.title) ||
    sessionTitles[0] ||
    normalizeValue(entry.groupId) ||
    normalizeValue(entry.entityId) ||
    normalizeValue(entry.id) ||
    normalizeValue(entry.key) ||
    "space"
  );
}

function isArchivedCollaborationLifecycleStatus(value: string | null | undefined) {
  return normalizeKey(value) === "archived";
}

function isArchivedManagedSpace(space: WorkbenchCollaborationSpaceSnapshot) {
  return isArchivedWorkbenchCollaborationSpace(space);
}

function isOpenBotCollaborationSpaceShapedEntry(entry: WorkbenchTeamEntry) {
  const candidateKeys = [entry.key, entry.selectionKey, ...entry.sessionKeys]
    .map((value) => normalizeValue(value))
    .filter(Boolean) as string[];
  if (
    candidateKeys.some((key) => {
      const lower = key.toLowerCase();
      return lower.startsWith("space:") || lower.includes(":space:");
    })
  ) {
    return true;
  }
  const groupId = normalizeKey(entry.groupId);
  return Boolean(groupId?.startsWith("space-"));
}

function collectActiveManagedSpaceIdentities(
  spacesResult: WorkbenchCollaborationSpacesSnapshot | undefined,
) {
  const identities = new Set<string>();
  for (const space of spacesResult?.spaces ?? []) {
    if (isArchivedManagedSpace(space)) {
      continue;
    }
    for (const raw of [space.groupId, space.id, extractSpaceIdentity(space.id)]) {
      const normalized = normalizeKey(raw);
      if (!normalized) {
        continue;
      }
      for (const variant of buildIdentityVariants(normalized)) {
        identities.add(variant.toLowerCase());
      }
    }
  }
  return identities;
}

function collectArchivedManagedSpaceIdentities(
  spacesResult: WorkbenchCollaborationSpacesSnapshot | undefined,
) {
  const identities = new Set<string>();
  for (const archivedGroupId of spacesResult?.archivedGroupIds ?? []) {
    const normalized = normalizeKey(archivedGroupId);
    if (!normalized) {
      continue;
    }
    for (const variant of buildIdentityVariants(normalized)) {
      identities.add(variant.toLowerCase());
    }
  }
  return identities;
}

function collectFallbackEntryIdentityVariants(
  entry: WorkbenchTeamEntry,
  sessionsResult: SessionsListResult | null | undefined,
) {
  const identities = new Set<string>();
  for (const identity of resolveLegacyEntryIdentities(entry)) {
    const normalized = normalizeKey(identity);
    if (!normalized) {
      continue;
    }
    for (const variant of buildIdentityVariants(normalized)) {
      identities.add(variant.toLowerCase());
    }
  }
  for (const session of collectSessionsForFallbackEntry(entry, sessionsResult)) {
    for (const identity of collectSessionIdentities(session)) {
      const normalized = normalizeKey(identity);
      if (!normalized) {
        continue;
      }
      for (const variant of buildIdentityVariants(normalized)) {
        identities.add(variant.toLowerCase());
      }
    }
  }
  return identities;
}

function isStaleCollaborationSpaceFallback(
  entry: WorkbenchTeamEntry,
  spacesResult: WorkbenchCollaborationSpacesSnapshot | undefined,
  sessionsResult: SessionsListResult | null | undefined,
) {
  if (!isOpenBotCollaborationSpaceShapedEntry(entry)) {
    return false;
  }
  const archivedManagedSpaceIdentities = collectArchivedManagedSpaceIdentities(spacesResult);
  const entryIdentities = collectFallbackEntryIdentityVariants(entry, sessionsResult);
  if (entryIdentities.size === 0) {
    return archivedManagedSpaceIdentities.size > 0;
  }
  if ([...entryIdentities].some((identity) => archivedManagedSpaceIdentities.has(identity))) {
    return true;
  }
  const activeManagedSpaceIdentities = collectActiveManagedSpaceIdentities(spacesResult);
  if (activeManagedSpaceIdentities.size === 0) {
    return false;
  }
  return [...entryIdentities].every((identity) => !activeManagedSpaceIdentities.has(identity));
}

function collectFallbackEntryGroupIdentities(entry: WorkbenchTeamEntry) {
  return uniqueValues([entry.groupId, entry.entityId, extractSpaceIdentity(entry.key)]);
}

function isArchivedFallbackEntry(
  entry: WorkbenchTeamEntry,
  sessionsResult: SessionsListResult | null | undefined,
) {
  const identities = new Set(
    collectFallbackEntryGroupIdentities(entry)
      .map((value) => normalizeKey(value))
      .filter(Boolean) as string[],
  );
  if (identities.size === 0) {
    return false;
  }
  for (const session of sessionsResult?.sessions ?? []) {
    const sessionGroupId = normalizeKey(
      session.collaborationGroupProfile?.groupId ?? session.groupId,
    );
    if (!sessionGroupId || !identities.has(sessionGroupId)) {
      continue;
    }
    if (
      isArchivedCollaborationLifecycleStatus(session.collaborationGroupProfile?.lifecycleStatus)
    ) {
      return true;
    }
  }
  return false;
}

function shouldRetainFallbackEntry(
  entry: WorkbenchTeamEntry,
  sessionsResult: SessionsListResult | null | undefined,
  spacesResult?: WorkbenchCollaborationSpacesSnapshot,
) {
  if (isArchivedFallbackEntry(entry, sessionsResult)) {
    return false;
  }
  if (isStaleCollaborationSpaceFallback(entry, spacesResult, sessionsResult)) {
    return false;
  }
  const resolvedTitle = normalizeValue(resolveFallbackEntryTitle(entry, sessionsResult));
  if (!resolvedTitle) {
    return false;
  }
  if (isGeneratedSpaceTitle(resolvedTitle, resolveLegacyEntryIdentities(entry))) {
    return false;
  }
  // External chat groups (wecom, telegram, etc.) are not OpenBot collaboration
  // spaces — keep them out of the "我的协作小组" surfaces.
  if (isExternalChannelOnlyEntry(entry, sessionsResult)) {
    return false;
  }
  return true;
}

function findManagedSpaceForFallbackEntry(
  entry: WorkbenchTeamEntry,
  spacesResult: WorkbenchCollaborationSpacesSnapshot | undefined,
  sessionsResult: SessionsListResult | null | undefined,
): WorkbenchCollaborationSpaceSnapshot | null {
  const entryIdentities = collectFallbackEntryIdentityVariants(entry, sessionsResult);
  if (entryIdentities.size === 0) {
    return null;
  }
  for (const space of spacesResult?.spaces ?? []) {
    for (const identity of resolveSpaceIdentities(space)) {
      const normalized = normalizeKey(identity);
      if (!normalized) {
        continue;
      }
      for (const variant of buildIdentityVariants(normalized)) {
        if (entryIdentities.has(variant.toLowerCase())) {
          return space;
        }
      }
    }
  }
  return null;
}

/**
 * When spaces.list is over-broad (e.g. legacy tenant catalog), managed path
 * already drops non-member spaces via `isNavEligibleManagedSpace`. Fallbacks
 * must apply the same check so session-backed entries cannot re-admit them.
 */
function shouldRetainNavEligibleFallbackEntry(
  entry: WorkbenchTeamEntry,
  sessionsResult: SessionsListResult | null | undefined,
  spacesResult: WorkbenchCollaborationSpacesSnapshot | undefined,
  navScope: EmployeeWorkbenchCollaborationScopeParams | null,
) {
  if (!shouldRetainFallbackEntry(entry, sessionsResult, spacesResult)) {
    return false;
  }
  const matchedSpace = findManagedSpaceForFallbackEntry(entry, spacesResult, sessionsResult);
  if (!matchedSpace) {
    return true;
  }
  return isNavEligibleManagedSpace(matchedSpace, navScope);
}

/**
 * Pre-transform variant of `shouldRetainFallbackEntry`. We must run the
 * external-channel guard against the raw legacy entry shape because
 * `buildFallbackTeamSpaceEntry` rewrites the selection key into a
 * `space:<id>` form, which would otherwise mask the external chat origin.
 */
function shouldRetainOriginalFallbackEntry(
  entry: WorkbenchTeamEntry,
  sessionsResult: SessionsListResult | null | undefined,
) {
  return !isExternalChannelOnlyEntry(entry, sessionsResult);
}

function isListableCollaborationMemberStatus(status?: string | null) {
  const normalized = status?.trim().toLowerCase() ?? "";
  return (
    normalized !== "removed" &&
    normalized !== "revoked" &&
    normalized !== "deleted" &&
    normalized !== "invited"
  );
}

function countListableSpaceRosterEntries(space: WorkbenchCollaborationSpaceSnapshot) {
  const humans = (space.members.humans ?? []).filter((member) =>
    isListableCollaborationMemberStatus(member.status),
  );
  const bots = (space.members.bots ?? []).filter((member) =>
    isListableCollaborationMemberStatus(member.status),
  );
  return humans.length + bots.length;
}

function isPendingCollaborationInviteStatus(status?: string | null) {
  const normalized = status?.trim().toLowerCase() ?? "";
  return normalized === "" || normalized === "pending" || normalized === "invited";
}

function countPendingSpacePresenceEntries(space: WorkbenchCollaborationSpaceSnapshot) {
  const invitedHumans = (space.members.humans ?? []).filter(
    (member) =>
      !isListableCollaborationMemberStatus(member.status) &&
      isPendingCollaborationInviteStatus(member.status),
  );
  const invitedBots = (space.members.bots ?? []).filter(
    (member) =>
      !isListableCollaborationMemberStatus(member.status) &&
      isPendingCollaborationInviteStatus(member.status),
  );
  const inviteHumans = (space.invites?.humans ?? []).filter((entry) =>
    isPendingCollaborationInviteStatus(entry.status),
  );
  const inviteBots = (space.invites?.bots ?? []).filter((entry) =>
    isPendingCollaborationInviteStatus(entry.status),
  );
  return invitedHumans.length + invitedBots.length + inviteHumans.length + inviteBots.length;
}

function shouldRetainManagedSpace(params: {
  space: WorkbenchCollaborationSpaceSnapshot;
  legacyEntry: WorkbenchTeamEntry | null;
  sessionsResult: SessionsListResult | null | undefined;
}) {
  if (isArchivedManagedSpace(params.space)) {
    return false;
  }
  if (
    countListableSpaceRosterEntries(params.space) === 0 &&
    countPendingSpacePresenceEntries(params.space) === 0
  ) {
    return false;
  }
  const resolvedTitle = resolvePreferredSpaceTitle(
    params.space,
    params.legacyEntry,
    params.sessionsResult,
    normalizeValue(params.space.groupId) ?? normalizeValue(params.space.id) ?? "space",
  );
  if (
    !isGeneratedSpaceTitle(resolvedTitle, collectSpaceIdentities(params.space, params.legacyEntry))
  ) {
    return true;
  }

  const rosterCount = countSpaceRosterEntries(params.space);
  if (rosterCount > 0) {
    return true;
  }

  const matchedSessions = collectMatchedSpaceSessions(
    params.space,
    params.legacyEntry,
    params.sessionsResult,
  );
  return matchedSessions.some((session) =>
    collectSessionTitleCandidates(session).some((title) => {
      const normalizedTitle = normalizeValue(title);
      return (
        Boolean(normalizedTitle) &&
        !isGeneratedSpaceTitle(
          normalizedTitle,
          collectSpaceIdentities(params.space, params.legacyEntry),
        )
      );
    }),
  );
}

function resolvePreferredSpaceTitle(
  space: WorkbenchCollaborationSpaceSnapshot,
  legacyEntry: WorkbenchTeamEntry | null,
  sessionsResult: SessionsListResult | null | undefined,
  fallbackKey: string,
) {
  const identities = collectSpaceIdentities(space, legacyEntry);
  const sessionTitles = collectMatchedSpaceSessions(space, legacyEntry, sessionsResult).flatMap(
    (session) => collectSessionTitleCandidates(session),
  );
  return (
    findMeaningfulTitle([space.title], identities) ||
    findMeaningfulTitle([legacyEntry?.title], identities) ||
    findMeaningfulTitle(sessionTitles, identities) ||
    normalizeValue(legacyEntry?.title) ||
    normalizeValue(space.title) ||
    sessionTitles[0] ||
    normalizeValue(space.groupId) ||
    normalizeValue(space.id) ||
    fallbackKey
  );
}

function resolveEntryUpdatedAt(
  sessionKeys: string[],
  sessionsResult: SessionsListResult | null | undefined,
  fallback: number | null | undefined,
  matchedSessions: SessionsListResult["sessions"] = [],
) {
  const destinations = new Set(sessionKeys.map((key) => key.toLowerCase()));
  let newest: number | null = null;
  for (const session of [...matchedSessions, ...(sessionsResult?.sessions ?? [])]) {
    const sessionKey = normalizeValue(session.key);
    if (!sessionKey) {
      continue;
    }
    const canonical = canonicalizeWorkbenchChatSessionKey(sessionKey).toLowerCase();
    if (!destinations.has(canonical) && !destinations.has(sessionKey.toLowerCase())) {
      continue;
    }
    const updatedAt = session.updatedAt ?? 0;
    if (!updatedAt) {
      continue;
    }
    if (newest == null || updatedAt > newest) {
      newest = updatedAt;
    }
  }
  return newest ?? fallback ?? null;
}

function resolveEntryActivity(updatedAt: number | null, fallback: WorkbenchTeamEntry | null) {
  if (fallback?.activity) {
    return fallback.activity;
  }
  if (!updatedAt) {
    return "idle" as const;
  }
  const ageMs = Date.now() - updatedAt;
  if (ageMs <= 10 * 60 * 1000) {
    return "active" as const;
  }
  if (ageMs <= 2 * 60 * 60 * 1000) {
    return "warm" as const;
  }
  return "idle" as const;
}

function buildTeamSpaceFromManagedSpace(
  space: WorkbenchCollaborationSpaceSnapshot,
  legacyEntry: WorkbenchTeamEntry | null,
  sessionsResult: SessionsListResult | null | undefined,
): WorkbenchTeamEntry {
  const spaceId = normalizeValue(space.id) ?? normalizeValue(space.groupId) ?? "";
  const groupId = normalizeValue(space.groupId) ?? spaceId;
  const key = toCollaborationSpaceSessionKey(groupId || spaceId) || `space:${spaceId || groupId}`;
  const sessionKeys = collectSpaceSessionKeys(space, legacyEntry, sessionsResult);
  const updatedAt = resolveEntryUpdatedAt(
    sessionKeys,
    sessionsResult,
    legacyEntry?.updatedAt,
    collectMatchedSpaceSessions(space, legacyEntry, sessionsResult),
  );
  const title = resolvePreferredSpaceTitle(space, legacyEntry, sessionsResult, groupId || key);
  const entityId = legacyEntry?.entityId || spaceId || groupId || key;
  const ownerUserId =
    normalizeValue(space.operatingState?.governance?.ownerUserId) ??
    normalizeValue(space.ownerUserId) ??
    null;

  return {
    id: spaceId || groupId || key,
    key,
    selectionKey: key,
    sessionKeys,
    kind: "space",
    badge: legacyEntry?.badge ?? "GR",
    title,
    subtitle: legacyEntry?.subtitle ?? "",
    detail: legacyEntry?.detail ?? "",
    meta: legacyEntry?.meta ?? "",
    updatedAt,
    unreadCount: legacyEntry?.unreadCount ?? 0,
    activity: resolveEntryActivity(updatedAt, legacyEntry),
    saved: legacyEntry?.saved ?? true,
    channelId: legacyEntry?.channelId ?? null,
    directoryGroupId: legacyEntry?.directoryGroupId ?? groupId,
    entityId,
    groupId,
    ownerUserId,
  };
}

function buildFallbackTeamSpaceEntry(
  entry: WorkbenchTeamEntry,
  sessionsResult: SessionsListResult | null | undefined,
): WorkbenchTeamEntry {
  const rawSelectionKey = normalizeValue(entry.selectionKey) ?? normalizeValue(entry.key) ?? "";
  const spaceIdentity =
    extractSpaceIdentity(rawSelectionKey) ??
    extractSpaceIdentity(entry.key) ??
    normalizeValue(entry.groupId) ??
    normalizeValue(entry.entityId) ??
    normalizeValue(entry.id);
  const selectionKey =
    rawSelectionKey.startsWith("space:") || !spaceIdentity
      ? rawSelectionKey
      : `space:${spaceIdentity}`;
  const entityId =
    normalizeValue(entry.entityId) ??
    extractSpaceIdentity(selectionKey) ??
    extractSpaceIdentity(entry.key) ??
    normalizeValue(entry.id) ??
    selectionKey;
  const groupId =
    normalizeValue(entry.groupId) ??
    extractSpaceIdentity(selectionKey) ??
    extractSpaceIdentity(entry.key) ??
    entityId;
  return {
    ...entry,
    key: selectionKey,
    selectionKey,
    title: resolveFallbackEntryTitle(entry, sessionsResult),
    entityId,
    groupId,
    sessionKeys: collectSpaceSessionKeys(
      {
        id: entityId,
        groupId,
        title: entry.title,
        members: { humans: [], bots: [] },
        invites: { humans: [], bots: [] },
      },
      entry,
      sessionsResult,
    ),
  };
}

/**
 * Orders collaboration spaces "owner-first": groups the current user created
 * (ownerUserId === currentUserId) come before groups the user merely joined.
 * Ordering is a STABLE partition — within each partition the incoming relative
 * order is preserved (managed spaces before session-only fallbacks, recency
 * already applied upstream), so only the owner/joined split is introduced here.
 */
function sortTeamSpacesByOwnership(
  teamSpaces: WorkbenchTeamEntry[],
  currentUserId: string | null | undefined,
): WorkbenchTeamEntry[] {
  const normalizedCurrentUserId = normalizeKey(currentUserId);
  if (!normalizedCurrentUserId) {
    return teamSpaces;
  }
  const isOwnedByCurrentUser = (entry: WorkbenchTeamEntry) =>
    normalizeKey(entry.ownerUserId) === normalizedCurrentUserId;
  const owned = teamSpaces.filter((entry) => isOwnedByCurrentUser(entry));
  const joined = teamSpaces.filter((entry) => !isOwnedByCurrentUser(entry));
  return [...owned, ...joined];
}

function isNavEligibleManagedSpace(
  space: WorkbenchCollaborationSpaceSnapshot,
  scope: EmployeeWorkbenchCollaborationScopeParams | null,
): boolean {
  // Invite-only / owned-bot-approval spaces stay in spaces.list for todos +
  // deep-link governance, but must not appear as chat-ready nav entries.
  if (!scope) {
    return true;
  }
  if (!scope.userId?.trim() && !scope.userEmail?.trim()) {
    return true;
  }
  return isEmployeeWorkbenchCollaborationSpaceVisible(space, scope);
}

export function buildWorkbenchCollaborationReadModel(input: {
  spacesResult?: WorkbenchCollaborationSpacesSnapshot;
  teamSpaces: WorkbenchTeamEntry[];
  sessionsResult?: SessionsListResult | null;
  currentUserId?: string | null;
  currentUserEmail?: string | null;
  seatSpaceIds?: readonly string[] | null;
}): WorkbenchCollaborationReadModel {
  const navScope: EmployeeWorkbenchCollaborationScopeParams | null =
    input.currentUserId || input.currentUserEmail
      ? {
          userId: input.currentUserId ?? null,
          userEmail: input.currentUserEmail ?? null,
          seatSpaceIds: input.seatSpaceIds ?? null,
          grantsHydrated: true,
        }
      : null;
  const spaces = input.spacesResult?.spaces ?? [];
  if (spaces.length === 0) {
    const fallbackTeamSpaces = input.teamSpaces
      // Filter on the original entry so we can still see the raw session-key
      // shape (e.g. `agent:bot:wecom:group:<id>`) before
      // `buildFallbackTeamSpaceEntry` aggressively rewrites it as a
      // `space:`-prefixed selection key.
      .filter((entry) => shouldRetainOriginalFallbackEntry(entry, input.sessionsResult))
      .map((entry) => buildFallbackTeamSpaceEntry(entry, input.sessionsResult))
      .filter((entry) =>
        shouldRetainNavEligibleFallbackEntry(
          entry,
          input.sessionsResult,
          input.spacesResult,
          navScope,
        ),
      );
    const orderedFallbackTeamSpaces = sortTeamSpacesByOwnership(
      fallbackTeamSpaces,
      input.currentUserId,
    );
    return {
      teamSpaces: orderedFallbackTeamSpaces,
      savedTeamCount: orderedFallbackTeamSpaces.filter((entry) => entry.saved).length,
    };
  }

  const legacyIndexes = buildLegacyEntryIndexes(input.teamSpaces);
  const matchedLegacyEntries = new Set<WorkbenchTeamEntry>();
  const teamSpaces = spaces.flatMap((space) => {
    if (!isNavEligibleManagedSpace(space, navScope)) {
      return [];
    }
    const legacyEntry =
      findMatchingLegacyEntry(space, legacyIndexes) ??
      findMatchingLegacyEntryBySessionContext({
        space,
        teamSpaces: input.teamSpaces,
        sessionsResult: input.sessionsResult,
        matchedLegacyEntries,
      });
    if (legacyEntry) {
      matchedLegacyEntries.add(legacyEntry);
    }
    if (!shouldRetainManagedSpace({ space, legacyEntry, sessionsResult: input.sessionsResult })) {
      return [];
    }
    return [buildTeamSpaceFromManagedSpace(space, legacyEntry, input.sessionsResult)];
  });
  const fallbackTeamSpaces = input.teamSpaces
    .filter((entry) => !matchedLegacyEntries.has(entry))
    // Same pre-transform filter as above so external channel groups never
    // reach the workbench collaboration list.
    .filter((entry) => shouldRetainOriginalFallbackEntry(entry, input.sessionsResult))
    .map((entry) => buildFallbackTeamSpaceEntry(entry, input.sessionsResult))
    .filter((entry) =>
      shouldRetainNavEligibleFallbackEntry(
        entry,
        input.sessionsResult,
        input.spacesResult,
        navScope,
      ),
    );
  const mergedTeamSpaces = sortTeamSpacesByOwnership(
    [...teamSpaces, ...fallbackTeamSpaces],
    input.currentUserId,
  );
  return {
    teamSpaces: mergedTeamSpaces,
    savedTeamCount: mergedTeamSpaces.filter((entry) => entry.saved).length,
  };
}
