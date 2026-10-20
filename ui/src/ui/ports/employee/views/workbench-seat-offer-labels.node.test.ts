import { describe, expect, it } from "vitest";
import type { GatewayAgentRow } from "../../../types.ts";
import {
  buildWorkbenchSeatOfferDisplayLabels,
  formatWorkbenchSeatStatus,
} from "./workbench-seat-offer-labels.ts";

describe("buildWorkbenchSeatOfferDisplayLabels", () => {
  it("resolves agent and collaboration space display names", () => {
    const agents = [
      { id: "main", name: "主秘书" },
      { id: "bot-2", name: "市场助手" },
    ] as GatewayAgentRow[];
    const labels = buildWorkbenchSeatOfferDisplayLabels({
      agents,
      robotEntries: [],
      groupEntries: [
        {
          sessionKey: "space:product",
          title: "产品研发小组",
          groupId: "grp_product",
          memberCount: 3,
          role: "owner",
        },
      ],
      spaces: [
        {
          id: "space-fef40e8a",
          groupId: "grp_product",
          title: "产品研发小组",
        },
      ],
      defaultAgentId: "main",
      agentIds: ["main", "bot-2"],
      defaultSpaceIds: ["grp_product", "space-fef40e8a"],
    });
    expect(labels.defaultAgentLabel).toBe("主秘书");
    expect(labels.agentToolLabels).toEqual(["主秘书", "市场助手"]);
    expect(labels.defaultSpaceLabels).toEqual(["产品研发小组"]);
  });

  it("dedupes collaboration space labels", () => {
    const labels = buildWorkbenchSeatOfferDisplayLabels({
      agents: [],
      robotEntries: [],
      groupEntries: [
        {
          sessionKey: "space:product",
          title: "产品研发小组",
          groupId: "grp_product",
          memberCount: 3,
          role: "owner",
        },
      ],
      spaces: [
        {
          id: "space-fef40e8a",
          groupId: "grp_product",
          title: "产品研发小组",
        },
      ],
      defaultSpaceIds: ["grp_product", "space-fef40e8a"],
    });
    expect(labels.defaultSpaceLabels).toEqual(["产品研发小组"]);
  });
});

describe("formatWorkbenchSeatStatus", () => {
  it("maps known seat statuses to readable labels", () => {
    expect(formatWorkbenchSeatStatus("occupied", "zh-CN")).toBe("在岗");
    expect(formatWorkbenchSeatStatus("handover_pending", "en")).toBe("Handover pending");
    expect(formatWorkbenchSeatStatus(null, "zh-CN")).toBe("未绑定");
  });
});
