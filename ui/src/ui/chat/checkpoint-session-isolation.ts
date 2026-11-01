/**
 * Unified restore-session isolation boundary for checkpoint load observability.
 *
 * Every trusted session-surface change (shell switch, employee workbench switch,
 * send-path realign, draft key change) must call this so prior-session
 * checkpoints / diagnostics / pending confirm never leak, and in-flight list
 * responses are generation-bumped away.
 */

import { resolveChatRestoreSessionKey } from "../app-chat-actions.ts";
import type { ChatCheckpoint } from "../types/chat-types.ts";
import {
  applyChatCheckpointLoadFailure,
  applyChatCheckpointLoadSuccess,
  beginChatCheckpointLoad,
  checkpointsFromLoadState,
  createChatCheckpointLoadState,
  isolateChatCheckpointLoad,
  type ChatCheckpointLoadState,
} from "./checkpoint-load-state.ts";
import {
  diagnoseCheckpointListVisibility,
  type ChatCheckpointVisibilityDiagnostic,
} from "./checkpoint-visibility-diagnostics.ts";

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

export type LoadChatCheckpointsHost = {
  client?: { request: (method: string, params?: unknown) => Promise<unknown> } | null;
  connected?: boolean;
  sessionKey: string;
  workbenchTeamSelectedKey?: string;
  workbenchPrimaryModule?: string;
  chatMessages: unknown[];
  chatCheckpoints: ChatCheckpoint[];
  chatCheckpointLoadState: ChatCheckpointLoadState;
  chatCheckpointDiagnostics: ChatCheckpointVisibilityDiagnostic[];
};

/** Fetch the active session's restorable checkpoints for the inline dividers. */
export async function loadChatCheckpointsForHost(host: LoadChatCheckpointsHost): Promise<void> {
  if (!host.client || !host.connected) {
    // P0: do not wipe last-good on disconnect; leave load state as-is.
    return;
  }
  const sessionKey = resolveChatRestoreSessionKey(host);
  const began = beginChatCheckpointLoad(host.chatCheckpointLoadState, sessionKey);
  host.chatCheckpointLoadState = began.state;
  host.chatCheckpoints = checkpointsFromLoadState(began.state);
  // Phase A: load checkpoints for collab/space sessions (恢复线).
  // P0: bind request to sessionKey + generation; ignore late / cross-session replies.
  try {
    const result = (await host.client.request("chat.checkpoints.list", {
      sessionKey: began.sessionKey,
    })) as { checkpoints?: ChatCheckpoint[] };
    const applied = applyChatCheckpointLoadSuccess(host.chatCheckpointLoadState, {
      sessionKey: began.sessionKey,
      generation: began.generation,
      checkpoints: result.checkpoints,
    });
    host.chatCheckpointLoadState = applied.state;
    if (!applied.ignored) {
      host.chatCheckpoints = checkpointsFromLoadState(applied.state);
      host.chatCheckpointDiagnostics = diagnoseCheckpointListVisibility(
        applied.state.checkpoints,
        host.chatMessages,
      );
    }
  } catch {
    const applied = applyChatCheckpointLoadFailure(host.chatCheckpointLoadState, {
      sessionKey: began.sessionKey,
      generation: began.generation,
      errorToken: "list_failed",
    });
    host.chatCheckpointLoadState = applied.state;
    if (!applied.ignored) {
      host.chatCheckpoints = checkpointsFromLoadState(applied.state);
      // Keep prior diagnostics when stale; clear when hard error with no data.
      if (applied.state.status === "error") {
        host.chatCheckpointDiagnostics = [];
      }
    }
  }
}
