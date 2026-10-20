import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  handleAgentEvent,
  resetToolStream,
  type FallbackStatus,
  type ToolStreamEntry,
  type ToolStreamHost,
} from "./app-tool-stream.ts";

type MutableHost = ToolStreamHost & {
  compactionStatus?: unknown;
  compactionClearTimer?: number | null;
  fallbackStatus?: FallbackStatus | null;
  fallbackClearTimer?: number | null;
  workProgressPhase?: "thinking" | "drafting" | "verifying" | "wrapping" | null;
  workProgressToolsInFlight?: number;
};

function createHost(overrides?: Partial<MutableHost>): MutableHost {
  return {
    sessionKey: "main",
    chatRunId: null,
    chatStream: null,
    chatStreamStartedAt: null,
    chatStreamSegments: [],
    toolStreamById: new Map<string, ToolStreamEntry>(),
    toolStreamOrder: [],
    chatToolMessages: [],
    toolStreamSyncTimer: null,
    compactionStatus: null,
    compactionClearTimer: null,
    fallbackStatus: null,
    fallbackClearTimer: null,
    ...overrides,
  };
}

describe("app-tool-stream toolUse narration", () => {
  beforeAll(() => {
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    if (!globalWithWindow.window) {
      globalWithWindow.window = globalThis as unknown as Window & typeof globalThis;
    }
  });

  it("folds committed stream text into the work-progress card", () => {
    const host = createHost({
      chatStream: "好，那我先打开云电脑浏览器看看有什么待支付的订单。",
      chatStreamStartedAt: 10,
    });
    handleAgentEvent(host, {
      runId: "7fd20883",
      seq: 1,
      stream: "tool",
      ts: 20,
      sessionKey: "main",
      data: { phase: "start", name: "browser", toolCallId: "browser-status" },
    });
    expect(host.chatStreamSegments).toEqual([]);
    expect(host.chatStream).toBeNull();
    expect(host.workProgressNarration).toContain("好，那我先打开");
  });
});

describe("app-tool-stream fallback lifecycle handling", () => {
  beforeAll(() => {
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    if (!globalWithWindow.window) {
      globalWithWindow.window = globalThis as unknown as Window & typeof globalThis;
    }
  });

  it("accepts session-scoped fallback lifecycle events when no run is active", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "fallback",
        selectedProvider: "fireworks",
        selectedModel: "fireworks/minimax-m2p5",
        activeProvider: "deepinfra",
        activeModel: "moonshotai/Kimi-K2.5",
        reasonSummary: "rate limit",
      },
    });

    expect(host.fallbackStatus?.selected).toBe("fireworks/minimax-m2p5");
    expect(host.fallbackStatus?.active).toBe("deepinfra/moonshotai/Kimi-K2.5");
    expect(host.fallbackStatus?.reason).toBe("rate limit");
    vi.useRealTimers();
  });

  it("rejects idle fallback lifecycle events for other sessions", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "agent:other:main",
      data: {
        phase: "fallback",
        selectedProvider: "fireworks",
        selectedModel: "fireworks/minimax-m2p5",
        activeProvider: "deepinfra",
        activeModel: "moonshotai/Kimi-K2.5",
      },
    });

    expect(host.fallbackStatus).toBeNull();
    vi.useRealTimers();
  });

  it("auto-clears fallback status after toast duration", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "fallback",
        selectedProvider: "fireworks",
        selectedModel: "fireworks/minimax-m2p5",
        activeProvider: "deepinfra",
        activeModel: "moonshotai/Kimi-K2.5",
      },
    });

    expect(host.fallbackStatus).not.toBeNull();
    vi.advanceTimersByTime(7_999);
    expect(host.fallbackStatus).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(host.fallbackStatus).toBeNull();
    vi.useRealTimers();
  });

  it("builds previous fallback label from provider + model on fallback_cleared", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "fallback_cleared",
        selectedProvider: "fireworks",
        selectedModel: "fireworks/minimax-m2p5",
        activeProvider: "fireworks",
        activeModel: "fireworks/minimax-m2p5",
        previousActiveProvider: "deepinfra",
        previousActiveModel: "moonshotai/Kimi-K2.5",
      },
    });

    expect(host.fallbackStatus?.phase).toBe("cleared");
    expect(host.fallbackStatus?.previous).toBe("deepinfra/moonshotai/Kimi-K2.5");
    vi.useRealTimers();
  });
});

function compactionEvent(phase: "start" | "end") {
  return {
    runId: "run-1",
    seq: 1,
    stream: "compaction",
    ts: Date.now(),
    sessionKey: "main",
    data: { phase },
  } as const;
}

describe("app-tool-stream compaction self-heal", () => {
  beforeAll(() => {
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    if (!globalWithWindow.window) {
      globalWithWindow.window = globalThis as unknown as Window & typeof globalThis;
    }
  });

  it("ignores compaction events from unrelated chat surfaces", () => {
    const host = createHost({ sessionKey: "space:quanbian", chatRunId: "round-1" });

    handleAgentEvent(host, {
      runId: "other-run",
      seq: 1,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "agent:main:main",
      data: { phase: "start" },
    });
    expect(host.compactionStatus).toBeNull();

    handleAgentEvent(host, {
      runId: "round-1:bot-a",
      seq: 2,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "agent:bot-a:space:quanbian",
      data: { phase: "start" },
    });
    expect((host.compactionStatus as { active?: boolean } | null)?.active).toBe(true);
  });

  it("shows the pill on start and clears it after the end toast", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, compactionEvent("start"));
    expect((host.compactionStatus as { active?: boolean } | null)?.active).toBe(true);

    handleAgentEvent(host, compactionEvent("end"));
    expect((host.compactionStatus as { active?: boolean } | null)?.active).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(host.compactionStatus).toBeNull();
    vi.useRealTimers();
  });

  it("auto-clears a stuck pill via the fallback timer when no end arrives", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, compactionEvent("start"));
    expect(host.compactionStatus).not.toBeNull();
    vi.advanceTimersByTime(179_999);
    expect(host.compactionStatus).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(host.compactionStatus).toBeNull();
    vi.useRealTimers();
  });

  it("resetToolStream clears an active compaction pill (reconnect / session-switch self-heal)", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, compactionEvent("start"));
    expect(host.compactionStatus).not.toBeNull();

    resetToolStream(host);
    expect(host.compactionStatus).toBeNull();
    // The fallback timer must be cleared too, so it can't null a later pill.
    handleAgentEvent(host, compactionEvent("start"));
    vi.advanceTimersByTime(179_999);
    expect(host.compactionStatus).not.toBeNull();
    vi.useRealTimers();
  });
});

describe("work progress phase on agent events", () => {
  beforeAll(() => {
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    if (!globalWithWindow.window) {
      globalWithWindow.window = globalThis as unknown as Window & typeof globalThis;
    }
  });

  it("maps lifecycle, assistant text, tool, and compaction onto the host label", () => {
    const host = createHost({
      chatRunId: "run-1",
      sessionKey: "main",
      workProgressPhase: null,
      workProgressToolsInFlight: 0,
    } as MutableHost);

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "lifecycle",
      ts: 1,
      sessionKey: "main",
      data: { phase: "start" },
    });
    expect(host.workProgressPhase).toBe("thinking");

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 2,
      stream: "assistant",
      ts: 2,
      sessionKey: "main",
      data: { text: "草稿", delta: "草稿" },
    });
    expect(host.workProgressPhase).toBe("drafting");

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 3,
      stream: "tool",
      ts: 3,
      sessionKey: "main",
      data: { phase: "start", name: "read", toolCallId: "call-1" },
    });
    expect(host.workProgressPhase).toBe("verifying");

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 4,
      stream: "tool",
      ts: 4,
      sessionKey: "main",
      data: { phase: "result", name: "read", toolCallId: "call-1" },
    });
    expect(host.workProgressPhase).toBe("wrapping");

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 5,
      stream: "compaction",
      ts: 5,
      sessionKey: "main",
      data: { phase: "start" },
    });
    expect(host.workProgressPhase).toBe("wrapping");

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 6,
      stream: "lifecycle",
      ts: 6,
      sessionKey: "main",
      data: { phase: "end" },
    });
    expect(host.workProgressPhase).toBeNull();
  });
});
