import { describe, expect, it } from "vitest";
import { enqueueFollowupRun, resetRecentQueuedMessageIdDedupe } from "../auto-reply/reply/queue.js";
import { clearFollowupDrainCallback } from "../auto-reply/reply/queue/drain.js";
import { clearFollowupQueue } from "../auto-reply/reply/queue/state.js";
import type { FollowupRun } from "../auto-reply/reply/queue/types.js";

function makeRun(overrides: Partial<FollowupRun> = {}): FollowupRun {
  return {
    prompt: "hello",
    enqueuedAt: Date.now(),
    run: {
      agentId: "bot",
      agentDir: "/tmp",
      sessionId: "s1",
      sessionKey: "sess-1",
      sessionFile: "/tmp/s.jsonl",
      workspaceDir: "/tmp",
      config: {} as FollowupRun["run"]["config"],
      provider: "openai",
      model: "gpt",
      timeoutMs: 1000,
      blockReplyBreak: "text_end",
      collaborationTaskId: "chat:bot:parent-from-collab",
    },
    ...overrides,
  } as FollowupRun;
}

describe("askOutcome W1 followup enqueue identity", () => {
  it("stamps followupItemId once and inherits parentTaskId from collaborationTaskId", () => {
    resetRecentQueuedMessageIdDedupe();
    const key = "w1-fu-identity";
    clearFollowupQueue(key);
    clearFollowupDrainCallback(key);
    const run = makeRun({ messageId: "m1" });
    expect(run.followupItemId).toBeUndefined();
    const ok = enqueueFollowupRun(key, run, { mode: "followup", debounceMs: 0, cap: 10 });
    expect(ok).toBe(true);
    expect(run.followupItemId).toBeTruthy();
    expect(run.parentTaskId).toBe("chat:bot:parent-from-collab");
    const stamped = run.followupItemId!;

    const run2 = makeRun({ prompt: "second", messageId: "m2" });
    enqueueFollowupRun(key, run2, { mode: "followup", debounceMs: 0, cap: 10 });
    expect(run2.followupItemId).toBeTruthy();
    expect(run2.followupItemId).not.toBe(stamped);

    clearFollowupQueue(key);
    clearFollowupDrainCallback(key);
  });
});
