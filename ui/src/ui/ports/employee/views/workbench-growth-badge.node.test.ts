// @vitest-environment jsdom
import { render } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import type { GrowthStatusView } from "../../../controllers/agent-growth.ts";
import { deriveGrowthBadgeModel, renderGrowthBadge } from "./workbench-growth-badge.ts";

function view(partial: Partial<GrowthStatusView>): GrowthStatusView {
  return {
    lifecycleState: "growing",
    dimensions: { identity: 0, capability: 0, knowledge: 0, habits: 0 },
    activationScore: 0,
    operationalScore: null,
    capabilityReadiness: false,
    isActivated: false,
    templateId: "generic_worker",
    ...partial,
  };
}

beforeEach(async () => {
  await i18n.setLocale("zh-CN");
});

describe("deriveGrowthBadgeModel", () => {
  it("returns null for missing view", () => {
    expect(deriveGrowthBadgeModel(null)).toBeNull();
  });

  it("shows growth percent for birth/growing", () => {
    expect(
      deriveGrowthBadgeModel(view({ lifecycleState: "growing", activationScore: 42 })),
    ).toEqual({
      label: "成长中 42%",
      tone: "growing",
    });
    expect(
      deriveGrowthBadgeModel(view({ lifecycleState: "birth", activationScore: 0 }))?.label,
    ).toBe("成长中 0%");
  });

  it("maps lifecycle states to labels", () => {
    expect(deriveGrowthBadgeModel(view({ lifecycleState: "mission_ready" }))?.label).toBe(
      "待首任务",
    );
    expect(deriveGrowthBadgeModel(view({ lifecycleState: "activated" }))?.label).toBe("已激活");
    expect(deriveGrowthBadgeModel(view({ lifecycleState: "evolution" }))?.label).toBe("成长报告");
  });

  it("clamps activationScore into 0..100", () => {
    expect(deriveGrowthBadgeModel(view({ activationScore: 150 }))?.label).toBe("成长中 100%");
    expect(deriveGrowthBadgeModel(view({ activationScore: -5 }))?.label).toBe("成长中 0%");
  });

  it("surfaces false-ready when activation high but operational low", () => {
    expect(
      deriveGrowthBadgeModel(
        view({ lifecycleState: "mission_ready", activationScore: 95, operationalScore: 10 }),
      )?.label,
    ).toBe("虚高就绪");
  });
});

describe("renderGrowthBadge", () => {
  it("renders a badge element with tone and label", () => {
    const host = document.createElement("div");
    render(renderGrowthBadge(view({ lifecycleState: "mission_ready" })), host);
    const badge = host.querySelector(".workbench-growth-badge");
    expect(badge?.getAttribute("data-growth-tone")).toBe("mission_ready");
    expect(badge?.textContent).toContain("待首任务");
  });

  it("renders nothing when no view", () => {
    const host = document.createElement("div");
    render(renderGrowthBadge(null), host);
    expect(host.querySelector(".workbench-growth-badge")).toBeNull();
  });
});
