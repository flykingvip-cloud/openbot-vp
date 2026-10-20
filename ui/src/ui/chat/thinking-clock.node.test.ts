import { afterEach, describe, expect, it, vi } from "vitest";
import { stopChatThinkingClock, syncChatThinkingClock } from "./thinking-clock.ts";

describe("thinking-clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a one-second tick while a turn is in flight and stops after delivery", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const host = {
      chatSending: true,
      chatStream: "",
      chatStreamStartedAt: 1_000,
      chatThinkingNowMs: 0,
    };
    syncChatThinkingClock(host);
    expect(host.chatThinkingNowMs).toBe(1_000);
    vi.advanceTimersByTime(1_000);
    expect(host.chatThinkingNowMs).toBe(2_000);
    host.chatStream = "hello";
    syncChatThinkingClock(host);
    vi.advanceTimersByTime(1_000);
    expect(host.chatThinkingNowMs).toBe(2_000);
    stopChatThinkingClock(host);
  });
});
