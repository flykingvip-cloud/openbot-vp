// @vitest-environment jsdom

import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderPlanPreviewOverview } from "./plan-config-workspace.ts";

describe("renderPlanPreviewOverview", () => {
  it("shows expanded entitlement summary fields in preview overview", () => {
    const container = document.createElement("div");
    render(
      renderPlanPreviewOverview({
        plan: {
          id: "plan-pro",
          name: "专业版",
          billingCycle: "monthly",
          basePriceCents: 99_900,
          currentVersionId: "pv-pro",
          seatQuota: {},
          botQuota: 120,
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        activeVersionNumber: 3,
        monthlyCredits: 30_000,
        maxConcurrentRuns: 20,
        maxWorkflows: 50,
        maxKnowledgeBases: 50,
        tierIds: ["tier_b"],
        features: {
          auditLog: true,
          mfa: true,
          sso: false,
          vpcIsolation: false,
        },
        allowPrivateModels: false,
        allowCustomPolicy: false,
        policyId: null,
        catalogTiers: [],
        catalogPolicies: [],
        activationBlockers: [],
        activeSubscriptions: 12,
        mrrCents: 1_198_800,
        fmtMoney: (cents) => `¥${cents / 100}`,
        onOpenModelsTab: () => {},
      }),
      container,
    );

    expect(container.textContent).toContain("工作流数量");
    expect(container.textContent).toContain("知识库数量");
    expect(container.textContent).toContain("治理能力");
    expect(container.textContent).toContain("MFA");
    expect(container.textContent).toContain("审计日志");
  });
});
