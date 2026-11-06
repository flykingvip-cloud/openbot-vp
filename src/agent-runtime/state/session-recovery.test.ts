import { expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";
import { resetCorruptedSession } from "./session-recovery.js";

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
