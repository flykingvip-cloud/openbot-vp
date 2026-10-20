// @vitest-environment jsdom
import { render } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import type { GrowthReportView, GrowthStatusView } from "../../../controllers/agent-growth.ts";
import {
  renderEvolutionGrowthPrelude,
  shouldShowEvolutionReport,
} from "./workbench-stage-growth-evolution.ts";

function evolutionView(report: GrowthReportView): GrowthStatusView {
  return {
    lifecycleState: "evolution",
    dimensions: { identity: 90, capability: 85, knowledge: 70, habits: 60 },
    activationScore: 88,
    operationalScore: 0.82,
    capabilityReadiness: true,
    isActivated: true,
    templateId: "generic_worker",
    growthReport: report,
  };
}

const SAMPLE_REPORT: GrowthReportView = {
  periodDays: 30,
  generatedAtMs: 1,
  tasksCompleted: 42,
  hoursSavedEstimate: 14,
  learningMaterialsCount: 3,
  toolInvocations: 842,
  collaborationMemberCount: null,
  taskSuccessRate: 0.86,
  toolSuccessRate: 0.91,
  humanTakeoverRate: 0.08,
  businessImpact: [
    { key: "manual_review_avoided", value: 37, description: "减少人工审核" },
    { key: "customer_auto_replies", value: 286, unit: "次", description: "自动回复客户" },
  ],
  topInsights: [],
  suggestedWorkflows: [],
};

beforeEach(async () => {
  await i18n.setLocale("zh-CN");
});

describe("shouldShowEvolutionReport", () => {
  it("shows when lifecycle is evolution and report exists", () => {
    expect(shouldShowEvolutionReport(evolutionView(SAMPLE_REPORT))).toBe(true);
  });

  it("hides without report or wrong lifecycle", () => {
    expect(shouldShowEvolutionReport(null)).toBe(false);
    expect(
      shouldShowEvolutionReport({
        ...evolutionView(SAMPLE_REPORT),
        lifecycleState: "growing",
      }),
    ).toBe(false);
    expect(
      shouldShowEvolutionReport({
        ...evolutionView(SAMPLE_REPORT),
        growthReport: null,
      }),
    ).toBe(false);
  });
});

describe("renderEvolutionGrowthPrelude", () => {
  it("wires growth report summary with business impact before stats", () => {
    const host = document.createElement("div");
    render(
      renderEvolutionGrowthPrelude({
        view: evolutionView(SAMPLE_REPORT),
        roleName: "审核助手",
      }),
      host,
    );
    expect(host.querySelector('[data-growth-report="summary"]')).not.toBeNull();
    const impact = host.querySelector(".workbench-growth-report__impact-block");
    const stats = host.querySelector(".workbench-growth-report__stats");
    expect(impact).not.toBeNull();
    expect(stats).not.toBeNull();
    expect(impact!.compareDocumentPosition(stats!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelectorAll(".workbench-growth-report__impact-item").length).toBe(2);
    expect(host.textContent).toContain("842");
    expect(host.textContent).toContain("减少人工审核");
  });
});
