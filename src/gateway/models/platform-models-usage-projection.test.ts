import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../infra/session-cost-usage.js", () => ({
  discoverAllSessions: vi.fn(async () => [
    {
      sessionId: "sess-1",
      sessionFile: "/tmp/sess-1.jsonl",
      mtime: Date.now(),
    },
  ]),
  loadSessionCostSummary: vi.fn(async () => ({
    messageCounts: { total: 10, assistant: 5, errors: 1 },
    modelUsage: [
      {
        provider: "anthropic",
        model: "claude-sonnet",
        count: 5,
        totals: {
          input: 100,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 150,
          totalCost: 1.25,
          inputCost: 0,
          outputCost: 0,
          cacheReadCost: 0,
          cacheWriteCost: 0,
          missingCostEntries: 0,
        },
      },
    ],
    latency: { count: 5, sum: 4000, min: 500, max: 1200, p95Max: 1200 },
  })),
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: vi.fn(() => ({ agents: [{ id: "main" }] })),
}));

vi.mock("../billing/usage-records-store.js", () => ({
  listUsageRecords: vi.fn(async () => []),
}));

import { buildPlatformModelsUsageProjection } from "./platform-models-usage-projection.js";

describe("buildPlatformModelsUsageProjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates session model usage into snapshot usage blocks", async () => {
    const result = await buildPlatformModelsUsageProjection({
      cfg: {},
      plans: [
        {
          planId: "coding_plan",
          taskProfileId: "coding",
          name: "Coding",
          description: null,
          audience: "platform",
          primaryModelIds: ["anthropic/claude-sonnet"],
          fallbackModelIds: [],
          costTarget: "medium",
          qualityTarget: "high",
          latencyTarget: "interactive",
          status: "published",
          userSelectable: false,
          tenantOverrideAllowed: false,
          updatedAt: null,
        },
      ],
      routingPolicies: [
        {
          policyId: "coding_policy",
          name: "Coding Policy",
          taskProfileId: "coding",
          planId: "coding_plan",
          primaryModelIds: ["anthropic/claude-sonnet"],
          fallbackModelIds: [],
          status: "active",
          rankingMode: "balanced",
          maxCostPerRequest: null,
          maxLatencyMs: null,
          requiredCapabilities: [],
          requiredHealth: null,
          scope: { tenantIds: [], userSegments: [], agentIds: [] },
          updatedAt: null,
        },
      ],
    });

    expect(result.usageByModel).toHaveLength(1);
    expect(result.usageByModel[0]?.modelRef).toBe("anthropic/claude-sonnet");
    expect(result.usageByModel[0]?.calls7d).toBe(5);
    expect(result.usageByPlan[0]?.calls7d).toBe(5);
    expect(result.usageByTask[0]?.taskProfileId).toBe("coding");
    expect(result.usageByPolicy[0]?.policyId).toBe("coding_policy");
    expect(result.usageByPolicy[0]?.calls7d).toBe(5);
  });
});
