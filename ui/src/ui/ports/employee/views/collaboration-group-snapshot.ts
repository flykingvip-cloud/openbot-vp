import { toCollaborationSpaceSessionKey } from "../../../../../../src/sessions/session-key-utils.ts";
import type {
  WorkbenchCollaborationSpaceSnapshot,
  WorkbenchCollaborationSpacesSnapshot,
} from "./workbench-types.ts";

type MinimalTeamSpaceEntry = {
  id?: string;
  key: string;
  sessionKeys?: string[];
  groupId?: string | null;
  selectionKey?: string | null;
  entityId?: string | null;
};

type MinimalSessionsResult = {
  sessions?: Array<{
    key: string;
    updatedAt?: number | null;
  }>;
} | null;

export type CollaborationGroupSnapshot = {
  selectionKey: string | null;
  spaceId: string | null;
  groupId: string | null;
  managedSpace: WorkbenchCollaborationSpaceSnapshot | null;
  teamSpaceEntry: MinimalTeamSpaceEntry | null;
  sessionKeys: string[];
  preferredSessionKey: string | null;
};

function normalizeValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function extractSpaceAliasId(value: string | null | undefined) {
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

function findManagedSpaceByIdentity(
  spacesResult: WorkbenchCollaborationSpacesSnapshot,
  candidateId: string | null | undefined,
) {
  const normalizedCandidate = normalizeValue(candidateId);
  if (!normalizedCandidate) {
    return null;
  }
  return (
    spacesResult?.spaces?.find((entry) => {
      const spaceId = normalizeValue(entry.id);
      const groupId = normalizeValue(entry.groupId);
      return spaceId === normalizedCandidate || groupId === normalizedCandidate;
    }) ?? null
  );
}

function findTeamSpaceEntry(
  teamSpaces: MinimalTeamSpaceEntry[] | null | undefined,
  candidateKey: string | null | undefined,
  candidateId: string | null | undefined,
) {
  const normalizedKey = normalizeValue(candidateKey);
  const normalizedId = normalizeValue(candidateId);
  return (
    teamSpaces?.find((entry) => {
      const entrySelectionKey = normalizeValue(entry.selectionKey) ?? normalizeValue(entry.key);
      const entryEntityId = normalizeValue(entry.entityId) ?? normalizeValue(entry.id);
      const entryGroupId = normalizeValue(entry.groupId);
      const entrySpaceAliasId =
        extractSpaceAliasId(entrySelectionKey) ?? extractSpaceAliasId(entry.key);
      if (normalizedKey) {
        if (entrySelectionKey === normalizedKey || normalizeValue(entry.key) === normalizedKey) {
          return true;
        }
      }
      if (normalizedId) {
        return (
          entryEntityId === normalizedId ||
          entryGroupId === normalizedId ||
          entrySpaceAliasId === normalizedId
        );
      }
      return false;
    }) ?? null
  );
}

export function resolveCollaborationGroupSnapshotFromSelection(params: {
  selectionKey: string | null | undefined;
  activeSessionKey: string | null | undefined;
  spacesResult: WorkbenchCollaborationSpacesSnapshot;
  teamSpaces?: MinimalTeamSpaceEntry[] | null;
  sessionsResult?: MinimalSessionsResult;
}): CollaborationGroupSnapshot | null {
  const candidateKeys = [params.selectionKey, params.activeSessionKey]
    .map((value) => normalizeValue(value))
    .filter(Boolean) as string[];

  for (const candidateKey of candidateKeys) {
    const candidateSpaceAliasId = extractSpaceAliasId(candidateKey);
    const managedSpace =
      findManagedSpaceByIdentity(params.spacesResult, candidateSpaceAliasId) ??
      findManagedSpaceByIdentity(params.spacesResult, candidateKey);
    const teamSpaceEntry =
      findTeamSpaceEntry(params.teamSpaces, candidateKey, candidateSpaceAliasId) ??
      findTeamSpaceEntry(
        params.teamSpaces,
        candidateKey,
        managedSpace?.id ?? managedSpace?.groupId,
      );

    const spaceId =
      normalizeValue(managedSpace?.id) ??
      extractSpaceAliasId(teamSpaceEntry?.selectionKey ?? teamSpaceEntry?.key) ??
      normalizeValue(teamSpaceEntry?.id) ??
      candidateSpaceAliasId;
    const groupId =
      normalizeValue(managedSpace?.groupId) ?? normalizeValue(teamSpaceEntry?.groupId) ?? spaceId;

    if (!spaceId && !groupId && !teamSpaceEntry && !managedSpace) {
      continue;
    }

    const destinationKey =
      toCollaborationSpaceSessionKey(groupId || spaceId) ||
      toCollaborationSpaceSessionKey(candidateSpaceAliasId);
    const preferredSessionKey = destinationKey || candidateKey;
    return {
      selectionKey: destinationKey || normalizeValue(teamSpaceEntry?.selectionKey) || candidateKey,
      spaceId,
      groupId,
      managedSpace,
      teamSpaceEntry,
      sessionKeys: preferredSessionKey ? [preferredSessionKey] : [],
      preferredSessionKey,
    };
  }
  return null;
}

export function resolveCollaborationGroupSnapshot(params: {
  selectionKey: string | null | undefined;
  activeSessionKey: string | null | undefined;
  spacesResult: WorkbenchCollaborationSpacesSnapshot;
  teamSpaces?: MinimalTeamSpaceEntry[] | null;
  sessionsResult?: MinimalSessionsResult;
}) {
  return resolveCollaborationGroupSnapshotFromSelection(params);
}
