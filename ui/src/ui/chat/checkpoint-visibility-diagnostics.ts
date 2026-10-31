/**
 * P0 observability: classify why a checkpoint may not render an inline divider.
 *
 * Read-only. Does NOT change placement, restore targeting, or restorable flags.
 * `boundary_filtered` is reserved; precise control-channel strip detection is P1.
 *
 * Boundary helpers below mirror ui/src/ui/views/chat.ts exports so this module
 * stays free of the Lit/markdown graph. Keep them aligned when those change.
 */

import { isTranscriptStartBoundary } from "../../../../src/auto-reply/reply/chat-checkpoint-boundary.ts";
import type { ChatCheckpoint } from "../types/chat-types.ts";
import type { ChatCheckpointDiagnosticReasonCode } from "./checkpoint-load-state.ts";
import { normalizeMessage } from "./message-normalizer.ts";

/** Must stay aligned with CHAT_CHECKPOINT_VISIBLE_USER_TURNS in views/chat.ts. */
export const CHAT_CHECKPOINT_DIAG_VISIBLE_USER_TURNS = 2;

export type ChatCheckpointVisibilityDiagnostic = {
  checkpointId: string;
  /** True when current placement rules would put a divider on a recent user turn. */
  inlineVisible: boolean;
  reasonCodes: ChatCheckpointDiagnosticReasonCode[];
};

function getMessageIdForCheckpoint(message: unknown): string | undefined {
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

function resolveCheckpointPlaceBeforeUserIndex(
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

function checkpointBoundaryCanTruncate(
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

function collectRecentUserIndexes(history: unknown[], limit: number): number[] {
  const indexes: number[] = [];
  for (let hi = history.length - 1; hi >= 0; hi--) {
    if (normalizeMessage(history[hi]).role.toLowerCase() !== "user") {
      continue;
    }
    indexes.push(hi);
    if (indexes.length >= limit) {
      break;
    }
  }
  return indexes;
}

function pushUnique(
  codes: ChatCheckpointDiagnosticReasonCode[],
  code: ChatCheckpointDiagnosticReasonCode,
) {
  if (!codes.includes(code)) {
    codes.push(code);
  }
}

/**
 * Diagnose one checkpoint against the currently loaded history page.
 * Safe for logging/metrics: ids only, no message bodies.
 */
export function diagnoseCheckpointVisibility(
  checkpoint: ChatCheckpoint,
  history: unknown[],
  opts?: { visibleUserTurns?: number },
): ChatCheckpointVisibilityDiagnostic {
  const visibleTurns = opts?.visibleUserTurns ?? CHAT_CHECKPOINT_DIAG_VISIBLE_USER_TURNS;
  const reasonCodes: ChatCheckpointDiagnosticReasonCode[] = [];
  const hist = Array.isArray(history) ? history : [];

  if (!(checkpoint.restorable?.files || checkpoint.restorable?.transcript)) {
    pushUnique(reasonCodes, "not_restorable");
  }

  const boundaryId = checkpoint.boundaryMessageId;
  if (!boundaryId) {
    pushUnique(reasonCodes, "boundary_missing_source");
    return {
      checkpointId: checkpoint.checkpointId,
      inlineVisible: false,
      reasonCodes,
    };
  }

  const boundaryIndex = hist.findIndex((msg) => getMessageIdForCheckpoint(msg) === boundaryId);
  const canTruncate = checkpointBoundaryCanTruncate(hist, boundaryId);

  if (!canTruncate) {
    if (boundaryIndex >= 0) {
      pushUnique(reasonCodes, "tip_noop");
    } else {
      pushUnique(reasonCodes, "outside_loaded_page");
    }
  }

  const placeBefore = resolveCheckpointPlaceBeforeUserIndex(hist, boundaryId);
  const recentSet = new Set(collectRecentUserIndexes(hist, visibleTurns));

  let inlineVisible = false;
  if (placeBefore === undefined) {
    if (boundaryIndex < 0) {
      pushUnique(reasonCodes, "outside_loaded_page");
    }
    // P1: distinguish control-channel-filtered boundaries as boundary_filtered.
  } else if (!recentSet.has(placeBefore)) {
    pushUnique(reasonCodes, "outside_recent_window");
  } else if (canTruncate) {
    inlineVisible = true;
  }

  return {
    checkpointId: checkpoint.checkpointId,
    inlineVisible,
    reasonCodes,
  };
}

export function diagnoseCheckpointListVisibility(
  checkpoints: ChatCheckpoint[],
  history: unknown[],
  opts?: { visibleUserTurns?: number },
): ChatCheckpointVisibilityDiagnostic[] {
  return (checkpoints ?? []).map((cp) => diagnoseCheckpointVisibility(cp, history, opts));
}
