// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderAssetLeaderboardSection } from "./asset-incubation-leaderboards.ts";

describe("renderAssetLeaderboardSection", () => {
  it("renders contributor and enterprise leaderboard cards", () => {
    const container = document.createElement("div");
    render(
      renderAssetLeaderboardSection({
        title: "资产孵化贡献榜",
        description: "展示推动资产成熟与扩散的创作者。",
        entries: [
          {
            id: "emp-1",
            entityType: "employee",
            rank: 1,
            name: "张三",
            subtitle: "销售部 · 资深运营",
            description: "连续推动多个资产进入企业资产库。",
            badge: "本月 Top",
            highlights: ["线索清洗", "客户跟进", "销售日报"],
            primaryMetric: { label: "已贡献", value: "12 项" },
            secondaryMetric: { label: "进入孵化", value: "3 项" },
          },
          {
            id: "tenant-1",
            entityType: "enterprise",
            rank: 2,
            name: "华东运营中心",
            subtitle: "企业贡献者",
            description: "持续输出高复用资产包。",
            highlights: ["工单归档", "巡检日报"],
            primaryMetric: { label: "提交资产包", value: "18 项" },
            secondaryMetric: { label: "进入平台候选", value: "5 项" },
          },
        ],
        emptyTitle: "暂无贡献榜数据",
        emptyDescription: "待接通贡献统计后显示。",
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("资产孵化贡献榜");
    expect(text).toContain("张三");
    expect(text).toContain("华东运营中心");
    expect(text).toContain("12 项");
    expect(text).toContain("5 项");
  });

  it("renders an empty state when no entries exist", () => {
    const container = document.createElement("div");
    render(
      renderAssetLeaderboardSection({
        title: "贡献榜",
        description: "暂无数据",
        entries: [],
        emptyTitle: "暂无贡献榜数据",
        emptyDescription: "待接通贡献统计后显示。",
      }),
      container,
    );

    expect(container.textContent).toContain("暂无贡献榜数据");
    expect(container.textContent).toContain("待接通贡献统计后显示。");
  });
});
