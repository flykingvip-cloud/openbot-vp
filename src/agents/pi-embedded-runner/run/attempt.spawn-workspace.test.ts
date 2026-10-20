/**
 * attempt.spawn-workspace.test.ts
 *
 * Integration harness for runEmbeddedAttempt workspace inheritance and Constitutional
 * shadow observation. Drives the real preflight (buildExecutionPreflight +
 * applyPreflightToTools) through plain, deny, capability-ceiling, and delivery-hold decisions.
 *
 * vi.mock usage:
 * - Pass-through spies (buildExecutionPreflight, applyPreflightToTools,
 *   observePreflightRuntimeFacade, projectPreflightShadowObservation) for observation and
 *   one-shot fault injection (B-11, B-33, B-38).
 * - Per-test skill fixture (hoisted.skillEntries, returned by the skills-runtime mock) to
 *   drive the real preflight to delivery-hold (B-09). This is an approved exception to the
 *   "vi.mock for fault injection and observation only" rule — accepted by Codex on 2026-07-28
 *   because the alternatives (real filesystem skill setup or production parameter injection)
 *   carry higher cost and risk. The preflight decision logic itself remains real and untouched.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type {
  ExtensionContext,
  ModelRegistry,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observePreflightRuntimeFacade } from "../../execution-preflight/constitutional-runtime-facade.js";
import type { ConstitutionalRuntimeShadowDeps } from "../../execution-preflight/constitutional-runtime-shadow-deps.js";
import {
  CONSTITUTIONAL_RUNTIME_SHADOW_RECORD_KEYS,
  projectPreflightShadowObservation,
} from "../../execution-preflight/constitutional-runtime-shadow-projection.js";
import {
  NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK,
  type ConstitutionalRuntimeShadowErrorCode,
  type ConstitutionalRuntimeShadowRecord,
  type ConstitutionalRuntimeShadowSink,
} from "../../execution-preflight/constitutional-runtime-shadow-sink.js";
import {
  applyPreflightToTools,
  buildExecutionPreflight,
  resetCompletionHoldsForTest,
  resetDeliveryArtifactsForTest,
  resetExecutionTraceForTest,
  type ExecutionPreflight,
} from "../../execution-preflight/index.js";
import type { InboundToolCeiling } from "../../inbound-tool-policy.js";
import type { OpenBotAuthStorage } from "../../pi-sdk/auth-storage.js";
import { createHostSandboxFsBridge } from "../../test-helpers/host-sandbox-fs-bridge.js";
import { createPiToolsSandboxContext } from "../../test-helpers/pi-tools-sandbox-context.js";

const hoisted = vi.hoisted(() => {
  const spawnSubagentDirectMock = vi.fn();
  const createAgentSessionMock = vi.fn();
  const sessionManagerOpenMock = vi.fn();
  const resolveSandboxContextMock = vi.fn();
  const subscribeEmbeddedPiSessionMock = vi.fn();
  const acquireSessionWriteLockMock = vi.fn();
  // Per-test skill entries handed to the real preflight (fixture data, not a decision).
  const skillEntries: unknown[] = [];
  // Call order of the pass-through spies below (observation only).
  const order: string[] = [];
  const sessionManager = {
    // openSessionManager checks the session header (since #812).
    getHeader: vi.fn(() => ({ type: "session", id: "embedded-session", version: 1 })),
    getLeafEntry: vi.fn(() => null),
    branch: vi.fn(),
    resetLeaf: vi.fn(),
    buildSessionContext: vi.fn(() => ({ messages: [] })),
    appendCustomEntry: vi.fn(),
  };
  return {
    spawnSubagentDirectMock,
    createAgentSessionMock,
    sessionManagerOpenMock,
    resolveSandboxContextMock,
    subscribeEmbeddedPiSessionMock,
    acquireSessionWriteLockMock,
    skillEntries,
    order,
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

vi.mock("../../subagent-spawn.js", () => ({
  SUBAGENT_SPAWN_MODES: ["run", "session"],
  spawnSubagentDirect: (...args: unknown[]) => hoisted.spawnSubagentDirectMock(...args),
}));

vi.mock("../../sandbox.js", () => ({
  resolveSandboxContext: (...args: unknown[]) => hoisted.resolveSandboxContextMock(...args),
}));

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
    skillEntries: hoisted.skillEntries,
  }),
}));

// Pass-through spies: real behavior by default. They record call order and let a
// test make exactly one step throw (fault injection). The preflight decision and
// the shadow observation still run for real; deps arrive only through params.
vi.mock("../../execution-preflight/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../execution-preflight/index.js")>();
  return {
    ...actual,
    buildExecutionPreflight: vi.fn((...args: Parameters<typeof actual.buildExecutionPreflight>) => {
      hoisted.order.push("buildExecutionPreflight");
      return actual.buildExecutionPreflight(...args);
    }),
    applyPreflightToTools: vi.fn((...args: Parameters<typeof actual.applyPreflightToTools>) => {
      hoisted.order.push("applyPreflightToTools");
      return actual.applyPreflightToTools(...args);
    }),
  };
});

vi.mock("../../execution-preflight/constitutional-runtime-facade.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../execution-preflight/constitutional-runtime-facade.js")
    >();
  return {
    ...actual,
    observePreflightRuntimeFacade: vi.fn(
      (...args: Parameters<typeof actual.observePreflightRuntimeFacade>) => {
        hoisted.order.push("observePreflightRuntimeFacade");
        return actual.observePreflightRuntimeFacade(...args);
      },
    ),
  };
});

vi.mock(
  "../../execution-preflight/constitutional-runtime-shadow-projection.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../execution-preflight/constitutional-runtime-shadow-projection.js")
      >();
    return {
      ...actual,
      projectPreflightShadowObservation: vi.fn(actual.projectPreflightShadowObservation),
    };
  },
);

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

vi.mock("../runs.js", () => ({
  setActiveEmbeddedRun: () => {},
  clearActiveEmbeddedRun: () => {},
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

vi.mock("../../model-selection.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../model-selection.js")>();

  return {
    ...actual,
    normalizeProviderId: (providerId?: string) => providerId?.trim().toLowerCase() ?? "",
    resolveDefaultModelForAgent: () => ({ provider: "openai", model: "gpt-test" }),
  };
});

const { runEmbeddedAttempt } = await import("./attempt.js");

// Direct caller: explicit frozen Constitutional shadow deps (gate off, production
// no-op sink, fixed clock). No environment access and no fallback.
const constitutionalRuntimeShadowDeps: ConstitutionalRuntimeShadowDeps = Object.freeze({
  runtimeShadowEnabled: false,
  sink: NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK,
  now: () => 0,
});

type MutableSession = {
  sessionId: string;
  messages: unknown[];
  isCompacting: boolean;
  isStreaming: boolean;
  agent: {
    streamFunction?: unknown;
    state: { messages: unknown[] };
  };
  prompt: (prompt: string, options?: { images?: unknown[] }) => Promise<void>;
  abort: () => Promise<void>;
  dispose: () => void;
  steer: (text: string) => Promise<void>;
};

function createSubscriptionMock() {
  return {
    assistantTexts: [] as string[],
    toolMetas: [] as Array<{ toolName: string; meta?: string }>,
    unsubscribe: () => {},
    waitForCompactionRetry: async () => {},
    getMessagingToolSentTexts: () => [] as string[],
    getMessagingToolSentMediaUrls: () => [] as string[],
    getMessagingToolSentTargets: () => [] as unknown[],
    getSuccessfulCronAdds: () => 0,
    didSendViaMessagingTool: () => false,
    didSendReaction: () => false,
    didSendDeterministicApprovalPrompt: () => false,
    getLastToolError: () => undefined,
    getUsageTotals: () => undefined,
    getCompactionCount: () => 0,
    isCompacting: () => false,
  };
}

function resetHarnessMocks() {
  hoisted.spawnSubagentDirectMock.mockReset().mockResolvedValue({
    status: "accepted",
    childSessionKey: "agent:main:subagent:child",
    runId: "run-child",
  });
  hoisted.createAgentSessionMock.mockReset();
  hoisted.sessionManagerOpenMock.mockReset().mockReturnValue(hoisted.sessionManager);
  hoisted.resolveSandboxContextMock.mockReset();
  hoisted.subscribeEmbeddedPiSessionMock.mockReset().mockImplementation(createSubscriptionMock);
  hoisted.acquireSessionWriteLockMock.mockReset().mockResolvedValue({
    release: async () => {},
  });
  hoisted.sessionManager.getLeafEntry.mockReset().mockReturnValue(null);
  hoisted.sessionManager.branch.mockReset();
  hoisted.sessionManager.resetLeaf.mockReset();
  hoisted.sessionManager.buildSessionContext.mockReset().mockReturnValue({ messages: [] });
  hoisted.sessionManager.appendCustomEntry.mockReset();
  hoisted.skillEntries.length = 0;
  hoisted.order.length = 0;
}

describe("runEmbeddedAttempt sessions_spawn workspace inheritance", () => {
  const tempPaths: string[] = [];

  beforeEach(() => {
    resetHarnessMocks();
  });

  afterEach(async () => {
    while (tempPaths.length > 0) {
      const target = tempPaths.pop();
      if (target) {
        await fs.rm(target, { recursive: true, force: true });
      }
    }
  });

  // none is the default access mode; ro and none both run the attempt in the sandbox copy.
  it.each(["ro", "none"] as const)("uses the real workspace for %s sandboxes", async (access) => {
    const realWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-real-workspace-"));
    const sandboxWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-sandbox-workspace-"));
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-agent-dir-"));
    tempPaths.push(realWorkspace, sandboxWorkspace, agentDir);

    hoisted.resolveSandboxContextMock.mockResolvedValue(
      createPiToolsSandboxContext({
        workspaceDir: sandboxWorkspace,
        agentWorkspaceDir: realWorkspace,
        workspaceAccess: access,
        fsBridge: createHostSandboxFsBridge(sandboxWorkspace),
        tools: { allow: ["sessions_spawn"], deny: [] },
        sessionKey: "agent:main:main",
      }),
    );

    hoisted.createAgentSessionMock.mockImplementation(
      async (params: { customTools: ToolDefinition[] }) => {
        const session: MutableSession = {
          sessionId: "embedded-session",
          messages: [],
          isCompacting: false,
          isStreaming: false,
          agent: {
            state: {
              set messages(messages: unknown[]) {
                session.messages = [...messages];
              },
            },
          },
          prompt: async () => {
            const spawnTool = params.customTools.find((tool) => tool.name === "sessions_spawn");
            expect(spawnTool).toBeDefined();
            if (!spawnTool) {
              throw new Error("missing sessions_spawn tool");
            }
            await spawnTool.execute(
              "call-sessions-spawn",
              { task: "inspect workspace" },
              undefined,
              undefined,
              {} as unknown as ExtensionContext,
            );
          },
          abort: async () => {},
          dispose: () => {},
          steer: async () => {},
        };

        return { session };
      },
    );

    const model = {
      api: "openai-completions",
      provider: "openai",
      compat: {},
      contextWindow: 8192,
      input: ["text"],
    } as unknown as Model<Api>;

    const result = await runEmbeddedAttempt({
      sessionId: "embedded-session",
      sessionKey: "agent:main:main",
      sessionFile: path.join(realWorkspace, "session.jsonl"),
      workspaceDir: realWorkspace,
      agentDir,
      config: {},
      prompt: "spawn a child session",
      timeoutMs: 10_000,
      runId: "run-1",
      provider: "openai",
      modelId: "gpt-test",
      model,
      // The attempt resolves the stream API key through authStorage.
      authStorage: { getApiKey: async () => undefined } as unknown as OpenBotAuthStorage,
      modelRegistry: {} as ModelRegistry,
      thinkLevel: "off",
      senderIsOwner: true,
      disableMessageTool: true,
      constitutionalRuntimeShadowDeps,
    });

    expect(result.promptError).toBeNull();
    expect(hoisted.spawnSubagentDirectMock).toHaveBeenCalledTimes(1);
    expect(hoisted.spawnSubagentDirectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "inspect workspace",
      }),
      expect.objectContaining({
        workspaceDir: realWorkspace,
      }),
    );
    expect(hoisted.spawnSubagentDirectMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceDir: sandboxWorkspace,
      }),
    );
  });
});

// --- Constitutional runtime shadow: attempt-level integration (Checkpoint C3) ---
// Frozen test plan cases B-04, B-05, B-08, B-09, B-11, B-19, B-23, B-30 (collector
// clause) and the attempt-level halves of B-31, B-33 and B-38. Every run passes its
// deps explicitly through EmbeddedRunAttemptParams; nothing reads the environment.

const SHADOW_MODEL = {
  api: "openai-completions",
  provider: "openai",
  compat: {},
  contextWindow: 8192,
  input: ["text"],
} as unknown as Model<Api>;

const DELIVERY_HOLD_NOTICE_TEXT = "正在处理，结果尚未对外公布。";

type ShadowFixture = {
  prompt: string;
  inboundToolCeiling?: InboundToolCeiling;
  holdSkill?: boolean;
};

// Each fixture drives the real preflight to a different decision.
const SHADOW_FIXTURES = {
  // No contract: nothing is cut.
  plain: { prompt: "inspect the workspace" },
  // Wait + continuation with no goal: needs_clarification -> goal_unclear -> read-only cut.
  deny: { prompt: "直到他确认再继续" },
  // Inbound retrieve ceiling: only read/none tools survive, intent becomes retrieve.
  ceiling: {
    prompt: "inspect the workspace",
    inboundToolCeiling: { depth: "retrieve", maxToolMode: "read", maxSideEffectLevel: "none" },
  },
  // Skill contract with delivery-blocked-until: the completion hold is on.
  hold: { prompt: "run holdprobe", holdSkill: true },
} satisfies Record<string, ShadowFixture>;

type ShadowFixtureName = keyof typeof SHADOW_FIXTURES;

type ShadowWorkspace = { realWorkspace: string; sandboxWorkspace: string; agentDir: string };

type ShadowRun = {
  result: Awaited<ReturnType<typeof runEmbeddedAttempt>>;
  preflight: ExecutionPreflight;
  sessionTools: string[];
};

function collectorSink(options: { recordThrows?: boolean; recordErrorThrows?: boolean } = {}) {
  const records: ConstitutionalRuntimeShadowRecord[] = [];
  const errors: ConstitutionalRuntimeShadowErrorCode[] = [];
  const record = vi.fn((value: ConstitutionalRuntimeShadowRecord) => {
    records.push(value);
    if (options.recordThrows) {
      throw new Error("sink record failed");
    }
  });
  const recordError = vi.fn((code: ConstitutionalRuntimeShadowErrorCode) => {
    errors.push(code);
    if (options.recordErrorThrows) {
      throw new Error("sink recordError failed");
    }
  });
  const sink: ConstitutionalRuntimeShadowSink = Object.freeze({ record, recordError });
  return { sink, record, recordError, records, errors };
}

/** Advances 1 ms per read, so one observation always lands in `le_1ms`. */
function steppingClock(): () => number {
  let tick = 0;
  return () => tick++;
}

function holdSkillEntry(workspace: ShadowWorkspace) {
  return {
    skill: {
      name: "holdprobe",
      description: "Hold probe",
      filePath: path.join(workspace.realWorkspace, "skills", "holdprobe", "SKILL.md"),
      baseDir: path.join(workspace.realWorkspace, "skills", "holdprobe"),
      source: "workspace",
    },
    frontmatter: { "delivery-blocked-until": "receipt" },
  };
}

/** What must not move when the shadow gate flips: decision, tool set and visible result. */
function invariantView(run: ShadowRun) {
  return {
    preflight: run.preflight,
    sessionTools: run.sessionTools,
    result: {
      promptError: run.result.promptError,
      aborted: run.result.aborted,
      timedOut: run.result.timedOut,
      assistantTexts: run.result.assistantTexts,
      messagingToolSentTexts: run.result.messagingToolSentTexts,
      didSendViaMessagingTool: run.result.didSendViaMessagingTool,
      clientToolCall: run.result.clientToolCall,
      hookDelivery: run.result.hookDelivery,
    },
  };
}

describe("runEmbeddedAttempt Constitutional runtime shadow", () => {
  const tempPaths: string[] = [];

  beforeEach(() => {
    resetHarnessMocks();
    vi.mocked(buildExecutionPreflight).mockClear();
    vi.mocked(applyPreflightToTools).mockClear();
    vi.mocked(observePreflightRuntimeFacade).mockClear();
    vi.mocked(projectPreflightShadowObservation).mockClear();
  });

  afterEach(async () => {
    while (tempPaths.length > 0) {
      const target = tempPaths.pop();
      if (target) {
        await fs.rm(target, { recursive: true, force: true });
      }
    }
  });

  async function createShadowWorkspace(): Promise<ShadowWorkspace> {
    const workspace = {
      realWorkspace: await fs.mkdtemp(path.join(os.tmpdir(), "openbot-shadow-real-")),
      sandboxWorkspace: await fs.mkdtemp(path.join(os.tmpdir(), "openbot-shadow-sandbox-")),
      agentDir: await fs.mkdtemp(path.join(os.tmpdir(), "openbot-shadow-agent-")),
    };
    tempPaths.push(workspace.realWorkspace, workspace.sandboxWorkspace, workspace.agentDir);
    return workspace;
  }

  async function runShadowAttempt(options: {
    workspace: ShadowWorkspace;
    fixture: ShadowFixture;
    runtimeShadowEnabled: boolean;
    sink?: ConstitutionalRuntimeShadowSink;
    runId?: string;
  }): Promise<ShadowRun> {
    const { workspace, fixture } = options;
    hoisted.skillEntries.length = 0;
    if (fixture.holdSkill) {
      hoisted.skillEntries.push(holdSkillEntry(workspace));
    }
    hoisted.resolveSandboxContextMock.mockResolvedValue(
      createPiToolsSandboxContext({
        workspaceDir: workspace.sandboxWorkspace,
        agentWorkspaceDir: workspace.realWorkspace,
        workspaceAccess: "ro",
        fsBridge: createHostSandboxFsBridge(workspace.sandboxWorkspace),
        tools: { allow: ["read", "sessions_spawn"], deny: [] },
        sessionKey: "agent:main:main",
      }),
    );
    let sessionTools: string[] = [];
    hoisted.createAgentSessionMock.mockImplementation(
      async (params: { customTools: ToolDefinition[] }) => {
        sessionTools = params.customTools.map((tool) => tool.name);
        const session: MutableSession = {
          sessionId: "embedded-session",
          messages: [],
          isCompacting: false,
          isStreaming: false,
          agent: {
            state: {
              set messages(messages: unknown[]) {
                session.messages = [...messages];
              },
            },
          },
          prompt: async () => {},
          abort: async () => {},
          dispose: () => {},
          steer: async () => {},
        };
        return { session };
      },
    );
    // Same task attempt numbering for every run, so gate-off and gate-on runs of one
    // fixture build byte-identical preflight results.
    resetExecutionTraceForTest();
    resetDeliveryArtifactsForTest();
    resetCompletionHoldsForTest();

    const result = await runEmbeddedAttempt({
      sessionId: "embedded-session",
      sessionKey: "agent:main:main",
      sessionFile: path.join(workspace.realWorkspace, "session.jsonl"),
      workspaceDir: workspace.realWorkspace,
      agentDir: workspace.agentDir,
      config: {},
      prompt: fixture.prompt,
      timeoutMs: 10_000,
      runId: options.runId ?? "run-shadow",
      provider: "openai",
      modelId: "gpt-test",
      model: SHADOW_MODEL,
      authStorage: { getApiKey: async () => undefined } as unknown as OpenBotAuthStorage,
      modelRegistry: {} as ModelRegistry,
      thinkLevel: "off",
      senderIsOwner: true,
      disableMessageTool: true,
      ...(fixture.inboundToolCeiling ? { inboundToolCeiling: fixture.inboundToolCeiling } : {}),
      constitutionalRuntimeShadowDeps: Object.freeze({
        runtimeShadowEnabled: options.runtimeShadowEnabled,
        sink: options.sink ?? NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK,
        now: steppingClock(),
      }),
    });
    const preflight = vi.mocked(buildExecutionPreflight).mock.results.at(-1)?.value;
    if (!preflight) {
      throw new Error("the attempt built no preflight");
    }
    return { result, preflight, sessionTools };
  }

  /** Proves each fixture really reaches the decision it is named for. */
  function expectFixtureDecision(name: ShadowFixtureName, run: ShadowRun) {
    if (name === "plain") {
      expect(run.preflight.decisionCode).toBe("no_skill_contract");
      expect(run.sessionTools.toSorted()).toEqual(["read", "sessions_spawn"]);
    } else if (name === "deny") {
      expect(run.preflight.decisionCode).toBe("goal_unclear");
      expect(run.preflight.blockedTools).toContain("sessions_spawn");
      expect(run.sessionTools).toEqual(["read"]);
    } else if (name === "ceiling") {
      expect(run.preflight.intentClass).toBe("retrieve");
      expect(run.sessionTools).toEqual(["read"]);
    } else {
      expect(run.preflight.primarySkill).toBe("holdprobe");
      expect(run.preflight.deliveryBlockedUntil).toBe("receipt");
      expect(run.result.hookDelivery?.allowedToDeliver).toBe(false);
      expect(run.result.assistantTexts).toEqual([DELIVERY_HOLD_NOTICE_TEXT]);
    }
  }

  it("B-04: observes only after the preflight result and the filtered tool set exist", async () => {
    const workspace = await createShadowWorkspace();
    const collector = collectorSink();

    await runShadowAttempt({
      workspace,
      fixture: SHADOW_FIXTURES.plain,
      runtimeShadowEnabled: true,
      sink: collector.sink,
    });

    const facadeAt = hoisted.order.indexOf("observePreflightRuntimeFacade");
    expect(hoisted.order.filter((step) => step === "observePreflightRuntimeFacade")).toHaveLength(
      1,
    );
    expect(facadeAt).toBeGreaterThan(hoisted.order.lastIndexOf("buildExecutionPreflight"));
    expect(facadeAt).toBeGreaterThan(hoisted.order.lastIndexOf("applyPreflightToTools"));
    expect(hoisted.order.lastIndexOf("buildExecutionPreflight")).toBeGreaterThanOrEqual(0);
    expect(collector.records).toHaveLength(1);
    expect(collector.errors).toEqual([]);
  });

  // B-05 (allow/deny), B-08 (capability ceiling), B-09 (delivery hold), plus the plain path.
  it.each(Object.keys(SHADOW_FIXTURES) as ShadowFixtureName[])(
    "B-05/B-08/B-09: gate on leaves the %s decision, tool set and result unchanged",
    async (name) => {
      const workspace = await createShadowWorkspace();
      const fixture = SHADOW_FIXTURES[name];
      const off = await runShadowAttempt({ workspace, fixture, runtimeShadowEnabled: false });
      const collector = collectorSink();
      const on = await runShadowAttempt({
        workspace,
        fixture,
        runtimeShadowEnabled: true,
        sink: collector.sink,
      });

      expectFixtureDecision(name, off);
      expect(invariantView(on)).toEqual(invariantView(off));
      expect(collector.records).toHaveLength(1);
      expect(collector.errors).toEqual([]);
    },
  );

  it("B-11: an observe throw does not lift a preflight deny", async () => {
    const workspace = await createShadowWorkspace();
    const off = await runShadowAttempt({
      workspace,
      fixture: SHADOW_FIXTURES.deny,
      runtimeShadowEnabled: false,
    });
    const collector = collectorSink();
    vi.mocked(observePreflightRuntimeFacade).mockImplementationOnce(() => {
      throw new Error("facade failed");
    });

    const on = await runShadowAttempt({
      workspace,
      fixture: SHADOW_FIXTURES.deny,
      runtimeShadowEnabled: true,
      sink: collector.sink,
    });

    expectFixtureDecision("deny", on);
    expect(on.sessionTools).not.toContain("sessions_spawn");
    expect(invariantView(on)).toEqual(invariantView(off));
    expect(collector.records).toEqual([]);
    expect(collector.errors).toEqual(["observe_error"]);
  });

  it("B-19: turning the flag back off returns to zero observation calls", async () => {
    const workspace = await createShadowWorkspace();
    const first = collectorSink();
    const on = await runShadowAttempt({
      workspace,
      fixture: SHADOW_FIXTURES.plain,
      runtimeShadowEnabled: true,
      sink: first.sink,
    });
    expect(vi.mocked(observePreflightRuntimeFacade)).toHaveBeenCalledTimes(1);
    expect(first.records).toHaveLength(1);

    vi.mocked(observePreflightRuntimeFacade).mockClear();
    vi.mocked(projectPreflightShadowObservation).mockClear();
    const second = collectorSink();
    const off = await runShadowAttempt({
      workspace,
      fixture: SHADOW_FIXTURES.plain,
      runtimeShadowEnabled: false,
      sink: second.sink,
    });

    expect(vi.mocked(observePreflightRuntimeFacade)).not.toHaveBeenCalled();
    expect(vi.mocked(projectPreflightShadowObservation)).not.toHaveBeenCalled();
    expect(second.record).not.toHaveBeenCalled();
    expect(second.recordError).not.toHaveBeenCalled();
    expect(invariantView(off)).toEqual(invariantView(on));
  });

  it("B-23: gate off projects, observes and records nothing", async () => {
    const workspace = await createShadowWorkspace();
    const collector = collectorSink();

    await runShadowAttempt({
      workspace,
      fixture: SHADOW_FIXTURES.plain,
      runtimeShadowEnabled: false,
      sink: collector.sink,
    });

    expect(vi.mocked(projectPreflightShadowObservation)).not.toHaveBeenCalled();
    expect(vi.mocked(observePreflightRuntimeFacade)).not.toHaveBeenCalled();
    expect(collector.record).not.toHaveBeenCalled();
    expect(collector.recordError).not.toHaveBeenCalled();
    expect(hoisted.order).not.toContain("observePreflightRuntimeFacade");
  });

  it("B-31: a throwing sink.record is contained and never reaches recordError", async () => {
    const workspace = await createShadowWorkspace();
    const off = await runShadowAttempt({
      workspace,
      fixture: SHADOW_FIXTURES.plain,
      runtimeShadowEnabled: false,
    });
    const collector = collectorSink({ recordThrows: true });

    const on = await runShadowAttempt({
      workspace,
      fixture: SHADOW_FIXTURES.plain,
      runtimeShadowEnabled: true,
      sink: collector.sink,
    });

    expect(collector.record).toHaveBeenCalledTimes(1);
    expect(collector.recordError).not.toHaveBeenCalled();
    expect(invariantView(on)).toEqual(invariantView(off));
  });

  it.each(["facade", "projection"] as const)(
    "B-33/B-38: a %s throw plus a throwing recordError is contained",
    async (step) => {
      const workspace = await createShadowWorkspace();
      const off = await runShadowAttempt({
        workspace,
        fixture: SHADOW_FIXTURES.plain,
        runtimeShadowEnabled: false,
      });
      const collector = collectorSink({ recordErrorThrows: true });
      const fault = () => {
        throw new Error(`${step} failed`);
      };
      if (step === "facade") {
        vi.mocked(observePreflightRuntimeFacade).mockImplementationOnce(fault);
      } else {
        vi.mocked(projectPreflightShadowObservation).mockImplementationOnce(fault);
      }

      const on = await runShadowAttempt({
        workspace,
        fixture: SHADOW_FIXTURES.plain,
        runtimeShadowEnabled: true,
        sink: collector.sink,
      });

      expect(collector.record).not.toHaveBeenCalled();
      expect(collector.recordError).toHaveBeenCalledTimes(1);
      expect(collector.errors).toEqual(["observe_error"]);
      expect(invariantView(on)).toEqual(invariantView(off));
    },
  );

  it("B-30: records carry no environment key, value, map or dynamic id", async () => {
    const workspace = await createShadowWorkspace();
    // Synthetic placeholders only: an API-key-shaped name and an unrelated OPENBOT_* key.
    const placeholders: Record<string, string> = {
      SYNTHETIC_PROVIDER_API_KEY: "sk-placeholder-shadow-0000",
      OPENBOT_SHADOW_TEST_PLACEHOLDER: "placeholder-openbot-shadow-value",
    };
    const previous = Object.fromEntries(
      Object.keys(placeholders).map((key) => [key, process.env[key]]),
    );
    const collector = collectorSink();
    try {
      Object.assign(process.env, placeholders);
      await runShadowAttempt({
        workspace,
        fixture: SHADOW_FIXTURES.plain,
        runtimeShadowEnabled: true,
        sink: collector.sink,
        runId: "run-shadow-b30",
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }

    expect(collector.records).toHaveLength(1);
    const [record] = collector.records;
    expect(Object.keys(record ?? {}).toSorted()).toEqual(
      [...CONSTITUTIONAL_RUNTIME_SHADOW_RECORD_KEYS].toSorted(),
    );
    expect(
      Object.values(record ?? {}).every(
        (value) => typeof value === "boolean" || typeof value === "string",
      ),
    ).toBe(true);
    expect(record).toMatchObject({
      decisionStage: "preflight",
      flagOn: true,
      executed: false,
      wroteReceipt: false,
      wroteTrace: false,
      pathExists: false,
      gapExists: false,
      profileCategory: "unspecified",
      capabilityCategory: "unspecified",
      latencyBucket: "le_1ms",
    });
    const serialized = JSON.stringify(collector.records);
    for (const needle of [
      ...Object.keys(placeholders),
      ...Object.values(placeholders),
      "run-shadow-b30",
      "embedded-session",
      "agent:main:main",
      workspace.realWorkspace,
      workspace.sandboxWorkspace,
      SHADOW_FIXTURES.plain.prompt,
    ]) {
      expect(serialized).not.toContain(needle);
    }
  });
});
