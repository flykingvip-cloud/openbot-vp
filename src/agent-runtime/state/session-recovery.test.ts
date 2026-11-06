import { expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";
import { resetCorruptedSession, prepareReplacementSessionEntry } from "./session-recovery.js";

it("retires transcript-bound model state without changing owner preferences or the old snapshot", () => {
  const previous: SessionEntry = {
    sessionId: "old",
    updatedAt: 1,
    systemSent: true,
    abortedLastRun: true,
    modelProvider: "provider",
    model: "model",
    contextTokens: 100,
    fallbackNoticeSelectedModel: "old-model",
    fallbackNoticeActiveModel: "fallback",
    fallbackNoticeReason: "failed",
    thinkingLevel: "high",
  };
  const replacement = prepareReplacementSessionEntry(previous, "next", 2);
  expect(replacement).toMatchObject({
    sessionId: "next",
    updatedAt: 2,
    systemSent: false,
    abortedLastRun: false,
    thinkingLevel: "high",
  });
  for (const field of [
    "modelProvider",
    "model",
    "contextTokens",
    "systemPromptReport",
    "fallbackNoticeSelectedModel",
    "fallbackNoticeActiveModel",
    "fallbackNoticeReason",
  ] as const) {
    expect(replacement[field]).toBeUndefined();
  }
  expect(previous).toMatchObject({ sessionId: "old", model: "model", systemSent: true });
});

it.each([false, true])(
  "preserves cleanup order even when transcript removal fails: %s",
  async (fails) => {
    const entries: Record<string, SessionEntry> = {
      own: { sessionId: "old", updatedAt: 1 },
      other: { sessionId: "other", updatedAt: 1 },
    };
    const order: string[] = [];
    const reportError = vi.fn();
    await resetCorruptedSession(
      {
        sessionKey: "own",
        storePath: "store",
        activeSessionStore: entries,
        getActiveSessionEntry: () => entries.own,
      },
      {
        removeTranscript: (id) => {
          order.push(id);
          if (fails) {
            throw new Error("missing");
          }
        },
        removeStoredSession: async (path, key) => {
          expect(entries.own).toBeUndefined();
          expect(path).toBe("store");
          order.push(key);
        },
        reportError,
      },
    );
    expect(order).toEqual(["old", "own"]);
    expect(entries.other.sessionId).toBe("other");
    expect(reportError).toHaveBeenCalledOnce();
  },
);

it("reports persistence failure and keeps the original best-effort in-memory cleanup", async () => {
  const entries: Record<string, SessionEntry> = {};
  const reportError = vi.fn();
  const removeTranscript = vi.fn();
  await resetCorruptedSession(
    {
      sessionKey: "own",
      storePath: "store",
      activeSessionStore: entries,
      getActiveSessionEntry: () => undefined,
    },
    {
      removeTranscript,
      removeStoredSession: async () => {
        throw new Error("store unavailable");
      },
      reportError,
    },
  );
  expect(removeTranscript).not.toHaveBeenCalled();
  expect(reportError).toHaveBeenLastCalledWith(expect.stringContaining("store unavailable"));
});
