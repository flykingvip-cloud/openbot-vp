import type { SessionEntry } from "../../config/sessions.js";

function findStoreEntry(
  store: Record<string, SessionEntry | undefined>,
  target: string,
): SessionEntry | undefined {
  const exact = store[target];
  if (exact) {
    return exact;
  }
  return Object.entries(store).find(([key]) => key.trim().toLowerCase() === target)?.[1];
}

/**
 * Live collaboration history lives only on `space:<groupId>`.
 * Agent mirrors are leftover sources for heal/retire, not destinations.
 */
export function findCollaborationSpaceStoreEntry(
  store: Record<string, SessionEntry | undefined>,
  rawSessionKey: string,
): SessionEntry | undefined {
  const normalizedKey = rawSessionKey.trim().toLowerCase();
  return findStoreEntry(store, normalizedKey);
}

export function listRedundantGroupMirrorKeys(
  store: Record<string, SessionEntry | undefined>,
  groupId: string,
): string[] {
  const normalizedGroupId = groupId.trim().toLowerCase();
  if (!normalizedGroupId) {
    return [];
  }
  const canonical = `space:${normalizedGroupId}`;
  const suffix = `:space:${normalizedGroupId}`;
  return Object.keys(store).filter((key) => {
    const normalized = key.trim().toLowerCase();
    if (!normalized || normalized === canonical) {
      return false;
    }
    return normalized.endsWith(suffix);
  });
}
