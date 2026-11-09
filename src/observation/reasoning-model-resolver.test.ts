import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { expect, it, vi } from "vitest";
import type { invokeMetadataCompletion } from "../agent-runtime/model/index.js";
import { bindAdmittedTurnHost } from "../agent-runtime/wiring/admitted-turn-host.js";
import { FailoverError } from "../agents/failover-error.js";
import { makeZeroUsageSnapshot } from "../agents/usage.js";
import { createReasoningGatewayAdapter } from "./reasoning-gateway.js";
import { createReasoningModelResolver } from "./reasoning-model-resolver.js";
const fixture: Model<Api> = {
  id: "actual",
  name: "Actual",
  provider: "transport",
  api: "openai-completions",
  baseUrl: "https://invalid.example",
  reasoning: false,
  input: ["text"],
  contextWindow: 4096,
  maxTokens: 256,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const evidence = {
  evidence: [
    {
      evidenceId: "e",
      layer: "execution" as const,
      status: "partial" as const,
      reasonCodes: ["missing"],
    },
  ],
  findings: [],
};
function makeCompletionFixture() {
  return {
    response: {
      role: "assistant" as const,
      api: "openai-completions" as const,
      provider: "transport",
      model: "actual",
      content: [{ type: "text" as const, text: "{}" }],
      usage: { ...makeZeroUsageSnapshot(), input: 7, output: 3 },
      stopReason: "stop" as const,
      timestamp: 0,
    },
    readValue: () => ({
      schemaVersion: 1,
      items: [
        {
          id: "h",
          kind: "hypothesis",
          text: "possible",
          evidenceIds: ["e"],
          source: "reasoning",
          modelRef: "transport/actual",
        },
      ],
    }),
  };
}
function setup(realFallback = false, agentDir?: string) {
  const host = bindAdmittedTurnHost();
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
    acquired: true as const,
    skipped: false as const,
    enterpriseId: "tenant",
    modelGate: {
      tenantId: "tenant",
      allowlist: ["test/model", "test/other"],
      effectiveRouting: { mode: "native" as const, selectorStrategy: "balanced" as const },
      creditReporting: { enterpriseId: "tenant", policyId: "policy" },
    },
  }));
  host.admission.releaseEnterpriseAgentRun = vi.fn(async () => {});
  host.model.forgetRunModelSet = vi.fn();
  host.model.buildRunModelSetSnapshot = vi.fn(() => undefined);
  host.model.rememberRunModelSet = vi.fn();
  if (!realFallback) {
    host.model.runWithModelFallback = vi.fn(async (p) => ({
      result: await p.run("test", "model"),
      provider: "test",
      model: "model",
      attempts: [],
    }));
  }
  host.accounting.recordCreditUsage = vi.fn(async () => ({
    recorded: true,
    deduped: false,
    creditsCharged: 0,
    tier: "test",
    providerCostCents: 0,
    tenantRevenueCents: 0,
    skippedConsumption: false,
  }));
  host.task.ensureChatTurnTaskOutcome = vi.fn();
  const authorized = vi.fn(async () => true);
  const candidate = vi.fn(async () => ({ model: fixture }));
  const complete = vi.fn(async (_params: Parameters<typeof invokeMetadataCompletion>[0]) =>
    makeCompletionFixture(),
  );
  const resolver = createReasoningModelResolver(
    {
      cfg: {
        agents: {
          defaults: { model: { primary: "test/model", fallbacks: ["test/other"] } },
          ...(agentDir ? { list: [{ id: "bot", agentDir }] } : {}),
        },
      },
      agentId: "bot",
      tenantId: "tenant",
      subjectRef: "user:test",
      client: {
        connect: {
          minProtocol: 3,
          maxProtocol: 3,
          client: { id: "test", version: "test", platform: "test", mode: "backend" },
        },
        user: "test@example.invalid",
        platformUserId: "test",
        sessionDomain: "employee",
      },
      authorize: authorized,
    },
    { host, candidate, complete },
  );
  const call = (enabled = true) =>
    createReasoningGatewayAdapter({
      enabled,
      ...resolver,
      authorize: async () => ({ identityRef: "test", scopeRef: "tenant", grantVersion: "1" }),
      readEvidence: async () => evidence,
    })({ requested: true });
  return { host, authorized, candidate, complete, call, resolver };
}
it("default closed performs no admission or transport", async () => {
  const p = setup();
  expect(await p.call(false)).toMatchObject({ reasoningPass: { reason: "reasoning_disabled" } });
  expect(p.host.admission.tryAcquireEnterpriseAgentRun).not.toHaveBeenCalled();
  expect(p.complete).not.toHaveBeenCalled();
});
it("accounts actual usage before JSON, preserves actual transport identity and releases without task writes", async () => {
  const p = setup();
  expect(await p.call()).toMatchObject({
    reasoningPass: { reason: "hypotheses_only", items: [{ modelRef: "transport/actual" }] },
  });
  expect(p.host.accounting.recordCreditUsage).toHaveBeenCalledOnce();
  expect(p.host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
  expect(p.host.task.ensureChatTurnTaskOutcome).not.toHaveBeenCalled();
});
it("quota denial never reaches a credential or completion", async () => {
  const p = setup();
  vi.mocked(p.host.admission.tryAcquireEnterpriseAgentRun).mockResolvedValue({
    acquired: false,
    skipped: false,
    reason: "NO_SUBSCRIPTION",
    message: "denied",
  });
  expect(await p.call()).toMatchObject({ reasoningPass: { reason: "reasoning_model_error" } });
  expect(p.candidate).not.toHaveBeenCalled();
  expect(p.complete).not.toHaveBeenCalled();
});
it("revocation after response still accounts usage and releases but returns no hypothesis", async () => {
  const p = setup();
  p.complete.mockImplementationOnce(async () => {
    const out = makeCompletionFixture();
    p.authorized.mockResolvedValue(false);
    return out;
  });
  expect(await p.call()).toMatchObject({
    reasoningPass: { reason: "reasoning_model_error", items: [] },
  });
  expect(p.host.accounting.recordCreditUsage).toHaveBeenCalledOnce();
  expect(p.host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
});
it("schema failure preserves accounting and resource disposal", async () => {
  const p = setup();
  const out = makeCompletionFixture();
  p.complete.mockResolvedValue({
    ...out,
    readValue: () => {
      throw new Error("bad json");
    },
  });
  expect(await p.call()).toMatchObject({ reasoningPass: { reason: "reasoning_model_error" } });
  expect(p.host.accounting.recordCreditUsage).toHaveBeenCalledOnce();
  expect(p.host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
});

it("abort-aware timeout releases before returning rule fallback", async () => {
  const p = setup();
  p.complete.mockImplementationOnce(async (params) => {
    await new Promise<void>((_resolve, reject) =>
      params.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
    );
    return p.complete(params);
  });
  const result = await createReasoningGatewayAdapter({
    enabled: true,
    ...p.resolver,
    timeoutMs: 20,
    authorize: async () => ({ identityRef: "test", scopeRef: "tenant", grantVersion: "1" }),
    readEvidence: async () => evidence,
  })({ requested: true });
  expect(result).toMatchObject({ reasoningPass: { items: [] } });
  expect(p.host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
  expect(p.host.accounting.recordCreditUsage).not.toHaveBeenCalled();
});
it("uses original fallback for a failed first candidate and actual second transport identity", async () => {
  const p = setup(true);
  p.candidate.mockRejectedValueOnce(
    new FailoverError("rate limited", {
      reason: "rate_limit",
      provider: "test",
      model: "model",
      status: 429,
    }),
  );
  expect(await p.call()).toMatchObject({
    reasoningPass: { reason: "hypotheses_only", items: [{ modelRef: "transport/actual" }] },
  });
  expect(p.candidate).toHaveBeenCalledTimes(2);
  expect(p.complete).toHaveBeenCalledOnce();
  expect(p.host.accounting.recordCreditUsage).toHaveBeenCalledOnce();
  expect(p.host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
});

it("real fallback does not migrate legacy auth or create task/session files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reasoning-readonly-"));
  const legacy = JSON.stringify({ test: { type: "api_key", key: "fake-test-key" } });
  fs.writeFileSync(path.join(dir, "auth.json"), legacy);
  try {
    const p = setup(true, dir);
    expect(await p.call()).toMatchObject({ reasoningPass: { reason: "hypotheses_only" } });
    expect(fs.readdirSync(dir)).toEqual(["auth.json"]);
    expect(fs.readFileSync(path.join(dir, "auth.json"), "utf8")).toBe(legacy);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function boundedCall(p: ReturnType<typeof setup>) {
  return Promise.race([
    createReasoningGatewayAdapter({
      enabled: true,
      ...p.resolver,
      timeoutMs: 20,
      authorize: async () => ({ identityRef: "test", scopeRef: "tenant", grantVersion: "1" }),
      readEvidence: async () => evidence,
    })({ requested: true }),
    new Promise<"deadline_not_enforced">((resolve) =>
      setTimeout(() => resolve("deadline_not_enforced"), 150),
    ),
  ]);
}
it("deadline bounds an unresponsive membership authorization", async () => {
  const p = setup();
  p.authorized.mockImplementationOnce(() => new Promise<boolean>(() => {}));
  expect(await boundedCall(p)).toMatchObject({ reasoningPass: { items: [] } });
  expect(p.host.admission.tryAcquireEnterpriseAgentRun).not.toHaveBeenCalled();
});
it("deadline bounds usage waiting and releases the acquired lease", async () => {
  const p = setup();
  p.host.accounting.recordCreditUsage = vi.fn(() => new Promise<never>(() => {}));
  expect(await boundedCall(p)).toMatchObject({ reasoningPass: { items: [] } });
  expect(p.complete).toHaveBeenCalledOnce();
  expect(p.host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
});
it("deadline bounds commercial authorization and releases a late acquired lease", async () => {
  const p = setup();
  const admission = vi.mocked(p.host.admission.tryAcquireEnterpriseAgentRun);
  const original = admission.getMockImplementation();
  if (!original) {
    throw new Error("missing admission fixture");
  }
  let grant:
    | ((value: Awaited<ReturnType<typeof p.host.admission.tryAcquireEnterpriseAgentRun>>) => void)
    | undefined;
  admission.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  expect(await boundedCall(p)).toMatchObject({ reasoningPass: { items: [] } });
  expect(p.complete).not.toHaveBeenCalled();
  const acquired = await original({ runId: "late" });
  if (!grant) {
    throw new Error("missing pending grant");
  }
  grant(acquired);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(p.host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
});

it("late transport usage is retained as pending reconciliation without a second charge", async () => {
  const p = setup();
  p.complete.mockImplementationOnce(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return makeCompletionFixture();
  });
  expect(await boundedCall(p)).toMatchObject({ reasoningPass: { items: [] } });
  await new Promise((resolve) => setTimeout(resolve, 70));
  expect(p.resolver.model.diagnostics?.()).toMatchObject({
    usageStatus: "late_usage_pending_reconciliation",
    observedUsage: { input: 7, output: 3 },
  });
  expect(p.host.accounting.recordCreditUsage).not.toHaveBeenCalled();
});
it.each(["reject", "pending"])("cleanup %s is explicit to the caller", async (kind) => {
  const p = setup();
  p.host.admission.releaseEnterpriseAgentRun = vi.fn(async () => {
    if (kind === "reject") {
      throw new Error("release rejected");
    }
    await new Promise<never>(() => {});
  });
  expect(await boundedCall(p)).toMatchObject({
    reasoningPass: {
      reason: "cleanup_unconfirmed",
      governance: { cleanupStatus: "cleanup_unconfirmed" },
    },
  });
});
it("cancellation before the start microtask does not invoke authorization", async () => {
  const p = setup();
  const controller = new AbortController();
  const result = p.resolver.model(evidence, {
    signal: controller.signal,
    modelRef: p.resolver.modelRef,
  });
  controller.abort();
  await expect(result).rejects.toThrow();
  expect(p.authorized).not.toHaveBeenCalled();
});
