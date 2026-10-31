/**
 * P0 observability: classify why a checkpoint may not render an inline divider.
 *
 * Read-only. Does NOT change placement, restore targeting, or restorable flags.
 * `inlineVisible` comes from the same placement projection as chat render.
 * `boundary_filtered` is reserved; precise control-channel strip detection is P1.
 */

import type { ChatCheckpoint } from "../types/chat-types.ts";
import type { ChatCheckpointDiagnosticReasonCode } from "./checkpoint-load-state.ts";
import {
  CHAT_CHECKPOINT_VISIBLE_USER_TURNS,
  checkpointBoundaryCanTruncate,
  getMessageIdForCheckpoint,
  projectCheckpointPlacements,
  resolveCheckpointPlaceBeforeUserIndex,
} from "./checkpoint-placement.ts";

/** @deprecated Prefer CHAT_CHECKPOINT_VISIBLE_USER_TURNS from checkpoint-placement.ts */
export const CHAT_CHECKPOINT_DIAG_VISIBLE_USER_TURNS = CHAT_CHECKPOINT_VISIBLE_USER_TURNS;

export type ChatCheckpointSourceBoundaryState = "ok" | "tip" | "missing" | "unknown";

export type ChatCheckpointVisibilityDiagnostic = {
  checkpointId: string;
  /** True when shared placement rules would put a divider on a recent user turn. */
  inlineVisible: boolean;
  /** Source boundary classification (independent of whether fallback still paints). */
  sourceBoundaryState: ChatCheckpointSourceBoundaryState;
  reasonCodes: ChatCheckpointDiagnosticReasonCode[];
};

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
  return diagnoseCheckpointListVisibility([checkpoint], history, opts)[0];
}

export function diagnoseCheckpointListVisibility(
  checkpoints: ChatCheckpoint[],
  history: unknown[],
  opts?: { visibleUserTurns?: number },
): ChatCheckpointVisibilityDiagnostic[] {
  const visibleTurns = opts?.visibleUserTurns ?? CHAT_CHECKPOINT_VISIBLE_USER_TURNS;
  const cps = Array.isArray(checkpoints) ? checkpoints : [];
  const projection = projectCheckpointPlacements(cps, history, { visibleUserTurns: visibleTurns });
  const hist = projection.history;
  const recentSet = new Set(projection.recentUserIndexes);

  return cps.map((checkpoint) => {
    const reasonCodes: ChatCheckpointDiagnosticReasonCode[] = [];
    let sourceBoundaryState: ChatCheckpointSourceBoundaryState = "unknown";

    if (!(checkpoint.restorable?.files || checkpoint.restorable?.transcript)) {
      pushUnique(reasonCodes, "not_restorable");
    }

    const boundaryId = checkpoint.boundaryMessageId;
    if (!boundaryId) {
      sourceBoundaryState = "missing";
      pushUnique(reasonCodes, "boundary_missing_source");
      return {
        checkpointId: checkpoint.checkpointId,
        inlineVisible: false,
        sourceBoundaryState,
        reasonCodes,
      };
    }

    const boundaryIndex = hist.findIndex((msg) => getMessageIdForCheckpoint(msg) === boundaryId);
    const canTruncate = checkpointBoundaryCanTruncate(hist, boundaryId);
    if (!canTruncate) {
      if (boundaryIndex >= 0) {
        sourceBoundaryState = "tip";
        pushUnique(reasonCodes, "tip_noop");
      } else {
        sourceBoundaryState = "unknown";
        // Without pagination evidence, do not claim outside_loaded_page alone;
        // still record that the stored id is not on this page as a soft signal.
        pushUnique(reasonCodes, "outside_loaded_page");
      }
    } else {
      sourceBoundaryState = "ok";
    }

    const placement = projection.byCheckpointId.get(checkpoint.checkpointId);
    const inlineVisible = Boolean(placement);

    if (!inlineVisible) {
      const placeBefore = resolveCheckpointPlaceBeforeUserIndex(hist, boundaryId);
      if (placeBefore === undefined) {
        if (boundaryIndex < 0 && sourceBoundaryState !== "tip") {
          pushUnique(reasonCodes, "outside_loaded_page");
        }
        // P1: distinguish control-channel-filtered boundaries as boundary_filtered.
      } else if (!recentSet.has(placeBefore)) {
        pushUnique(reasonCodes, "outside_recent_window");
      }
    }

    return {
      checkpointId: checkpoint.checkpointId,
      inlineVisible,
      sourceBoundaryState,
      reasonCodes,
    };
  });
}
