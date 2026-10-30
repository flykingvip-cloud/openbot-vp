import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config/config.js";
import { resetAgentRunContextForTest } from "../infra/agent-events.js";
import { resolveHeartbeatVisibility } from "../infra/heartbeat-visibility.js";
import { resetRunReplyLanguageForTest } from "../shared/text/run-reply-language.js";
import {
  createAgentEventHandler,
  createChatRunState,
  createToolEventRecipientRegistry,
} from "./server-chat.js";

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../infra/heartbeat-visibility.js", () => ({
  resolveHeartbeatVisibility: vi.fn(() => ({
    showOk: false,
    showAlerts: true,
    useIndicator: true,
  })),
}));

describe("server-chat control-channel streaming wire", () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({});
    vi.mocked(resolveHeartbeatVisibility).mockReturnValue({
      showOk: false,
      showAlerts: true,
      useIndicator: true,
    });
    resetAgentRunContextForTest();
    resetRunReplyLanguageForTest();
  });

  afterEach(() => {
    resetAgentRunContextForTest();
    resetRunReplyLanguageForTest();
  });

  function createHarness(params?: { now?: number }) {
    const nowSpy =
      params?.now === undefined ? undefined : vi.spyOn(Date, "now").mockReturnValue(params.now);
    const broadcast = vi.fn();
    const broadcastChat = vi.fn();
    const broadcastToConnIds = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    const chatAbortControllers = new Map();
    const toolEventRecipients = createToolEventRecipientRegistry();

    const handler = createAgentEventHandler({
      broadcast,
      broadcastChat,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      chatAbortControllers,
      resolveSessionKeyForRun: () => undefined,
      clearAgentRunContext: vi.fn(),
      toolEventRecipients,
    });

    return {
      nowSpy,
      broadcast,
      broadcastChat,
      broadcastToConnIds,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      handler,
    };
  }

  function emitAssistantText(harness: ReturnType<typeof createHarness>, text: string, seq = 1) {
    harness.chatRunState.registry.add("run-1", {
      sessionKey: "session-1",
      clientRunId: "client-1",
    });
    harness.handler({
      runId: "run-1",
      seq,
      stream: "assistant",
      ts: Date.now(),
      data: { text },
    });
  }

  function deltaTexts(broadcastChat: ReturnType<typeof vi.fn>): string[] {
    return broadcastChat.mock.calls
      .map(
        (call) => call[1] as { state?: string; message?: { content?: Array<{ text?: string }> } },
      )
      .filter((p) => p.state === "delta")
      .map((p) => p.message?.content?.[0]?.text ?? "")
      .filter((t) => t.length > 0);
  }

  function allBroadcastJson(broadcastChat: ReturnType<typeof vi.fn>): string {
    return JSON.stringify(broadcastChat.mock.calls);
  }

  it("streaming chat delta contains no complete turn_completion markers", () => {
    const h = createHarness({ now: 1_000 });
    emitAssistantText(h, "处理完成。\n[turn_completion state=delivered path=x]");
    const payloads = allBroadcastJson(h.broadcastChat);
    expect(payloads).not.toContain("[turn_completion");
    const texts = deltaTexts(h.broadcastChat);
    expect(texts.some((t) => t.includes("处理完成。"))).toBe(true);
    h.nowSpy?.mockRestore();
  });

  it("char-split turn_completion never appears on the wire", () => {
    const h = createHarness({ now: 1_000 });
    const full = "处理完成。\n[turn_completion state=delivered path=x]";
    let acc = "";
    let seq = 1;
    for (const ch of full) {
      acc += ch;
      // Advance clock past throttle window between chunks.
      h.nowSpy?.mockReturnValue(1_000 + seq * 200);
      emitAssistantText(h, acc, seq++);
    }
    expect(allBroadcastJson(h.broadcastChat)).not.toContain("[turn_completion");
    expect(allBroadcastJson(h.broadcastChat)).not.toMatch(/turn_completion/);
    h.nowSpy?.mockRestore();
  });

  it("char-split unclosed DELIVERABLE never appears on the wire", () => {
    const h = createHarness({ now: 1_000 });
    const full = '已完成。\n<<DELIVERABLE title="内部路径" file="x">>body<</DELIVERABLE>>';
    let acc = "";
    let seq = 1;
    for (const ch of full) {
      acc += ch;
      h.nowSpy?.mockReturnValue(1_000 + seq * 200);
      emitAssistantText(h, acc, seq++);
    }
    expect(allBroadcastJson(h.broadcastChat)).not.toContain("<<DELIVERABLE");
    expect(allBroadcastJson(h.broadcastChat)).not.toContain("<</DELIVERABLE");
    h.nowSpy?.mockRestore();
  });

  it("internal continue and tool-digest stay off the delta wire", () => {
    const h = createHarness({ now: 1_000 });
    emitAssistantText(h, "Internal task-board continue:\nContinue next step");
    expect(allBroadcastJson(h.broadcastChat)).not.toContain("Internal task-board continue");

    const h2 = createHarness({ now: 2_000 });
    emitAssistantText(h2, "[tool-digest] exec ls\nPRIVATE_DIGEST_OUTPUT");
    expect(allBroadcastJson(h2.broadcastChat)).not.toContain("PRIVATE_DIGEST_OUTPUT");
    expect(allBroadcastJson(h2.broadcastChat)).not.toContain("[tool-digest]");
    h.nowSpy?.mockRestore();
    h2.nowSpy?.mockRestore();
  });

  it("throttle flush also strips control markers before final", () => {
    const h = createHarness();
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000);
    h.chatRunState.registry.add("run-1", {
      sessionKey: "session-1",
      clientRunId: "client-1",
    });
    // First delta within throttle window setup
    h.handler({
      runId: "run-1",
      seq: 1,
      stream: "assistant",
      ts: 1_000,
      data: { text: "处理完成。" },
    });
    // Second chunk inside 150ms throttle — buffered, not broadcast yet
    nowSpy.mockReturnValue(1_050);
    h.handler({
      runId: "run-1",
      seq: 2,
      stream: "assistant",
      ts: 1_050,
      data: { text: "处理完成。\n[turn_completion state=delivered path=x]" },
    });
    // Lifecycle end triggers flushBufferedChatDeltaIfNeeded then final
    nowSpy.mockReturnValue(1_300);
    h.handler({
      runId: "run-1",
      seq: 3,
      stream: "lifecycle",
      ts: 1_300,
      data: { phase: "end" },
    });
    expect(allBroadcastJson(h.broadcastChat)).not.toContain("[turn_completion");
    nowSpy.mockRestore();
  });

  it("keeps raw buffer available for final settle (control markers not destroyed in buffer)", () => {
    const h = createHarness({ now: 1_000 });
    const raw = "处理完成。\n[turn_completion state=delivered path=x]";
    emitAssistantText(h, raw);
    const buffered = h.chatRunState.buffers.get("client-1") ?? "";
    // Buffer retains model text for structured settle; wire was cleaned separately.
    expect(buffered).toContain("处理完成。");
    expect(allBroadcastJson(h.broadcastChat)).not.toContain("[turn_completion");
    h.nowSpy?.mockRestore();
  });
});
