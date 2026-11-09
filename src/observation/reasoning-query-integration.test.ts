import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { expect, it, vi } from "vitest";
import { bindAdmittedTurnHost } from "../agent-runtime/wiring/admitted-turn-host.js";
import { makeZeroUsageSnapshot } from "../agents/usage.js";
import type {
  GatewayClient,
  GatewayRequestHandlerOptions,
} from "../gateway/server-methods/types.js";
import { createObservationQueryHandlers, OBSERVATION_QUERY_METHOD } from "./query-gateway.js";
import {
  createObservationReasoningOptions,
  createReasoningModelResolver,
} from "./reasoning-model-resolver.js";
vi.mock("./query.js", () => ({
  queryObservationWithJournal: async () => ({
    ok: true,
    samples: [
      {
        sampleId: "sample",
        evidence: {
          resource: "unknown",
          technical: "present",
          execution: "partial",
          business: "unknown",
        },
        evidenceReasons: { resource: [], technical: [], execution: [], business: [] },
      },
    ],
  }),
}));
const model: Model<Api> = {
  id: "actual",
  name: "actual",
  provider: "transport",
  api: "openai-completions",
  baseUrl: "https://invalid.example",
  reasoning: false,
  input: ["text"],
  contextWindow: 4096,
  maxTokens: 256,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
it("same server composition reaches real governed session through existing query and remains default closed", async () => {
  const host = bindAdmittedTurnHost();
  host.admission.tryAcquireEnterpriseAgentRun = vi.fn(async () => ({
    acquired: true as const,
    skipped: false as const,
    enterpriseId: "tenant",
    modelGate: {
      tenantId: "tenant",
      allowlist: ["test/model"],
      effectiveRouting: { mode: "native" as const, selectorStrategy: "balanced" as const },
      creditReporting: { enterpriseId: "tenant", policyId: "policy" },
    },
  }));
  host.admission.releaseEnterpriseAgentRun = vi.fn(async () => {});
  host.model.buildRunModelSetSnapshot = vi.fn(() => undefined);
  host.model.rememberRunModelSet = vi.fn();
  host.model.forgetRunModelSet = vi.fn();
  host.model.runWithModelFallback = vi.fn(async (p) => ({
    result: await p.run("test", "model"),
    provider: "test",
    model: "model",
    attempts: [],
  }));
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
  const candidate = vi.fn(async () => ({ model }));
  const complete = vi.fn(async () => ({
    response: {
      role: "assistant" as const,
      api: "openai-completions" as const,
      provider: "transport",
      model: "actual",
      usage: makeZeroUsageSnapshot(),
      content: [{ type: "text" as const, text: "{}" }],
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
          evidenceIds: ["sample:execution"],
          source: "reasoning",
          modelRef: "transport/actual",
        },
      ],
    }),
  }));
  const resolver = vi.fn((ctx: Parameters<typeof createReasoningModelResolver>[0]) =>
    createReasoningModelResolver(ctx, { host, candidate, complete }),
  );
  const client: GatewayClient = {
    user: "alice@example.invalid",
    platformUserId: "alice",
    sessionDomain: "enterprise",
    connect: {
      minProtocol: 3,
      maxProtocol: 3,
      client: { id: "test", version: "test", platform: "test", mode: "backend" },
      scopes: ["operator.read"],
    },
  };
  const run = async (enabled = false) => {
    const handler = createObservationQueryHandlers({
      ...createObservationReasoningOptions(enabled, resolver),
      loadConfig: () => ({ agents: { defaults: { model: { primary: "test/model" } } } }),
      authDeps: { resolveMembership: async () => ({ tenantId: "tenant", userId: "alice" }) },
      now: () => 3,
    })[OBSERVATION_QUERY_METHOD];
    const respond = vi.fn();
    await handler({
      client,
      params: {
        agentId: "bot",
        taskId: "task",
        outcomeVersion: 1,
        from: 1,
        to: 2,
        reasoning: { requested: true },
      },
      respond,
    } as unknown as GatewayRequestHandlerOptions);
    return respond;
  };
  expect((await run()).mock.calls[0]?.[1].reasoningPass.reason).toBe("reasoning_disabled");
  expect(resolver).not.toHaveBeenCalled();
  const response = await run(true);
  expect(response.mock.calls[0]?.[1].reasoningPass).toMatchObject({
    reason: "hypotheses_only",
    items: [{ modelRef: "transport/actual" }],
  });
  expect(complete).toHaveBeenCalledOnce();
  expect(host.accounting.recordCreditUsage).toHaveBeenCalledOnce();
  expect(host.admission.releaseEnterpriseAgentRun).toHaveBeenCalledOnce();
  expect(host.task.ensureChatTurnTaskOutcome).not.toHaveBeenCalled();
});
