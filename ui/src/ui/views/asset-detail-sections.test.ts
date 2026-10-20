// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import {
  renderAssetDetailFactPairs,
  renderAssetDetailFactPairsOrEmpty,
  renderAssetDetailFactRows,
  renderAssetDetailListItems,
  renderAssetDetailListItemsOrEmpty,
  renderAssetDetailStatCards,
  renderAssetDetailTimeline,
} from "./asset-detail-sections.ts";

const items = [
  { label: "当前版本", value: "1.2.3" },
  { label: "当前状态", value: "已发布" },
];

describe("asset detail sections", () => {
  it("renders reusable row, pair, list, and stat sections", () => {
    const container = document.createElement("div");
    render(
      [
        renderAssetDetailFactRows({
          items,
          rowClass: "row",
          labelClass: "label",
          valueClass: "value",
        }),
        renderAssetDetailFactPairs({
          items,
          containerClass: "pairs",
          itemClass: "pair",
          labelClass: "pair-label",
          valueClass: "pair-value",
        }),
        renderAssetDetailStatCards({
          items,
          containerClass: "stats",
          itemClass: "stat",
          labelClass: "stat-label",
          valueClass: "stat-value",
        }),
        renderAssetDetailListItems({
          items,
          containerClass: "list",
          itemClass: "list-item",
        }),
      ],
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("当前版本");
    expect(text).toContain("1.2.3");
    expect(text).toContain("当前状态");
    expect(text).toContain("已发布");
  });

  it("renders shared empty states when the list is empty", () => {
    const container = document.createElement("div");
    render(
      [
        renderAssetDetailFactPairsOrEmpty({
          items: [],
          containerClass: "pairs",
          itemClass: "pair",
          labelClass: "pair-label",
          valueClass: "pair-value",
          emptyTitle: "定义待接通",
          emptyDescription: "当前还没有定义口径。",
        }),
        renderAssetDetailListItemsOrEmpty({
          items: [],
          containerClass: "list",
          itemClass: "list-item",
          emptyTitle: "列表待接通",
          emptyDescription: "当前还没有列表项。",
        }),
      ],
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("定义待接通");
    expect(text).toContain("列表待接通");
  });

  it("renders timeline items with tag and status badges", () => {
    const container = document.createElement("div");
    render(
      renderAssetDetailTimeline({
        items: [
          {
            timestampLabel: "2026-05-28 10:00",
            primary: "张三",
            secondary: "提交首版资产。",
            badge: { label: "初始提交", variant: "tag" },
          },
          {
            timestampLabel: "2026-05-29 10:00",
            primary: "李主管",
            secondary: "可以推广。",
            badge: { label: "通过", variant: "status", tone: "success" },
          },
        ],
        itemClass: "timeline-item",
        timeClass: "time",
        primaryClass: "primary",
        secondaryClass: "secondary",
        tagClass: "tag",
        statusClassBase: "status",
        statusTonePrefix: "status--",
        emptyTitle: "空",
        emptyDescription: "空描述",
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("初始提交");
    expect(text).toContain("通过");
    expect(container.querySelector(".status.status--success")).not.toBeNull();
    expect(container.querySelector(".tag")).not.toBeNull();
  });
});
