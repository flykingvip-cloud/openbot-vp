import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { expect, it, vi } from "vitest";
import { resolveEmbeddedModelGovernance } from "../../agents/embedded-model-governance.js";
import { makeZeroUsageSnapshot } from "../../agents/usage.js";
import { PRODUCTION_RUNTIME_RULE_WHITELIST } from "../contracts/rule-adaptation-activation.js";
import { createAuthorizedModelSession, type ModelSessionPorts } from "../model/index.js";
import { bindAdmittedTurnHost } from "../wiring/admitted-turn-host.js";
import {
  governedShadowHostBoundary,
  runGovernedInteraction,
  type GovernedInteractionInput,
  type GovernedInteractionPorts,
} from "./governed-interaction.js";
import * as activate from "./rule-adaptation/activate.js";
import {
  fixtureHost,
  fixtureRequest,
  hangingModel,
  messageStep,
  proposalOutput,
  tightenProposal,
} from "./rule-adaptation/test-support.js";

const calls = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@earendil-works/pi-ai/compat", async (original) => ({
  ...(await original<typeof import("@earendil-works/pi-ai/compat")>()),
  complete: calls.complete,
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

function bindReplyPorts(commit = vi.fn()) {
  const host = bindAdmittedTurnHost();
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
    acquired: true as const,
    skipped: false as const,
    enterpriseId: "tenant",
  }));
  host.model.runWithModelFallback = vi.fn(async (options) => ({
    result: await options.run("test", "test"),
    provider: "test",
    model: "test",
    attempts: [],
  }));
  host.task.ensureChatTurnTaskOutcome = vi.fn();
  host.admission.releaseEnterpriseAgentRun = vi.fn(async () => {});
  host.model.forgetRunModelSet = vi.fn();
  calls.complete.mockReset();
  calls.complete.mockResolvedValue({
    role: "assistant",
    content: [{ type: "text", text: JSON.stringify({ kind: "reply", text: "你好" }) }],
    usage: makeZeroUsageSnapshot(),
    stopReason: "stop",
  });
  const params: GovernedInteractionInput = {
    input: { message: "你好", context: [] },
    runId: "governed-shadow-host",
    agentId: "bot",
    agentDir: "/tmp/agent",
    sessionFile: "/tmp/session.jsonl",
    requestId: "message-a",
    captured: { expectedFocusRevision: 0, expectedWriteEpoch: 0 },
    identity: { gatewayClientPlatformUserId: "user" },
    authorized: true,
    config: {},
    provider: "test",
    model: "test",
    timeoutMs: 1000,
  };
  const ports: GovernedInteractionPorts = {
    modelSession: host,
    model: host.model,
    resolveFallbacks: () => undefined,
    candidate: async () => ({ model }),
    commit,
  };
  return { host, params, ports, commit };
}

it("default-off host injection starts zero additional shadow calls and returns the original result", async () => {
  const { host, params, ports, commit } = bindReplyPorts();
  const shadowComplete = vi.fn();
  const { host: shadow } = fixtureHost();
  const withoutHost = await runGovernedInteraction(params, ports);
  expect(withoutHost).toEqual({ kind: "respond", text: "你好", clarification: false });
  expect(shadowComplete).not.toHaveBeenCalled();
  expect(calls.complete).toHaveBeenCalledOnce();

  const disabled = await runGovernedInteraction(params, ports, {
    trigger: false,
    request: fixtureRequest(),
    binding: {
      view: shadow.view,
      controlBoard: shadow.controlBoard,
      now: shadow.now,
      model: {
        runId: "governed-shadow-disabled",
        sessionPorts: stubShadowPorts(),
        createSession: createAuthorizedModelSession,
        config: {},
        env: {},
        complete: shadowComplete,
      },
    },
  });
  expect(disabled).toEqual({ kind: "respond", text: "你好", clarification: false });
  expect(shadowComplete).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(host.task.ensureChatTurnTaskOutcome).not.toHaveBeenCalled();
  expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
});

it("explicit trigger returns advice only and leaves the original interaction and task state unchanged", async () => {
  const { host, params, ports, commit } = bindReplyPorts();
  const { host: shadow, board } = fixtureHost();
  const baselineCommit = vi.fn(() => {
    throw new Error("original commit should not be reused by shadow");
  });
  const activateSpy = vi.spyOn(activate, "activateApprovedRuntimeRuleProposal");
  const revokeSpy = vi.spyOn(activate, "revokeActivatedRuntimeRulePolicy");
  const rollbackSpy = vi.spyOn(activate, "rollbackActivatedRuntimeRulePolicy");
  const complete = vi.fn(async () => messageStep(proposalOutput(tightenProposal(24000))));
  const config = Object.freeze({});
  const env = Object.freeze({});

  const original = await runGovernedInteraction(params, { ...ports, commit: baselineCommit });
  const wrapped = await runGovernedInteraction(params, ports, {
    trigger: true,
    request: fixtureRequest({ requestId: "governed-shadow-explicit-1" }),
    binding: {
      view: shadow.view,
      controlBoard: shadow.controlBoard,
      now: shadow.now,
      model: {
        runId: "governed-shadow-explicit-1",
        sessionPorts: stubShadowPorts(),
        createSession: createAuthorizedModelSession,
        config,
        env,
        complete,
      },
    },
  });

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
  expect(board.mutations()).toEqual([]);
  expect(commit).not.toHaveBeenCalled();
  expect(baselineCommit).not.toHaveBeenCalled();
  expect(host.task.ensureChatTurnTaskOutcome).not.toHaveBeenCalled();
  expect(activateSpy).not.toHaveBeenCalled();
  expect(revokeSpy).not.toHaveBeenCalled();
  expect(rollbackSpy).not.toHaveBeenCalled();
  expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
  expect(config).toEqual({});
  expect(env).toEqual({});
});

it("isolates a shadow protocol failure so the original reply is unchanged", async () => {
  const { params, ports, commit } = bindReplyPorts();
  const { host: shadow, board } = fixtureHost();
  const complete = vi.fn(async () => ({
    kind: "protocol_failure" as const,
    usage: { inputTokens: 1, outputTokens: 0, cost: 0 },
    detail: "malformed protocol",
  }));
  const wrapped = await runGovernedInteraction(params, ports, {
    trigger: true,
    request: fixtureRequest({ requestId: "governed-shadow-protocol-failure" }),
    binding: {
      view: shadow.view,
      controlBoard: shadow.controlBoard,
      now: shadow.now,
      model: {
        runId: "governed-shadow-protocol-failure",
        sessionPorts: stubShadowPorts(),
        config: {},
        env: {},
        complete,
      },
    },
  });
  expect(wrapped.interaction).toEqual({ kind: "respond", text: "你好", clarification: false });
  expect(wrapped.shadow.outcomeCode).toBe("protocol_failure");
  expect(wrapped.shadow.activationAllowed).toBe(false);
  expect(wrapped.shadow.candidatePersisted).toBe(false);
  expect(board.mutations()).toEqual([]);
  expect(commit).not.toHaveBeenCalled();
});

it("isolates a thrown official-shadow error and does not overwrite the original result", async () => {
  const { params, ports, commit } = bindReplyPorts();
  const { host: shadow } = fixtureHost();
  const complete = vi.fn(async () => {
    throw new Error("unexpected shadow port crash");
  });
  const wrapped = await runGovernedInteraction(params, ports, {
    trigger: true,
    request: fixtureRequest({ requestId: "governed-shadow-thrown" }),
    binding: {
      view: shadow.view,
      controlBoard: shadow.controlBoard,
      now: shadow.now,
      model: {
        runId: "governed-shadow-thrown",
        sessionPorts: stubShadowPorts(),
        config: {},
        env: {},
        complete,
      },
    },
  });
  expect(wrapped.interaction).toEqual({ kind: "respond", text: "你好", clarification: false });
  expect(wrapped.shadow.outcomeCode).toBe("protocol_failure");
  expect(wrapped.shadow.usage.modelCalls).toBeGreaterThanOrEqual(0);
  expect(commit).not.toHaveBeenCalled();
});

it("does not start a new shadow call after cancel", async () => {
  const { params, ports, commit } = bindReplyPorts();
  const { host: shadow } = fixtureHost();
  const complete = vi.fn(async () => messageStep(proposalOutput(tightenProposal(24000))));
  const controller = new AbortController();
  controller.abort();
  const wrapped = await runGovernedInteraction(params, ports, {
    trigger: true,
    request: fixtureRequest({
      requestId: "governed-shadow-cancelled",
      signal: controller.signal,
    }),
    binding: {
      view: shadow.view,
      controlBoard: shadow.controlBoard,
      now: shadow.now,
      model: {
        runId: "governed-shadow-cancelled",
        sessionPorts: stubShadowPorts(),
        config: {},
        env: {},
        complete,
      },
    },
  });
  expect(wrapped.interaction).toEqual({ kind: "respond", text: "你好", clarification: false });
  expect(complete).not.toHaveBeenCalled();
  expect(wrapped.shadow.outcomeCode).toBe("cancelled");
  expect(wrapped.shadow.cancelled).toBe(true);
  expect(wrapped.shadow.usage.modelCalls).toBe(0);
  expect(commit).not.toHaveBeenCalled();
});

it("honors an explicit shadow budget boundary without changing the original interaction", async () => {
  const { params, ports, commit } = bindReplyPorts();
  const { host: shadow, board } = fixtureHost();
  const complete = vi.fn(async () => messageStep(proposalOutput(tightenProposal(24000))));
  const wrapped = await runGovernedInteraction(params, ports, {
    trigger: true,
    request: fixtureRequest({
      requestId: "governed-shadow-budget",
      budget: { maxModelCalls: 0, maxDurationMs: 20 },
    }),
    binding: {
      view: shadow.view,
      controlBoard: shadow.controlBoard,
      now: shadow.now,
      model: {
        runId: "governed-shadow-budget",
        sessionPorts: stubShadowPorts(),
        config: {},
        env: {},
        complete,
      },
    },
  });
  expect(wrapped.interaction).toEqual({ kind: "respond", text: "你好", clarification: false });
  expect(wrapped.shadow.outcomeCode).toBe("budget_exhausted");
  expect(complete).not.toHaveBeenCalled();
  expect(board.mutations()).toEqual([]);
  expect(commit).not.toHaveBeenCalled();
});

it("does not start a shadow call when the original request is cancelled after it finishes and before shadow starts", async () => {
  const { params, ports, commit } = bindReplyPorts();
  const origin = new AbortController();
  params.input = { ...params.input, abortSignal: origin.signal };
  let releaseBoundary!: () => void;
  const hold = new Promise<void>((resolve) => {
    releaseBoundary = resolve;
  });
  const boundary = vi
    .spyOn(governedShadowHostBoundary, "afterOriginalInteraction")
    .mockImplementation(() => hold);
  const complete = vi.fn(async () => messageStep(proposalOutput(tightenProposal(24000))));
  const { host: shadow } = fixtureHost();
  try {
    const pending = runGovernedInteraction(params, ports, {
      trigger: true,
      request: fixtureRequest({ requestId: "governed-shadow-origin-cancel-before-start" }),
      binding: {
        view: shadow.view,
        controlBoard: shadow.controlBoard,
        now: shadow.now,
        model: {
          runId: "governed-shadow-origin-cancel-before-start",
          sessionPorts: stubShadowPorts(),
          config: {},
          env: {},
          complete,
        },
      },
    });
    await vi.waitFor(() => expect(boundary).toHaveBeenCalled());
    origin.abort();
    releaseBoundary();
    const wrapped = await pending;
    expect(wrapped.interaction).toEqual({ kind: "respond", text: "你好", clarification: false });
    expect(complete).not.toHaveBeenCalled();
    expect(wrapped.shadow.outcomeCode).toBe("cancelled");
    expect(wrapped.shadow.cancelled).toBe(true);
    expect(wrapped.shadow.usage.modelCalls).toBe(0);
    expect(commit).not.toHaveBeenCalled();
  } finally {
    boundary.mockRestore();
  }
});

it("stops waiting for an in-flight shadow call on original cancel and does not overwrite the original result", async () => {
  const { params, ports, commit } = bindReplyPorts();
  const origin = new AbortController();
  params.input = { ...params.input, abortSignal: origin.signal };
  const hanging = hangingModel();
  let shadowStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    shadowStarted = resolve;
  });
  const complete = vi.fn(async (input: Parameters<typeof hanging.complete>[0]) => {
    shadowStarted();
    return hanging.complete(input);
  });
  const { host: shadow } = fixtureHost();
  const pending = runGovernedInteraction(params, ports, {
    trigger: true,
    request: fixtureRequest({
      requestId: "governed-shadow-origin-cancel-in-flight",
      budget: { maxDurationMs: 5_000 },
    }),
    binding: {
      view: shadow.view,
      controlBoard: shadow.controlBoard,
      now: shadow.now,
      model: {
        runId: "governed-shadow-origin-cancel-in-flight",
        sessionPorts: stubShadowPorts(),
        config: {},
        env: {},
        complete,
      },
    },
  });
  await started;
  origin.abort();
  const wrapped = await pending;
  expect(wrapped.interaction).toEqual({ kind: "respond", text: "你好", clarification: false });
  expect(complete).toHaveBeenCalled();
  expect(wrapped.shadow.outcomeCode).toBe("cancelled");
  expect(wrapped.shadow.cancelled).toBe(true);
  expect(commit).not.toHaveBeenCalled();
});

it("does not weaken original cancel when the caller supplies a different unaborted shadow signal", async () => {
  const { params, ports, commit } = bindReplyPorts();
  const origin = new AbortController();
  const other = new AbortController();
  params.input = { ...params.input, abortSignal: origin.signal };
  let releaseBoundary!: () => void;
  const hold = new Promise<void>((resolve) => {
    releaseBoundary = resolve;
  });
  const boundary = vi
    .spyOn(governedShadowHostBoundary, "afterOriginalInteraction")
    .mockImplementation(() => hold);
  const complete = vi.fn(async () => messageStep(proposalOutput(tightenProposal(24000))));
  const { host: shadow } = fixtureHost();
  try {
    const pending = runGovernedInteraction(params, ports, {
      trigger: true,
      request: fixtureRequest({
        requestId: "governed-shadow-distinct-signal-does-not-weaken",
        signal: other.signal,
      }),
      binding: {
        view: shadow.view,
        controlBoard: shadow.controlBoard,
        now: shadow.now,
        model: {
          runId: "governed-shadow-distinct-signal-does-not-weaken",
          sessionPorts: stubShadowPorts(),
          config: {},
          env: {},
          complete,
        },
      },
    });
    await vi.waitFor(() => expect(boundary).toHaveBeenCalled());
    origin.abort();
    releaseBoundary();
    const wrapped = await pending;
    expect(other.signal.aborted).toBe(false);
    expect(wrapped.interaction).toEqual({ kind: "respond", text: "你好", clarification: false });
    expect(complete).not.toHaveBeenCalled();
    expect(wrapped.shadow.outcomeCode).toBe("cancelled");
    expect(wrapped.shadow.cancelled).toBe(true);
    expect(wrapped.shadow.usage.modelCalls).toBe(0);
    expect(commit).not.toHaveBeenCalled();
  } finally {
    boundary.mockRestore();
  }
});

it("still honors a caller-supplied shadow signal when the original request is not cancelled", async () => {
  const { params, ports, commit } = bindReplyPorts();
  const origin = new AbortController();
  const other = new AbortController();
  params.input = { ...params.input, abortSignal: origin.signal };
  const hanging = hangingModel();
  let shadowStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    shadowStarted = resolve;
  });
  const complete = vi.fn(async (input: Parameters<typeof hanging.complete>[0]) => {
    shadowStarted();
    return hanging.complete(input);
  });
  const { host: shadow } = fixtureHost();
  const pending = runGovernedInteraction(params, ports, {
    trigger: true,
    request: fixtureRequest({
      requestId: "governed-shadow-caller-signal-still-cancels",
      signal: other.signal,
      budget: { maxDurationMs: 5_000 },
    }),
    binding: {
      view: shadow.view,
      controlBoard: shadow.controlBoard,
      now: shadow.now,
      model: {
        runId: "governed-shadow-caller-signal-still-cancels",
        sessionPorts: stubShadowPorts(),
        config: {},
        env: {},
        complete,
      },
    },
  });
  await started;
  other.abort();
  const wrapped = await pending;
  expect(origin.signal.aborted).toBe(false);
  expect(wrapped.interaction).toEqual({ kind: "respond", text: "你好", clarification: false });
  expect(wrapped.shadow.outcomeCode).toBe("cancelled");
  expect(wrapped.shadow.cancelled).toBe(true);
  expect(commit).not.toHaveBeenCalled();
});

it("passes trusted group enterprise scope through the single commercial admission", async () => {
  const { host, params, ports } = bindReplyPorts();
  params.identity.executionIdentity = {
    enterpriseId: "tenant-group",
    collaborationGroupId: "group-fixture",
  };
  await runGovernedInteraction(params, ports);
  expect(host.admission.tryAcquireEnterpriseAgentRun).toHaveBeenCalledTimes(1);
  expect(host.admission.tryAcquireEnterpriseAgentRun).toHaveBeenCalledWith(
    expect.objectContaining({
      enterpriseId: "tenant-group",
      groupId: "group-fixture",
      modelGateInput: expect.objectContaining({ enterpriseIdHint: "tenant-group" }),
    }),
  );
});

it("never resolves a candidate when explicit enterprise admission is skipped", async () => {
  const { host, params, ports } = bindReplyPorts();
  params.identity.executionIdentity = {
    enterpriseId: "tenant-group",
    collaborationGroupId: "group-fixture",
  };
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
    acquired: false as const,
    skipped: true as const,
  }));
  const candidate = vi.fn(ports.candidate);
  const result = await runGovernedInteraction(params, { ...ports, candidate });
  expect(result).toMatchObject({
    kind: "respond",
    text: expect.stringContaining("企业模型准入未完成"),
  });
  expect(candidate).not.toHaveBeenCalled();
  expect(host.model.runWithModelFallback).not.toHaveBeenCalled();
  expect(host.admission.tryAcquireEnterpriseAgentRun).toHaveBeenCalledTimes(1);
});
