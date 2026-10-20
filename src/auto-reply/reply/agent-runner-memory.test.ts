import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../agents/bootstrap-budget.js", () => ({
  resolveBootstrapWarningSignaturesSeen: vi.fn().mockReturnValue([]),
}));

vi.mock("../../agents/compaction.js", () => ({
  estimateMessagesTokens: vi.fn().mockReturnValue(1),
}));

vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: vi
    .fn()
    .mockImplementation(async (params: { run: (...args: unknown[]) => Promise<unknown> }) =>
      params.run("anthropic", "claude-opus-4-1", {}),
    ),
}));

vi.mock("../../agents/model-selection.js", () => ({
  isCliProvider: vi.fn().mockReturnValue(false),
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  runEmbeddedPiAgent: vi.fn().mockResolvedValue({
    payloads: [],
    meta: { durationMs: 10 },
  }),
}));

vi.mock("../../agents/sandbox.js", () => ({
  resolveSandboxConfigForAgent: vi.fn().mockReturnValue({ workspaceAccess: "rw" }),
  resolveSandboxRuntimeStatus: vi.fn().mockReturnValue({ sandboxed: false, agentId: "agent-1" }),
}));

vi.mock("../../config/sessions.js", () => ({
  resolveAgentIdFromSessionKey: vi.fn().mockReturnValue(undefined),
  resolveSessionFilePath: vi.fn().mockReturnValue(undefined),
  resolveSessionFilePathOptions: vi.fn().mockReturnValue({}),
  updateSessionStoreEntry: vi
    .fn()
    .mockImplementation(async (params: { update: () => Promise<Record<string, unknown>> }) => ({
      sessionFile: "sessions/session-1.jsonl",
      totalTokens: 1_500,
      totalTokensFresh: true,
      compactionCount: 1,
      ...(await params.update()),
    })),
}));

vi.mock("../../globals.js", () => ({
  logVerbose: vi.fn(),
}));

vi.mock("../../infra/agent-events.js", () => ({
  registerAgentRunContext: vi.fn(),
}));

vi.mock("./agent-runner-utils.js", () => ({
  buildEmbeddedRunBaseParams: vi.fn().mockReturnValue({}),
  buildEmbeddedRunContexts: vi.fn().mockReturnValue({
    authProfile: undefined,
    embeddedContext: {},
    senderContext: {},
  }),
  resolveModelFallbackOptions: vi.fn().mockReturnValue({}),
}));

vi.mock("./session-updates.js", () => ({
  incrementCompactionCount: vi.fn().mockResolvedValue(1),
}));

import { runMemoryFlushIfNeeded } from "./agent-runner-memory.js";

describe("runMemoryFlushIfNeeded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invokes the completion hook after a successful flush run", async () => {
    const onMemoryFlushCompleted = vi.fn().mockResolvedValue(undefined);

    const result = await runMemoryFlushIfNeeded({
      cfg: {
        agents: {
          defaults: {
            compaction: {
              reserveTokensFloor: 100,
              memoryFlush: {
                enabled: true,
                softThresholdTokens: 1_000,
                forceFlushTranscriptBytes: 0,
              },
            },
          },
        },
      } as never,
      followupRun: {
        prompt: "Summarize and store durable memory.",
        enqueuedAt: Date.now(),
        run: {
          agentId: "agent-1",
          agentDir: "/tmp/agent-1",
          sessionId: "session-1",
          sessionKey: "session-key",
          sessionFile: "sessions/session-1.jsonl",
          workspaceDir: "/tmp/workspace",
          config: {} as never,
          provider: "anthropic",
          model: "claude-opus-4-1",
          timeoutMs: 30_000,
          blockReplyBreak: "message_end",
        },
      },
      promptForEstimate: "Summarize and store durable memory.",
      sessionCtx: {} as never,
      defaultModel: "claude-opus-4-1",
      agentCfgContextTokens: 2_000,
      resolvedVerboseLevel: "off",
      sessionEntry: {
        sessionId: "session-1",
        updatedAt: Date.now(),
        sessionFile: "sessions/session-1.jsonl",
        totalTokens: 1_500,
        totalTokensFresh: true,
        compactionCount: 0,
      },
      sessionStore: {
        "session-key": {
          sessionId: "session-1",
          updatedAt: Date.now(),
          sessionFile: "sessions/session-1.jsonl",
          totalTokens: 1_500,
          totalTokensFresh: true,
          compactionCount: 0,
        },
      },
      sessionKey: "session-key",
      storePath: "/tmp/openclaw-sessions",
      isHeartbeat: false,
      onMemoryFlushCompleted,
    });

    expect(result).toEqual(
      expect.objectContaining({
        memoryFlushAt: expect.any(Number),
        memoryFlushCompactionCount: 0,
      }),
    );
    expect(onMemoryFlushCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "session-key",
        memoryFlushWritePath: expect.stringMatching(/^memory\/\d{4}-\d{2}-\d{2}\.md$/),
        memoryCompactionCompleted: false,
        result: expect.objectContaining({
          meta: expect.objectContaining({ durationMs: 10 }),
        }),
      }),
    );
  });
});
