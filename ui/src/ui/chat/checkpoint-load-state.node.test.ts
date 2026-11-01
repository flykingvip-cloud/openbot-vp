// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ChatCheckpoint } from "../types/chat-types.ts";
import {
  applyChatCheckpointLoadFailure,
  applyChatCheckpointLoadSuccess,
  beginChatCheckpointLoad,
  createChatCheckpointLoadState,
  isolateChatCheckpointLoad,
} from "./checkpoint-load-state.ts";

function cp(id: string): ChatCheckpoint {
  return {
    checkpointId: id,
    createdAt: "2026-10-31T00:00:00.000Z",
    boundaryMessageId: "m0",
    summary: "s",
    restorable: { files: true, transcript: true },
    externalEffects: { present: false, kinds: [] },
  };
}

describe("checkpoint load state P0 (empty ≠ error)", () => {
  it("marks successful empty list as empty, not error", () => {
    let state = createChatCheckpointLoadState();
    const began = beginChatCheckpointLoad(state, "session-a");
    state = began.state;
    const applied = applyChatCheckpointLoadSuccess(state, {
      sessionKey: began.sessionKey,
      generation: began.generation,
      checkpoints: [],
    });
    expect(applied.ignored).toBe(false);
    expect(applied.state.status).toBe("empty");
    expect(applied.state.checkpoints).toEqual([]);
    expect(applied.state.reasonCode).toBeUndefined();
  });

  it("marks failure with no last-good as error (not empty)", () => {
    let state = createChatCheckpointLoadState();
    const began = beginChatCheckpointLoad(state, "session-a");
    const applied = applyChatCheckpointLoadFailure(began.state, {
      sessionKey: began.sessionKey,
      generation: began.generation,
      errorToken: "rpc_failed",
    });
    expect(applied.ignored).toBe(false);
    expect(applied.state.status).toBe("error");
    expect(applied.state.checkpoints).toEqual([]);
    expect(applied.state.reasonCode).toBe("load_error");
  });
});

describe("checkpoint load state P0 request isolation", () => {
  it("ignores late success from a superseded generation", () => {
    let state = createChatCheckpointLoadState();
    const first = beginChatCheckpointLoad(state, "session-a");
    state = first.state;
    const second = beginChatCheckpointLoad(state, "session-a");
    state = second.state;

    const late = applyChatCheckpointLoadSuccess(state, {
      sessionKey: first.sessionKey,
      generation: first.generation,
      checkpoints: [cp("stale-cp")],
    });
    expect(late.ignored).toBe(true);
    expect(late.ignoreReason).toBe("scope_mismatch");
    expect(late.state.checkpoints).toEqual([]);
    expect(late.state.status).toBe("loading");

    const current = applyChatCheckpointLoadSuccess(late.state, {
      sessionKey: second.sessionKey,
      generation: second.generation,
      checkpoints: [cp("fresh-cp")],
    });
    expect(current.ignored).toBe(false);
    expect(current.state.status).toBe("ready");
    expect(current.state.checkpoints.map((c) => c.checkpointId)).toEqual(["fresh-cp"]);
  });

  it("isolates on session switch and ignores the prior session response", () => {
    let state = createChatCheckpointLoadState();
    const forA = beginChatCheckpointLoad(state, "session-a");
    state = applyChatCheckpointLoadSuccess(forA.state, {
      sessionKey: forA.sessionKey,
      generation: forA.generation,
      checkpoints: [cp("cp-a")],
    }).state;
    expect(state.status).toBe("ready");
    expect(state.checkpoints).toHaveLength(1);

    state = isolateChatCheckpointLoad(state, "session-b");
    expect(state.status).toBe("idle");
    expect(state.checkpoints).toEqual([]);
    expect(state.sessionKey).toBe("session-b");

    // Late response for session-a must not reappear after isolation.
    const late = applyChatCheckpointLoadSuccess(state, {
      sessionKey: forA.sessionKey,
      generation: forA.generation,
      checkpoints: [cp("cp-a-late")],
    });
    expect(late.ignored).toBe(true);
    expect(late.state.checkpoints).toEqual([]);
    expect(late.state.sessionKey).toBe("session-b");
  });

  it("begin on a different session isolates before loading", () => {
    let state = createChatCheckpointLoadState();
    const forA = beginChatCheckpointLoad(state, "session-a");
    state = applyChatCheckpointLoadSuccess(forA.state, {
      sessionKey: forA.sessionKey,
      generation: forA.generation,
      checkpoints: [cp("cp-a")],
    }).state;

    const forB = beginChatCheckpointLoad(state, "session-b");
    expect(forB.state.checkpoints).toEqual([]);
    expect(forB.state.sessionKey).toBe("session-b");
    expect(forB.state.status).toBe("loading");
    expect(forB.generation).toBeGreaterThan(forA.generation);
  });
});

describe("checkpoint load state P0 last-good + stale", () => {
  it("keeps same-session last-good and marks stale on failure", () => {
    let state = createChatCheckpointLoadState();
    const first = beginChatCheckpointLoad(state, "session-a");
    state = applyChatCheckpointLoadSuccess(first.state, {
      sessionKey: first.sessionKey,
      generation: first.generation,
      checkpoints: [cp("cp-good")],
    }).state;
    expect(state.status).toBe("ready");

    const reload = beginChatCheckpointLoad(state, "session-a");
    // Same-session reload keeps last-good visible while loading.
    expect(reload.state.checkpoints.map((c) => c.checkpointId)).toEqual(["cp-good"]);
    expect(reload.state.status).toBe("loading");

    const failed = applyChatCheckpointLoadFailure(reload.state, {
      sessionKey: reload.sessionKey,
      generation: reload.generation,
      errorToken: "timeout",
    });
    expect(failed.ignored).toBe(false);
    expect(failed.state.status).toBe("stale");
    expect(failed.state.reasonCode).toBe("load_error");
    expect(failed.state.checkpoints.map((c) => c.checkpointId)).toEqual(["cp-good"]);
  });
});
