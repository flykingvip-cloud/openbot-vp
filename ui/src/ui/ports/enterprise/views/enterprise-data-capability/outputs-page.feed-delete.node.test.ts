// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { ManagedKnowledgeFeedItemRecord } from "../../../../capability/enterprise-data-capability/types.ts";
import { renderProjectionStudioSection } from "./outputs-page.ts";

function mount(onDeleteFeedItem = vi.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const feedItems: ManagedKnowledgeFeedItemRecord[] = [
    {
      objectId: "feed-current",
      projectionId: "proj-1",
      title: "当前仓库供给",
      kind: "data",
      category: "erp",
      sourceSystems: ["yonyou"],
      generatedAt: "2026-11-05T02:00:00.000Z",
      freshnessStatus: "fresh",
      isCurrentSupplied: true,
    },
    {
      objectId: "feed-old",
      projectionId: "proj-1",
      title: "模拟仓库",
      kind: "data",
      category: "erp",
      sourceSystems: ["yonyou"],
      generatedAt: "2026-11-01T00:00:00.000Z",
      freshnessStatus: "stale",
      isCurrentSupplied: false,
    },
  ];
  render(
    renderProjectionStudioSection({
      state: {
        projectionSpecs: [
          {
            projectionId: "proj-1",
            projectionKey: "warehouse",
            displayName: "仓库",
            lifecycle: "active",
            objectKind: "data",
            templateKey: "AggregateTemplate",
            sourceActionCount: 1,
            updatedAt: "2026-11-05T00:00:00.000Z",
          },
        ],
        projectionBindings: [
          {
            bindingId: "bind-1",
            projectionId: "proj-1",
            materializationMode: "on_demand",
            enabled: true,
            materializationTeamLabel: "ops",
            updatedAt: "2026-11-05T00:00:00.000Z",
            supplyRecordCount: 2,
          },
        ],
        feedItems,
        feedItemsLoading: false,
        feedDeleteBusyObjectId: null,
        projectionsLoading: false,
        projectionsError: null,
        projectionsNotice: null,
        projectionAuditFailureCount: 0,
        materializeBusyBindingId: null,
      },
      onMaterialize: vi.fn(),
      onOpenCreate: vi.fn(),
      onDeleteFeedItem,
    }),
    container,
  );
  return { container, onDeleteFeedItem };
}

describe("outputs-page feed delete", () => {
  it("renders per-feed delete actions and invokes callback", () => {
    const { container, onDeleteFeedItem } = mount();
    expect(container.textContent).toContain("知识对象（Feed）");
    expect(container.textContent).toContain("当前供给");
    expect(container.textContent).toContain("模拟仓库");
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid="feed-item-delete"]'),
    );
    expect(buttons.length).toBe(2);
    buttons[1].click();
    expect(onDeleteFeedItem).toHaveBeenCalledTimes(1);
    expect(onDeleteFeedItem.mock.calls[0][0].objectId).toBe("feed-old");
  });
});
