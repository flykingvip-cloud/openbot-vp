import { describe, expect, it, vi } from "vitest";
import { stopTaskAtGateway } from "./gateway-task-stop.js";

describe("Gateway task stop ordering", () => {
  it("waits for chat abortion before stopping embedded execution and pending work", async () => {
    const events: string[] = [];
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const run = stopTaskAtGateway(true, {
      abortChatRuns: async () => {
        events.push("chat-start");
        await pending;
        events.push("chat-end");
      },
      abortEmbedded: () => {
        events.push("embedded");
      },
      clearPending: () => {
        events.push("queue");
      },
    });
    expect(events).toEqual(["chat-start"]);
    finish();
    await run;
    expect(events).toEqual(["chat-start", "chat-end", "embedded", "queue"]);
  });
  it("preserves focus-switch behavior without owner-only cleanup", async () => {
    const abortEmbedded = vi.fn(),
      clearPending = vi.fn();
    await stopTaskAtGateway(false, { abortChatRuns: async () => {}, abortEmbedded, clearPending });
    expect(abortEmbedded).not.toHaveBeenCalled();
    expect(clearPending).not.toHaveBeenCalled();
  });
  it("does not run later effects after asynchronous abort failure", async () => {
    const abortEmbedded = vi.fn(),
      clearPending = vi.fn();
    await expect(
      stopTaskAtGateway(true, {
        abortChatRuns: async () => {
          throw new Error("abort failed");
        },
        abortEmbedded,
        clearPending,
      }),
    ).rejects.toThrow("abort failed");
    expect(abortEmbedded).not.toHaveBeenCalled();
    expect(clearPending).not.toHaveBeenCalled();
  });
});
