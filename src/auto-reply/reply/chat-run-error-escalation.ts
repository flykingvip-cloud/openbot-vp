/**
 * Escalate unresolved chat-scoped run errors into the evolution loop.
 *
 * Design note
 * -----------
 * Primary surface: the chat transcript. The user can continue or try another
 * approach. That path must not depend on this handoff.
 *
 * Secondary surface: candidate experience capsules (`task_failure` →
 * `anti_pattern`, status `candidate`). `recordExperienceCapsuleSafely` in
 * `experience-capsule-backflow.ts` is the existing failure→evolution writer.
 * It was unwired. This module is the chat-run hook.
 *
 * Escalate when `shouldEscalateChatRunError` is true (the chat copy cannot
 * resolve the failure). Missing API keys, workspace authorization, and
 * collaboration permission errors stay in chat only.
 *
 * Fail closed: no session scope → the capsule writer skips. A throw from
 * session lookup or the writer must not block the chat error broadcast.
 * Capsules stay candidates; nothing here approves, applies, or mutates
 * working DNA.
 */

import type { SessionEntry } from "../../config/sessions.js";
import { loadSessionEntrySyncFallback } from "../../gateway/tenant-context.js";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
import {
  classifyChatRunFailureReason,
  shouldEscalateChatRunError,
} from "./chat-run-error-policy.js";
import {
  recordExperienceCapsuleSafely,
  type RecordExperienceParams,
} from "./experience-capsule-backflow.js";

export type ChatRunErrorEscalationDeps = {
  record: (params: RecordExperienceParams) => void;
  loadSession?: (sessionKey: string) => { entry?: SessionEntry } | undefined;
};

const defaultDeps: ChatRunErrorEscalationDeps = {
  record: recordExperienceCapsuleSafely,
  loadSession: (sessionKey) => {
    try {
      return loadSessionEntrySyncFallback(sessionKey);
    } catch {
      return undefined;
    }
  },
};

export function noteUnresolvedChatRunError(
  params: {
    sessionKey: string;
    errorMessage?: string | null;
    agentId?: string | null;
    sessionEntry?: SessionEntry;
  },
  deps: ChatRunErrorEscalationDeps = defaultDeps,
): void {
  const errorMessage = params.errorMessage?.trim() ?? "";
  if (!shouldEscalateChatRunError(errorMessage)) {
    return;
  }
  const parsedAgentId = parseAgentSessionKey(params.sessionKey)?.agentId ?? null;
  const agentId = params.agentId?.trim() || parsedAgentId;
  let sessionEntry = params.sessionEntry;
  if (!sessionEntry && deps.loadSession) {
    try {
      sessionEntry = deps.loadSession(params.sessionKey)?.entry;
    } catch {
      sessionEntry = undefined;
    }
  }
  try {
    deps.record({
      trigger: "task_failure",
      agentId,
      sessionEntry,
      reason: classifyChatRunFailureReason(errorMessage),
      detail: errorMessage,
      sessionKey: params.sessionKey,
    });
  } catch {
    // Evolution handoff never blocks the chat error broadcast.
  }
}
