/**
 * Apply MemoryRecallDenyWatermark to search / inject results (plan §8.5.3).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { resolveRecallDenyStoreDir } from "../conversations/memory-recall-deny.js";
import type { MemoryRecallDenyWatermark } from "../conversations/types.js";

export type RecallDenySets = {
  sourceIdentityIds: Set<string>;
  messageIds: Set<string>;
  /** Normalized session files with any deny. */
  sessionFiles: Set<string>;
};

export function emptyRecallDenySets(): RecallDenySets {
  return {
    sourceIdentityIds: new Set(),
    messageIds: new Set(),
    sessionFiles: new Set(),
  };
}

export async function loadRecallDenySets(dataRoot: string | null): Promise<RecallDenySets> {
  const sets = emptyRecallDenySets();
  if (!dataRoot) {
    return sets;
  }
  const storeDir = resolveRecallDenyStoreDir(dataRoot);
  const deniesDir = path.join(storeDir, "denies");
  let names: string[];
  try {
    names = await fs.readdir(deniesDir);
  } catch {
    return sets;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = await fs.readFile(path.join(deniesDir, name), "utf8");
      const deny = JSON.parse(raw) as MemoryRecallDenyWatermark;
      sets.sessionFiles.add(deny.sessionFile.split("\\").join("/"));
      for (const id of deny.deniedSourceIdentityIds ?? []) {
        sets.sourceIdentityIds.add(id);
      }
      for (const id of deny.deniedMessageIds ?? []) {
        sets.messageIds.add(id);
      }
    } catch {
      // skip corrupt
    }
  }
  return sets;
}

export function isSourceIdentityDenied(
  sourceIdentityId: string | undefined | null,
  sets: RecallDenySets,
): boolean {
  if (!sourceIdentityId) {
    return false;
  }
  return sets.sourceIdentityIds.has(sourceIdentityId);
}

/**
 * True when a search hit should be suppressed.
 * Matches msrc:// identity paths, explicit sourceIdentityId, or message id markers.
 */
export function isSearchHitDenied(params: {
  path?: string;
  snippet?: string;
  sourceIdentityIds?: string[];
  messageIds?: string[];
  sets: RecallDenySets;
}): boolean {
  for (const id of params.sourceIdentityIds ?? []) {
    if (params.sets.sourceIdentityIds.has(id)) {
      return true;
    }
  }
  for (const id of params.messageIds ?? []) {
    if (params.sets.messageIds.has(id)) {
      return true;
    }
  }
  const p = (params.path ?? "").split("\\").join("/");
  if (p.startsWith("msrc://")) {
    const id = p.slice("msrc://".length);
    if (params.sets.sourceIdentityIds.has(id)) {
      return true;
    }
  }
  const snippet = params.snippet ?? "";
  // Path form sessions/... may still surface denied-only content if identity embedded.
  for (const id of params.sets.sourceIdentityIds) {
    if (p.includes(id) || snippet.includes(id)) {
      return true;
    }
  }
  // Message-id denies (chat.restore without sealed source identities yet).
  for (const id of params.sets.messageIds) {
    if (!id || id.length < 2) {
      continue;
    }
    if (p.includes(id) || snippet.includes(id)) {
      return true;
    }
  }
  return false;
}

/** Extract deny-relevant ids from a MemorySearchResult for filter meta. */
export function extractMemorySearchDenyMeta(hit: {
  path: string;
  snippet?: string;
  evidence?: Array<{ id?: string; uri?: string }>;
  explainability?: { evidenceRefs?: string[]; supportingAtoms?: string[] };
}): { sourceIdentityIds?: string[]; messageIds?: string[] } {
  const sourceIdentityIds: string[] = [];
  const messageIds: string[] = [];
  for (const ev of hit.evidence ?? []) {
    if (typeof ev.id === "string" && ev.id.trim()) {
      messageIds.push(ev.id.trim());
    }
    const uri = typeof ev.uri === "string" ? ev.uri : "";
    if (uri.startsWith("msrc://")) {
      sourceIdentityIds.push(uri.slice("msrc://".length));
    }
  }
  for (const ref of hit.explainability?.evidenceRefs ?? []) {
    if (typeof ref !== "string" || !ref.trim()) {
      continue;
    }
    if (ref.startsWith("msrc://")) {
      sourceIdentityIds.push(ref.slice("msrc://".length));
    } else {
      messageIds.push(ref.trim());
    }
  }
  for (const atom of hit.explainability?.supportingAtoms ?? []) {
    if (typeof atom === "string" && atom.trim()) {
      messageIds.push(atom.trim());
    }
  }
  return { sourceIdentityIds, messageIds };
}

export function filterSearchHitsByDeny<T extends { path: string; snippet?: string }>(
  hits: T[],
  sets: RecallDenySets,
  resolveMeta?: (hit: T) => { sourceIdentityIds?: string[]; messageIds?: string[] },
): T[] {
  if (sets.sourceIdentityIds.size === 0 && sets.messageIds.size === 0) {
    return hits;
  }
  return hits.filter((hit) => {
    const meta = resolveMeta?.(hit) ?? {};
    return !isSearchHitDenied({
      path: hit.path,
      snippet: hit.snippet,
      sourceIdentityIds: meta.sourceIdentityIds,
      messageIds: meta.messageIds,
      sets,
    });
  });
}

/** Filter Memory Center rows by denied atom ids and/or denied source markers in summary. */
export function filterMemoryCenterItemsByDeny<T extends { id: string; summary?: string }>(
  items: T[],
  params: {
    deniedAtomIds: Set<string>;
    sets: RecallDenySets;
  },
): T[] {
  if (
    params.deniedAtomIds.size === 0 &&
    params.sets.sourceIdentityIds.size === 0 &&
    params.sets.messageIds.size === 0
  ) {
    return items;
  }
  return items.filter((item) => {
    if (params.deniedAtomIds.has(item.id)) {
      return false;
    }
    // Fail closed if summary embeds a denied source identity (rare).
    for (const id of params.sets.sourceIdentityIds) {
      if (item.summary?.includes(id)) {
        return false;
      }
    }
    return true;
  });
}
