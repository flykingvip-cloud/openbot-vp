/**
 * Real runEmbeddedAttempt boundary: contextEngine.assemble + post-assemble
 * sanitizeToolUseResultPairing must leave provider-bound messages without
 * orphan toolResult rows. Captures messages at session.prompt time.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LegacyContextEngine } from "../../../context-engine/legacy.js";
import type { ConstitutionalRuntimeShadowDeps } from "../../execution-preflight/constitutional-runtime-shadow-deps.js";
import { NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK } from "../../execution-preflight/constitutional-runtime-shadow-sink.js";
import type { OpenBotAuthStorage } from "../../pi-sdk/auth-storage.js";

const hoisted = vi.hoisted(() => {
  const createAgentSessionMock = vi.fn();
  const sessionManagerOpenMock = vi.fn();
  const acquireSessionWriteLockMock = vi.fn();
  const subscribeEmbeddedPiSessionMock = vi.fn();
  const seedMessages: unknown[] = [];
  const sessionManager = {
    getHeader: vi.fn(() => ({ type: "session", id: "pairing-session", version: 1 })),
    getLeafEntry: vi.fn(() => null),
    branch: vi.fn(),
    resetLeaf: vi.fn(),
    buildSessionContext: vi.fn(() => ({ messages: [...seedMessages] })),
    appendCustomEntry: vi.fn(),
  };
  return {
    createAgentSessionMock,
    sessionManagerOpenMock,
    acquireSessionWriteLockMock,
    subscribeEmbeddedPiSessionMock,
    seedMessages,
    sessionManager,
  };
});

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    createAgentSession: (...args: unknown[]) => hoisted.createAgentSessionMock(...args),
    DefaultResourceLoader: class {
      async reload() {}
    },
    SessionManager: {
      open: (...args: unknown[]) => hoisted.sessionManagerOpenMock(...args),
    } as unknown as typeof actual.SessionManager,
  };
});

vi.mock("../../session-tool-result-guard-wrapper.js", () => ({
  guardSessionManager: () => hoisted.sessionManager,
}));

vi.mock("../../pi-embedded-subscribe.js", () => ({
  subscribeEmbeddedPiSession: (...args: unknown[]) =>
    hoisted.subscribeEmbeddedPiSessionMock(...args),
}));

vi.mock("../../../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => undefined,
}));

vi.mock("../../../infra/machine-name.js", () => ({
  getMachineDisplayName: async () => "test-host",
}));

vi.mock("../../../infra/net/undici-global-dispatcher.js", () => ({
  ensureGlobalUndiciStreamTimeouts: () => {},
}));

vi.mock("../../bootstrap-files.js", () => ({
  makeBootstrapWarn: () => () => {},
  resolveBootstrapContextForRun: async () => ({ bootstrapFiles: [], contextFiles: [] }),
}));

vi.mock("../../skills.js", () => ({
  applySkillEnvOverrides: () => () => {},
  applySkillEnvOverridesFromSnapshot: () => () => {},
  resolveSkillsPromptForRun: () => "",
}));

vi.mock("../skills-runtime.js", () => ({
  resolveEmbeddedRunSkillEntries: () => ({
    shouldLoadSkillEntries: false,
    skillEntries: [],
  }),
}));

vi.mock("../../docs-path.js", () => ({
  resolveOpenClawDocsPath: async () => undefined,
}));

vi.mock("../../pi-project-settings.js", () => ({
  createPreparedEmbeddedPiSettingsManager: () => ({}),
}));

vi.mock("../../pi-settings.js", () => ({
  applyPiAutoCompactionGuard: () => {},
}));

vi.mock("../extensions.js", () => ({
  buildEmbeddedExtensionFactories: () => [],
}));

vi.mock("../google.js", () => ({
  logToolSchemasForGoogle: () => {},
  sanitizeSessionHistory: async ({ messages }: { messages: unknown[] }) => messages,
  sanitizeToolsForGoogle: ({ tools }: { tools: unknown[] }) => tools,
}));

vi.mock("../../session-file-repair.js", () => ({
  repairSessionFileIfNeeded: async () => {},
}));

vi.mock("../session-manager-cache.js", () => ({
  prewarmSessionFile: async () => {},
  trackSessionManagerAccess: () => {},
}));

vi.mock("../session-manager-init.js", () => ({
  prepareSessionManagerForRun: async () => {},
}));

vi.mock("../../session-write-lock.js", () => ({
  acquireSessionWriteLock: (...args: unknown[]) => hoisted.acquireSessionWriteLockMock(...args),
  resolveSessionLockMaxHoldFromTimeout: () => 1,
}));

vi.mock("../tool-result-context-guard.js", () => ({
  installToolResultContextGuard: () => () => {},
}));

vi.mock("../../context-compiler/flag.js", () => ({
  isContextCompilerEnabled: () => false,
}));

vi.mock("../wait-for-idle-before-flush.js", () => ({
  flushPendingToolResultsAfterIdle: async () => {},
}));

vi.mock("../runs.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runs.js")>()),
}));

vi.mock("./images.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./images.js")>();
  return {
    ...actual,
    detectAndLoadPromptImages: async () => ({ images: [] }),
  };
});

vi.mock("../../system-prompt-params.js", () => ({
  buildSystemPromptParams: () => ({
    runtimeInfo: {},
    userTimezone: "UTC",
    userTime: "00:00",
    userTimeFormat: "24h",
  }),
}));

vi.mock("../../system-prompt-report.js", () => ({
  buildSystemPromptReport: () => undefined,
}));

vi.mock("../system-prompt.js", () => ({
  applySystemPromptOverrideToSession: () => {},
  buildEmbeddedSystemPrompt: () => "system prompt",
  createSystemPromptOverride: (prompt: string) => () => prompt,
}));

vi.mock("../extra-params.js", () => ({
  applyExtraParamsToAgent: () => {},
}));

vi.mock("../../openai-ws-stream.js", () => ({
  createOpenAIWebSocketStreamFn: vi.fn(),
  releaseWsSession: () => {},
}));

vi.mock("../../anthropic-payload-log.js", () => ({
  createAnthropicPayloadLogger: () => undefined,
}));

vi.mock("../../cache-trace.js", () => ({
  createCacheTrace: () => undefined,
}));

vi.mock("../../sandbox.js", () => ({
  resolveSandboxContext: async () => null,
}));

vi.mock("../../model-selection.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../model-selection.js")>();
  return {
    ...actual,
    normalizeProviderId: (providerId?: string) => providerId?.trim().toLowerCase() ?? "",
    resolveDefaultModelForAgent: () => ({ provider: "openai", model: "gpt-test" }),
  };
});

const { runEmbeddedAttempt } = await import("./attempt.js");

const constitutionalRuntimeShadowDeps: ConstitutionalRuntimeShadowDeps = Object.freeze({
  runtimeShadowEnabled: false,
  sink: NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK,
  now: () => 0,
});

const MODEL = {
  api: "openai-completions",
  provider: "openai",
  compat: {},
  contextWindow: 8192,
  input: ["text"],
} as unknown as Model<Api>;

function hasOrphanToolResult(messages: unknown[]): boolean {
  const callIds = new Set<string>();
  for (const m of messages) {
    const role = (m as { role?: string }).role;
    if (role !== "assistant") {
      continue;
    }
    const content = (m as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: string }).type === "toolCall" &&
        typeof (part as { id?: string }).id === "string"
      ) {
        callIds.add((part as { id: string }).id);
      }
    }
  }
  return messages.some((m) => {
    if ((m as { role?: string }).role !== "toolResult") {
      return false;
    }
    const id = (m as { toolCallId?: string }).toolCallId;
    return typeof id === "string" && !callIds.has(id);
  });
}

describe("runEmbeddedAttempt context assemble pairing boundary", () => {
  let workspaceDir = "";
  let agentDir = "";
  let providerMessages: unknown[] = [];

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "attempt-pair-ws-"));
    agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "attempt-pair-agent-"));
    providerMessages = [];
    hoisted.seedMessages.length = 0;
    hoisted.createAgentSessionMock.mockReset();
    hoisted.sessionManagerOpenMock.mockReset();
    hoisted.sessionManagerOpenMock.mockReturnValue(hoisted.sessionManager);
    hoisted.acquireSessionWriteLockMock.mockReset();
    hoisted.acquireSessionWriteLockMock.mockResolvedValue({ release: async () => {} });
    hoisted.subscribeEmbeddedPiSessionMock.mockReset();
    hoisted.subscribeEmbeddedPiSessionMock.mockReturnValue({
      assistantTexts: [],
      toolMetas: [],
      unsubscribe: () => {},
      waitForCompactionRetry: async () => {},
      getMessagingToolSentTexts: () => [],
      getMessagingToolSentMediaUrls: () => [],
      getMessagingToolSentTargets: () => [],
      getSuccessfulCronAdds: () => 0,
      didSendViaMessagingTool: () => false,
      didSendReaction: () => false,
      didSendDeterministicApprovalPrompt: () => false,
      getLastToolError: () => undefined,
      getUsageTotals: () => undefined,
      getCompactionCount: () => 0,
      isCompacting: () => false,
    });

    delete process.env.OPENBOT_CONVERSATION_CONTEXT_PLANNER;

    hoisted.seedMessages.push(
      { role: "user", content: "old", timestamp: 1 },
      {
        role: "assistant",
        content: [
          { type: "text", text: "x".repeat(40_000) },
          { type: "toolCall", id: "call_1", name: "read", arguments: { path: "x" } },
        ],
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: "ok" }],
        isError: false,
        timestamp: 3,
      },
      { role: "user", content: "continue", timestamp: 4 },
    );

    hoisted.createAgentSessionMock.mockImplementation(async () => {
      const session: {
        sessionId: string;
        messages: unknown[];
        isCompacting: boolean;
        isStreaming: boolean;
        agent: {
          streamFn?: unknown;
          streamFunction?: unknown;
          state: { messages: unknown[] };
        };
        prompt: () => Promise<void>;
        abort: () => Promise<void>;
        dispose: () => void;
        steer: () => Promise<void>;
      } = {
        sessionId: "pairing-session",
        messages: [...hoisted.seedMessages],
        isCompacting: false,
        isStreaming: false,
        agent: {
          state: {
            get messages() {
              return session.messages;
            },
            set messages(next: unknown[]) {
              session.messages = [...next];
            },
          },
        },
        prompt: async () => {
          // Messages that would be sent to the provider after assemble/sanitize.
          providerMessages = [...session.messages];
        },
        abort: async () => {},
        dispose: () => {},
        steer: async () => {},
      };
      return { session };
    });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(agentDir, { recursive: true, force: true });
  });

  it("runEmbeddedAttempt drops orphan toolResult before prompt/provider", async () => {
    const sessionFile = path.join(workspaceDir, "session.jsonl");
    await fs.writeFile(sessionFile, "", "utf8");

    const contextEngine = new LegacyContextEngine({
      conversation: { projection: { enabled: false } },
    } as never);

    const result = await runEmbeddedAttempt({
      sessionId: "pairing-session",
      sessionKey: "agent:main:main",
      sessionFile,
      workspaceDir,
      agentDir,
      config: {
        conversation: {
          contextPlanner: { enabled: true },
          projection: { enabled: false },
        },
      } as never,
      prompt: "continue",
      timeoutMs: 10_000,
      runId: "pair-run-1",
      provider: "openai",
      modelId: "gpt-test",
      model: MODEL,
      authStorage: { getApiKey: async () => undefined } as unknown as OpenBotAuthStorage,
      modelRegistry: {} as ModelRegistry,
      thinkLevel: "off",
      senderIsOwner: true,
      disableMessageTool: true,
      contextEngine,
      contextTokenBudget: 4_000,
      constitutionalRuntimeShadowDeps,
    });

    expect(result.promptError).toBeNull();
    expect(providerMessages.length).toBeGreaterThan(0);
    expect(hasOrphanToolResult(providerMessages)).toBe(false);
    const hasResult = providerMessages.some(
      (m) =>
        (m as { role?: string }).role === "toolResult" &&
        (m as { toolCallId?: string }).toolCallId === "call_1",
    );
    const hasCall = providerMessages.some((m) => {
      if ((m as { role?: string }).role !== "assistant") {
        return false;
      }
      const content = (m as { content?: unknown }).content;
      return (
        Array.isArray(content) &&
        content.some(
          (p) =>
            p &&
            typeof p === "object" &&
            (p as { type?: string; id?: string }).type === "toolCall" &&
            (p as { id?: string }).id === "call_1",
        )
      );
    });
    expect(hasResult && !hasCall).toBe(false);
  });
  it("aborts stopped tasks at registration without starting prompt and releases the session lock", async () => {
    const boardApi = await import("../../../conversation-task/session-task-board.js");
    const runs = await import("../runs.js");
    const sessionFile = path.join(workspaceDir, "session.jsonl");
    await fs.writeFile(sessionFile, "");
    boardApi.mutateSessionTaskBoard(sessionFile, () => ({
      board: {
        ...boardApi.emptySessionTaskBoard(),
        current: {
          taskId: "task-a",
          title: "A",
          goalText: "A",
          unfinished: true,
          createdAtMs: 1,
          stop: { summary: "preparing", workspacePaths: [] },
          executionAttempt: "attempt-a",
          deliverableVersion: "attempt-a",
        },
      },
      value: undefined,
    }));
    const binding = boardApi.captureTaskCompletionBinding(sessionFile);
    const create = hoisted.createAgentSessionMock.getMockImplementation()!;
    hoisted.createAgentSessionMock.mockImplementationOnce(async (...args: unknown[]) => {
      const value = await create(...args);
      // Owner stop arrives while the runtime is still preparing, before active registration.
      boardApi.mutateSessionTaskBoard(sessionFile, (board) => ({
        board: { ...board, current: { ...board.current!, wakeSuppress: true } },
        value: undefined,
      }));
      return value;
    });
    const release = vi.fn(async () => {});
    hoisted.acquireSessionWriteLockMock.mockResolvedValue({ release });
    await expect(
      runEmbeddedAttempt({
        sessionId: "pairing-session",
        sessionKey: "agent:main:main",
        sessionFile,
        taskExecutionBinding: binding,
        workspaceDir,
        agentDir,
        config: { conversation: { projection: { enabled: false } } } as never,
        prompt: "continue",
        timeoutMs: 10_000,
        runId: "stopped-run",
        provider: "openai",
        modelId: "gpt-test",
        model: MODEL,
        authStorage: { getApiKey: async () => undefined } as unknown as OpenBotAuthStorage,
        modelRegistry: {} as ModelRegistry,
        thinkLevel: "off",
        senderIsOwner: true,
        disableMessageTool: true,
        constitutionalRuntimeShadowDeps,
      }),
    ).rejects.toThrow("aborted");
    expect(providerMessages).toEqual([]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(runs.isEmbeddedPiRunActive("pairing-session")).toBe(false);
  });
});
