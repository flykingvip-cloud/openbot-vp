// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { AssetLandscapeGraph } from "../../capability/enterprise-data-capability/types.ts";
import { renderDataAssetLandscapeGraph } from "./data-asset-landscape-graph.ts";
import { renderNodeDetailDrawer } from "./node-detail-drawer.ts";

function mount(template: unknown): HTMLElement {
  const container = document.createElement("div");
  render(template as never, container);
  return container;
}

const graph: AssetLandscapeGraph = {
  nodes: [
    { id: "source:s1", kind: "source", label: "CRM" },
    { id: "capability:c1", kind: "capability", label: "销售分析能力" },
    { id: "knowledge:k1", kind: "knowledge", label: "客户画像" },
    { id: "seat:seat-1", kind: "seat", label: "华东销售经理" },
  ],
  edges: [
    { from: "source:s1", to: "capability:c1", relation: "source" },
    { from: "capability:c1", to: "knowledge:k1", relation: "generate" },
    { from: "source:s1", to: "seat:seat-1", relation: "open" },
  ],
  truncated: false,
};

describe("DataAssetLandscapeGraph", () => {
  it("renders an svg with nodes and column headers", () => {
    const container = mount(
      renderDataAssetLandscapeGraph({
        graph,
        loading: false,
        error: null,
        selectedNodeId: null,
        onOpenNode: vi.fn(),
      }),
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("数据源");
    expect(container.textContent).toContain("销售分析能力");
    expect(container.textContent).toContain("客户画像");
  });

  it("invokes onOpenNode when a node is clicked", () => {
    const onOpenNode = vi.fn();
    const container = mount(
      renderDataAssetLandscapeGraph({
        graph,
        loading: false,
        error: null,
        selectedNodeId: null,
        onOpenNode,
      }),
    );
    const node = container.querySelector(".enterprise-data-capability__graph-node");
    expect(node).not.toBeNull();
    node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenNode).toHaveBeenCalledTimes(1);
  });

  it("shows empty state when graph has no nodes", () => {
    const container = mount(
      renderDataAssetLandscapeGraph({
        graph: { nodes: [], edges: [], truncated: false },
        loading: false,
        error: null,
        selectedNodeId: null,
        onOpenNode: vi.fn(),
      }),
    );
    expect(container.textContent).toContain("暂无资产关系数据");
  });
});

describe("NodeDetailDrawer", () => {
  it("renders neighbor groups for a selected capability node", () => {
    const container = mount(
      renderNodeDetailDrawer({ graph, selectedNodeId: "capability:c1", onClose: vi.fn() }),
    );
    expect(container.textContent).toContain("销售分析能力");
    expect(container.textContent).toContain("来源数据源");
    expect(container.textContent).toContain("CRM");
    expect(container.textContent).toContain("知识供给");
    expect(container.textContent).toContain("客户画像");
  });

  it("renders open targets for a selected source node", () => {
    const container = mount(
      renderNodeDetailDrawer({ graph, selectedNodeId: "source:s1", onClose: vi.fn() }),
    );
    expect(container.textContent).toContain("开放对象");
    expect(container.textContent).toContain("华东销售经理");
  });

  it("renders nothing when no node is selected", () => {
    const container = mount(
      renderNodeDetailDrawer({ graph, selectedNodeId: null, onClose: vi.fn() }),
    );
    expect(container.querySelector(".enterprise-data-capability__drawer")).toBeNull();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    const container = mount(
      renderNodeDetailDrawer({ graph, selectedNodeId: "capability:c1", onClose }),
    );
    const closeBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("关闭"),
    );
    closeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
