import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveEmbeddedModelGovernance } from "../../../agents/embedded-model-governance.js";
import { makeZeroUsageSnapshot } from "../../../agents/usage.js";
import { PRODUCTION_RUNTIME_RULE_WHITELIST } from "../../contracts/rule-adaptation-activation.js";
import { createAuthorizedModelSession, type ModelSessionPorts } from "../../model/index.js";
import { replyTurnRuntime } from "../../wiring/reply-turn.js";
import {
  governedShadowHostBoundary,
  type GovernedInteractionWithShadow,
  type GovernedShadowHostInjection,
} from "../index.js";
import * as activate from "./activate.js";
import {
  fixtureHost,
  fixtureRequest,
  hangingModel,
  messageStep,
  proposalOutput,
  tightenProposal,
} from "./test-support.js";

const calls = vi.hoisted(() => ({ complete: vi.fn() }));
const candidateMocks = vi.hoisted(() => ({
  transport: vi.fn(),
  ensure: vi.fn(),
  resolve: vi.fn(),
  auth: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/compat", async (original) => ({
  ...(await original<typeof import("@earendil-works/pi-ai/compat")>()),
  complete: calls.complete,
}));
vi.mock("../../../gateway/enterprise-model/embedded-transport.js", () => ({
  resolveEnterpriseEmbeddedTransport: candidateMocks.transport,
}));
vi.mock("../../../agents/models-config.js", () => ({
  ensureOpenClawModelsJson: candidateMocks.ensure,
}));
vi.mock("../../../agents/pi-embedded-runner/model.js", () => ({
  resolveModel: candidateMocks.resolve,
}));
vi.mock("../../../agents/model-auth.js", () => ({
  getApiKeyForModel: candidateMocks.auth,
}));

const model = {
  id: "test",
  provider: "test",
  api: "openai-completions",
  reasoning: false,
  input: ["text"],
  contextWindow: 8192,
  maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as Model<Api>;

function stubShadowPorts(): ModelSessionPorts {
  return {
    accounting: { recordCreditUsage: vi.fn(async () => undefined) },
    admission: {
      tryAcquireEnterpriseAgentRun: vi.fn(async () => ({
        acquired: false as const,
        skipped: true as const,
      })),
      releaseEnterpriseAgentRun: vi.fn(async () => {}),
    },
    model: {
      resolveEmbeddedModelGovernance,
      buildRunModelSetSnapshot: vi.fn(() => undefined),
      forgetRunModelSet: vi.fn(),
      rememberRunModelSet: vi.fn(),
      snapshotCreditReportingFromGate: vi.fn(() => undefined),
      resolvePlatformModelsMode: vi.fn(() => "default"),
      runWithModelFallback: vi.fn(
        async (options: {
          run: (provider: string, model: string, extra?: unknown) => Promise<unknown>;
        }) => ({
          result: await options.run("shadow-fixture", "shadow-fixture"),
          provider: "shadow-fixture",
          model: "shadow-fixture",
          attempts: [],
        }),
      ),
    },
  } as unknown as ModelSessionPorts;
}

function isWrapped(value: unknown): value is GovernedInteractionWithShadow {
  return typeof value === "object" && value !== null && "interaction" in value && "shadow" in value;
}

function hostParams(abortSignal?: AbortSignal) {
  return {
    config: {},
    runId: "host-trigger-passthrough",
    agentId: "bot",
    agentDir: "/tmp/t62-host-trigger-agent",
    sessionKey: "t62-host-trigger",
    sessionFile: "/tmp/t62-host-trigger-session.jsonl",
    requestId: "message-host-trigger",
    captured: { expectedFocusRevision: 0, expectedWriteEpoch: 0 },
    authorized: true,
    identity: { gatewayClientPlatformUserId: "user" },
    provider: "test",
    model: "test",
    timeoutMs: 1000,
    input: {
      message: "你好",
      context: [],
      ...(abortSignal ? { abortSignal } : {}),
    },
  };
}

function shadowBinding(
  runId: string,
  complete: GovernedShadowHostInjection["binding"]["model"]["complete"],
  fixture: ReturnType<typeof fixtureHost> = fixtureHost(),
): GovernedShadowHostInjection["binding"] {
  return {
    view: fixture.host.view,
    controlBoard: fixture.host.controlBoard,
    now: fixture.host.now,
    model: {
      runId,
      sessionPorts: stubShadowPorts(),
      createSession: createAuthorizedModelSession,
      config: Object.freeze({}),
      env: Object.freeze({}),
      complete,
    },
  };
}

beforeEach(() => {
  calls.complete.mockReset();
  calls.complete.mockResolvedValue({
    role: "assistant",
    content: [{ type: "text", text: JSON.stringify({ kind: "reply", text: "你好" }) }],
    usage: makeZeroUsageSnapshot(),
    stopReason: "stop",
  });
  candidateMocks.transport.mockReset();
  candidateMocks.ensure.mockReset();
  candidateMocks.resolve.mockReset();
  candidateMocks.auth.mockReset();
  candidateMocks.transport.mockImplementation(
    async (params: { provider: string; model: string }) => ({
      provider: params.provider,
      model: params.model,
    }),
  );
  candidateMocks.resolve.mockResolvedValue({ model });
  candidateMocks.auth.mockResolvedValue({ apiKey: "fixture-interaction-key", mode: "api-key" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("default-off production wrapper starts zero shadow calls and returns the original result", async () => {
  const shadowComplete = vi.fn();
  const withoutHost = await replyTurnRuntime.interaction(hostParams());
  expect(isWrapped(withoutHost)).toBe(false);
  expect(withoutHost).toEqual({ kind: "respond", text: "你好", clarification: false });
  expect(shadowComplete).not.toHaveBeenCalled();
  expect(calls.complete).toHaveBeenCalledOnce();

  const disabled = await replyTurnRuntime.interaction(hostParams(), {
    trigger: false,
    request: fixtureRequest(),
    binding: shadowBinding("host-trigger-disabled", shadowComplete),
  });
  expect(isWrapped(disabled)).toBe(false);
  expect(disabled).toEqual({ kind: "respond", text: "你好", clarification: false });
  expect(shadowComplete).not.toHaveBeenCalled();
  expect(calls.complete).toHaveBeenCalledTimes(2);
  expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
});

it("explicit host trigger reaches the official shadow entry and returns advice only", async () => {
  const fixture = fixtureHost();
  const activateSpy = vi.spyOn(activate, "activateApprovedRuntimeRuleProposal");
  const revokeSpy = vi.spyOn(activate, "revokeActivatedRuntimeRulePolicy");
  const rollbackSpy = vi.spyOn(activate, "rollbackActivatedRuntimeRulePolicy");
  const complete = vi.fn(async () => messageStep(proposalOutput(tightenProposal(24000))));
  const original = await replyTurnRuntime.interaction(hostParams());
  const wrapped = await replyTurnRuntime.interaction(hostParams(), {
    trigger: true,
    request: fixtureRequest({ requestId: "host-trigger-explicit-1" }),
    binding: shadowBinding("host-trigger-explicit-1", complete, fixture),
  });

  expect(isWrapped(wrapped)).toBe(true);
  if (!isWrapped(wrapped)) {
    return;
  }
  expect(wrapped.interaction).toEqual(original);
  expect(wrapped.interaction).toEqual({ kind: "respond", text: "你好", clarification: false });
  expect(complete).toHaveBeenCalled();
  expect(wrapped.shadow.outcomeCode).toBe("shadow_recorded");
  expect(wrapped.shadow.validation?.resultKind).toBe("shadow_accepted");
  expect(wrapped.shadow.activationAllowed).toBe(false);
  expect(wrapped.shadow.claimedEffective).toBe(false);
  expect(wrapped.shadow.commitment).toBe("none");
  expect(wrapped.shadow.executionModeOpened).toBe(false);
  expect(wrapped.shadow.candidatePersisted).toBe(false);
  expect(wrapped.shadow.candidateActivated).toBe(false);
  expect(wrapped.shadow.controlUnchanged).toBe(true);
  expect(fixture.board.mutations()).toEqual([]);
  expect(activateSpy).not.toHaveBeenCalled();
  expect(revokeSpy).not.toHaveBeenCalled();
  expect(rollbackSpy).not.toHaveBeenCalled();
  expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
});

it("isolates a thrown official-shadow error and does not overwrite the original reply", async () => {
  const complete = vi.fn(async () => {
    throw new Error("unexpected shadow port crash");
  });
  const wrapped = await replyTurnRuntime.interaction(hostParams(), {
    trigger: true,
    request: fixtureRequest({ requestId: "host-trigger-thrown" }),
    binding: shadowBinding("host-trigger-thrown", complete),
  });
  expect(isWrapped(wrapped)).toBe(true);
  if (!isWrapped(wrapped)) {
    return;
  }
  expect(wrapped.interaction).toEqual({ kind: "respond", text: "你好", clarification: false });
  expect(wrapped.shadow.outcomeCode).toBe("protocol_failure");
  expect(wrapped.shadow.activationAllowed).toBe(false);
});

it("does not start a shadow call when the original request is cancelled after it finishes and before shadow starts", async () => {
  const origin = new AbortController();
  let releaseBoundary!: () => void;
  const hold = new Promise<void>((resolve) => {
    releaseBoundary = resolve;
  });
  const boundary = vi
    .spyOn(governedShadowHostBoundary, "afterOriginalInteraction")
    .mockImplementation(() => hold);
  const complete = vi.fn(async () => messageStep(proposalOutput(tightenProposal(24000))));
  try {
    const pending = replyTurnRuntime.interaction(hostParams(origin.signal), {
      trigger: true,
      request: fixtureRequest({ requestId: "host-trigger-origin-cancel-before-start" }),
      binding: shadowBinding("host-trigger-origin-cancel-before-start", complete),
    });
    await vi.waitFor(() => expect(boundary).toHaveBeenCalled());
    origin.abort();
    releaseBoundary();
    const wrapped = await pending;
    expect(isWrapped(wrapped)).toBe(true);
    if (!isWrapped(wrapped)) {
      return;
    }
    expect(wrapped.interaction).toEqual({ kind: "respond", text: "你好", clarification: false });
    expect(complete).not.toHaveBeenCalled();
    expect(wrapped.shadow.outcomeCode).toBe("cancelled");
    expect(wrapped.shadow.cancelled).toBe(true);
    expect(wrapped.shadow.usage.modelCalls).toBe(0);
  } finally {
    boundary.mockRestore();
  }
});

it("does not weaken original cancel when the caller supplies a different unaborted shadow signal", async () => {
  const origin = new AbortController();
  const other = new AbortController();
  let releaseBoundary!: () => void;
  const hold = new Promise<void>((resolve) => {
    releaseBoundary = resolve;
  });
  const boundary = vi
    .spyOn(governedShadowHostBoundary, "afterOriginalInteraction")
    .mockImplementation(() => hold);
  const complete = vi.fn(async () => messageStep(proposalOutput(tightenProposal(24000))));
  try {
    const pending = replyTurnRuntime.interaction(hostParams(origin.signal), {
      trigger: true,
      request: fixtureRequest({
        requestId: "host-trigger-distinct-signal-does-not-weaken",
        signal: other.signal,
      }),
      binding: shadowBinding("host-trigger-distinct-signal-does-not-weaken", complete),
    });
    await vi.waitFor(() => expect(boundary).toHaveBeenCalled());
    origin.abort();
    releaseBoundary();
    const wrapped = await pending;
    expect(other.signal.aborted).toBe(false);
    expect(isWrapped(wrapped)).toBe(true);
    if (!isWrapped(wrapped)) {
      return;
    }
    expect(wrapped.interaction).toEqual({ kind: "respond", text: "你好", clarification: false });
    expect(complete).not.toHaveBeenCalled();
    expect(wrapped.shadow.outcomeCode).toBe("cancelled");
    expect(wrapped.shadow.cancelled).toBe(true);
    expect(wrapped.shadow.usage.modelCalls).toBe(0);
  } finally {
    boundary.mockRestore();
  }
});

it("still honors a caller-supplied shadow signal when the original request is not cancelled", async () => {
  const origin = new AbortController();
  const other = new AbortController();
  const hanging = hangingModel();
  let shadowStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    shadowStarted = resolve;
  });
  const complete = vi.fn(async (input: Parameters<typeof hanging.complete>[0]) => {
    shadowStarted();
    return hanging.complete(input);
  });
  const pending = replyTurnRuntime.interaction(hostParams(origin.signal), {
    trigger: true,
    request: fixtureRequest({
      requestId: "host-trigger-caller-signal-still-cancels",
      signal: other.signal,
      budget: { maxDurationMs: 5_000 },
    }),
    binding: shadowBinding("host-trigger-caller-signal-still-cancels", complete),
  });
  await started;
  other.abort();
  const wrapped = await pending;
  expect(origin.signal.aborted).toBe(false);
  expect(isWrapped(wrapped)).toBe(true);
  if (!isWrapped(wrapped)) {
    return;
  }
  expect(wrapped.interaction).toEqual({ kind: "respond", text: "你好", clarification: false });
  expect(wrapped.shadow.outcomeCode).toBe("cancelled");
  expect(wrapped.shadow.cancelled).toBe(true);
});
