import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSessionStore, saveSessionStore, type SessionEntry } from "../../config/sessions.js";
import { createExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import type { FollowupRun } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const runEmbeddedPiAgentMock = vi.fn();
const routeReplyMock = vi.fn();
const isRoutableChannelMock = vi.fn();

vi.mock(
  "../../agents/model-fallback.js",
  async () => await import("../../test-utils/model-fallback.mock.js"),
);

vi.mock("../../agents/pi-embedded.js", () => ({
  queueEmbeddedPiMessage: vi.fn(),
  abortEmbeddedPiRun: vi.fn(),
  runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
}));

vi.mock("./route-reply.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./route-reply.js")>();
  return {
    ...actual,
    isRoutableChannel: (...args: unknown[]) => isRoutableChannelMock(...args),
    routeReply: (...args: unknown[]) => routeReplyMock(...args),
  };
});

import { createFollowupRunner } from "./followup-runner.js";

const ROUTABLE_TEST_CHANNELS = new Set([
  "telegram",
  "slack",
  "discord",
  "signal",
  "imessage",
  "whatsapp",
  "feishu",
]);

beforeEach(() => {
  routeReplyMock.mockReset();
  routeReplyMock.mockResolvedValue({ ok: true });
  isRoutableChannelMock.mockReset();
  isRoutableChannelMock.mockImplementation((ch: string | undefined) =>
    Boolean(ch?.trim() && ROUTABLE_TEST_CHANNELS.has(ch.trim().toLowerCase())),
  );
});

const baseQueuedRun = (messageProvider = "whatsapp"): FollowupRun =>
  ({
    prompt: "hello",
    summaryLine: "hello",
    enqueuedAt: Date.now(),
    originatingTo: "channel:C1",
    run: {
      sessionId: "session",
      sessionKey: "main",
      messageProvider,
      agentAccountId: "primary",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: "/tmp",
      config: {},
      skillsSnapshot: {},
      provider: "anthropic",
      model: "claude",
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: {
        enabled: false,
        allowed: false,
        defaultLevel: "off",
      },
      timeoutMs: 1_000,
      blockReplyBreak: "message_end",
    },
  }) as FollowupRun;

function createQueuedRun(
  overrides: Partial<Omit<FollowupRun, "run">> & { run?: Partial<FollowupRun["run"]> } = {},
): FollowupRun {
  const base = baseQueuedRun();
  return {
    ...base,
    ...overrides,
    run: {
      ...base.run,
      ...overrides.run,
    },
  };
}

function mockCompactionRun(params: {
  willRetry: boolean;
  result: {
    payloads: Array<{ text: string }>;
    meta: Record<string, unknown>;
  };
}) {
  runEmbeddedPiAgentMock.mockImplementationOnce(
    async (args: {
      onAgentEvent?: (evt: { stream: string; data: Record<string, unknown> }) => void;
    }) => {
      args.onAgentEvent?.({
        stream: "compaction",
        data: { phase: "end", willRetry: params.willRetry },
      });
      return params.result;
    },
  );
}

function createAsyncReplySpy() {
  return vi.fn(async () => {});
}

describe("createFollowupRunner compaction", () => {
  it("adds verbose auto-compaction notice and tracks count", async () => {
    const storePath = path.join(
      await fs.mkdtemp(path.join(tmpdir(), "openbot-compaction-")),
      "sessions.json",
    );
    const sessionEntry: SessionEntry = {
      sessionId: "session",
      updatedAt: Date.now(),
    };
    const sessionStore: Record<string, SessionEntry> = {
      main: sessionEntry,
    };
    const onBlockReply = vi.fn(async () => {});

    mockCompactionRun({
      willRetry: true,
      result: { payloads: [{ text: "final" }], meta: {} },
    });

    const runner = createFollowupRunner({
      opts: { onBlockReply },
      typing: createMockTypingController(),
      typingMode: "instant",
      sessionEntry,
      sessionStore,
      sessionKey: "main",
      storePath,
      defaultModel: "anthropic/claude-opus-4-5",
    });

    const queued = createQueuedRun({
      run: {
        verboseLevel: "on",
      },
    });

    await runner(queued);

    expect(onBlockReply).toHaveBeenCalled();
    const firstCall = (onBlockReply.mock.calls as unknown as Array<Array<{ text?: string }>>)[0];
    expect(firstCall?.[0]?.text).toContain("Auto-compaction complete");
    expect(sessionStore.main.compactionCount).toBe(1);
  });
});

describe("createFollowupRunner bootstrap warning dedupe", () => {
  it("passes stored warning signature history to embedded followup runs", async () => {
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      payloads: [],
      meta: {},
    });

    const sessionEntry: SessionEntry = {
      sessionId: "session",
      updatedAt: Date.now(),
      systemPromptReport: {
        source: "run",
        generatedAt: Date.now(),
        systemPrompt: {
          chars: 1,
          projectContextChars: 0,
          nonProjectContextChars: 1,
        },
        injectedWorkspaceFiles: [],
        skills: {
          promptChars: 0,
          entries: [],
        },
        tools: {
          listChars: 0,
          schemaChars: 0,
          entries: [],
        },
        bootstrapTruncation: {
          warningMode: "once",
          warningShown: true,
          promptWarningSignature: "sig-b",
          warningSignaturesSeen: ["sig-a", "sig-b"],
          truncatedFiles: 1,
          nearLimitFiles: 0,
          totalNearLimit: false,
        },
      },
    };
    const sessionStore: Record<string, SessionEntry> = { main: sessionEntry };

    const runner = createFollowupRunner({
      opts: { onBlockReply: vi.fn(async () => {}) },
      typing: createMockTypingController(),
      typingMode: "instant",
      sessionEntry,
      sessionStore,
      sessionKey: "main",
      defaultModel: "anthropic/claude-opus-4-5",
    });

    await runner(baseQueuedRun());

    const call = runEmbeddedPiAgentMock.mock.calls.at(-1)?.[0] as
      | {
          bootstrapPromptWarningSignaturesSeen?: string[];
          bootstrapPromptWarningSignature?: string;
        }
      | undefined;
    expect(call?.bootstrapPromptWarningSignaturesSeen).toEqual(["sig-a", "sig-b"]);
    expect(call?.bootstrapPromptWarningSignature).toBe("sig-b");
  });
});

describe("createFollowupRunner messaging tool dedupe", () => {
  function createMessagingDedupeRunner(
    onBlockReply: (payload: unknown) => Promise<void>,
    overrides: Partial<{
      sessionEntry: SessionEntry;
      sessionStore: Record<string, SessionEntry>;
      sessionKey: string;
      storePath: string;
    }> = {},
  ) {
    return createFollowupRunner({
      opts: { onBlockReply },
      typing: createMockTypingController(),
      typingMode: "instant",
      defaultModel: "anthropic/claude-opus-4-5",
      sessionEntry: overrides.sessionEntry,
      sessionStore: overrides.sessionStore,
      sessionKey: overrides.sessionKey,
      storePath: overrides.storePath,
    });
  }

  async function runMessagingCase(params: {
    agentResult: Record<string, unknown>;
    queued?: FollowupRun;
    runnerOverrides?: Partial<{
      sessionEntry: SessionEntry;
      sessionStore: Record<string, SessionEntry>;
      sessionKey: string;
      storePath: string;
    }>;
  }) {
    const onBlockReply = createAsyncReplySpy();
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      meta: {},
      ...params.agentResult,
    });
    const runner = createMessagingDedupeRunner(onBlockReply, params.runnerOverrides);
    await runner(params.queued ?? baseQueuedRun());
    return { onBlockReply };
  }

  function makeTextReplyDedupeResult(overrides?: Record<string, unknown>) {
    return {
      payloads: [{ text: "hello world!" }],
      messagingToolSentTexts: ["different message"],
      ...overrides,
    };
  }

  it("drops payloads already sent via messaging tool", async () => {
    const { onBlockReply } = await runMessagingCase({
      agentResult: {
        payloads: [{ text: "hello world!" }],
        messagingToolSentTexts: ["hello world!"],
      },
    });

    expect(onBlockReply).not.toHaveBeenCalled();
  });

  it("delivers payloads when not duplicates", async () => {
    const { onBlockReply } = await runMessagingCase({
      agentResult: makeTextReplyDedupeResult(),
    });

    expect(onBlockReply).toHaveBeenCalledTimes(1);
  });

  it("suppresses replies when a messaging tool sent via the same provider + target", async () => {
    const { onBlockReply } = await runMessagingCase({
      agentResult: {
        ...makeTextReplyDedupeResult(),
        messagingToolSentTargets: [{ tool: "slack", provider: "slack", to: "channel:C1" }],
      },
      queued: baseQueuedRun("slack"),
    });

    expect(onBlockReply).not.toHaveBeenCalled();
  });

  it("suppresses replies when provider is synthetic but originating channel matches", async () => {
    const { onBlockReply } = await runMessagingCase({
      agentResult: {
        ...makeTextReplyDedupeResult(),
        messagingToolSentTargets: [{ tool: "telegram", provider: "telegram", to: "268300329" }],
      },
      queued: {
        ...baseQueuedRun("heartbeat"),
        originatingChannel: "telegram",
        originatingTo: "268300329",
      } as FollowupRun,
    });

    expect(onBlockReply).not.toHaveBeenCalled();
  });

  it("does not suppress replies for same target when account differs", async () => {
    const { onBlockReply } = await runMessagingCase({
      agentResult: {
        ...makeTextReplyDedupeResult(),
        messagingToolSentTargets: [
          { tool: "telegram", provider: "telegram", to: "268300329", accountId: "work" },
        ],
      },
      queued: {
        ...baseQueuedRun("heartbeat"),
        originatingChannel: "telegram",
        originatingTo: "268300329",
        originatingAccountId: "personal",
      } as FollowupRun,
    });

    expect(routeReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        to: "268300329",
        accountId: "personal",
      }),
    );
    expect(onBlockReply).not.toHaveBeenCalled();
  });

  it("drops media URL from payload when messaging tool already sent it", async () => {
    const { onBlockReply } = await runMessagingCase({
      agentResult: {
        payloads: [{ mediaUrl: "/tmp/img.png" }],
        messagingToolSentMediaUrls: ["/tmp/img.png"],
      },
    });

    // Media stripped → payload becomes non-renderable → not delivered.
    expect(onBlockReply).not.toHaveBeenCalled();
  });

  it("delivers media payload when not a duplicate", async () => {
    const { onBlockReply } = await runMessagingCase({
      agentResult: {
        payloads: [{ mediaUrl: "/tmp/img.png" }],
        messagingToolSentMediaUrls: ["/tmp/other.png"],
      },
    });

    expect(onBlockReply).toHaveBeenCalledTimes(1);
  });

  it("persists usage even when replies are suppressed", async () => {
    const storePath = path.join(
      await fs.mkdtemp(path.join(tmpdir(), "openbot-followup-usage-")),
      "sessions.json",
    );
    const sessionKey = "main";
    const sessionEntry: SessionEntry = { sessionId: "session", updatedAt: Date.now() };
    const sessionStore: Record<string, SessionEntry> = { [sessionKey]: sessionEntry };
    await saveSessionStore(storePath, sessionStore);

    const { onBlockReply } = await runMessagingCase({
      agentResult: {
        ...makeTextReplyDedupeResult(),
        messagingToolSentTargets: [{ tool: "slack", provider: "slack", to: "channel:C1" }],
        meta: {
          agentMeta: {
            usage: { input: 1_000, output: 50 },
            lastCallUsage: { input: 400, output: 20 },
            model: "claude-opus-4-5",
            provider: "anthropic",
          },
        },
      },
      runnerOverrides: {
        sessionEntry,
        sessionStore,
        sessionKey,
        storePath,
      },
      queued: baseQueuedRun("slack"),
    });

    expect(onBlockReply).not.toHaveBeenCalled();
    const store = loadSessionStore(storePath, { skipCache: true });
    // totalTokens should reflect the last call usage snapshot, not the accumulated input.
    expect(store[sessionKey]?.totalTokens).toBe(400);
    expect(store[sessionKey]?.model).toBe("claude-opus-4-5");
    // Accumulated usage is still stored for usage/cost tracking.
    expect(store[sessionKey]?.inputTokens).toBe(1_000);
    expect(store[sessionKey]?.outputTokens).toBe(50);
  });

  it("does not fall back to dispatcher when cross-channel origin routing fails", async () => {
    routeReplyMock.mockResolvedValueOnce({
      ok: false,
      error: "forced route failure",
    });
    const { onBlockReply } = await runMessagingCase({
      agentResult: { payloads: [{ text: "hello world!" }] },
      queued: {
        ...baseQueuedRun("webchat"),
        originatingChannel: "discord",
        originatingTo: "channel:C1",
      } as FollowupRun,
    });

    expect(routeReplyMock).toHaveBeenCalled();
    expect(onBlockReply).not.toHaveBeenCalled();
  });

  it("falls back to dispatcher when same-channel origin routing fails", async () => {
    routeReplyMock.mockResolvedValueOnce({
      ok: false,
      error: "outbound adapter unavailable",
    });
    const { onBlockReply } = await runMessagingCase({
      agentResult: { payloads: [{ text: "hello world!" }] },
      queued: {
        ...baseQueuedRun(" Feishu "),
        originatingChannel: "FEISHU",
        originatingTo: "ou_abc123",
      } as FollowupRun,
    });

    expect(routeReplyMock).toHaveBeenCalled();
    expect(onBlockReply).toHaveBeenCalledTimes(1);
    expect(onBlockReply).toHaveBeenCalledWith(expect.objectContaining({ text: "hello world!" }));
  });

  it("routes followups with originating account/thread metadata", async () => {
    const { onBlockReply } = await runMessagingCase({
      agentResult: { payloads: [{ text: "hello world!" }] },
      queued: {
        ...baseQueuedRun("webchat"),
        originatingChannel: "discord",
        originatingTo: "channel:C1",
        originatingAccountId: "work",
        originatingThreadId: "1739142736.000100",
      } as FollowupRun,
    });

    expect(routeReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "discord",
        to: "channel:C1",
        accountId: "work",
        threadId: "1739142736.000100",
      }),
    );
    expect(onBlockReply).not.toHaveBeenCalled();
  });
});

describe("createFollowupRunner typing cleanup", () => {
  async function runTypingCase(agentResult: Record<string, unknown>) {
    const typing = createMockTypingController();
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      meta: {},
      ...agentResult,
    });

    const runner = createFollowupRunner({
      opts: { onBlockReply: createAsyncReplySpy() },
      typing,
      typingMode: "instant",
      defaultModel: "anthropic/claude-opus-4-5",
    });

    await runner(baseQueuedRun());
    return typing;
  }

  function expectTypingCleanup(typing: ReturnType<typeof createMockTypingController>) {
    expect(typing.markRunComplete).toHaveBeenCalled();
    expect(typing.markDispatchIdle).toHaveBeenCalled();
  }

  it("calls both markRunComplete and markDispatchIdle on NO_REPLY", async () => {
    const typing = await runTypingCase({ payloads: [{ text: "NO_REPLY" }] });
    expectTypingCleanup(typing);
  });

  it("calls both markRunComplete and markDispatchIdle on empty payloads", async () => {
    const typing = await runTypingCase({ payloads: [] });
    expectTypingCleanup(typing);
  });

  it("calls both markRunComplete and markDispatchIdle on agent error", async () => {
    const typing = createMockTypingController();
    runEmbeddedPiAgentMock.mockRejectedValueOnce(new Error("agent exploded"));

    const runner = createFollowupRunner({
      opts: { onBlockReply: vi.fn(async () => {}) },
      typing,
      typingMode: "instant",
      defaultModel: "anthropic/claude-opus-4-5",
    });

    await runner(baseQueuedRun());

    expectTypingCleanup(typing);
  });

  it("calls both markRunComplete and markDispatchIdle on successful delivery", async () => {
    const typing = createMockTypingController();
    const onBlockReply = vi.fn(async () => {});
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      payloads: [{ text: "hello world!" }],
      meta: {},
    });

    const runner = createFollowupRunner({
      opts: { onBlockReply },
      typing,
      typingMode: "instant",
      defaultModel: "anthropic/claude-opus-4-5",
    });

    await runner(baseQueuedRun());

    expect(onBlockReply).toHaveBeenCalled();
    expectTypingCleanup(typing);
  });
});

describe("createFollowupRunner agentDir forwarding", () => {
  it("passes queued run agentDir to runEmbeddedPiAgent", async () => {
    runEmbeddedPiAgentMock.mockClear();
    const onBlockReply = vi.fn(async () => {});
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      payloads: [{ text: "hello world!" }],
      messagingToolSentTexts: ["different message"],
      meta: {},
    });
    const runner = createFollowupRunner({
      opts: { onBlockReply },
      typing: createMockTypingController(),
      typingMode: "instant",
      defaultModel: "anthropic/claude-opus-4-5",
    });
    const agentDir = path.join("/tmp", "agent-dir");
    const queued = createQueuedRun();
    await runner({
      ...queued,
      run: {
        ...queued.run,
        agentDir,
      },
    });

    expect(runEmbeddedPiAgentMock).toHaveBeenCalledTimes(1);
    const call = runEmbeddedPiAgentMock.mock.calls.at(-1)?.[0] as { agentDir?: string };
    expect(call?.agentDir).toBe(agentDir);
  });

  it("forwards disableTools so the embedded run tool list stays empty", async () => {
    runEmbeddedPiAgentMock.mockClear();
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      payloads: [{ text: "hello world!" }],
      meta: {},
    });
    const runner = createFollowupRunner({
      opts: { onBlockReply: vi.fn(async () => {}) },
      typing: createMockTypingController(),
      typingMode: "instant",
      defaultModel: "anthropic/claude-opus-4-5",
    });
    const queued = createQueuedRun({ run: { disableTools: true } });
    await runner(queued);
    const call = runEmbeddedPiAgentMock.mock.calls.at(-1)?.[0] as { disableTools?: boolean };
    expect(call?.disableTools).toBe(true);
  });

  it("forwards inboundToolCeiling so retrieve stays on the read-only set", async () => {
    runEmbeddedPiAgentMock.mockClear();
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      payloads: [{ text: "hello world!" }],
      meta: {},
    });
    const runner = createFollowupRunner({
      opts: { onBlockReply: vi.fn(async () => {}) },
      typing: createMockTypingController(),
      typingMode: "instant",
      defaultModel: "anthropic/claude-opus-4-5",
    });
    const ceiling = {
      depth: "retrieve" as const,
      maxToolMode: "read" as const,
      maxSideEffectLevel: "none" as const,
    };
    const queued = createQueuedRun({ run: { inboundToolCeiling: ceiling } });
    await runner(queued);
    const call = runEmbeddedPiAgentMock.mock.calls.at(-1)?.[0] as {
      inboundToolCeiling?: typeof ceiling;
    };
    expect(call?.inboundToolCeiling).toEqual(ceiling);
  });

  it("forwards queued execution identity tenant and membership into the embedded run", async () => {
    runEmbeddedPiAgentMock.mockClear();
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      payloads: [{ text: "hello world!" }],
      meta: {},
    });
    const runner = createFollowupRunner({
      opts: { onBlockReply: vi.fn(async () => {}) },
      typing: createMockTypingController(),
      typingMode: "instant",
      defaultModel: "anthropic/claude-opus-4-5",
    });
    const executionIdentity = createExecutionIdentityContext({
      user: "employee@acme.example",
      platformUserId: "emp-1",
      sessionDomain: "employee",
      enterpriseId: "001",
      membershipId: "mem-1",
      agentId: "main",
      sessionKey: "agent:main:employee:emp-1",
    });
    const queued = createQueuedRun({
      run: {
        agentId: "main",
        executionIdentity,
        gatewayClientUser: executionIdentity.user,
        gatewayClientSessionDomain: executionIdentity.sessionDomain,
        gatewayClientPlatformUserId: executionIdentity.platformUserId,
      },
    });
    await runner(queued);
    const call = runEmbeddedPiAgentMock.mock.calls.at(-1)?.[0] as {
      executionIdentity?: typeof executionIdentity;
      gatewayClientSessionEnterpriseId?: string;
      gatewayClientSessionMembershipId?: string;
      gatewayClientUser?: string;
    };
    expect(call?.executionIdentity?.enterpriseId).toBe("001");
    expect(call?.executionIdentity?.membershipId).toBe("mem-1");
    expect(call?.gatewayClientSessionEnterpriseId).toBe("001");
    expect(call?.gatewayClientSessionMembershipId).toBe("mem-1");
    expect(call?.gatewayClientUser).toBe("employee@acme.example");
  });
});

describe("queued task binding claim", () => {
  it.each(["delivered", "failed", "unknown", "unverified", "empty"] as const)(
    "settles queued task only with verified acceptance and actual delivery: %s",
    async (mode) => {
      const board = await import("../../conversation-task/session-task-board.js");
      const governance = await import("../../gateway/billing/agent-run-governance.js");
      const root = await fs.mkdtemp(path.join(tmpdir(), "followup-delivery-"));
      const sessionFile = path.join(root, "session.jsonl");
      await fs.writeFile(sessionFile, "");
      board.mutateSessionTaskBoard(sessionFile, () => ({
        board: {
          ...board.emptySessionTaskBoard(),
          current: {
            taskId: "a",
            title: "report",
            goalText: "write report",
            unfinished: true,
            createdAtMs: 1,
            stop: { summary: "waiting", workspacePaths: [] },
          },
        },
        value: undefined,
      }));
      const queued = createQueuedRun({
        originatingChannel: mode === "unknown" ? undefined : "telegram",
        originatingTo: "target",
        followupItemId: "item",
        run: {
          agentId: "test",
          sessionKey: "agent:test:main",
          sessionFile,
          config: { agents: { list: [{ id: "test", agentDir: root }] } },
          taskCompletionBinding: board.captureTaskCompletionBinding(sessionFile),
        },
      });
      const admission = vi
        .spyOn(governance, "tryAcquireEnterpriseAgentRun")
        .mockResolvedValue({ acquired: false, skipped: true });
      runEmbeddedPiAgentMock.mockReset();
      runEmbeddedPiAgentMock.mockResolvedValue({
        payloads: mode === "empty" ? [] : [{ text: "report with verified sources" }],
        meta: {
          hookDelivery: {
            validatorsRequired: true,
            decisionCode: mode === "unverified" ? "delivery_blocked" : "delivery_receipt_verified",
            validatorReceipts: [{ validatorId: "sources" }],
            intentClass: "long_running",
          },
        },
      });
      routeReplyMock.mockResolvedValue(
        mode === "failed" ? { ok: false, error: "offline" } : { ok: true },
      );
      try {
        await createFollowupRunner({
          opts: { onBlockReply: createAsyncReplySpy() },
          typing: createMockTypingController(),
          typingMode: "instant",
          defaultModel: "anthropic/claude",
        })(queued);
        expect(runEmbeddedPiAgentMock).toHaveBeenCalledOnce();
        expect(board.readSessionTaskBoard(sessionFile).current?.unfinished).toBe(
          mode !== "delivered",
        );
      } finally {
        admission.mockRestore();
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );
  it("rejects a queued A request after same-goal B becomes current without invoking the provider", async () => {
    const {
      mutateSessionTaskBoard,
      emptySessionTaskBoard,
      captureTaskCompletionBinding,
      readSessionTaskBoard,
    } = await import("../../conversation-task/session-task-board.js");
    const dir = await fs.mkdtemp(path.join(tmpdir(), "followup-binding-"));
    try {
      const sessionFile = path.join(dir, "session.jsonl");
      await fs.writeFile(sessionFile, "");
      const task = {
        taskId: "a",
        title: "same",
        goalText: "same",
        unfinished: true,
        createdAtMs: 1,
        stop: { summary: "", workspacePaths: [] },
      };
      mutateSessionTaskBoard(sessionFile, () => ({
        board: { ...emptySessionTaskBoard(), current: task },
        value: undefined,
      }));
      const binding = captureTaskCompletionBinding(sessionFile);
      mutateSessionTaskBoard(sessionFile, (board) => ({
        board: { ...board, current: { ...task, taskId: "b" } },
        value: undefined,
      }));
      const typing = createMockTypingController();
      const onBlockReply = createAsyncReplySpy();
      const runner = createFollowupRunner({
        opts: { onBlockReply },
        typing,
        typingMode: "instant",
        sessionStore: {},
        sessionKey: "main",
        defaultModel: "anthropic/claude",
      });
      runEmbeddedPiAgentMock.mockClear();
      await runner(createQueuedRun({ run: { sessionFile, taskCompletionBinding: binding } }));
      expect(runEmbeddedPiAgentMock).not.toHaveBeenCalled();
      expect(readSessionTaskBoard(sessionFile).current?.taskId).toBe("b");
      expect(readSessionTaskBoard(sessionFile).current?.executionAttempt).toBeUndefined();
      expect(typing.markRunComplete).toHaveBeenCalled();
      expect(typing.markDispatchIdle).toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

it("does not start queued provider work when owner pause arrives during async transport preparation", async () => {
  const boardApi = await import("../../conversation-task/session-task-board.js");
  const transportApi = await import("../../gateway/enterprise-model/embedded-transport.js");
  const dir = await fs.mkdtemp(path.join(tmpdir(), "followup-pause-prep-"));
  const sessionFile = path.join(dir, "session.jsonl");
  await fs.writeFile(sessionFile, "");
  const task = {
    taskId: "a",
    title: "A",
    goalText: "A",
    unfinished: true,
    createdAtMs: 1,
    stop: { summary: "", workspacePaths: [] },
  };
  boardApi.mutateSessionTaskBoard(sessionFile, () => ({
    board: { ...boardApi.emptySessionTaskBoard(), current: task },
    value: undefined,
  }));
  const queued = createQueuedRun({
    run: { sessionFile, taskCompletionBinding: boardApi.captureTaskCompletionBinding(sessionFile) },
  });
  const spy = vi
    .spyOn(transportApi, "resolveEnterpriseEmbeddedTransport")
    .mockImplementationOnce(async ({ provider, model }) => {
      boardApi.mutateSessionTaskBoard(sessionFile, (board) => ({
        board: { ...board, current: { ...board.current!, wakeSuppress: true } },
        value: undefined,
      }));
      return { provider, model };
    });
  try {
    runEmbeddedPiAgentMock.mockClear();
    const typing = createMockTypingController();
    await createFollowupRunner({
      opts: { onBlockReply: createAsyncReplySpy() },
      typing,
      typingMode: "instant",
      sessionStore: {},
      sessionKey: "main",
      defaultModel: "anthropic/claude",
    })(queued);
    expect(spy).toHaveBeenCalled();
    expect(runEmbeddedPiAgentMock).not.toHaveBeenCalled();
    expect(typing.markRunComplete).toHaveBeenCalled();
    expect(typing.markDispatchIdle).toHaveBeenCalled();
  } finally {
    spy.mockRestore();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it("refreshes queued task-board continuation with owner constraints accepted after enqueue", async () => {
  const boardApi = await import("../../conversation-task/session-task-board.js");
  const dir = await fs.mkdtemp(path.join(tmpdir(), "followup-continue-live-"));
  try {
    const sessionFile = path.join(dir, "session.jsonl");
    await fs.writeFile(sessionFile, "");
    boardApi.mutateSessionTaskBoard(sessionFile, () => ({
      board: {
        ...boardApi.emptySessionTaskBoard(),
        focusRevision: 1,
        current: {
          taskId: "a",
          title: "report",
          goalText: "write report",
          unfinished: true,
          createdAtMs: 1,
          executionAttempt: "old-run",
          deliverableVersion: "v1",
          stop: { summary: "waiting", workspacePaths: [] },
        },
      },
      value: undefined,
    }));
    const queued = createQueuedRun({
      prompt: "old resume text",
      taskBoardContinueTicket: { taskId: "a", focusRevision: 1 },
      run: {
        sessionFile,
        taskCompletionBinding: boardApi.captureTaskCompletionBinding(sessionFile),
      },
    });
    expect(
      boardApi.commitSameTaskConstraint({
        sessionFile,
        expectedTaskId: "a",
        constraintText: "必须保留来源链接，不要发布",
      }),
    ).toBe(true);
    runEmbeddedPiAgentMock.mockReset();
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "report with sources" }],
      meta: {},
    });
    const runner = createFollowupRunner({
      opts: { onBlockReply: createAsyncReplySpy() },
      typing: createMockTypingController(),
      typingMode: "instant",
      defaultModel: "anthropic/claude",
    });
    await runner(queued);
    expect(runEmbeddedPiAgentMock).toHaveBeenCalledOnce();
    expect(runEmbeddedPiAgentMock.mock.calls[0][0].prompt).toContain("必须保留来源链接，不要发布");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it.each(["paused", "focus changed", "new attempt"] as const)(
  "rejects a queued continue ticket after %s without provider execution",
  async (change) => {
    const api = await import("../../conversation-task/session-task-board.js");
    const dir = await fs.mkdtemp(path.join(tmpdir(), "continue-revalidate-"));
    try {
      const sessionFile = path.join(dir, "session.jsonl");
      await fs.writeFile(sessionFile, "");
      api.mutateSessionTaskBoard(sessionFile, () => ({
        board: {
          ...api.emptySessionTaskBoard(),
          focusRevision: 1,
          current: {
            taskId: "a",
            title: "A",
            goalText: "A",
            unfinished: true,
            createdAtMs: 1,
            executionAttempt: "old",
            deliverableVersion: "v1",
            stop: { summary: "waiting", workspacePaths: [] },
          },
        },
        value: undefined,
      }));
      const queued = createQueuedRun({
        taskBoardContinueTicket: { taskId: "a", focusRevision: 1 },
        run: { sessionFile, taskCompletionBinding: api.captureTaskCompletionBinding(sessionFile) },
      });
      api.mutateSessionTaskBoard(sessionFile, (board) => ({
        board: {
          ...board,
          ...(change === "focus changed" ? { focusRevision: 2 } : {}),
          current: {
            ...board.current!,
            ...(change === "paused"
              ? { wakeSuppress: true }
              : change === "new attempt"
                ? { executionAttempt: "new" }
                : {}),
          },
        },
        value: undefined,
      }));
      const before = api.readSessionTaskBoard(sessionFile);
      runEmbeddedPiAgentMock.mockClear();
      const typing = createMockTypingController();
      await createFollowupRunner({
        opts: { onBlockReply: createAsyncReplySpy() },
        typing,
        typingMode: "instant",
        defaultModel: "anthropic/claude",
      })(queued);
      expect(runEmbeddedPiAgentMock).not.toHaveBeenCalled();
      expect(api.readSessionTaskBoard(sessionFile).current).toEqual(before.current);
      expect(typing.markRunComplete).toHaveBeenCalled();
      expect(typing.markDispatchIdle).toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

vi.mock("../../agent-runtime/execution/runner/embedded-run.js", async () => {
  const { runEmbeddedPiAgent } = await import("../../agents/pi-embedded.js");
  return { runEmbeddedPiAgent };
});
