/**
 * Slice2 Gateway/UI cross: A final/cancel must not clear B's chatRun bucket;
 * B end must not clear A's abort controller. Registry is keyed by agent sessionId
 * (evt.runId); aside reply_lane uses a distinct sessionId + clientRunId.
 */
import { describe, expect, it } from "vitest";
import {
  abortMidTaskAsideLanes,
  isMidTaskAsideLaneCancelled,
  listMidTaskAsideLanesForTests,
  registerMidTaskAsideLane,
  unregisterMidTaskAsideLane,
} from "../auto-reply/reply/mid-task-aside-reply-lane.js";
import { createChatRunRegistry, createChatRunState } from "./server-chat.js";

describe("slice2 A/B chatRun + aside cancel isolation", () => {
  it("A final shift removes only A's clientRunId; B registry entry survives", () => {
    const registry = createChatRunRegistry();
    const sessionA = "embedded-session-a";
    const sessionB = "aside-session-b";
    registry.add(sessionA, { sessionKey: "main", clientRunId: "client-run-a" });
    registry.add(sessionB, { sessionKey: "main", clientRunId: "client-run-b" });

    // A lifecycle end → shift(A) like server-chat emitLifecycleFinal
    const finishedA = registry.shift(sessionA);
    expect(finishedA?.clientRunId).toBe("client-run-a");
    expect(registry.peek(sessionA)).toBeUndefined();
    expect(registry.peek(sessionB)?.clientRunId).toBe("client-run-b");

    // Foreign remove of B's id against A's session must no-op
    expect(registry.remove(sessionA, "client-run-b", "main")).toBeUndefined();
    expect(registry.peek(sessionB)?.clientRunId).toBe("client-run-b");
  });

  it("same-session queued runs: remove/shift by identity does not drop the sibling run", () => {
    const registry = createChatRunRegistry();
    const sessionId = "shared-session";
    registry.add(sessionId, { sessionKey: "main", clientRunId: "run-a" });
    registry.add(sessionId, { sessionKey: "main", clientRunId: "run-b" });

    expect(registry.remove(sessionId, "run-a", "main")?.clientRunId).toBe("run-a");
    expect(registry.peek(sessionId)?.clientRunId).toBe("run-b");
    expect(registry.remove(sessionId, "run-a", "main")).toBeUndefined();
  });

  it("chatRunState buffers: A final cleanup deletes only A's clientRunId keys", () => {
    const state = createChatRunState();
    state.buffers.set("client-run-a", "A partial…");
    state.buffers.set("client-run-b", "B partial…");
    state.deltaSentAt.set("client-run-a", 1);
    state.deltaSentAt.set("client-run-b", 2);
    state.abortedRuns.set("client-run-a", Date.now());

    // Mirror aborted final cleanup for A only
    state.abortedRuns.delete("client-run-a");
    state.buffers.delete("client-run-a");
    state.deltaSentAt.delete("client-run-a");

    expect(state.buffers.get("client-run-b")).toBe("B partial…");
    expect(state.deltaSentAt.get("client-run-b")).toBe(2);
    expect(state.buffers.has("client-run-a")).toBe(false);
  });

  it("owner cancel marks aside cancelled without dropping registration before B finally", () => {
    const parent = "session-a-parent";
    const aside = "aside-live-b";
    registerMidTaskAsideLane(parent, aside);
    expect(listMidTaskAsideLanesForTests(parent)).toEqual([aside]);

    abortMidTaskAsideLanes(parent);
    expect(isMidTaskAsideLaneCancelled(parent, aside)).toBe(true);
    // Still registered so late prepare/run observes cancel (no drop-then-late-start)
    expect(listMidTaskAsideLanesForTests(parent)).toEqual([aside]);

    unregisterMidTaskAsideLane(parent, aside);
    expect(listMidTaskAsideLanesForTests(parent)).toEqual([]);
  });

  it("B unregister does not clear a sibling aside on the same parent", () => {
    const parent = "session-a-multi";
    registerMidTaskAsideLane(parent, "aside-1");
    registerMidTaskAsideLane(parent, "aside-2");
    unregisterMidTaskAsideLane(parent, "aside-1");
    expect(listMidTaskAsideLanesForTests(parent)).toEqual(["aside-2"]);
    expect(isMidTaskAsideLaneCancelled(parent, "aside-2")).toBe(false);
    unregisterMidTaskAsideLane(parent, "aside-2");
  });
});
