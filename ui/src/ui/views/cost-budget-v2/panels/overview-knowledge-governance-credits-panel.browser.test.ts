// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DashboardResponse } from "../../../capability/cost-budget-billing/index.ts";
import { renderKnowledgeGovernanceCreditsPanel } from "./overview-knowledge-governance-credits-panel.ts";

function dashboard(partial: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    subscribed: true,
    accruedCents: 0,
    seatCostCents: 0,
    usageCostCents: 0,
    extraCostCents: 0,
    predictedCents: null,
    budgetStatus: {
      level: "ok",
      monthlyLimitCents: 0,
      accruedCents: 0,
      predictedCents: null,
      alertThreshold: 0.8,
    },
    snapshotType: "estimated",
    computedAt: "2026-06-25T00:00:00.000Z",
    stale: false,
    ...partial,
  };
}

beforeEach(async () => {
  const { i18n } = await import("../../../../i18n/index.ts");
  const { zh_CN } = await import("../../../../i18n/locales/zh-CN.ts");
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("overview knowledge governance credits panel", () => {
  it("renders nothing when governance credits summary is empty", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeGovernanceCreditsPanel(
        dashboard({
          knowledgeGovernanceCredits: {
            cycleStart: "2026-06-01T00:00:00.000Z",
            cycleEnd: "2026-07-01T00:00:00.000Z",
            llmCallCount: 0,
            creditsCharged: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            providerCostCents: 0,
            tenantRevenueCents: 0,
          },
        }),
      ),
      container,
    );
    expect(
      container.querySelector('[data-testid="cost-budget-governance-llm-credits"]'),
    ).toBeNull();
  });

  it("renders governance credits KPIs and cycle share hint", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeGovernanceCreditsPanel(
        dashboard({
          creditsStatus: {
            monthlyCredits: 100,
            creditsConsumed: 20,
            creditsRemaining: 80,
            cycleStart: "2026-06-01T00:00:00.000Z",
          },
          knowledgeGovernanceCredits: {
            cycleStart: "2026-06-01T00:00:00.000Z",
            cycleEnd: "2026-07-01T00:00:00.000Z",
            llmCallCount: 4,
            creditsCharged: 5,
            inputTokens: 800,
            outputTokens: 120,
            totalTokens: 920,
            providerCostCents: 40,
            tenantRevenueCents: 30,
          },
        }),
      ),
      container,
    );
    const panel = container.querySelector('[data-testid="cost-budget-governance-llm-credits"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("知识治理 LLM 消耗");
    expect(panel?.textContent).toContain("4");
    expect(panel?.textContent).toContain("5");
    expect(panel?.textContent).toContain("920");
    expect(panel?.textContent).toContain("25%");
  });
});
