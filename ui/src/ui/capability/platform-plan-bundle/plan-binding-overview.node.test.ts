import { describe, expect, it } from "vitest";
import { buildModelBindingOverviewFromBundle } from "./plan-binding-overview.ts";

describe("buildModelBindingOverviewFromBundle", () => {
  it("projects plans and reverse index from bundle state", () => {
    const overview = buildModelBindingOverviewFromBundle({
      catalog: ["ollama/llama3.2"],
      plans: [
        {
          id: "plan-a",
          name: "Growth",
          billingCycle: "monthly",
          basePriceCents: 0,
          currentVersionId: "pv-a",
          seatQuota: {},
          botQuota: 1,
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      versionMetaById: {
        "pv-a": {
          versionId: "pv-a",
          version: 1,
          status: "active",
          snapshot: {
            basePriceCents: 0,
            seatQuota: {},
            botQuota: 1,
            pricing: [],
          },
          binding: {
            planVersionId: "pv-a",
            allowedModelIds: ["ollama/llama3.2", "openai/gpt-4o"],
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          bindingState: "valid",
          activationReady: true,
          activationBlockers: [],
        },
      },
    });

    expect(overview.plans).toHaveLength(1);
    expect(overview.plans[0]?.allowedModelIds).toEqual(["ollama/llama3.2", "openai/gpt-4o"]);
    expect(overview.reverseIndex["ollama/llama3.2"]).toEqual(["plan-a"]);
    expect(overview.catalog).toContain("ollama/llama3.2");
    expect(overview.catalog).toContain("openai/gpt-4o");
  });
});
