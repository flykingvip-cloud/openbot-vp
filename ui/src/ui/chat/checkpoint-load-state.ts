/**
 * P0 checkpoint restore-line load observability.
 *
 * Separates load lifecycle from restore execution. Does NOT change restore
 * RPC semantics, divider placement, guess-fallback, or restorable flags.
 *
 * Baseline: CHECKPOINT-RESTORE-PLAN-2026-10-31.md (P0 only).
 *
 * Deferred to P1 (do not implement here):
 * - sourceRevision full binding (tenant/session/transcript/checkpoint version)
 * - plan token server validation
 * - displayBeforeMessageId ≠ restoreBoundaryId projection
 * - restore preview/precheck + compensation records
 * - precise `boundary_filtered` from control-channel strip / source index
 */

import type { ChatCheckpoint } from "../types/chat-types.ts";

/** Load lifecycle for chat.checkpoints.list (empty ≠ error). */
export type ChatCheckpointLoadStatus = "idle" | "loading" | "ready" | "error" | "stale" | "empty";

/**
 * Diagnostic reason codes (no private chat body, no absolute locators).
 * Wire what P0 can observe without changing restore semantics.
 */
export type ChatCheckpointDiagnosticReasonCode =
  | "outside_recent_window"
  | "boundary_filtered"
  | "outside_loaded_page"
  | "boundary_missing_source"
  | "tip_noop"
  | "not_restorable"
  | "load_error"
  | "scope_mismatch";

export type ChatCheckpointLoadState = {
  status: ChatCheckpointLoadStatus;
  /** Session key this state belongs to (restore session key). */
  sessionKey: string | null;
  /** Monotonic generation; responses must match to apply. */
  generation: number;
  /** Last-good checkpoints for this session (kept across stale). */
  checkpoints: ChatCheckpoint[];
  /** Load-level reason when status is error/stale, or last ignored mismatch. */
  reasonCode?: ChatCheckpointDiagnosticReasonCode;
  /** Optional sanitized error token (never a chat body / absolute path). */
  errorToken?: string;
};

export function createChatCheckpointLoadState(): ChatCheckpointLoadState {
  return {
    status: "idle",
    sessionKey: null,
    generation: 0,
    checkpoints: [],
  };
}

/**
 * Isolate immediately for a session switch: never show prior session checkpoints.
 * Bumps generation so in-flight responses for the old session are ignored.
 */
export function isolateChatCheckpointLoad(
  _state: ChatCheckpointLoadState,
  nextSessionKey: string | null,
): ChatCheckpointLoadState {
  return {
    status: "idle",
    sessionKey: nextSessionKey,
    generation: (_state?.generation ?? 0) + 1,
    checkpoints: [],
  };
}

export type BeginChatCheckpointLoadResult = {
  state: ChatCheckpointLoadState;
  generation: number;
  sessionKey: string;
};

/**
 * Start a list request. Same-session keeps last-good visible while loading;
 * cross-session isolates first so prior checkpoints never leak.
 */
export function beginChatCheckpointLoad(
  state: ChatCheckpointLoadState,
  sessionKey: string,
): BeginChatCheckpointLoadResult {
  const key = sessionKey.trim();
  let next = state;
  if (state.sessionKey !== key) {
    next = isolateChatCheckpointLoad(state, key);
  }
  const generation = next.generation + 1;
  return {
    sessionKey: key,
    generation,
    state: {
      ...next,
      sessionKey: key,
      generation,
      status: "loading",
      // Keep same-session last-good during reload; clear reason until settle.
      reasonCode: undefined,
      errorToken: undefined,
    },
  };
}

function isBoundResponse(
  state: ChatCheckpointLoadState,
  sessionKey: string,
  generation: number,
): boolean {
  return state.sessionKey === sessionKey && state.generation === generation;
}

export type ChatCheckpointLoadApplyResult = {
  state: ChatCheckpointLoadState;
  /** True when the response was dropped (late / wrong session). */
  ignored: boolean;
  ignoreReason?: ChatCheckpointDiagnosticReasonCode;
};

/**
 * Successful list: empty array → `empty` (not error); non-empty → `ready`.
 */
export function applyChatCheckpointLoadSuccess(
  state: ChatCheckpointLoadState,
  params: {
    sessionKey: string;
    generation: number;
    checkpoints: ChatCheckpoint[] | null | undefined;
  },
): ChatCheckpointLoadApplyResult {
  if (!isBoundResponse(state, params.sessionKey, params.generation)) {
    // Late / cross-session: do not mutate last-good or status.
    return {
      state,
      ignored: true,
      ignoreReason: "scope_mismatch",
    };
  }
  const checkpoints = Array.isArray(params.checkpoints) ? params.checkpoints.slice() : [];
  if (checkpoints.length === 0) {
    return {
      ignored: false,
      state: {
        ...state,
        status: "empty",
        checkpoints: [],
        reasonCode: undefined,
        errorToken: undefined,
      },
    };
  }
  return {
    ignored: false,
    state: {
      ...state,
      status: "ready",
      checkpoints,
      reasonCode: undefined,
      errorToken: undefined,
    },
  };
}

/**
 * Failed list: same-session last-good → `stale`; no last-good → `error`.
 * Never conflates with `empty`.
 */
export function applyChatCheckpointLoadFailure(
  state: ChatCheckpointLoadState,
  params: {
    sessionKey: string;
    generation: number;
    errorToken?: string;
  },
): ChatCheckpointLoadApplyResult {
  if (!isBoundResponse(state, params.sessionKey, params.generation)) {
    return {
      state,
      ignored: true,
      ignoreReason: "scope_mismatch",
    };
  }
  const hasLastGood = state.checkpoints.length > 0;
  return {
    ignored: false,
    state: {
      ...state,
      status: hasLastGood ? "stale" : "error",
      // Keep checkpoints when last-good exists; otherwise stay empty list.
      checkpoints: hasLastGood ? state.checkpoints : [],
      reasonCode: "load_error",
      errorToken: params.errorToken,
    },
  };
}

/** Mirror load-state checkpoints onto the legacy chatCheckpoints array field. */
export function checkpointsFromLoadState(state: ChatCheckpointLoadState): ChatCheckpoint[] {
  return state.checkpoints;
}
