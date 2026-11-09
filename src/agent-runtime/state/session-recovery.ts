import type { SessionEntry } from "../../config/sessions.js";

/** Preserve identity/preferences while retiring model state bound to the damaged transcript. */
export function prepareReplacementSessionEntry(
  previous: SessionEntry,
  sessionId: string,
  updatedAt: number,
): SessionEntry {
  return {
    ...previous,
    sessionId,
    updatedAt,
    systemSent: false,
    abortedLastRun: false,
    modelProvider: undefined,
    model: undefined,
    contextTokens: undefined,
    systemPromptReport: undefined,
    fallbackNoticeSelectedModel: undefined,
    fallbackNoticeActiveModel: undefined,
    fallbackNoticeReason: undefined,
  };
}

export type CorruptedSessionResetInput = {
  sessionKey: string;
  storePath: string;
  activeSessionStore: Record<string, SessionEntry>;
  getActiveSessionEntry: () => SessionEntry | undefined;
};
export type SessionRecoveryPorts = {
  removeTranscript: (sessionId: string) => void;
  removeStoredSession: (storePath: string, sessionKey: string) => Promise<void>;
  reportError: (message: string) => void;
};

/** Original corruption cleanup sequence. This does not create a replacement task or retry. */
export async function resetCorruptedSession(
  input: CorruptedSessionResetInput,
  ports: SessionRecoveryPorts,
): Promise<void> {
  const corruptedSessionId = input.getActiveSessionEntry()?.sessionId;
  ports.reportError(
    `Session history corrupted (Gemini function call ordering). Resetting session: ${input.sessionKey}`,
  );
  try {
    if (corruptedSessionId) {
      try {
        ports.removeTranscript(corruptedSessionId);
      } catch {
        // Original best-effort transcript cleanup must not block the locked store update.
      }
    }
    delete input.activeSessionStore[input.sessionKey];
    await ports.removeStoredSession(input.storePath, input.sessionKey);
  } catch (error) {
    ports.reportError(`Failed to reset corrupted session ${input.sessionKey}: ${String(error)}`);
  }
}
