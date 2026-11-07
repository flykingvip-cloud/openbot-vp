import type { SessionManager } from "@earendil-works/pi-coding-agent";

/** Caller holds the existing session lock; SessionManager remains the sole writer. */
export function repairTrailingUserTurn(
  manager: Pick<SessionManager, "getLeafEntry" | "branch" | "resetLeaf" | "buildSessionContext">,
  preserveUserTranscript: boolean,
) {
  const leaf = manager.getLeafEntry();
  if (preserveUserTranscript || leaf?.type !== "message" || leaf.message.role !== "user") {
    return undefined;
  }
  if (leaf.parentId) {
    manager.branch(leaf.parentId);
  } else {
    manager.resetLeaf();
  }
  return manager.buildSessionContext().messages;
}

export function persistAttemptPromptError(
  manager: Pick<SessionManager, "appendCustomEntry">,
  input: {
    runId: string;
    sessionId: string;
    provider: string;
    model: string;
    api: string;
    error: string;
  },
  warn: (message: string) => void,
): void {
  try {
    manager.appendCustomEntry("openclaw:prompt-error", { timestamp: Date.now(), ...input });
  } catch (error) {
    warn(`failed to persist prompt error entry: ${String(error)}`);
  }
}
