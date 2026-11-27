import { beforeEach, expect, it, vi } from "vitest";
import { ContractEndedError } from "../../gateway/billing/billing-period.js";
import { createCommandAdmissionSession } from "./command-admission-session.js";
const m = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  forget: vi.fn(),
  remember: vi.fn(),
  build: vi.fn(),
  credit: vi.fn(),
  runWithModelFallback: vi.fn(),
  recordCreditUsage: vi.fn(),
}));
vi.mock("./command-commercial-gate.js", () => ({
  acquireAgentCommandCommercialRun: m.acquire,
  releaseAgentCommandCommercialRun: m.release,
}));
vi.mock("../../gateway/governance/spawn-snapshot-handoff.js", () => ({
  forgetRunModelSet: m.forget,
  rememberRunModelSet: m.remember,
  buildRunModelSetSnapshot: m.build,
  snapshotCreditReportingFromGate: m.credit,
}));
vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: m.runWithModelFallback,
}));
vi.mock("../../gateway/billing/record-credit-usage.js", () => ({
  recordCreditUsage: m.recordCreditUsage,
}));
beforeEach(() => {
  vi.resetAllMocks();
  m.build.mockReturnValue({ runId: "run" });
});
it("returns denied for an ended contract without acquiring or releasing a lease", async () => {
  m.acquire.mockRejectedValue(new ContractEndedError("2026-01-01", "2026-11-09"));
  const session = createCommandAdmissionSession({ runId: "run", isSubagentLane: false });
  await expect(session.acquire({ runId: "run", sessionAgentId: "main" })).resolves.toMatchObject({
    status: "denied",
  });
  await session.dispose();
  expect(m.release).not.toHaveBeenCalled();
  expect(m.remember).not.toHaveBeenCalled();
});
it("keeps unexpected admission failures visible instead of disguising them as a denial", async () => {
  const error = new Error("storage unavailable");
  m.acquire.mockRejectedValue(error);
  const session = createCommandAdmissionSession({ runId: "run", isSubagentLane: false });
  await expect(session.acquire({ runId: "run", sessionAgentId: "main" })).rejects.toBe(error);
});
it("acquired parent snapshots once and releases before forgetting", async () => {
  m.acquire.mockResolvedValue({
    status: "acquired",
    enterpriseId: "tenant",
    authorizationDecisionId: "auth",
    modelGate: { allowlist: ["openai/gpt-5"] },
  });
  const s = createCommandAdmissionSession({ runId: "run", isSubagentLane: false, entry: "E2" });
  await s.acquire({ runId: "run", sessionAgentId: "main", entry: "E2" });
  expect(m.remember).toHaveBeenCalledTimes(1);
  expect(s.fallbackGovernance()).toMatchObject({
    governanceContext: { entry: "E2", tenantId: "tenant" },
  });
  await s.dispose();
  await s.dispose();
  expect(m.release).toHaveBeenCalledTimes(1);
  expect(m.release.mock.invocationCallOrder[0]).toBeLessThan(m.forget.mock.invocationCallOrder[0]);
});
it("child acquires E6 quota without replacing inherited model snapshot", async () => {
  m.acquire.mockResolvedValue({ status: "acquired" });
  const s = createCommandAdmissionSession({ runId: "run", isSubagentLane: true });
  await s.acquire({ runId: "run", sessionAgentId: "child", entry: "E6" });
  expect(m.acquire).toHaveBeenCalledWith(expect.objectContaining({ entry: "E6" }));
  expect(m.build).not.toHaveBeenCalled();
  expect(s.fallbackGovernance()).toEqual({});
  await s.dispose();
});
it.each(["denied", "skipped"])("%s never releases an unheld slot", async (status) => {
  m.acquire.mockResolvedValue({ status });
  const s = createCommandAdmissionSession({ runId: "run", isSubagentLane: false });
  await s.acquire({ runId: "run", sessionAgentId: "main" });
  await s.dispose();
  expect(m.release).not.toHaveBeenCalled();
  expect(m.forget).not.toHaveBeenCalled();
});

it("enforces disposed guard, platformModelsMode/selectorStrategy snapshot parity, infer, and recordUsage", async () => {
  m.acquire.mockResolvedValue({
    status: "acquired",
    enterpriseId: "tenant-snap",
    authorizationDecisionId: "auth-snap",
    subscriptionId: "sub-snap",
    modelGate: {
      tenantId: "tenant-snap",
      allowlist: ["openai/gpt-5.2"],
      effectiveRouting: { mode: "aor_enhanced", selectorStrategy: "bandit" },
      creditReporting: { enterpriseId: "tenant-snap", policyId: "policy-snap" },
    },
  });
  m.runWithModelFallback.mockImplementation(
    async (input: { run: (p: string, mod: string) => Promise<unknown> }) => ({
      result: await input.run("openai", "gpt-5.2"),
      provider: "openai",
      model: "gpt-5.2",
      attempts: [],
    }),
  );
  m.recordCreditUsage.mockResolvedValue({
    recorded: true,
    deduped: false,
    creditsCharged: 1,
    tier: "test",
    providerCostCents: 0,
    tenantRevenueCents: 0,
  });

  const s = createCommandAdmissionSession(
    {
      runId: "run-snap",
      isSubagentLane: false,
      entry: "E2",
    },
    { runWithModelFallback: m.runWithModelFallback },
  );
  await expect(
    s.infer({
      cfg: {},
      provider: "openai",
      model: "gpt-5.2",
      taskText: "t",
      run: async () => "no",
    }),
  ).rejects.toThrow(/not prepared/);

  await s.acquire({ runId: "run-snap", sessionAgentId: "main", entry: "E2" });
  expect(m.build).toHaveBeenCalledWith(
    expect.objectContaining({
      platformModelsMode: "aor_enhanced",
      selectorStrategy: "bandit",
    }),
  );

  const out = await s.infer({
    cfg: {},
    provider: "openai",
    model: "gpt-5.2",
    taskText: "hello",
    run: async () => "ok",
  });
  expect(out.result).toBe("ok");
  expect(m.runWithModelFallback).toHaveBeenCalledOnce();

  await s.recordUsage({
    provider: "openai",
    model: "gpt-5.2",
    toolCallCount: 0,
    toolClasses: [],
    fallbackAttemptsRaw: [],
  });
  expect(m.recordCreditUsage).toHaveBeenCalledOnce();

  await s.dispose();
  await expect(s.acquire({ runId: "run-snap", sessionAgentId: "main" })).rejects.toThrow(
    /disposed/,
  );
  await expect(
    s.infer({
      cfg: {},
      provider: "openai",
      model: "gpt-5.2",
      taskText: "t",
      run: async () => "no",
    }),
  ).rejects.toThrow(/not prepared/);
  expect(() =>
    s.recordUsage({
      provider: "openai",
      model: "gpt-5.2",
      toolCallCount: 0,
      toolClasses: [],
      fallbackAttemptsRaw: [],
    }),
  ).toThrow(/authorized/);
});
