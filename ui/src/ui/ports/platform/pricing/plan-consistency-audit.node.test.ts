import { describe, expect, it } from "vitest";
import { auditPlanBindingConsistency, mapRpcConsistencyIssues } from "./plan-consistency-audit.ts";

const PLAN = {
  id: "plan-1",
  name: "Growth",
  billingCycle: "monthly" as const,
  basePriceCents: 0,
  currentVersionId: "pv-active",
  seatQuota: {},
  botQuota: 1,
  status: "active" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("auditPlanBindingConsistency", () => {
  it("flags missing binding", () => {
    const issues = auditPlanBindingConsistency({
      catalog: ["ollama/llama3.2"],
      plans: [PLAN],
      versionMetaById: {
        "pv-active": {
          versionId: "pv-active",
          version: 1,
          status: "active",
          snapshot: { basePriceCents: 0, seatQuota: {}, botQuota: 1, pricing: [] },
          bindingState: "missing",
          activationReady: false,
          activationBlockers: ["missing_binding"],
        },
      },
    });
    expect(issues.some((issue) => issue.code === "plan_binding_missing")).toBe(true);
  });

  it("flags invalid catalog models", () => {
    const issues = auditPlanBindingConsistency({
      catalog: ["ollama/llama3.2"],
      plans: [PLAN],
      versionMetaById: {
        "pv-active": {
          versionId: "pv-active",
          version: 1,
          status: "active",
          snapshot: { basePriceCents: 0, seatQuota: {}, botQuota: 1, pricing: [] },
          binding: {
            planVersionId: "pv-active",
            allowedModelIds: ["ollama/llama3.2", "stale/model"],
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          bindingState: "invalid_catalog",
          activationReady: false,
          activationBlockers: ["invalid_catalog"],
        },
      },
    });
    const issue = issues.find((entry) => entry.code === "plan_binding_invalid_catalog");
    expect(issue?.invalidModelIds).toEqual(["stale/model"]);
  });

  it("maps RPC doctor issues to display rows", () => {
    const mapped = mapRpcConsistencyIssues(
      [
        {
          code: "plan_binding_orphan",
          planVersionId: "pv-orphan",
          message: "orphan binding",
        },
      ],
      [],
    );
    expect(mapped[0]?.code).toBe("plan_binding_orphan");
    expect(mapped[0]?.serverMessage).toBe("orphan binding");
  });
});
