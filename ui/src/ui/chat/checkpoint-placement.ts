/**
 * Read-only checkpoint divider placement projection.
 *
 * Shared by chat render (`buildChatItems`) and P0 visibility diagnostics so
 * `inlineVisible` matches what the divider actually paints. Does NOT change
 * restore RPC, boundary retarget for rollback, restorable flags, or guess
 * widening beyond the existing UI rules copied from views/chat.ts.
 */

import {
  isTranscriptStartBoundary,
  resolveEffectiveRestoreBoundaryMessageId,
} from "../../../../src/auto-reply/reply/chat-checkpoint-boundary.ts";
import type { ChatCheckpoint } from "../types/chat-types.ts";
import { extractText } from "./message-extract.ts";
import { normalizeMessage } from "./message-normalizer.ts";

/** Must stay aligned with historical CHAT_CHECKPOINT_VISIBLE_USER_TURNS. */
export const CHAT_CHECKPOINT_VISIBLE_USER_TURNS = 2;

export type CheckpointPlacementVia = "direct" | "unused" | "tip_fallback";

export type CheckpointPlacement = {
  checkpointId: string;
  /** History index of the user turn the divider renders before. */
  placeBeforeUserIndex: number;
  via: CheckpointPlacementVia;
};

export type CheckpointPlacementProjection = {
  /** Collapsed history used for placement (same as render). */
  history: unknown[];
  /** Recent user indexes (newest first), capped at visibleUserTurns. */
  recentUserIndexes: number[];
  /** checkpointId → placement. */
  byCheckpointId: Map<string, CheckpointPlacement>;
  /** userIndex → checkpoint placed before that row. */
  beforeUserIndex: Map<number, ChatCheckpoint>;
};

/** Extract a transcript message id usable to match a checkpoint boundary. */
export function getMessageIdForCheckpoint(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const m = message as Record<string, unknown>;
  if (typeof m.transcriptEntryId === "string" && m.transcriptEntryId) {
    return m.transcriptEntryId;
  }
  if (typeof m.id === "string" && m.id) {
    return m.id;
  }
  if (typeof m.messageId === "string" && m.messageId) {
    return m.messageId;
  }
  return undefined;
}

/**
 * History index of the user instruction a checkpoint undoes (divider renders
 * immediately before this row).
 */
export function resolveCheckpointPlaceBeforeUserIndex(
  history: unknown[],
  boundaryMessageId: string,
): number | undefined {
  if (isTranscriptStartBoundary(boundaryMessageId)) {
    for (let hi = 0; hi < history.length; hi++) {
      if (normalizeMessage(history[hi]).role.toLowerCase() === "user") {
        return hi;
      }
    }
    return undefined;
  }
  const boundaryIndex = history.findIndex(
    (msg) => getMessageIdForCheckpoint(msg) === boundaryMessageId,
  );
  if (boundaryIndex < 0) {
    return undefined;
  }
  for (let hi = boundaryIndex + 1; hi < history.length; hi++) {
    if (normalizeMessage(history[hi]).role.toLowerCase() === "user") {
      return hi;
    }
  }
  if (normalizeMessage(history[boundaryIndex]).role.toLowerCase() === "user") {
    return boundaryIndex;
  }
  return undefined;
}

/** True when restoring this boundary would remove at least one transcript row. */
export function checkpointBoundaryCanTruncate(
  history: unknown[],
  boundaryMessageId: string | undefined,
): boolean {
  if (!boundaryMessageId) {
    return false;
  }
  if (isTranscriptStartBoundary(boundaryMessageId)) {
    return history.length > 0;
  }
  const boundaryIndex = history.findIndex(
    (msg) => getMessageIdForCheckpoint(msg) === boundaryMessageId,
  );
  return boundaryIndex >= 0 && boundaryIndex < history.length - 1;
}

function visibleUserTurnText(message: unknown): string | null {
  if (normalizeMessage(message).role.toLowerCase() !== "user") {
    return null;
  }
  const text = extractText(message)?.trim() ?? "";
  return text || null;
}

/** One send must not paint twice when optimistic + persisted rows both land. */
export function collapseConsecutiveDuplicateUserTurns(history: unknown[]): unknown[] {
  const collapsed: unknown[] = [];
  for (const message of history) {
    const text = visibleUserTurnText(message);
    const previous = collapsed[collapsed.length - 1];
    if (text && previous && visibleUserTurnText(previous) === text) {
      collapsed[collapsed.length - 1] = message;
      continue;
    }
    collapsed.push(message);
  }
  return collapsed;
}

export type ProjectCheckpointPlacementsOptions = {
  visibleUserTurns?: number;
};

/**
 * Pure placement projection mirroring views/chat.ts `buildChatItems` rules:
 * direct boundary match → unused-slot fill → tip/legacy fallback.
 */
export function projectCheckpointPlacements(
  checkpoints: ChatCheckpoint[],
  messages: unknown[],
  opts?: ProjectCheckpointPlacementsOptions,
): CheckpointPlacementProjection {
  const visibleTurns = opts?.visibleUserTurns ?? CHAT_CHECKPOINT_VISIBLE_USER_TURNS;
  const history = collapseConsecutiveDuplicateUserTurns(Array.isArray(messages) ? messages : []);
  const cps = Array.isArray(checkpoints) ? checkpoints : [];

  const recentUserIndexes: number[] = [];
  for (let hi = history.length - 1; hi >= 0; hi--) {
    if (normalizeMessage(history[hi]).role.toLowerCase() !== "user") {
      continue;
    }
    recentUserIndexes.push(hi);
    if (recentUserIndexes.length >= visibleTurns) {
      break;
    }
  }
  const visibleUserIndexSet = new Set(recentUserIndexes);
  const checkpointBeforeRawIndex = new Map<number, ChatCheckpoint>();
  const checkpointBoundaryIndex = new Map<string, number>();
  const placementVia = new Map<string, CheckpointPlacementVia>();
  const historyRoles = history.map((msg) => ({
    id: getMessageIdForCheckpoint(msg),
    role: normalizeMessage(msg).role.toLowerCase(),
  }));

  for (const cp of cps) {
    if (!cp.boundaryMessageId) {
      continue;
    }
    if (!checkpointBoundaryCanTruncate(history, cp.boundaryMessageId)) {
      continue;
    }
    const boundaryIndex = isTranscriptStartBoundary(cp.boundaryMessageId)
      ? -1
      : history.findIndex((msg) => getMessageIdForCheckpoint(msg) === cp.boundaryMessageId);
    if (boundaryIndex >= 0) {
      checkpointBoundaryIndex.set(cp.checkpointId, boundaryIndex);
    }
    const placeBefore = resolveCheckpointPlaceBeforeUserIndex(history, cp.boundaryMessageId);
    if (placeBefore === undefined || !visibleUserIndexSet.has(placeBefore)) {
      continue;
    }
    const existing = checkpointBeforeRawIndex.get(placeBefore);
    if (!existing) {
      checkpointBeforeRawIndex.set(placeBefore, cp);
      placementVia.set(cp.checkpointId, "direct");
      continue;
    }
    const existingBoundary = checkpointBoundaryIndex.get(existing.checkpointId) ?? -1;
    const nextBoundary = checkpointBoundaryIndex.get(cp.checkpointId) ?? -1;
    const existingDistance =
      existingBoundary >= 0 && existingBoundary < placeBefore
        ? placeBefore - existingBoundary
        : Number.POSITIVE_INFINITY;
    const nextDistance =
      nextBoundary >= 0 && nextBoundary < placeBefore
        ? placeBefore - nextBoundary
        : Number.POSITIVE_INFINITY;
    if (
      nextDistance < existingDistance ||
      (nextDistance === existingDistance && cp.createdAt.localeCompare(existing.createdAt) >= 0)
    ) {
      placementVia.delete(existing.checkpointId);
      checkpointBeforeRawIndex.set(placeBefore, cp);
      placementVia.set(cp.checkpointId, "direct");
    }
  }

  const placedCheckpointIdSet = new Set(
    [...checkpointBeforeRawIndex.values()].map((cp) => cp.checkpointId),
  );
  const unusedCheckpoints = cps
    .filter((cp) => cp.boundaryMessageId && !placedCheckpointIdSet.has(cp.checkpointId))
    .filter((cp) => {
      const boundaryIndex = history.findIndex(
        (msg) => getMessageIdForCheckpoint(msg) === cp.boundaryMessageId,
      );
      return boundaryIndex < 0 || boundaryIndex < history.length - 1;
    })
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const userIndex of recentUserIndexes) {
    if (checkpointBeforeRawIndex.has(userIndex)) {
      continue;
    }
    let laterCreatedAt: string | undefined;
    for (const [placedIndex, placed] of checkpointBeforeRawIndex) {
      if (placedIndex > userIndex) {
        if (!laterCreatedAt || placed.createdAt < laterCreatedAt) {
          laterCreatedAt = placed.createdAt;
        }
      }
    }
    const candidateIndex = unusedCheckpoints.findIndex((cp) => {
      if (placedCheckpointIdSet.has(cp.checkpointId)) {
        return false;
      }
      if (laterCreatedAt && cp.createdAt >= laterCreatedAt) {
        return false;
      }
      if (!cp.boundaryMessageId) {
        return false;
      }
      const placeBefore = resolveCheckpointPlaceBeforeUserIndex(history, cp.boundaryMessageId);
      return placeBefore === undefined || placeBefore === userIndex;
    });
    if (candidateIndex < 0) {
      continue;
    }
    const [candidate] = unusedCheckpoints.splice(candidateIndex, 1);
    if (!candidate) {
      continue;
    }
    placedCheckpointIdSet.add(candidate.checkpointId);
    checkpointBeforeRawIndex.set(userIndex, candidate);
    placementVia.set(candidate.checkpointId, "unused");
  }

  if (checkpointBeforeRawIndex.size === 0 && recentUserIndexes.length > 0) {
    const latestUserIndex = recentUserIndexes[0];
    let fallback: ChatCheckpoint | undefined;
    let fallbackRank = -1;
    for (const cp of cps) {
      const boundaryMessageId = resolveEffectiveRestoreBoundaryMessageId(
        cp.boundaryMessageId,
        historyRoles,
      );
      const canTruncate = checkpointBoundaryCanTruncate(history, boundaryMessageId);
      if (!canTruncate) {
        continue;
      }
      const boundaryIndex = isTranscriptStartBoundary(boundaryMessageId)
        ? -1
        : history.findIndex((msg) => getMessageIdForCheckpoint(msg) === boundaryMessageId);
      const beforeLatestUser = boundaryIndex >= 0 && boundaryIndex < latestUserIndex;
      const rank = (canTruncate ? 4 : 0) + (beforeLatestUser ? 2 : 0);
      if (
        !fallback ||
        rank > fallbackRank ||
        (rank === fallbackRank && cp.createdAt.localeCompare(fallback.createdAt) >= 0)
      ) {
        fallback = cp;
        fallbackRank = rank;
      }
    }
    if (fallback) {
      checkpointBeforeRawIndex.set(latestUserIndex, fallback);
      placementVia.set(fallback.checkpointId, "tip_fallback");
    }
  }

  const byCheckpointId = new Map<string, CheckpointPlacement>();
  for (const [placeBeforeUserIndex, cp] of checkpointBeforeRawIndex) {
    byCheckpointId.set(cp.checkpointId, {
      checkpointId: cp.checkpointId,
      placeBeforeUserIndex,
      via: placementVia.get(cp.checkpointId) ?? "direct",
    });
  }

  return {
    history,
    recentUserIndexes,
    byCheckpointId,
    beforeUserIndex: checkpointBeforeRawIndex,
  };
}
