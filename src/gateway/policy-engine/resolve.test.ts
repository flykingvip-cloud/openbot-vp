// @vitest-environment node
import { describe, expect, it } from "vitest";
import { BUILTIN_ROUTING_POLICIES } from "./policies-store.js";
import { resolveRoutingPolicy } from "./resolve.js";

describe("resolveRoutingPolicy", () => {
  const policies = BUILTIN_ROUTING_POLICIES.map((p) => ({
    ...p,
    status: "active" as const,
    builtin: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));

  it("prefers explicit policyId", () => {
    const res = resolveRoutingPolicy({ policyId: "cost", policies });
    expect(res.policyId).toBe("cost");
    expect(res.selectorStrategy).toBe("cheapest");
    expect(res.source).toBe("policyId");
  });

  it("falls back to allowedPolicies[0]", () => {
    const res = resolveRoutingPolicy({ allowedPolicies: ["quality"], policies });
    expect(res.policyId).toBe("quality");
    expect(res.selectorStrategy).toBe("best_quality");
    expect(res.source).toBe("allowedPolicies");
  });

  it("falls back to legacy selectorStrategy", () => {
    const res = resolveRoutingPolicy({
      legacySelectorStrategy: "cheapest",
      policies,
    });
    expect(res.source).toBe("legacy");
    expect(res.selectorStrategy).toBe("cheapest");
  });
});
