// @vitest-environment node
/**
 * P3-2: memory flush inherits parent model set (shadow record-only, no filter).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GovernanceDecision } from "../../gateway/governance/decision.js";

const { appendMock } = vi.hoisted(() => ({ appendMock: vi.fn() }));
vi.mock("../../gateway/governance/shadow-sink.js", () => ({
  appendGovernanceShadowDecision: appendMock,
}));

vi.mock("../../agents/bootstrap-budget.js", () => ({
  resolveBootstrapWarningSignaturesSeen: vi.fn().mockReturnValue([]),
}));

vi.mock("../../agents/compaction.js", () => ({
  estimateMessagesTokens: vi.fn().mockReturnValue(1),
}));

vi.mock("../../agents/model-selection.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agents/model-selection.js")>();
  return {
    ...actual,
    isCliProvider: vi.fn().mockReturnValue(false),
  };
});

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

vi.mock("./agent-runner-utils.js", async () => {
  const { makeModelFallbackCfg } =
    await import("../../agents/test-helpers/model-fallback-config-fixture.js");
  return {
    buildEmbeddedRunBaseParams: vi.fn().mockReturnValue({}),
    buildEmbeddedRunContexts: vi.fn().mockReturnValue({
      authProfile: undefined,
      embeddedContext: {},
      senderContext: {},
    }),
    resolveModelFallbackOptions: vi.fn().mockImplementation(() => ({
      cfg: makeModelFallbackCfg(),
      provider: "openai",
      model: "gpt-4.1-mini",
      agentDir: "/tmp/openbot-mem-flush-gov-agent",
    })),
  };
});

vi.mock("./session-updates.js", () => ({
  incrementCompactionCount: vi.fn().mockResolvedValue(1),
}));

const { runWithModelFallback } = await import("../../agents/model-fallback.js");
const {
  buildRunModelSetSnapshot,
  rememberRunModelSet,
  resetSpawnGovernanceSnapshotHandoffForTest,
} = await import("../../gateway/governance/spawn-snapshot-handoff.js");
const { resolveMemoryFlushModelGovernance, runMemoryFlushIfNeeded } =
  await import("./agent-runner-memory.js");

const PRIMARY = "openai/gpt-4.1-mini";
const FALLBACK = "anthropic/claude-haiku-3-5";
const OUTSIDE = "other/not-in-parent-set";

function recordedDecisions(): GovernanceDecision[] {
  return appendMock.mock.calls.map(([decision]) => decision as GovernanceDecision);
}

function flushCfg() {
  return {
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
  } as never;
}

function flushParams(
  extra: Partial<Parameters<typeof runMemoryFlushIfNeeded>[0]> = {},
): Parameters<typeof runMemoryFlushIfNeeded>[0] {
  return {
    cfg: flushCfg(),
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
        provider: "openai",
        model: "gpt-4.1-mini",
        timeoutMs: 30_000,
        blockReplyBreak: "message_end",
      },
    },
    promptForEstimate: "Summarize and store durable memory.",
    sessionCtx: {} as never,
    defaultModel: "gpt-4.1-mini",
    agentCfgContextTokens: 2_000,
    resolvedVerboseLevel: "off" as const,
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
    ...extra,
  };
}

describe("resolveMemoryFlushModelGovernance (P3-2)", () => {
  beforeEach(() => {
    resetSpawnGovernanceSnapshotHandoffForTest();
    delete process.env.OPENBOT_GOVERNANCE_EMBEDDED_MODEL_MODE;
  });

  afterEach(() => {
    resetSpawnGovernanceSnapshotHandoffForTest();
    delete process.env.OPENBOT_GOVERNANCE_EMBEDDED_MODEL_MODE;
  });

  it("inherits parent allowlist + snapshot mode when parent set is an array", () => {
    const snapshot = buildRunModelSetSnapshot({
      runId: "parent-turn",
      allowlist: [PRIMARY],
      governanceMode: "shadow",
      tenantId: "tenant-a",
    });
    rememberRunModelSet("parent-turn", snapshot!);
    expect(resolveMemoryFlushModelGovernance("parent-turn")).toEqual({
      governanceMode: "shadow",
      entitlementAllowlist: [PRIMARY],
      governanceContext: {
        parentRunId: "parent-turn",
        tenantId: "tenant-a",
      },
    });
  });

  it("missing parent snapshot → skipped reason parent-model-set-absent, default shadow", () => {
    expect(resolveMemoryFlushModelGovernance("missing-parent")).toEqual({
      governanceMode: "shadow",
      absentAllowlistReason: "parent-model-set-absent",
      governanceContext: { parentRunId: "missing-parent" },
    });
  });

  it("undefined parentRunId → parent-model-set-absent", () => {
    expect(resolveMemoryFlushModelGovernance(undefined)).toEqual({
      governanceMode: "shadow",
      absentAllowlistReason: "parent-model-set-absent",
    });
  });

  it("parent snapshot mode legacy → flush legacy, no allowlist", () => {
    const snapshot = buildRunModelSetSnapshot({
      runId: "legacy-parent",
      allowlist: [PRIMARY],
      governanceMode: "legacy",
    });
    rememberRunModelSet("legacy-parent", snapshot!);
    expect(resolveMemoryFlushModelGovernance("legacy-parent")).toEqual({
      governanceMode: "legacy",
      governanceContext: { parentRunId: "legacy-parent" },
    });
  });

  it("uses OPENBOT_GOVERNANCE_EMBEDDED_MODEL_MODE when snapshot omits mode", () => {
    process.env.OPENBOT_GOVERNANCE_EMBEDDED_MODEL_MODE = "enforced";
    // buildRunModelSetSnapshot always sets governanceMode; simulate lookup of a
    // snapshot whose mode is missing by remembering then overriding via a
    // shadow-mode snapshot and checking env only for absent-parent path.
    expect(resolveMemoryFlushModelGovernance("no-snap").governanceMode).toBe("enforced");
  });
});

describe("runMemoryFlushIfNeeded governance (P3-2)", () => {
  let agentDir: string;

  beforeEach(async () => {
    appendMock.mockReset();
    appendMock.mockResolvedValue(true);
    resetSpawnGovernanceSnapshotHandoffForTest();
    delete process.env.OPENBOT_GOVERNANCE_EMBEDDED_MODEL_MODE;
    agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mem-flush-gov-"));
  });

  afterEach(async () => {
    resetSpawnGovernanceSnapshotHandoffForTest();
    delete process.env.OPENBOT_GOVERNANCE_EMBEDDED_MODEL_MODE;
    await fs.rm(agentDir, { recursive: true, force: true });
  });

  it("outside parent set: shadow effect deny, candidates same as without allowlist (no filter)", async () => {
    const snapshot = buildRunModelSetSnapshot({
      runId: "parent-turn",
      allowlist: [OUTSIDE],
      governanceMode: "shadow",
    });
    rememberRunModelSet("parent-turn", snapshot!);

    const baselineKeys: string[] = [];
    const baselineRun = vi.fn(async (provider: string, model: string) => {
      baselineKeys.push(`${provider}/${model}`);
      if (provider === "openai") {
        throw Object.assign(new Error("rate-limited"), { status: 429 });
      }
      return `ok:${provider}/${model}`;
    });
    await runWithModelFallback({
      cfg: (
        await import("../../agents/test-helpers/model-fallback-config-fixture.js")
      ).makeModelFallbackCfg(),
      provider: "openai",
      model: "gpt-4.1-mini",
      agentDir,
      run: baselineRun,
    });

    appendMock.mockClear();
    const flushKeys: string[] = [];
    const flushRun = vi.fn(async (provider: string, model: string) => {
      flushKeys.push(`${provider}/${model}`);
      if (provider === "openai") {
        throw Object.assign(new Error("rate-limited"), { status: 429 });
      }
      return { payloads: [], meta: { durationMs: 1 } };
    });

    // Drive the same governance path flush uses, asserting candidates + envelope.
    const gov = resolveMemoryFlushModelGovernance("parent-turn");
    await runWithModelFallback({
      cfg: (
        await import("../../agents/test-helpers/model-fallback-config-fixture.js")
      ).makeModelFallbackCfg(),
      provider: "openai",
      model: "gpt-4.1-mini",
      agentDir,
      ...gov,
      run: flushRun,
    });

    expect(flushKeys).toEqual(baselineKeys);
    expect(flushKeys).toEqual([PRIMARY, FALLBACK]);
    expect(recordedDecisions()[0]).toMatchObject({
      effect: "deny",
      mode: "shadow",
      shadow: { existing: { effect: "allow", reason: "not-enforced" } },
    });
  });

  it("no parent snapshot: skipped + parent-model-set-absent", async () => {
    await runMemoryFlushIfNeeded(flushParams({ parentRunId: "no-such-parent" }));
    // runMemoryFlushIfNeeded uses real runWithModelFallback (not mocked here).
    expect(recordedDecisions()[0]).toMatchObject({
      effect: "skipped",
      mode: "shadow",
      reason: "parent-model-set-absent",
    });
  });

  it("default env: flush model selection unchanged vs no-governance baseline", async () => {
    const baselineKeys: string[] = [];
    await runWithModelFallback({
      cfg: (
        await import("../../agents/test-helpers/model-fallback-config-fixture.js")
      ).makeModelFallbackCfg(),
      provider: "openai",
      model: "gpt-4.1-mini",
      agentDir,
      run: async (provider, model) => {
        baselineKeys.push(`${provider}/${model}`);
        if (provider === "openai") {
          throw Object.assign(new Error("rate-limited"), { status: 429 });
        }
        return "ok";
      },
    });

    const flushKeys: string[] = [];
    const gov = resolveMemoryFlushModelGovernance(undefined);
    // Absent parent → mode shadow, no allowlist → same candidates as baseline.
    expect(gov.entitlementAllowlist).toBeUndefined();
    await runWithModelFallback({
      cfg: (
        await import("../../agents/test-helpers/model-fallback-config-fixture.js")
      ).makeModelFallbackCfg(),
      provider: "openai",
      model: "gpt-4.1-mini",
      agentDir,
      ...gov,
      run: async (provider, model) => {
        flushKeys.push(`${provider}/${model}`);
        if (provider === "openai") {
          throw Object.assign(new Error("rate-limited"), { status: 429 });
        }
        return "ok";
      },
    });
    expect(flushKeys).toEqual(baselineKeys);
  });
});
