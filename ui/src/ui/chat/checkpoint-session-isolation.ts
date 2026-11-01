/**
 * Unified restore-session isolation boundary for checkpoint load observability.
 *
 * Every trusted session-surface change (shell switch, employee workbench switch,
 * send-path realign, draft key change) must call this so prior-session
 * checkpoints / diagnostics / pending confirm never leak, and in-flight list
 * responses are generation-bumped away.
 */

import type { ChatCheckpoint } from "../types/chat-types.ts";
import {
  createChatCheckpointLoadState,
  isolateChatCheckpointLoad,
  type ChatCheckpointLoadState,
} from "./checkpoint-load-state.ts";
import type { ChatCheckpointVisibilityDiagnostic } from "./checkpoint-visibility-diagnostics.ts";

export type ChatCheckpointSessionIsolationState = {
  chatCheckpoints?: ChatCheckpoint[];
  chatCheckpointLoadState?: ChatCheckpointLoadState;
  chatCheckpointDiagnostics?: ChatCheckpointVisibilityDiagnostic[];
  pendingRestoreCheckpointId?: string | null;
};

/**
 * Isolate immediately for a restore-session surface change.
 * Clears painted checkpoints, diagnostics, and pending confirm; bumps generation.
 */
export function applyChatCheckpointSessionIsolation(
  state: ChatCheckpointSessionIsolationState,
  nextSessionKey: string | null,
): void {
  state.chatCheckpoints = [];
  state.pendingRestoreCheckpointId = null;
  state.chatCheckpointDiagnostics = [];
  state.chatCheckpointLoadState = isolateChatCheckpointLoad(
    state.chatCheckpointLoadState ?? createChatCheckpointLoadState(),
    nextSessionKey,
  );
}
