import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildEmbeddedExtensionFactories } from "../../../agents/pi-embedded-runner/extensions.js";
import { resolveModel } from "../../../agents/pi-embedded-runner/model.js";
import { getCompactionSafeguardRuntime } from "../../../agents/pi-extensions/compaction-safeguard-runtime.js";
import type { OpenBotConfig } from "../../../config/config.js";
import {
  activateApprovedRuntimeRuleProposal,
  revokeActivatedRuntimeRulePolicy,
  readActivatedRuntimeRulePolicy,
} from "../../command/rule-adaptation/activate.js";
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
import { createOfficialFixtureContextCapPort } from "../../command/rule-adaptation/fixture-context-cap-port.js";
import {
  NO_LIVE_EXECUTION_CLAIM,
  PRODUCTION_RUNTIME_RULE_WHITELIST,
  RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
  type ActivatedRuntimeRulePolicySnapshot,
  type RuntimeRuleAdaptationReadBinding,
} from "../../contracts/rule-adaptation-activation.js";
import { recoverContextOverflow } from "../../execution/recovery/context-overflow.js";
import { prepareEmbeddedModel } from "../prepare-embedded-model.js";
import {
  ContextCapSelectionBlockedError,
  inheritSelectedContextCap,
  selectPersonalContextCap,
  type PersonalContextCapSelectionPort,
} from "./context-cap-selection.js";

vi.mock("../../../agents/pi-embedded-runner/model.js", () => ({ resolveModel: vi.fn() }));

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
    authStorage: {},
    modelRegistry: {},
  } as Awaited<ReturnType<typeof resolveModel>>);
});

const prepareBase = {
  provider: "custom",
  modelId: "m",
  agentDir: "/tmp/test-p4-context-cap",
  log: { warn: vi.fn(), error: vi.fn() },
  providerAuthOverride: {
    apiKey: "test-only",
    baseUrl: "https://example.invalid/api",
    protocol: "anthropic",
  },
};

function originalInfo(tokens: number) {
  return { tokens, source: "model" as const };
}

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
  expect(result.snapshot?.mainChainWired).toBe(false);
  expect(result.snapshot?.whitelistSource).toBe("fixture");
  return { binding, result };
}

function snapshotPort(sessionFile: string): PersonalContextCapSelectionPort {
  return createOfficialFixtureContextCapPort({
    mode: "personal_activated_snapshot",
    readBinding: fixtureReadBinding(),
    deps: fixtureDeps(sessionFile),
  });
}

function plantCurrentSnapshot(
  sessionFile: string,
  snapshot: Partial<ActivatedRuntimeRulePolicySnapshot> &
    Pick<ActivatedRuntimeRulePolicySnapshot, "status">,
) {
  const board = seedFixtureBoard(sessionFile, {
    writeEpoch: 2,
    runtimeRuleAdaptationByTaskId: {
      [FIXTURE_TASK_ID]: {
        current: {
          operation: "activate",
          taskId: FIXTURE_TASK_ID,
          scope: { type: "personal", id: "agent:fixture-personal-1" },
          boardScope: { ...FIXTURE_BOARD_SCOPE },
          items: [
            {
              ruleId: "model.context_window.guard",
              field: "agents.defaults.contextTokens",
              action: "tune",
              parameter: 24_000,
            },
          ],
          implementationVersion: RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
          catalogVersion: "inventory:test",
          policyHash: "fixture-policy-hash-aaaa",
          protocolVersion: "1.1",
          compilerRevision: "1.2.0",
          writeEpoch: 2,
          authorizationReference: "authref:fixture-tune-1",
          hostActivationGate: "test_entry",
          actor: {
            principalType: "personal",
            principalId: "user:fixture-1",
            scope: { type: "personal", id: "agent:fixture-personal-1" },
          },
          recordedAtMs: 1_731_398_400_000,
          effectiveNode: "cas_persist_success",
          whitelistSource: "fixture",
          mainChainWired: false,
          ...snapshot,
        },
        history: [],
      },
    },
  });
  return board;
}

it("keeps the production whitelist empty", () => {
  expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
});

it("mode original ignores a corrupt fixture and keeps 128000", async () => {
  const tmp = openSession();
  plantCurrentSnapshot(tmp.sessionFile, {
    status: "effective",
    items: [
      {
        ruleId: "model.context_window.guard",
        field: "agents.defaults.contextTokens",
        action: "tune",
        parameter: "not-a-number",
      },
    ],
  });
  const throwingRead: PersonalContextCapSelectionPort = {
    mode: "original",
    fixtureResolve: {
      kind: "fixture",
      readBinding: fixtureReadBinding(),
      onDiskBoardScope: { ...FIXTURE_BOARD_SCOPE },
      read: () => {
        throw new Error("fixture read must not run in original mode");
      },
    },
  };
  const result = await prepareEmbeddedModel({
    ...prepareBase,
    log: { warn: vi.fn(), error: vi.fn() },
    contextCapSelection: throwingRead,
  });
  expect(result.ctxInfo.tokens).toBe(128_000);
  expect(result.effectiveModel.contextWindow).toBe(128_000);
  expect(result.contextCapSelection.outcome).toBe("applied");
  expect(result.contextCapSelection.source).toBe("original");
});

it("default omitted port does not read live boards and stays at 128000", async () => {
  const result = await prepareEmbeddedModel({
    ...prepareBase,
    log: { warn: vi.fn(), error: vi.fn() },
  });
  expect(result.ctxInfo.tokens).toBe(128_000);
  expect(result.contextCapSelection.mode).toBe("original");
  expect(result.contextCapSelection.outcome).toBe("applied");
});

it("legally tightens 128000 to the effective 24000 task cap, then runs the hard guard", async () => {
  const tmp = openSession();
  activateLegalCap(tmp.sessionFile, 24_000);
  const log = { warn: vi.fn(), error: vi.fn() };
  const result = await prepareEmbeddedModel({
    ...prepareBase,
    log,
    contextCapSelection: snapshotPort(tmp.sessionFile),
  });
  expect(result.ctxInfo.tokens).toBe(24_000);
  expect(result.effectiveModel.contextWindow).toBe(24_000);
  expect(result.contextCapSelection).toMatchObject({
    outcome: "applied",
    mode: "personal_activated_snapshot",
    source: "personal_activated_snapshot",
    originalTokens: 128_000,
    tokens: 24_000,
    snapshotParameter: 24_000,
  });
  expect(log.warn).toHaveBeenCalled(); // 24000 < warn threshold 32000
  expect(log.error).not.toHaveBeenCalled();
});

it("blocks a corrupt snapshot in snapshot mode and does not quietly become 128000", async () => {
  const tmp = openSession();
  plantCurrentSnapshot(tmp.sessionFile, {
    status: "effective",
    items: [
      {
        ruleId: "model.context_window.guard",
        field: "agents.defaults.contextTokens",
        action: "tune",
        parameter: "corrupt",
      },
    ],
  });
  const log = { warn: vi.fn(), error: vi.fn() };
  await expect(
    prepareEmbeddedModel({
      ...prepareBase,
      log,
      contextCapSelection: snapshotPort(tmp.sessionFile),
    }),
  ).rejects.toSatisfy((err: unknown) => {
    expect(err).toBeInstanceOf(ContextCapSelectionBlockedError);
    const blocked = err as ContextCapSelectionBlockedError;
    expect(blocked.code).toBe("context_cap_selection_blocked");
    expect(blocked.reason).toBe("snapshot_corrupt");
    expect(blocked).not.toMatchObject({ tokens: 128_000 });
    return true;
  });
  expect(log.error).toHaveBeenCalled();
});

it("blocks a read failure in snapshot mode and does not quietly become 128000", async () => {
  const log = { warn: vi.fn(), error: vi.fn() };
  const port: PersonalContextCapSelectionPort = {
    mode: "personal_activated_snapshot",
    fixtureResolve: {
      kind: "fixture",
      readBinding: fixtureReadBinding(),
      onDiskBoardScope: { ...FIXTURE_BOARD_SCOPE },
      read: () => {
        throw new Error("simulated fixture read failure");
      },
    },
  };
  const selection = selectPersonalContextCap({
    original: originalInfo(128_000),
    port,
  });
  expect(selection).toMatchObject({
    outcome: "blocked",
    reason: "read_failed",
    originalTokens: 128_000,
  });
  expect("tokens" in selection).toBe(false);

  await expect(
    prepareEmbeddedModel({ ...prepareBase, log, contextCapSelection: port }),
  ).rejects.toSatisfy((err: unknown) => {
    expect(err).toBeInstanceOf(ContextCapSelectionBlockedError);
    expect((err as ContextCapSelectionBlockedError).code).toBe("context_cap_selection_blocked");
    expect((err as ContextCapSelectionBlockedError).reason).toBe("read_failed");
    return true;
  });
});

it("lets a tighter config cap win over the snapshot, which must not enlarge", async () => {
  const tmp = openSession();
  activateLegalCap(tmp.sessionFile, 24_000);
  const result = await prepareEmbeddedModel({
    ...prepareBase,
    log: { warn: vi.fn(), error: vi.fn() },
    config: { agents: { defaults: { contextTokens: 20_000 } } },
    contextCapSelection: snapshotPort(tmp.sessionFile),
  });
  expect(result.ctxInfo.tokens).toBe(20_000);
  expect(result.effectiveModel.contextWindow).toBe(20_000);
  expect(result.contextCapSelection).toMatchObject({
    outcome: "applied",
    source: "personal_activated_snapshot",
    originalTokens: 20_000,
    snapshotParameter: 24_000,
    tokens: 20_000,
  });
});

it("uses original parse when there is really no snapshot", async () => {
  const tmp = openSession();
  seedFixtureBoard(tmp.sessionFile);
  const result = await prepareEmbeddedModel({
    ...prepareBase,
    log: { warn: vi.fn(), error: vi.fn() },
    contextCapSelection: snapshotPort(tmp.sessionFile),
  });
  expect(result.contextCapSelection).toMatchObject({
    outcome: "no_snapshot",
    source: "original",
    tokens: 128_000,
  });
  expect(result.ctxInfo.tokens).toBe(128_000);
});

it("treats a completed revoke as a controlled change, not as no_snapshot, and does not apply the revoked cap", async () => {
  const tmp = openSession();
  const { binding, result: activated } = activateLegalCap(tmp.sessionFile, 24_000);
  const revoked = revokeActivatedRuntimeRulePolicy(
    {
      fixture: true,
      authorizationReference: binding.authorizationReference,
      identity: binding.identity,
      taskBinding: binding.taskBinding,
      expectedWriteEpoch: activated.boardWriteEpoch,
      expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
      hostActivationGate: "explicit_approval",
      nowMs: 1_731_398_400_200,
      revokeReason: "authorization_revoked",
    },
    fixtureDeps(tmp.sessionFile),
  );
  expect(revoked.resultKind).toBe("activated");
  expect(revoked.snapshot?.status).toBe("revoked");
  const found = readActivatedRuntimeRulePolicy(fixtureReadBinding(), fixtureDeps(tmp.sessionFile));
  expect(found.resultKind).toBe("found");
  expect(found.snapshot?.status).toBe("revoked");

  const result = await prepareEmbeddedModel({
    ...prepareBase,
    log: { warn: vi.fn(), error: vi.fn() },
    contextCapSelection: snapshotPort(tmp.sessionFile),
  });
  expect(result.contextCapSelection).toMatchObject({
    outcome: "controlled_change",
    change: "revoked",
    snapshotStatus: "revoked",
    tokens: 128_000,
  });
  expect(result.contextCapSelection.outcome).not.toBe("no_snapshot");
  expect(result.ctxInfo.tokens).toBe(128_000);
});

it("re-reads on the next prepare attempt after a revoke", async () => {
  const tmp = openSession();
  const { binding, result: activated } = activateLegalCap(tmp.sessionFile, 24_000);
  const first = await prepareEmbeddedModel({
    ...prepareBase,
    log: { warn: vi.fn(), error: vi.fn() },
    contextCapSelection: snapshotPort(tmp.sessionFile),
  });
  expect(first.ctxInfo.tokens).toBe(24_000);

  const revoked = revokeActivatedRuntimeRulePolicy(
    {
      fixture: true,
      authorizationReference: binding.authorizationReference,
      identity: binding.identity,
      taskBinding: binding.taskBinding,
      expectedWriteEpoch: activated.boardWriteEpoch,
      expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
      hostActivationGate: "explicit_approval",
      nowMs: 1_731_398_400_200,
      revokeReason: "task_cancelled",
    },
    fixtureDeps(tmp.sessionFile),
  );
  expect(revoked.resultKind).toBe("activated");

  const second = await prepareEmbeddedModel({
    ...prepareBase,
    log: { warn: vi.fn(), error: vi.fn() },
    contextCapSelection: snapshotPort(tmp.sessionFile),
  });
  expect(second.contextCapSelection.outcome).toBe("controlled_change");
  expect(second.ctxInfo.tokens).toBe(128_000);
});

it("does not treat context-cap selection as a permission credential that could bypass cancel gates", () => {
  const selection = selectPersonalContextCap({
    original: originalInfo(128_000),
  });
  expect(selection).not.toHaveProperty("authorizationStatus");
  expect(selection).not.toHaveProperty("permission");
  expect(selection).not.toHaveProperty("canceled");
});

it("blocks snapshot mode when the production path would have to be opened", () => {
  const selection = selectPersonalContextCap({
    original: originalInfo(128_000),
    port: { mode: "personal_activated_snapshot" },
  });
  expect(selection).toMatchObject({
    outcome: "blocked",
    reason: "production_path_closed",
    originalTokens: 128_000,
  });
});

it("does not reverse-prove identity from on-disk scope; a scope mismatch blocks", () => {
  const tmp = openSession();
  activateLegalCap(tmp.sessionFile, 24_000);
  const mismatched: RuntimeRuleAdaptationReadBinding = {
    ...fixtureReadBinding(),
    taskBinding: {
      taskId: FIXTURE_TASK_ID,
      boardScope: {
        tenantId: "tenant:other",
        userId: FIXTURE_BOARD_SCOPE.userId,
        sessionId: FIXTURE_BOARD_SCOPE.sessionId,
      },
    },
  };
  const port = createOfficialFixtureContextCapPort({
    mode: "personal_activated_snapshot",
    readBinding: mismatched,
    deps: fixtureDeps(tmp.sessionFile),
  });
  const selection = selectPersonalContextCap({
    original: originalInfo(128_000),
    port,
  });
  expect(selection).toMatchObject({
    outcome: "blocked",
    reason: "identity_unverified",
  });
});

it("accepts a personal task that still has a tenant on the board scope", async () => {
  const tmp = openSession();
  activateLegalCap(tmp.sessionFile, 24_000);
  expect(FIXTURE_BOARD_SCOPE.tenantId).toBeTruthy();
  const result = await prepareEmbeddedModel({
    ...prepareBase,
    log: { warn: vi.fn(), error: vi.fn() },
    contextCapSelection: snapshotPort(tmp.sessionFile),
  });
  expect(result.ctxInfo.tokens).toBe(24_000);
});

it("inheritSelectedContextCap never enlarges, and lets a tighter re-parse win", () => {
  expect(inheritSelectedContextCap(128_000, 24_000)).toBe(24_000);
  expect(inheritSelectedContextCap(20_000, 24_000)).toBe(20_000);
  expect(inheritSelectedContextCap(24_000, undefined)).toBe(24_000);
});

it("same-run extensions inherit the selected cap and do not re-parse back to 128000", () => {
  const sessionManager = {} as SessionManager;
  const cfg = {
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
  const model = { id: "m", contextWindow: 128_000 } as never;
  buildEmbeddedExtensionFactories({
    cfg,
    sessionManager,
    provider: "custom",
    modelId: "m",
    model,
    inheritedContextWindowTokens: 24_000,
  });
  expect(getCompactionSafeguardRuntime(sessionManager)?.contextWindowTokens).toBe(24_000);

  const other = {} as SessionManager;
  buildEmbeddedExtensionFactories({
    cfg,
    sessionManager: other,
    provider: "custom",
    modelId: "m",
    model,
  });
  expect(getCompactionSafeguardRuntime(other)?.contextWindowTokens).toBe(128_000);
});

it("overflow recovery inherits ctxInfo.tokens and does not re-resolve a larger window", async () => {
  const truncate = vi.fn(async () => ({ truncated: true, truncatedCount: 1 }));
  const result = await recoverContextOverflow({
    ports: {
      isCompactionFailureError: () => false,
      log: {
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        isEnabled: () => false,
      },
      hasOversized: ({ contextWindowTokens }) => {
        expect(contextWindowTokens).toBe(24_000);
        return true;
      },
      truncate,
    },
    contextOverflowError: { text: "context overflow", source: "test" },
    attempt: { messagesSnapshot: [{ role: "user" }] },
    attemptCompactionCount: 1,
    params: { sessionId: "s", sessionFile: "/tmp/unused-session.jsonl" },
    provider: "custom",
    modelId: "m",
    ctxInfo: { tokens: 24_000 },
    createDiagId: () => "diag-test",
    compact: async () => ({ compacted: false }),
    overflowCompactionAttempts: 3,
    toolResultTruncationAttempted: false,
    autoCompactionCount: 0,
    MAX_OVERFLOW_COMPACTION_ATTEMPTS: 3,
  });
  expect(truncate).toHaveBeenCalledWith(expect.objectContaining({ contextWindowTokens: 24_000 }));
  expect(result.action).toBe("retry");
});
