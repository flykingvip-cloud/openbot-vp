import { beforeEach, expect, it, vi } from "vitest";
import { bindAdmittedTurnHost } from "../../wiring/admitted-turn-host.js";
import {
  CONTROLLED_EXECUTION_STAGE_ORDER,
  assertControlledExecutionStages,
} from "./controlled-execution.js";
import {
  createUnifiedExecutionLifecycle,
  runControlledAuxiliaryTurn,
} from "./unified-lifecycle.js";

const mocks = vi.hoisted(() => ({
  acquireCmd: vi.fn((..._args: unknown[]): unknown => undefined),
  releaseCmd: vi.fn(async (..._args: unknown[]) => {}),
  runWithModelFallback: vi.fn(
    (_input: { run: (p: string, m: string) => Promise<unknown> }): Promise<unknown> =>
      Promise.resolve(undefined),
  ),
  recordCreditUsage: vi.fn(async (..._args: unknown[]) => ({
    recorded: true,
    deduped: false,
    creditsCharged: 0,
    tier: "test",
    providerCostCents: 0,
    tenantRevenueCents: 0,
    skippedConsumption: true,
  })),
  rememberRunModelSet: vi.fn((..._args: unknown[]) => {}),
  forgetRunModelSet: vi.fn((..._args: unknown[]) => {}),
  buildRunModelSetSnapshot: vi.fn((input: Record<string, unknown>) => ({ ...input })),
  snapshotCreditReportingFromGate: vi.fn((..._args: unknown[]) => undefined),
  runEmbeddedPiAgent: vi.fn(async (..._args: unknown[]) => ({
    payloads: [{ text: "aux-ok" }],
    meta: { durationMs: 1 },
  })),
}));

vi.mock("../../model/command-commercial-gate.js", () => ({
  acquireAgentCommandCommercialRun: (...args: unknown[]) => mocks.acquireCmd(...args),
  releaseAgentCommandCommercialRun: (...args: unknown[]) => mocks.releaseCmd(...args),
}));

vi.mock("../../../agents/model-fallback.js", () => ({
  runWithModelFallback: (input: { run: (p: string, m: string) => Promise<unknown> }) =>
    mocks.runWithModelFallback(input),
}));

vi.mock("../../../gateway/billing/record-credit-usage.js", () => ({
  recordCreditUsage: (...args: unknown[]) => mocks.recordCreditUsage(...args),
}));

vi.mock("./embedded-run.js", () => ({
  runEmbeddedPiAgent: (...args: unknown[]) => mocks.runEmbeddedPiAgent(...args),
}));

vi.mock("../../../gateway/governance/spawn-snapshot-handoff.js", () => ({
  buildRunModelSetSnapshot: (input: Record<string, unknown>) =>
    mocks.buildRunModelSetSnapshot(input),
  rememberRunModelSet: (...args: unknown[]) => mocks.rememberRunModelSet(...args),
  forgetRunModelSet: (...args: unknown[]) => mocks.forgetRunModelSet(...args),
  lookupRunModelSet: () => undefined,
  snapshotCreditReportingFromGate: (...args: unknown[]) =>
    mocks.snapshotCreditReportingFromGate(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.releaseCmd.mockResolvedValue(undefined);
  mocks.runWithModelFallback.mockImplementation(
    async (input: { run: (p: string, m: string) => Promise<unknown> }) => ({
      result: await input.run("openai", "gpt-5.2"),
      provider: "openai",
      model: "gpt-5.2",
      attempts: [],
    }),
  );
});

it("exposes the frozen controlled execution stage order across turn, command, and work_item modes", () => {
  const host = bindAdmittedTurnHost();
  const turn = createUnifiedExecutionLifecycle({ mode: "turn", runId: "u-turn", host });
  const command = createUnifiedExecutionLifecycle({
    mode: "command",
    runId: "u-cmd",
    isSubagentLane: false,
  });
  const workItem = createUnifiedExecutionLifecycle({
    mode: "work_item",
    ports: { acquire: async () => ({ status: "skipped" as const }), release: async () => {} },
  });
  const auxiliary = createUnifiedExecutionLifecycle({
    mode: "auxiliary",
    runId: "u-aux",
    purpose: "memory_flush",
  });
  for (const [scene, lifecycle] of [
    ["turn", turn],
    ["command", command],
    ["work_item", workItem],
    ["auxiliary", auxiliary],
  ] as Array<[string, { stages: typeof CONTROLLED_EXECUTION_STAGE_ORDER }]>) {
    expect(lifecycle.stages).toBe(CONTROLLED_EXECUTION_STAGE_ORDER);
    expect(() => assertControlledExecutionStages(lifecycle, scene)).not.toThrow();
  }
});

it("turn mode enforces prepare/infer/recordUsage/single-dispose lifecycle", async () => {
  const host = bindAdmittedTurnHost();
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn<
    typeof host.admission.tryAcquireEnterpriseAgentRun
  >(async () => ({
    acquired: true as const,
    skipped: false as const,
    enterpriseId: "tenant-1",
    authorizationDecisionId: "auth-1",
    modelGate: {
      tenantId: "tenant-1",
      allowlist: ["openai/gpt-5.2"],
      creditReporting: { enterpriseId: "tenant-1", policyId: "policy-1" },
      effectiveRouting: { mode: "native" as const, selectorStrategy: "balanced" as const },
    },
  }));
  host.admission.releaseEnterpriseAgentRun = vi.fn(async () => {});
  host.model.forgetRunModelSet = vi.fn();
  host.model.buildRunModelSetSnapshot = vi.fn(() => undefined);
  host.model.runWithModelFallback = vi.fn(async (input) => ({
    result: await input.run("openai", "gpt-5.2"),
    provider: "openai",
    model: "gpt-5.2",
    attempts: [],
  }));
  host.accounting.recordCreditUsage = vi.fn(async (_input) => ({
    recorded: true,
    deduped: false,
    creditsCharged: 1,
    tier: "test",
    providerCostCents: 0,
    tenantRevenueCents: 0,
    skippedConsumption: false,
  }));

  const lifecycle = createUnifiedExecutionLifecycle({ mode: "turn", runId: "turn-1", host });
  expect(() =>
    lifecycle.infer({
      cfg: {},
      provider: "openai",
      model: "gpt-5.2",
      taskText: "t",
      run: async () => "x",
    }),
  ).toThrow(/not prepared/);

  expect((await lifecycle.prepare({ config: {}, authorization: {} })).kind).toBe("ready");
  expect(
    (
      await lifecycle.infer({
        cfg: {},
        provider: "openai",
        model: "gpt-5.2",
        taskText: "t",
        run: async () => "ok",
      })
    ).result,
  ).toBe("ok");

  await lifecycle.recordUsage({
    provider: "openai",
    model: "gpt-5.2",
    toolCallCount: 0,
    toolClasses: [],
    fallbackAttemptsRaw: [],
  });
  expect(host.accounting.recordCreditUsage).toHaveBeenCalledOnce();

  await Promise.all([lifecycle.dispose(), lifecycle.dispose()]);
  expect(host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
  expect(host.model.forgetRunModelSet).toHaveBeenCalledOnce();
});

it("command mode runs ACP singleShot inside infer(), blocks denied/aborted runs, and supports recordUsage parity", async () => {
  // 1) Denied preparation never runs ACP singleShot or releases an unheld slot
  mocks.acquireCmd.mockResolvedValueOnce({ status: "denied", message: "quota denied" });
  const deniedLifecycle = createUnifiedExecutionLifecycle({
    mode: "command",
    runId: "cmd-deny-acp",
    isSubagentLane: false,
    entry: "E2",
  });
  const acpRunDenied = vi.fn(async () => "acp-ran");
  const deniedPrep = await deniedLifecycle.prepare({
    authorization: { runId: "cmd-deny-acp", sessionAgentId: "main", entry: "E2" },
  });
  expect(deniedPrep.kind).toBe("denied");
  expect(() =>
    deniedLifecycle.infer({
      cfg: {},
      provider: "acp",
      model: "codex",
      taskText: "t",
      singleShot: true,
      run: acpRunDenied,
    }),
  ).toThrow(/not prepared/);
  expect(acpRunDenied).not.toHaveBeenCalled();
  await deniedLifecycle.dispose();
  expect(mocks.releaseCmd).not.toHaveBeenCalled();

  // 2) Ready command lifecycle executes singleShot ACP without runWithModelFallback and records usage on model runs
  mocks.acquireCmd.mockResolvedValueOnce({
    status: "acquired",
    enterpriseId: "tenant-cmd",
    authorizationDecisionId: "auth-cmd",
    modelGate: {
      tenantId: "tenant-cmd",
      allowlist: ["openai/gpt-5.2"],
      effectiveRouting: { mode: "aor_enhanced", selectorStrategy: "bandit" },
      creditReporting: { enterpriseId: "tenant-cmd", policyId: "pol-cmd" },
    },
  });
  const acpLifecycle = createUnifiedExecutionLifecycle({
    mode: "command",
    runId: "cmd-acp-ok",
    isSubagentLane: false,
    entry: "E2",
    config: {},
  });
  const readyPrep = await acpLifecycle.prepare({
    authorization: { runId: "cmd-acp-ok", sessionAgentId: "main", entry: "E2" },
  });
  expect(readyPrep.kind).toBe("ready");
  expect(mocks.buildRunModelSetSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({
      platformModelsMode: "aor_enhanced",
      selectorStrategy: "bandit",
    }),
  );
  const acpBackend = vi.fn(async () => ({ finalText: "acp-done" }));
  const acpOut = await acpLifecycle.infer({
    cfg: {},
    provider: "acp",
    model: "codex",
    taskText: "t",
    singleShot: true,
    run: acpBackend,
  });
  expect(acpOut.result).toEqual({ finalText: "acp-done" });
  expect(acpBackend).toHaveBeenCalledOnce();
  expect(mocks.runWithModelFallback).not.toHaveBeenCalled();

  await acpLifecycle.recordUsage({
    provider: "openai",
    model: "gpt-5.2",
    toolCallCount: 1,
    toolClasses: ["read"],
    fallbackAttemptsRaw: [],
  });
  expect(mocks.recordCreditUsage).toHaveBeenCalledOnce();

  await Promise.all([acpLifecycle.dispose(), acpLifecycle.dispose()]);
  expect(mocks.releaseCmd).toHaveBeenCalledOnce();
  expect(mocks.forgetRunModelSet).toHaveBeenCalledOnce();
});

it("work_item mode supports recordUsage parity and single-dispose safety", async () => {
  const acquire = vi.fn(async () => ({ status: "acquired" as const }));
  const release = vi.fn(async () => {});
  const recordUsage = vi.fn(async () => ({ recorded: true }));
  const lifecycle = createUnifiedExecutionLifecycle({
    mode: "work_item",
    ports: { acquire, release, recordUsage },
  });
  await lifecycle.prepare({ runId: "wi-1", agentId: "main", enterpriseId: "ent-1" });
  await lifecycle.infer({
    cfg: {},
    provider: "codex-cli",
    model: "default",
    taskText: "work",
    run: async () => "ok",
  });
  await lifecycle.recordUsage({
    provider: "codex-cli",
    model: "default",
    toolCallCount: 0,
    toolClasses: [],
    fallbackAttemptsRaw: [],
  });
  expect(recordUsage).toHaveBeenCalledOnce();
  await Promise.all([lifecycle.dispose(), lifecycle.dispose()]);
  expect(release).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledWith("wi-1");
});

it("auxiliary mode routes memory_flush/slug_filename through AuthorizedModelSession without overwriting parent snapshot", async () => {
  const lifecycle = createUnifiedExecutionLifecycle({
    mode: "auxiliary",
    runId: "aux-flush-1",
    purpose: "memory_flush",
    parentRunId: "parent-1",
  });
  const prep = await lifecycle.prepare({ config: {} });
  expect(prep.kind).toBe("ready");
  const out = await lifecycle.infer({
    cfg: {},
    provider: "openai",
    model: "gpt-5.2",
    taskText: "flush",
    run: async () => ({ payloads: [{ text: "flushed" }] }),
  });
  expect(out.result).toEqual({ payloads: [{ text: "flushed" }] });
  expect(mocks.runWithModelFallback).toHaveBeenCalledWith(
    expect.objectContaining({
      runId: "aux-flush-1",
      governanceContext: expect.objectContaining({
        purpose: "memory_flush",
        parentRunId: "parent-1",
      }),
    }),
  );
  expect(mocks.rememberRunModelSet).not.toHaveBeenCalled();
  await lifecycle.dispose();
});

it("runControlledAuxiliaryTurn executes extension turns through auxiliary lifecycle and respects AbortSignal", async () => {
  const result = await runControlledAuxiliaryTurn({
    sessionId: "s-aux",
    sessionFile: "/tmp/s-aux.jsonl",
    workspaceDir: "/tmp",
    config: {},
    prompt: "hello",
    provider: "openai",
    model: "gpt-5.2",
    timeoutMs: 1000,
    runId: "aux-ext-1",
  });
  expect(result.payloads?.[0]?.text).toBe("aux-ok");
  expect(mocks.runEmbeddedPiAgent).toHaveBeenCalledOnce();
  expect(mocks.runWithModelFallback).not.toHaveBeenCalled();

  const controller = new AbortController();
  controller.abort();
  await expect(
    runControlledAuxiliaryTurn({
      sessionId: "s-aux-abort",
      sessionFile: "/tmp/s-aux-abort.jsonl",
      workspaceDir: "/tmp",
      config: {},
      prompt: "hello",
      provider: "openai",
      model: "gpt-5.2",
      timeoutMs: 1000,
      runId: "aux-ext-2",
      abortSignal: controller.signal,
    }),
  ).rejects.toThrow();
  expect(mocks.runEmbeddedPiAgent).toHaveBeenCalledOnce();
});
