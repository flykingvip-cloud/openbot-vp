import { describe, expect, it } from "vitest";
import type { ChatAbortControllerEntry } from "./chat-abort.js";
import {
  clearPendingChatRestoreForTests,
  enqueuePendingChatRestore,
  hasActiveChatRunForSession,
  takePendingChatRestore,
} from "./chat-restore-queue.js";

describe("chat-restore-queue", () => {
  it("detects active runs for a session", () => {
    const controllers = new Map<string, ChatAbortControllerEntry>();
    controllers.set("run-1", {
      controller: new AbortController(),
      sessionId: "s1",
      sessionKey: "main",
      startedAtMs: Date.now(),
      expiresAtMs: Date.now() + 60_000,
    });
    expect(hasActiveChatRunForSession(controllers, "main")).toBe(true);
    expect(hasActiveChatRunForSession(controllers, "other")).toBe(false);
  });

  it("queues and dequeues pending restore requests", () => {
    clearPendingChatRestoreForTests();
    enqueuePendingChatRestore("main", {
      sessionKey: "main",
      checkpointId: "cp-1",
      client: null,
      enqueuedAtMs: Date.now(),
    });
    const pending = takePendingChatRestore("main");
    expect(pending?.checkpointId).toBe("cp-1");
    expect(takePendingChatRestore("main")).toBeUndefined();
  });
});
