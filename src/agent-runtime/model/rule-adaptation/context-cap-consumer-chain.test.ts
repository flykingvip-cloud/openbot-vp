import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConstitutionalRuntimeShadowDeps } from "../../../agents/execution-preflight/constitutional-runtime-shadow-deps.js";
import { runWithModelFallback } from "../../../agents/model-fallback.js";
import { compactEmbeddedPiSessionDirect } from "../../../agents/pi-embedded-runner/compact.runtime.js";
import { buildEmbeddedExtensionFactories } from "../../../agents/pi-embedded-runner/extensions.js";
import { resolveModel } from "../../../agents/pi-embedded-runner/model.js";
import { getCompactionSafeguardRuntime } from "../../../agents/pi-extensions/compaction-safeguard-runtime.js";
import { makeModelFallbackCfg } from "../../../agents/test-helpers/model-fallback-config-fixture.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { LegacyContextEngine } from "../../../context-engine/legacy.js";
import {
  FIXTURE_BOARD_SCOPE,
  FIXTURE_POLICY_VERSION,
  FIXTURE_TASK_ID,
  fixtureActivationBinding,
  fixtureDeps,
  fixtureProposal,
  openTempSession,
  seedFixtureBoard,
} from "../../command/rule-adaptation/activation-test-support.js";
import {
  activateApprovedRuntimeRuleProposal,
  createOfficialFixtureContextCapPort,
} from "../../command/rule-adaptation/index.js";
import {
  NO_LIVE_EXECUTION_CLAIM,
  PRODUCTION_RUNTIME_RULE_WHITELIST,
} from "../../contracts/rule-adaptation-activation.js";
import type { RuntimeRuleAdaptationReadBinding } from "../../contracts/rule-adaptation-activation.js";
import { createUsageAccumulator } from "../../execution/outcomes/usage-summary.js";
import { runEmbeddedAttempt } from "../../execution/runner/embedded-attempt.js";
import { runEmbeddedRunAttemptIteration } from "../../execution/runner/embedded-run-attempt.js";
import { prepareEmbeddedRunAuth } from "../../execution/runner/embedded-run-auth.js";
import { prepareEmbeddedModel } from "../prepare-embedded-model.js";
import {
  ContextCapSelectionBlockedError,
  isContextCapSelectionBlockedError,
} from "./context-cap-selection.js";

vi.mock("../../../agents/pi-embedded-runner/model.js", () => ({ resolveModel: vi.fn() }));

vi.mock("../../execution/runner/embedded-attempt.js", () => ({
  runEmbeddedAttempt: vi.fn(),
}));

vi.mock("../../../agents/pi-embedded-runner/compact.runtime.js", () => ({
  compactEmbeddedPiSessionDirect: vi.fn(),
}));

vi.mock("../../../agents/model-auth.js", () => ({
  ensureAuthProfileStore: vi.fn(() => ({ profiles: {} })),
  getApiKeyForModel: vi.fn(async () => ({ apiKey: "test-only", source: "test" })),
}));

vi.mock("../auth-profile-candidates.js", () => ({
  resolveRunAuthProfileCandidates: vi.fn(() => ({
    lockedProfileId: undefined,
    profileCandidates: [] as string[],
  })),
}));

vi.mock("../auth-profile-rotation.js", () => ({
  createAuthProfileRotation: vi.fn(() => ({
    initialize: async () => true,
    advance: async () => false,
    current: undefined,
  })),
}));

vi.mock("../apply-provider-credential.js", () => ({
  applyProviderCredential: vi.fn(async () => undefined),
}));

vi.mock("../copilot-token-refresh.js", () => ({
  createCopilotTokenRefresh: vi.fn(() => ({
    enabled: false,
    refresh: async () => undefined,
    schedule: () => undefined,
  })),
}));

const tempCloses: Array<() => void> = [];

afterEach(() => {
  for (const close of tempCloses.splice(0)) {
    close();
  }
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(resolveModel).mockResolvedValue({
    model: undefined,
    error: "missing",
    authStorage: {
      setRuntimeApiKey: vi.fn(),
    },
    modelRegistry: {},
  } as unknown as Awaited<ReturnType<typeof resolveModel>>);
  vi.mocked(compactEmbeddedPiSessionDirect).mockResolvedValue({
    ok: true,
    compacted: true,
    reason: undefined,
  } as Awaited<ReturnType<typeof compactEmbeddedPiSessionDirect>>);
});

const prepareBase = {
  provider: "custom",
  modelId: "m",
  agentDir: "/tmp/test-p4-r2-context-cap",
  log: { warn: vi.fn(), error: vi.fn() },
  providerAuthOverride: {
    apiKey: "test-only",
    baseUrl: "https://example.invalid/api",
    protocol: "anthropic",
  },
};

function fixtureReadBinding(): RuntimeRuleAdaptationReadBinding {
  return {
    fixture: true,
    identity: {
      principalType: "personal",
      principalId: "user:fixture-1",
      scope: { type: "personal", id: "agent:fixture-personal-1" },
    },
    taskBinding: {
      taskId: FIXTURE_TASK_ID,
      boardScope: { ...FIXTURE_BOARD_SCOPE },
    },
  };
}

function openSession() {
  const tmp = openTempSession();
  tempCloses.push(tmp.close);
  return tmp;
}

function activateLegalCap(sessionFile: string, proposedValue = 24_000) {
  const seeded = seedFixtureBoard(sessionFile);
  const proposal = fixtureProposal({
    items: [
      {
        ruleId: "model.context_window.guard",
        field: "agents.defaults.contextTokens",
        action: "tune",
        proposedValue,
      },
    ],
  });
  const binding = fixtureActivationBinding({
    proposalForHash: proposal,
    currentEffectiveValues: { "agents.defaults.contextTokens": 128_000 },
    expectedVersions: {
      expectedWriteEpoch: seeded.writeEpoch,
      expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
      expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
    },
  });
  const result = activateApprovedRuntimeRuleProposal(proposal, binding, fixtureDeps(sessionFile));
  expect(result.resultKind).toBe("activated");
  return result;
}

function snapshotPort(sessionFile: string) {
  return createOfficialFixtureContextCapPort({
    mode: "personal_activated_snapshot",
    readBinding: fixtureReadBinding(),
    deps: fixtureDeps(sessionFile),
  });
}

const enlargingConfig = {
  agents: {
    defaults: {
      compaction: { mode: "safeguard" as const },
    },
  },
  models: {
    providers: {
      custom: {
        baseUrl: "https://example.invalid",
        models: [{ id: "m", contextWindow: 128_000 }],
      },
    },
  },
} as unknown as OpenBotConfig;

const shadowDeps = Object.freeze({
  runtimeShadowEnabled: false,
  sink: { record: () => undefined },
  now: () => 0,
}) as unknown as ConstitutionalRuntimeShadowDeps;

it("same-run official chain passes the prepared cap to extensions, auto-compact Direct, and overflow recovery", async () => {
  expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
  const tmp = openSession();
  activateLegalCap(tmp.sessionFile, 24_000);
  const port = snapshotPort(tmp.sessionFile);

  const session = await prepareEmbeddedRunAuth({
    params: {
      sessionId: "fixture-session",
      sessionFile: tmp.sessionFile,
      workspaceDir: "/tmp/p4-r2-workspace",
      prompt: "hello",
      config: enlargingConfig,
      providerAuthOverride: prepareBase.providerAuthOverride,
    } as never,
    provider: "custom",
    modelId: "m",
    agentDir: prepareBase.agentDir,
    fallbackConfigured: true,
    resolvedWorkspace: "/tmp/p4-r2-workspace",
    workspaceAgentId: "agent:fixture-personal-1",
    contextCapSelection: port,
  });

  expect(session.ctxInfo.tokens).toBe(24_000);
  expect(session.effectiveModel.contextWindow).toBe(24_000);
  expect(session.contextCapSelection).toMatchObject({
    outcome: "applied",
    source: "personal_activated_snapshot",
    tokens: 24_000,
  });

  vi.mocked(runEmbeddedAttempt).mockResolvedValue({
    aborted: false,
    promptError: new Error("context window exceeded"),
    timedOut: false,
    timedOutDuringCompaction: false,
    sessionIdUsed: "fixture-session",
    lastAssistant: undefined,
    compactionCount: 0,
    messagesSnapshot: [{ role: "user" }],
    assistantTexts: [],
    toolMetas: [],
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
  } as unknown as Awaited<ReturnType<typeof runEmbeddedAttempt>>);

  const contextEngine = new LegacyContextEngine();
  const loop = {
    overflowCompactionAttempts: 0,
    toolResultTruncationAttempted: false,
    bootstrapPromptWarningSignaturesSeen: [] as string[],
    usageAccumulator: createUsageAccumulator(),
    lastRunPromptUsage: undefined,
    autoCompactionCount: 0,
    runLoopIterations: 0,
    authRetryPending: false,
    lastTurnTotal: undefined,
    lastAttemptTaskId: "",
    lastHookDelivery: undefined,
  };

  await runEmbeddedRunAttemptIteration({
    session,
    loop,
    params: {
      sessionId: "fixture-session",
      sessionKey: "fixture-key",
      sessionFile: tmp.sessionFile,
      workspaceDir: "/tmp/p4-r2-workspace",
      prompt: "hello",
      config: enlargingConfig,
      runId: "run-p4-r2",
    } as never,
    prompt: "hello",
    resolvedWorkspace: "/tmp/p4-r2-workspace",
    workspaceAgentId: "agent:fixture-personal-1",
    resolvedToolResultFormat: "markdown",
    constitutionalRuntimeShadowDeps: shadowDeps,
    contextEngine,
    started: Date.now(),
    releaseRunTask: vi.fn(),
    createCompactionDiagId: () => "diag-p4-r2",
    resolveActiveErrorContext: ({ provider, model }) => ({ provider, model }),
  });

  expect(runEmbeddedAttempt).toHaveBeenCalledTimes(1);
  const attemptParams = vi.mocked(runEmbeddedAttempt).mock.calls[0]?.[0] as {
    inheritedContextWindowTokens?: number;
    contextTokenBudget?: number;
    model?: { contextWindow?: number };
  };
  expect(attemptParams.inheritedContextWindowTokens).toBe(24_000);
  expect(attemptParams.contextTokenBudget).toBe(24_000);
  expect(attemptParams.model?.contextWindow).toBe(24_000);

  expect(compactEmbeddedPiSessionDirect).toHaveBeenCalledTimes(1);
  const directParams = vi.mocked(compactEmbeddedPiSessionDirect).mock.calls[0]?.[0] as {
    inheritedContextWindowTokens?: number;
    tokenBudget?: number;
    trigger?: string;
  };
  expect(directParams.inheritedContextWindowTokens).toBe(24_000);
  expect(directParams.tokenBudget).toBe(24_000);
  expect(directParams.trigger).toBe("overflow");

  const sessionManager = {} as SessionManager;
  buildEmbeddedExtensionFactories({
    cfg: enlargingConfig,
    sessionManager,
    provider: "custom",
    modelId: "m",
    model: session.effectiveModel,
    inheritedContextWindowTokens: attemptParams.inheritedContextWindowTokens,
  });
  expect(getCompactionSafeguardRuntime(sessionManager)?.contextWindowTokens).toBe(24_000);
});

it("omitting the selection port on prepareEmbeddedRunAuth does not pass an inherited cap and keeps 128000", async () => {
  const session = await prepareEmbeddedRunAuth({
    params: {
      sessionId: "fixture-session-original",
      sessionFile: "/tmp/p4-r2-unused.jsonl",
      workspaceDir: "/tmp/p4-r2-workspace",
      prompt: "hello",
      config: enlargingConfig,
      providerAuthOverride: prepareBase.providerAuthOverride,
    } as never,
    provider: "custom",
    modelId: "m",
    agentDir: prepareBase.agentDir,
    fallbackConfigured: false,
    resolvedWorkspace: "/tmp/p4-r2-workspace",
    workspaceAgentId: "agent:fixture-personal-1",
  });
  expect(session.ctxInfo.tokens).toBe(128_000);
  expect(session.contextCapSelection).toMatchObject({
    mode: "original",
    source: "original",
    tokens: 128_000,
  });

  vi.mocked(runEmbeddedAttempt).mockResolvedValue({
    aborted: false,
    promptError: new Error("context window exceeded"),
    timedOut: false,
    timedOutDuringCompaction: false,
    sessionIdUsed: "fixture-session-original",
    lastAssistant: undefined,
    compactionCount: 0,
    messagesSnapshot: [{ role: "user" }],
    assistantTexts: [],
    toolMetas: [],
    didSendViaMessagingTool: false,
    messagingToolSentTexts: [],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    cloudCodeAssistFormatError: false,
  } as unknown as Awaited<ReturnType<typeof runEmbeddedAttempt>>);

  await runEmbeddedRunAttemptIteration({
    session,
    loop: {
      overflowCompactionAttempts: 0,
      toolResultTruncationAttempted: false,
      bootstrapPromptWarningSignaturesSeen: [],
      usageAccumulator: createUsageAccumulator(),
      lastRunPromptUsage: undefined,
      autoCompactionCount: 0,
      runLoopIterations: 0,
      authRetryPending: false,
      lastTurnTotal: undefined,
      lastAttemptTaskId: "",
      lastHookDelivery: undefined,
    },
    params: {
      sessionId: "fixture-session-original",
      sessionKey: "fixture-key",
      sessionFile: "/tmp/p4-r2-unused.jsonl",
      workspaceDir: "/tmp/p4-r2-workspace",
      prompt: "hello",
      config: enlargingConfig,
      runId: "run-p4-r2-original",
    } as never,
    prompt: "hello",
    resolvedWorkspace: "/tmp/p4-r2-workspace",
    workspaceAgentId: "agent:fixture-personal-1",
    resolvedToolResultFormat: "markdown",
    constitutionalRuntimeShadowDeps: shadowDeps,
    contextEngine: new LegacyContextEngine(),
    started: Date.now(),
    releaseRunTask: vi.fn(),
    createCompactionDiagId: () => "diag-p4-r2-original",
    resolveActiveErrorContext: ({ provider, model }) => ({ provider, model }),
  });

  const attemptParams = vi.mocked(runEmbeddedAttempt).mock.calls[0]?.[0] as {
    inheritedContextWindowTokens?: number;
    contextTokenBudget?: number;
  };
  expect(attemptParams.inheritedContextWindowTokens).toBeUndefined();
  expect(attemptParams.contextTokenBudget).toBe(128_000);
  const directParams = vi.mocked(compactEmbeddedPiSessionDirect).mock.calls[0]?.[0] as {
    inheritedContextWindowTokens?: number;
  };
  expect(directParams.inheritedContextWindowTokens).toBeUndefined();
});

it("does not start the provider or rotate to the next model after a selection source block", async () => {
  const providerStart = vi.fn();
  const run = vi.fn(async (_provider: string, _model: string) => {
    await prepareEmbeddedModel({
      ...prepareBase,
      log: { warn: vi.fn(), error: vi.fn() },
      contextCapSelection: { mode: "personal_activated_snapshot" },
    });
    providerStart();
    return "should-not-reach";
  });

  await expect(
    runWithModelFallback({
      cfg: makeModelFallbackCfg(),
      provider: "openai",
      model: "gpt-4.1-mini",
      run,
    }),
  ).rejects.toSatisfy((err: unknown) => {
    expect(err).toBeInstanceOf(ContextCapSelectionBlockedError);
    expect(isContextCapSelectionBlockedError(err)).toBe(true);
    expect((err as ContextCapSelectionBlockedError).reason).toBe("production_path_closed");
    expect((err as ContextCapSelectionBlockedError).code).toBe("context_cap_selection_blocked");
    return true;
  });

  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[0]).toBe("openai");
  expect(providerStart).not.toHaveBeenCalled();
});
