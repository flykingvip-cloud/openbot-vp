import { expect, it, vi } from "vitest";
import { resolveEmbeddedModelGovernance } from "../../../agents/embedded-model-governance.js";
import { fixtureUsage, noChangeOutput } from "../../command/rule-adaptation/test-support.js";
import { createAuthorizedModelSession, type ModelSessionPorts } from "../index.js";
import {
  createGovernedShadowModelPort,
  resolveShadowRuleAdaptationGovernance,
} from "./model-port.js";

function stubPorts(
  overrides: Partial<ModelSessionPorts["model"]> & {
    admission?: ModelSessionPorts["admission"];
  } = {},
): ModelSessionPorts {
  const admission = overrides.admission ?? {
    tryAcquireEnterpriseAgentRun: vi.fn(async () => ({
      acquired: false as const,
      skipped: true as const,
    })),
    releaseEnterpriseAgentRun: vi.fn(async () => {}),
  };
  return {
    accounting: { recordCreditUsage: vi.fn(async () => undefined) },
    admission,
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
      ...overrides,
    },
  } as unknown as ModelSessionPorts;
}

it("reuses shared embedded governance without inventing a parallel mode resolver", () => {
  const governance = resolveShadowRuleAdaptationGovernance({
    gateStatus: "skipped",
    actorId: "platform-user:fixture",
    env: {},
  });
  expect(governance.governanceMode).toBe("legacy");
  expect(governance.entitlementAllowlist).toBeUndefined();
  const acquired = resolveShadowRuleAdaptationGovernance({
    gateStatus: "acquired",
    allowlist: ["model-a"],
    tenantId: "tenant:fixture",
    env: {},
  });
  expect(acquired.governanceMode).toBe("shadow");
  expect(acquired.entitlementAllowlist).toEqual(["model-a"]);
  expect(acquired.allowlistEnforcement).toBe("preexisting");
});

it("runs completions through createAuthorizedModelSession and injected fixture completion", async () => {
  const ports = stubPorts();
  const dispose = vi.fn();
  const createSession = vi.fn((runId: string, sessionPorts: ModelSessionPorts) => {
    const session = createAuthorizedModelSession(runId, sessionPorts);
    const originalDispose = session.dispose.bind(session);
    session.dispose = () => {
      dispose();
      return originalDispose();
    };
    return session;
  });
  const complete = vi.fn(async () => ({
    kind: "message" as const,
    text: noChangeOutput(),
    usage: fixtureUsage(),
  }));
  const port = createGovernedShadowModelPort({
    runId: "shadow-run-1",
    sessionPorts: ports,
    createSession,
    config: {},
    env: {},
    complete,
  });
  const result = await port.complete({
    system: "sys",
    messages: [{ role: "user", content: "diagnose" }],
    tools: [],
    maxTokens: 4_000,
    timeoutMs: 5_000,
  });
  expect(createSession).toHaveBeenCalledWith("shadow-run-1", ports);
  expect(complete).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
  expect(result.kind).toBe("message");
  if (result.kind === "message") {
    expect(result.text).toContain("no_change");
  }
  // Skipped admission holds no commercial slot, so release must not be forced.
  expect(ports.admission.releaseEnterpriseAgentRun).not.toHaveBeenCalled();
});

it("maps admission denial and thrown inference to protocol_failure without throwing", async () => {
  const denied = stubPorts({
    admission: {
      tryAcquireEnterpriseAgentRun: vi.fn(async () => ({
        acquired: false as const,
        skipped: false as const,
        reason: "NO_SUBSCRIPTION" as const,
        message: "denied",
      })),
      releaseEnterpriseAgentRun: vi.fn(async () => {}),
    },
  });
  const deniedPort = createGovernedShadowModelPort({
    runId: "shadow-run-denied",
    sessionPorts: denied,
    config: {},
    env: {},
    complete: async () => ({ kind: "message", text: noChangeOutput(), usage: fixtureUsage() }),
  });
  const deniedResult = await deniedPort.complete({
    system: "s",
    messages: [],
    tools: [],
    maxTokens: 4_000,
    timeoutMs: 5_000,
  });
  expect(deniedResult).toEqual(
    expect.objectContaining({ kind: "protocol_failure", detail: "model_admission_denied" }),
  );

  const throwing = stubPorts({
    runWithModelFallback: vi.fn(async () => {
      throw new Error("upstream protocol broken");
    }),
  });
  const throwingPort = createGovernedShadowModelPort({
    runId: "shadow-run-throw",
    sessionPorts: throwing,
    config: {},
    env: {},
    complete: async () => ({ kind: "message", text: noChangeOutput(), usage: fixtureUsage() }),
  });
  const failed = await throwingPort.complete({
    system: "s",
    messages: [],
    tools: [],
    maxTokens: 4_000,
    timeoutMs: 5_000,
  });
  expect(failed.kind).toBe("protocol_failure");
  if (failed.kind === "protocol_failure") {
    expect(failed.detail).toBe("upstream protocol broken");
  }
});

it("maps an aborted signal to cancelled and does not start fixture completion", async () => {
  const ports = stubPorts();
  const complete = vi.fn(async () => ({
    kind: "message" as const,
    text: noChangeOutput(),
    usage: fixtureUsage(),
  }));
  const port = createGovernedShadowModelPort({
    runId: "shadow-run-abort",
    sessionPorts: ports,
    config: {},
    env: {},
    complete,
  });
  const result = await port.complete({
    system: "s",
    messages: [],
    tools: [],
    signal: AbortSignal.abort("stop"),
    maxTokens: 4_000,
    timeoutMs: 5_000,
  });
  expect(result.kind).toBe("cancelled");
  expect(complete).not.toHaveBeenCalled();
});

it("forwards remaining output and duration limits and records usage after cancel", async () => {
  const ports = stubPorts();
  const produced = fixtureUsage({ inputTokens: 6, outputTokens: 3, cost: 0.02 });
  const complete = vi.fn(
    async (input: { maxTokens: number; timeoutMs: number; signal?: AbortSignal }) => {
      expect(input.maxTokens).toBe(12);
      expect(input.timeoutMs).toBe(80);
      return { kind: "message" as const, text: noChangeOutput(), usage: produced };
    },
  );
  const port = createGovernedShadowModelPort({
    runId: "shadow-run-limits",
    sessionPorts: ports,
    config: {},
    env: {},
    complete,
  });
  const controller = new AbortController();
  complete.mockImplementationOnce(async (input) => {
    expect(input.maxTokens).toBe(12);
    controller.abort("owner_cancel");
    return { kind: "message" as const, text: noChangeOutput(), usage: produced };
  });
  const result = await port.complete({
    system: "s",
    messages: [],
    tools: [],
    signal: controller.signal,
    maxTokens: 12,
    timeoutMs: 80,
  });
  expect(complete).toHaveBeenCalled();
  // Cancel after a produced completion must keep that usage and still go through recordCreditUsage
  // when a reporting path exists; skipped admission is a no-op on the shared port.
  if (result.kind === "cancelled" || result.kind === "message") {
    expect(result.usage).toEqual(produced);
  }
});

it("keeps the original verdict and retained usage when session.dispose throws", async () => {
  const ports = stubPorts();
  const produced = fixtureUsage({ inputTokens: 7, outputTokens: 3, cost: 0.05 });
  const dispose = vi.fn(async () => {
    throw new Error("dispose boom");
  });
  const createSession = vi.fn((runId: string, sessionPorts: ModelSessionPorts) => {
    const session = createAuthorizedModelSession(runId, sessionPorts);
    session.dispose = dispose;
    return session;
  });
  const port = createGovernedShadowModelPort({
    runId: "shadow-run-dispose",
    sessionPorts: ports,
    createSession,
    config: {},
    env: {},
    complete: async () => ({
      kind: "message" as const,
      text: noChangeOutput(),
      usage: produced,
    }),
  });
  const result = await port.complete({
    system: "s",
    messages: [],
    tools: [],
    maxTokens: 4_000,
    timeoutMs: 5_000,
  });
  expect(dispose).toHaveBeenCalledOnce();
  expect(result.kind).toBe("message");
  expect(result.usage).toEqual(produced);
  expect((result as { sessionDisposeFailed?: boolean }).sessionDisposeFailed).toBe(true);
});

it("accounts late usage once after timeout and does not change the returned verdict", async () => {
  const ports = stubPorts();
  let release!: (completion: {
    kind: "message";
    text: string;
    usage: ReturnType<typeof fixtureUsage>;
  }) => void;
  const pending = new Promise<{
    kind: "message";
    text: string;
    usage: ReturnType<typeof fixtureUsage>;
  }>((resolve) => {
    release = resolve;
  });
  const recordUsage = vi.fn();
  const dispose = vi.fn();
  const createSession = vi.fn((runId: string, sessionPorts: ModelSessionPorts) => {
    const session = createAuthorizedModelSession(runId, sessionPorts);
    const originalRecord = session.recordUsage.bind(session);
    session.recordUsage = ((input: Parameters<typeof session.recordUsage>[0]) => {
      recordUsage(input);
      return originalRecord(input);
    }) as typeof session.recordUsage;
    const originalDispose = session.dispose.bind(session);
    session.dispose = () => {
      dispose();
      return originalDispose();
    };
    return session;
  });
  const lateUsage = fixtureUsage({ inputTokens: 12, outputTokens: 4, cost: 0.08 });
  const port = createGovernedShadowModelPort({
    runId: "shadow-run-late-usage",
    sessionPorts: ports,
    createSession,
    config: {},
    env: {},
    complete: () => pending,
  });
  const started = Date.now();
  const result = await port.complete({
    system: "s",
    messages: [],
    tools: [],
    maxTokens: 100,
    timeoutMs: 40,
  });
  const elapsed = Date.now() - started;
  expect(result.kind).toBe("cancelled");
  expect((result as { usageKnown?: boolean }).usageKnown).toBe(false);
  expect(recordUsage).not.toHaveBeenCalled();
  expect(dispose).not.toHaveBeenCalled();
  expect(elapsed).toBeLessThan(2_000);
  release({ kind: "message", text: noChangeOutput(), usage: lateUsage });
  await vi.waitFor(() => expect(recordUsage).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  expect(result.kind).toBe("cancelled");
  expect(recordUsage).toHaveBeenCalledTimes(1);
  expect(recordUsage.mock.calls[0]?.[0]?.usage).toEqual(lateUsage);
});

function reportingAdmission(enterpriseId = "ent-accounting"): ModelSessionPorts["admission"] {
  return {
    tryAcquireEnterpriseAgentRun: vi.fn(async () => ({
      acquired: true as const,
      skipped: false as const,
      enterpriseId,
      modelGate: {
        creditReporting: { enterpriseId, policyId: "policy-accounting" },
      },
    })),
    releaseEnterpriseAgentRun: vi.fn(async () => {}),
  } as unknown as ModelSessionPorts["admission"];
}

function idempotentCreditUsage() {
  const stages = new Map<string, "done">();
  const charges: Array<{ enterpriseId: string; taskId: string }> = [];
  const calls: Array<{ enterpriseId: string; taskId: string; deduped?: boolean; threw?: boolean }> =
    [];
  let failuresRemaining = 0;
  return {
    failNext(count: number) {
      failuresRemaining = count;
    },
    charges,
    calls,
    recordCreditUsage: async (input: { enterpriseId: string; taskId: string }) => {
      const key = `${input.enterpriseId}::${input.taskId}`;
      const call: (typeof calls)[number] = {
        enterpriseId: input.enterpriseId,
        taskId: input.taskId,
      };
      calls.push(call);
      if (stages.get(key) === "done") {
        call.deduped = true;
        return {
          recorded: false,
          deduped: true,
          creditsCharged: 1,
          tier: "unknown",
          providerCostCents: 0,
          tenantRevenueCents: 0,
          skippedConsumption: false,
          stage: "done" as const,
        };
      }
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        call.threw = true;
        throw new Error("ledger write failed");
      }
      stages.set(key, "done");
      charges.push({ enterpriseId: input.enterpriseId, taskId: input.taskId });
      return {
        recorded: true,
        deduped: false,
        creditsCharged: 1,
        tier: "unknown",
        providerCostCents: 0,
        tenantRevenueCents: 0,
        skippedConsumption: false,
        stage: "done" as const,
      };
    },
  };
}

it("retries a failed session.recordUsage post with the same runId and dedupes a second success", async () => {
  const ledger = idempotentCreditUsage();
  ledger.failNext(1);
  const ports = stubPorts({ admission: reportingAdmission() });
  ports.accounting.recordCreditUsage =
    ledger.recordCreditUsage as typeof ports.accounting.recordCreditUsage;
  const produced = fixtureUsage({ inputTokens: 9, outputTokens: 4, cost: 0.06 });
  const port = createGovernedShadowModelPort({
    runId: "shadow-run-accounting",
    sessionPorts: ports,
    config: {},
    env: {},
    complete: async () => ({
      kind: "message" as const,
      text: noChangeOutput(),
      usage: produced,
    }),
  });
  const result = await port.complete({
    system: "s",
    messages: [],
    tools: [],
    maxTokens: 4_000,
    timeoutMs: 5_000,
  });
  expect(result.kind).toBe("message");
  expect(result.usage).toEqual(produced);
  expect((result as { usageAccountingStatus?: string }).usageAccountingStatus).toBe("succeeded");
  expect((result as { usageAccountingAttempted?: boolean }).usageAccountingAttempted).toBe(true);
  expect(ledger.calls.length).toBeGreaterThanOrEqual(2);
  expect(ledger.calls.every((call) => call.taskId === "shadow-run-accounting")).toBe(true);
  expect(ledger.calls.every((call) => call.enterpriseId === "ent-accounting")).toBe(true);
  expect(ledger.charges).toEqual([
    { enterpriseId: "ent-accounting", taskId: "shadow-run-accounting" },
  ]);

  const second = await ports.accounting.recordCreditUsage({
    enterpriseId: "ent-accounting",
    taskId: "shadow-run-accounting",
    modelId: "shadow-fixture",
    policyId: "policy-accounting",
  });
  expect(second).toEqual(expect.objectContaining({ recorded: false, deduped: true }));
  expect(ledger.charges).toHaveLength(1);
});

it("leaves a failed post diagnosable and does not rewrite the verdict when no later success occurs", async () => {
  const ledger = idempotentCreditUsage();
  ledger.failNext(10);
  const ports = stubPorts({ admission: reportingAdmission() });
  ports.accounting.recordCreditUsage =
    ledger.recordCreditUsage as typeof ports.accounting.recordCreditUsage;
  const produced = fixtureUsage({ inputTokens: 2, outputTokens: 1, cost: 0.01 });
  const port = createGovernedShadowModelPort({
    runId: "shadow-run-accounting-failed",
    sessionPorts: ports,
    config: {},
    env: {},
    complete: async () => ({
      kind: "message" as const,
      text: noChangeOutput(),
      usage: produced,
    }),
  });
  const result = await port.complete({
    system: "s",
    messages: [],
    tools: [],
    maxTokens: 4_000,
    timeoutMs: 5_000,
  });
  expect(result.kind).toBe("message");
  expect(result.usage).toEqual(produced);
  expect((result as { usageAccountingStatus?: string }).usageAccountingStatus).toBe("failed");
  expect((result as { usageAccountingAttempted?: boolean }).usageAccountingAttempted).toBe(true);
  expect(ledger.charges).toHaveLength(0);
  expect(ledger.calls.every((call) => call.taskId === "shadow-run-accounting-failed")).toBe(true);
});

it("does not mutate the returned snapshot when a delayed session.dispose throws", async () => {
  const diagnostics: Array<{ kind: string; sessionDisposeFailed?: boolean }> = [];
  const ports = stubPorts();
  let release!: (completion: {
    kind: "message";
    text: string;
    usage: ReturnType<typeof fixtureUsage>;
  }) => void;
  const pending = new Promise<{
    kind: "message";
    text: string;
    usage: ReturnType<typeof fixtureUsage>;
  }>((resolve) => {
    release = resolve;
  });
  const dispose = vi.fn(async () => {
    throw new Error("late dispose boom");
  });
  const createSession = vi.fn((runId: string, sessionPorts: ModelSessionPorts) => {
    const session = createAuthorizedModelSession(runId, sessionPorts);
    session.dispose = dispose;
    return session;
  });
  const port = createGovernedShadowModelPort({
    runId: "shadow-run-late-dispose",
    sessionPorts: ports,
    createSession,
    diagnosticSink: {
      report: (event) => {
        diagnostics.push(event);
      },
    },
    config: {},
    env: {},
    complete: () => pending,
  });
  const result = await port.complete({
    system: "s",
    messages: [],
    tools: [],
    maxTokens: 100,
    timeoutMs: 40,
  });
  expect(result.kind).toBe("cancelled");
  expect((result as { sessionDisposeFailed?: boolean }).sessionDisposeFailed).toBe(false);
  expect(Object.isFrozen(result)).toBe(true);
  expect(dispose).not.toHaveBeenCalled();
  release({
    kind: "message",
    text: noChangeOutput(),
    usage: fixtureUsage({ inputTokens: 4, outputTokens: 1, cost: 0.02 }),
  });
  await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  await vi.waitFor(() =>
    expect(diagnostics.some((event) => event.kind === "session_dispose_failed")).toBe(true),
  );
  expect((result as { sessionDisposeFailed?: boolean }).sessionDisposeFailed).toBe(false);
  expect((result as { kind: string }).kind).toBe("cancelled");
  expect(() => {
    (result as unknown as { sessionDisposeFailed: boolean }).sessionDisposeFailed = true;
  }).toThrow();
});
