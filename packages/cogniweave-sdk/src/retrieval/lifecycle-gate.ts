import type { AtomStatus, MemoryAtom } from "../models.js";

/**
 * CW2-P4-01 retrieval lifecycle gate — ACL-safe query stage (before FTS/vector).
 */

export type AtomLifecycleFilterReason = "deprecated" | "tombstoned" | "tentative" | "conflicted";

export type AtomRetrievability = {
  retrievable: boolean;
  reason?: AtomLifecycleFilterReason;
};

/** Injection-grade statuses excluded unless explicitly opted in. */
export const DEFAULT_QUERY_EXCLUDE_STATUSES: AtomStatus[] = ["deprecated"];

export function isAtomRetrievable(
  atom: MemoryAtom,
  opts?: {
    includeTentative?: boolean;
    includeConflicted?: boolean;
  },
): AtomRetrievability {
  if (atom.lifecycle?.tombstonedAt) {
    return { retrievable: false, reason: "tombstoned" };
  }
  if (atom.state.status === "deprecated" || atom.lifecycle?.deprecatedAt) {
    return { retrievable: false, reason: "deprecated" };
  }
  if (atom.state.status === "tentative" && !opts?.includeTentative) {
    return { retrievable: false, reason: "tentative" };
  }
  if (atom.state.status === "conflicted" && !opts?.includeConflicted) {
    return { retrievable: false, reason: "conflicted" };
  }
  return { retrievable: true };
}
