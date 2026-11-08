import { expect, it, vi } from "vitest";
import type { FollowupRun } from "../../../auto-reply/reply/queue.js";
import { classifyTipBudgetCostFromUsage } from "../../../task-outcome/runtime-from-runner.js";
import { runQueuedCandidate, type QueuedCandidateChargeIdentity } from "./queued-candidate.js";

vi.mock("./embedded-run.js", () => ({
  runEmbeddedPiAgent: vi.fn(async () => ({
    payloads: [{ text: "queued" }],
    meta: { agentMeta: { usage: { input: 1_000, output: 0, cacheRead: 0, cacheWrite: 0 } } },
  })),
}));

vi.mock("../../../gateway/enterprise-model/embedded-transport.js", () => ({
  resolveEnterpriseEmbeddedTransport: vi.fn(async (params: { provider: string; model: string }) => {
    if (params.provider === "ent/acme" && params.model === "catalog-big") {
      return { provider: "upstream", model: "cheap" };
    }
    return { provider: params.provider, model: params.model };
  }),
}));

it("prices a followup candidate from the transport model, not the ent catalog id", async () => {
  const recorded: QueuedCandidateChargeIdentity[] = [];
  const catalogCost = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
  const transportCost = { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 };
  const config = {
    models: {
      providers: {
        "ent/acme": {
          baseUrl: "http://catalog.invalid",
          models: [{ id: "catalog-big", cost: catalogCost }],
        },
        upstream: {
          baseUrl: "http://upstream.invalid",
          models: [{ id: "cheap", cost: transportCost }],
        },
      },
    },
  } as unknown as FollowupRun["run"]["config"];
  const queued = {
    prompt: "price the transport",
    enqueuedAt: 1,
    run: {
      sessionId: "session",
      sessionFile: "/tmp/queued-session.jsonl",
      workspaceDir: "/tmp",
      agentDir: "/tmp",
      config,
      timeoutMs: 1000,
      agentId: "bot",
    },
  } as unknown as FollowupRun;
  const usage = { input: 1_000, output: 0, cacheRead: 0, cacheWrite: 0 };
  await runQueuedCandidate(
    {
      queued,
      provider: "ent/acme",
      model: "catalog-big",
      runId: "run-price",
      bootstrapWarnings: [],
    },
    {
      assertBudget: () => undefined,
      onCompaction: () => undefined,
      recordWarnings: () => undefined,
      recordUsage: (identity) => {
        recorded.push(identity);
      },
    },
  );
  expect(recorded).toHaveLength(1);
  const identity = recorded[0];
  expect(identity?.pricingSource).toBe("transport");
  expect(identity).toMatchObject({
    catalogProvider: "ent/acme",
    catalogModel: "catalog-big",
    transportProvider: "upstream",
    transportModel: "cheap",
  });
  const catalog = classifyTipBudgetCostFromUsage({
    usage,
    provider: identity?.catalogProvider,
    model: identity?.catalogModel,
    config,
  });
  const transport = classifyTipBudgetCostFromUsage({
    usage,
    provider: identity?.transportProvider,
    model: identity?.transportModel,
    config,
  });
  expect(catalog.evidence).toBe("known");
  expect(transport.evidence).toBe("known");
  expect(transport.costUsd).not.toBe(catalog.costUsd);
  expect(transport.costUsd).toBeLessThan(catalog.costUsd ?? 0);
});
