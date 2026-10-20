// @vitest-environment jsdom
import { render } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import {
  normalizeGrowthReport,
  renderGrowthReportSummary,
  type GrowthReportView,
} from "./workbench-growth-report.ts";

function mount(tpl: ReturnType<typeof renderGrowthReportSummary>): HTMLElement {
  const host = document.createElement("div");
  render(tpl, host);
  return host;
}

beforeEach(async () => {
  await i18n.setLocale("zh-CN");
});

const SAMPLE = {
  periodDays: 30,
  generatedAtMs: 1000,
  tasksCompleted: 12,
  hoursSavedEstimate: 4,
  learningMaterialsCount: 3,
  toolInvocations: 842,
  taskSuccessRate: 0.8,
  toolSuccessRate: null,
  humanTakeoverRate: null,
  businessImpact: [
    { key: "manual_review_avoided", value: 37, description: "减少人工审核" },
    { key: "customer_auto_replies", value: 286, description: "自动回复客户" },
  ],
  topInsights: ["合同复审耗时下降"],
};

describe("normalizeGrowthReport", () => {
  it("returns null for non-objects", () => {
    expect(normalizeGrowthReport(null)).toBeNull();
    expect(normalizeGrowthReport(42)).toBeNull();
  });

  it("normalizes snapshot fields and businessImpact", () => {
    const view = normalizeGrowthReport(SAMPLE);
    expect(view?.periodDays).toBe(30);
    expect(view?.toolInvocations).toBe(842);
    expect(view?.businessImpact).toHaveLength(2);
    expect(view?.businessImpact[0]).toEqual({
      key: "manual_review_avoided",
      value: 37,
      description: "减少人工审核",
    });
    expect(view?.toolSuccessRate).toBeNull();
  });

  it("drops malformed impact entries", () => {
    const view = normalizeGrowthReport({
      ...SAMPLE,
      businessImpact: [{ value: 1 }, { key: "ok", value: 2, description: "d" }],
    });
    expect(view?.businessImpact).toEqual([{ key: "ok", value: 2, description: "d" }]);
  });
});

describe("renderGrowthReportSummary", () => {
  it("renders nothing when no report", () => {
    const host = mount(renderGrowthReportSummary(null));
    expect(host.querySelector(".workbench-growth-report")).toBeNull();
  });

  it("renders businessImpact prominently + activity stats", () => {
    const view = normalizeGrowthReport(SAMPLE) as GrowthReportView;
    const host = mount(renderGrowthReportSummary(view));
    expect(host.querySelector('[data-growth-report="summary"]')).toBeTruthy();
    // businessImpact present with values + descriptions
    expect(host.querySelector('[data-impact-key="manual_review_avoided"]')?.textContent).toContain(
      "减少人工审核",
    );
    expect(host.textContent).toContain("37");
    // activity stats
    expect(host.textContent).toContain("842");
    expect(host.textContent).toContain("任务成功率");
    expect(host.textContent).toContain("80%");
    // insights
    expect(host.textContent).toContain("合同复审耗时下降");
  });

  it("renders when businessImpact is missing", () => {
    const view = normalizeGrowthReport(SAMPLE) as GrowthReportView;
    const host = mount(
      renderGrowthReportSummary({
        ...view,
        businessImpact: undefined as unknown as GrowthReportView["businessImpact"],
      }),
    );
    expect(host.querySelector('[data-growth-report="summary"]')).toBeTruthy();
    expect(host.querySelector(".workbench-growth-report__impact-block")).toBeNull();
    expect(host.textContent).toContain("842");
  });

  it("omits absent optional rates", () => {
    const view = normalizeGrowthReport({ ...SAMPLE, taskSuccessRate: null }) as GrowthReportView;
    const host = mount(renderGrowthReportSummary(view));
    expect(host.textContent).not.toContain("任务成功率");
  });
});
