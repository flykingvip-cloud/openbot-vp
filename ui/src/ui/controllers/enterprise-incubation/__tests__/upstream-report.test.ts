import { describe, expect, it } from "vitest";
import { type ProposalStatus, getProposalStatusDisplay } from "../upstream-report.ts";

// --- upstream-report: getProposalStatusDisplay ---
// The incubation center's "上报记录" tracker sources its data from the canonical
// platform-submission store (enterprise-capability.platform-submissions); this
// helper only maps the display status onto a label + color.

describe("getProposalStatusDisplay", () => {
  const allStatuses: ProposalStatus[] = [
    "pending",
    "reviewing",
    "approved",
    "rejected",
    "supplement",
  ];

  it("each status maps to correct label and color", () => {
    const expected: Record<ProposalStatus, { label: string; color: string }> = {
      pending: { label: "待审批", color: "gray" },
      reviewing: { label: "审批中", color: "blue" },
      approved: { label: "已通过", color: "green" },
      rejected: { label: "已拒绝", color: "red" },
      supplement: { label: "需补充材料", color: "orange" },
    };

    for (const status of allStatuses) {
      const display = getProposalStatusDisplay(status);
      expect(display.status).toBe(status);
      expect(display.label).toBe(expected[status].label);
      expect(display.color).toBe(expected[status].color);
    }
  });

  it("all 5 statuses have unique colors (bijection)", () => {
    const colors = allStatuses.map((s) => getProposalStatusDisplay(s).color);
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(5);
  });

  it("each result includes both color and label", () => {
    for (const status of allStatuses) {
      const display = getProposalStatusDisplay(status);
      expect(display).toHaveProperty("color");
      expect(display).toHaveProperty("label");
      expect(display.color).toBeTruthy();
      expect(display.label).toBeTruthy();
    }
  });
});
