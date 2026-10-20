import type { WorkbenchCollaborationSpacesSnapshot } from "./views/workbench-types.ts";

export type CollaborationScopedMap<T> = Record<string, T>;

function normalizeScopeId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function resolveCollaborationScopeIdsForSpace(
  spacesResult: WorkbenchCollaborationSpacesSnapshot,
  spaceId: string | null | undefined,
) {
  const normalizedSpaceId = normalizeScopeId(spaceId);
  if (!normalizedSpaceId) {
    return [];
  }
  const managedSpace =
    spacesResult?.spaces?.find((entry) => normalizeScopeId(entry.id) === normalizedSpaceId) ?? null;
  const scopeIds = new Set<string>();
  scopeIds.add(normalizedSpaceId);
  const groupId = normalizeScopeId(managedSpace?.groupId);
  if (groupId) {
    scopeIds.add(groupId);
  }
  return [...scopeIds];
}

export function readCollaborationScopedValue<T>(
  map: CollaborationScopedMap<T> | null | undefined,
  scopeIds: Iterable<string>,
) {
  if (!map) {
    return null;
  }
  for (const scopeId of scopeIds) {
    const normalized = normalizeScopeId(scopeId);
    if (!normalized) {
      continue;
    }
    if (normalized in map) {
      return map[normalized] ?? null;
    }
  }
  return null;
}

export function hasCollaborationScopedValue<T>(
  map: CollaborationScopedMap<T> | null | undefined,
  scopeIds: Iterable<string>,
) {
  return readCollaborationScopedValue(map, scopeIds) !== null;
}

export function writeCollaborationScopedValue<T>(
  map: CollaborationScopedMap<T>,
  scopeIds: Iterable<string>,
  value: T,
) {
  for (const scopeId of scopeIds) {
    const normalized = normalizeScopeId(scopeId);
    if (!normalized) {
      continue;
    }
    map[normalized] = value;
  }
  return map;
}
