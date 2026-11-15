// @vitest-environment jsdom
// Regression guard for the relationship-graph SVG rendering.
//
// The nodes/edges are produced by nested lit templates inside the <svg>. If those
// fragments are authored with lit's `html` tag (instead of `svg`), the browser parses
// <circle>/<line>/<g> in the XHTML namespace — they keep their attributes but render as
// zero-geometry HTMLUnknownElements, so the whole graph paints blank even though the DOM
// looks populated. These tests pin the correct SVG namespace + non-zero geometry.
//
// Dual-mode (repo convention for *.browser.test.ts):
//   - Root `pnpm test` runs this under jsdom → the namespace assertions run (jsdom tracks
//     namespaceURI even without layout).
//   - `pnpm -C ui test` runs it in real chromium → the getBBox geometry assertion also runs.
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHomeGraphViewModel } from "../capability/knowledge-universe/graph-layout.ts";
import type { RelationshipGraph } from "../capability/knowledge-universe/types.ts";
import {
  renderKnowledgeUniverseGraphCanvas,
  resetGraphAutoCenterStateForTests,
} from "./knowledge-universe-graph-canvas.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

const GRAPH: RelationshipGraph = {
  nodes: [
    { id: "node:me", kind: "owner", title: "我" },
    { id: "node:a", kind: "knowledge-object", title: "文档 A", objectId: "a" },
    { id: "node:b", kind: "knowledge-object", title: "文档 B", objectId: "b" },
    { id: "node:c", kind: "knowledge-base", title: "知识库 C", objectId: "obj:kb:c" },
  ],
  edges: [
    { sourceId: "node:me", targetId: "node:a", relationType: "related", score: 90 },
    { sourceId: "node:a", targetId: "node:b", relationType: "related", score: 70 },
    { sourceId: "node:me", targetId: "node:c", relationType: "related", score: 60 },
  ],
};

type CanvasParams = Parameters<typeof renderKnowledgeUniverseGraphCanvas>[0];

function renderCanvasWith(host: HTMLElement, overrides: Partial<CanvasParams> = {}) {
  render(
    renderKnowledgeUniverseGraphCanvas({
      graph: GRAPH,
      graphViewModel: buildHomeGraphViewModel(GRAPH),
      selectedNodeId: null,
      hoveredNodeId: null,
      zoom: 1,
      panX: 0,
      panY: 0,
      onSelectNode: vi.fn(),
      onHoverNode: vi.fn(),
      onZoom: vi.fn(),
      onPan: vi.fn(),
      onResetView: vi.fn(),
      ...overrides,
    }),
    host,
  );
}

function renderCanvas(host: HTMLElement) {
  renderCanvasWith(host);
}

let host: HTMLDivElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
  resetGraphAutoCenterStateForTests();
});

const isBrowserMode = typeof (expect as unknown as { element?: unknown }).element === "function";

describe("knowledge universe graph canvas — SVG namespace", () => {
  it("renders node circles and edge lines in the SVG namespace (not XHTML)", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    renderCanvas(host);

    // Count within the graph canvas svg only — the legend renders its own glyph <svg>s with extra
    // <circle>/<line> elements that must not inflate the node/edge counts.
    const canvas = host.querySelector(".knowledge-universe__graph-canvas");
    expect(canvas).toBeTruthy();
    const circles = canvas!.querySelectorAll("circle");
    const lines = canvas!.querySelectorAll("line");
    // One circle per node, one line per edge (all endpoints resolve here).
    expect(circles.length).toBe(GRAPH.nodes.length);
    expect(lines.length).toBe(GRAPH.edges.length);

    // The regression: every SVG child across canvas AND legend must be in the SVG namespace.
    for (const circle of host.querySelectorAll("circle")) {
      expect(circle.namespaceURI).toBe(SVG_NS);
    }
    for (const line of host.querySelectorAll("line")) {
      expect(line.namespaceURI).toBe(SVG_NS);
    }
  });

  it.skipIf(!isBrowserMode)("gives node circles a non-zero rendered geometry", () => {
    host = document.createElement("div");
    host.style.width = "600px";
    host.style.height = "400px";
    document.body.appendChild(host);
    renderCanvas(host);

    const circle = host.querySelector<SVGGraphicsElement>(
      ".knowledge-universe__graph-canvas circle",
    );
    expect(circle).toBeTruthy();
    // getBBox is SVG-only; an XHTML-namespaced <circle> would not expose real geometry.
    const bbox = circle!.getBBox();
    expect(bbox.width).toBeGreaterThan(0);
    expect(bbox.height).toBeGreaterThan(0);
  });
});

// Regression guard for node selection. The viewport is drag-pannable; the bug was that calling
// setPointerCapture on the viewport during pointerdown retargeted the trailing click away from the
// node <g>, so clicking a node never fired onSelectNode and the detail panel stayed empty. The fix
// drops pointer capture (panning still works via window listeners) and only suppresses the click
// that trails a real pan drag.
function firePointer(target: EventTarget, type: string, clientX: number, clientY: number) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }));
}

describe("knowledge universe graph canvas — node selection", () => {
  it("calls onSelectNode when a node is clicked", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const onSelectNode = vi.fn();
    renderCanvasWith(host, { onSelectNode });

    const node = host.querySelector('[data-node-id="node:a"]');
    expect(node).toBeTruthy();
    node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onSelectNode).toHaveBeenCalledWith("node:a");
  });

  it("suppresses the click that trails a pan drag", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const onSelectNode = vi.fn();
    const onPan = vi.fn();
    renderCanvasWith(host, { onSelectNode, onPan });

    const viewport = host.querySelector(".knowledge-universe__graph-viewport");
    const node = host.querySelector('[data-node-id="node:a"]');
    expect(viewport).toBeTruthy();
    expect(node).toBeTruthy();

    // Drag well past the pan threshold, then release on a node.
    firePointer(viewport!, "pointerdown", 100, 100);
    firePointer(window, "pointermove", 160, 160);
    firePointer(window, "pointerup", 160, 160);
    node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onPan).toHaveBeenCalled();
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it("re-enables selection on a fresh click after a pan drag", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const onSelectNode = vi.fn();
    renderCanvasWith(host, { onSelectNode });

    const viewport = host.querySelector(".knowledge-universe__graph-viewport");
    const node = host.querySelector('[data-node-id="node:a"]');

    // A pan drag whose trailing click is ignored.
    firePointer(viewport!, "pointerdown", 100, 100);
    firePointer(window, "pointermove", 160, 160);
    firePointer(window, "pointerup", 160, 160);
    node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelectNode).not.toHaveBeenCalled();

    // A fresh press with no movement restores click-to-select.
    firePointer(viewport!, "pointerdown", 100, 100);
    firePointer(window, "pointerup", 100, 100);
    node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelectNode).toHaveBeenCalledWith("node:a");
  });
});

// Increment A (governance overlay + legend): node color = knowledge type, governance shows as a
// status ring + corner badge dot (no longer a monochrome fill override), and a legend documents the
// node types / relation types / statuses present in the current graph.
const GOV_GRAPH: RelationshipGraph = {
  nodes: [
    { id: "node:me", kind: "owner", title: "我" },
    {
      id: "node:a",
      kind: "knowledge-object",
      title: "文档 A",
      objectId: "a",
      governance: { status: "conflict", conflictCount: 2 },
    },
    {
      id: "node:b",
      kind: "knowledge-object",
      title: "文档 B",
      objectId: "b",
      governance: { status: "attention", freshness: "stale" },
    },
    {
      id: "node:c",
      kind: "data-capability",
      title: "CRM",
      objectId: "obj:data:crm",
      governance: { status: "healthy" },
    },
  ],
  edges: [
    { sourceId: "node:me", targetId: "node:a", relationType: "conflicts", score: 60 },
    { sourceId: "node:a", targetId: "node:b", relationType: "derived-from", score: 72 },
    { sourceId: "node:b", targetId: "node:c", relationType: "used-by", score: 80 },
  ],
};

describe("knowledge universe graph canvas — legend + governance overlay", () => {
  it("badges non-healthy nodes and leaves healthy ones unbadged", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    renderCanvasWith(host, {
      graph: GOV_GRAPH,
      graphViewModel: buildHomeGraphViewModel(GOV_GRAPH),
    });

    expect(
      host.querySelector('[data-node-id="node:a"] [data-badge-status="conflict"]'),
    ).toBeTruthy();
    expect(
      host.querySelector('[data-node-id="node:b"] [data-badge-status="attention"]'),
    ).toBeTruthy();
    // Healthy node carries no badge (keeps the graph uncluttered).
    expect(host.querySelector('[data-node-id="node:c"] [data-badge-status]')).toBeNull();
  });

  it("keeps the type class on flagged nodes (governance no longer replaces the fill)", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    renderCanvasWith(host, {
      graph: GOV_GRAPH,
      graphViewModel: buildHomeGraphViewModel(GOV_GRAPH),
    });

    const conflicted = host.querySelector('[data-node-id="node:a"]');
    // Both the type class (drives the base fill) and the governance ring class are present.
    expect(conflicted?.classList.contains("knowledge-universe__graph-node--knowledge")).toBe(true);
    expect(conflicted?.classList.contains("knowledge-universe__graph-node--gov-conflict")).toBe(
      true,
    );
  });

  it("renders a legend covering the node types, relation types, and statuses present", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    renderCanvasWith(host, {
      graph: GOV_GRAPH,
      graphViewModel: buildHomeGraphViewModel(GOV_GRAPH),
    });

    const legend = host.querySelector('[data-testid="ku-graph-legend"]');
    expect(legend).toBeTruthy();
    // Node-type glyphs reuse the graph node classes; relation glyphs reuse the edge classes.
    expect(legend!.querySelector(".knowledge-universe__graph-node--data")).toBeTruthy();
    expect(legend!.querySelector(".knowledge-universe__graph-edge--conflicts")).toBeTruthy();
    expect(legend!.querySelector(".knowledge-universe__graph-edge--derived-from")).toBeTruthy();
    // Status group lists the non-healthy statuses present (healthy is omitted).
    expect(legend!.querySelector(".knowledge-universe__graph-node-badge--conflict")).toBeTruthy();
    expect(legend!.querySelector(".knowledge-universe__graph-node-badge--attention")).toBeTruthy();
  });
});

// Increment (archived-into): a deliverable that sedimented into a KB renders a dedicated
// `archived-into` (成果 沉淀入 知识库) edge — a distinct relation type/label from the generic
// derived-from — on both the canvas and the legend. Guards the full wiring: builder relation type
// → FE union → node-kind label map → legend order → CSS class on the DOM.
const SEDIMENT_GRAPH: RelationshipGraph = {
  nodes: [
    { id: "node:d", kind: "deliverable", title: "成果 X", objectId: "obj:deliverable:d1" },
    { id: "node:k", kind: "knowledge-base", title: "个人库", objectId: "obj:kb:k1" },
  ],
  edges: [{ sourceId: "node:d", targetId: "node:k", relationType: "archived-into", score: 78 }],
};

describe("knowledge universe graph canvas — archived-into (成果 沉淀入 知识库)", () => {
  it("renders the sedimentation edge and its legend glyph with the archived-into class", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    renderCanvasWith(host, {
      graph: SEDIMENT_GRAPH,
      graphViewModel: buildHomeGraphViewModel(SEDIMENT_GRAPH),
    });

    // Canvas edge carries the dedicated relation class, in the SVG namespace (not XHTML).
    const canvas = host.querySelector(".knowledge-universe__graph-canvas");
    const edge = canvas!.querySelector(".knowledge-universe__graph-edge--archived-into");
    expect(edge).toBeTruthy();
    expect(edge!.namespaceURI).toBe(SVG_NS);

    // Legend documents the archived-into relation (reuses the same edge class so it can't drift).
    const legend = host.querySelector('[data-testid="ku-graph-legend"]');
    expect(legend!.querySelector(".knowledge-universe__graph-edge--archived-into")).toBeTruthy();
  });

  it("labels the sedimentation edge (resolved i18n, not a raw key) when it touches focus", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    renderCanvasWith(host, {
      graph: SEDIMENT_GRAPH,
      graphViewModel: buildHomeGraphViewModel(SEDIMENT_GRAPH),
      hoveredNodeId: "node:d",
    });

    const label = host.querySelector(".knowledge-universe__graph-edge-label");
    expect(label).toBeTruthy();
    // relationTypes.archivedInto must resolve via i18n (en "Archived into" / zh "沉淀入"),
    // never surface the raw dotted key.
    expect(label!.textContent?.trim()).toBeTruthy();
    expect(label!.textContent).not.toContain("relationTypes.archivedInto");
  });
});

// Direction arrows: directional relations (lineage/flow/ownership) render an arrowhead at the
// target and pull the endpoint back to the node boundary; symmetric relations (related/conflicts)
// stay plain lines. Makes the source->target semantics (e.g. 成果 --沉淀入--> 知识库) legible.
describe("knowledge universe graph canvas — direction arrows", () => {
  it("adds an arrowhead marker to a directional edge and offsets its endpoint from the target", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    renderCanvasWith(host, {
      graph: SEDIMENT_GRAPH,
      graphViewModel: buildHomeGraphViewModel(SEDIMENT_GRAPH),
    });

    const canvas = host.querySelector(".knowledge-universe__graph-canvas");
    // The shared arrowhead marker is defined once in the canvas <defs>.
    expect(canvas!.querySelector("#ku-graph-arrow")).toBeTruthy();

    // The directional (archived-into) edge references the arrowhead marker.
    const edge = canvas!.querySelector(".knowledge-universe__graph-edge--archived-into");
    expect(edge!.getAttribute("marker-end")).toBe("url(#ku-graph-arrow)");

    // The endpoint is pulled back to the target node's boundary, not its center.
    const targetNode = host.querySelector('[data-node-id="node:k"]');
    const match = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(
      targetNode!.getAttribute("transform") ?? "",
    );
    expect(match).toBeTruthy();
    const centerX = Number(match![1]);
    const centerY = Number(match![2]);
    const x2 = Number(edge!.getAttribute("x2"));
    const y2 = Number(edge!.getAttribute("y2"));
    // Pulled back by roughly the node radius (28) + 4, so well clear of the center.
    expect(Math.hypot(x2 - centerX, y2 - centerY)).toBeGreaterThan(10);
  });

  it("leaves symmetric edges (related) as plain lines without an arrowhead", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    // The base GRAPH's edges are all "related" (symmetric).
    renderCanvas(host);

    const canvas = host.querySelector(".knowledge-universe__graph-canvas");
    const relatedEdges = canvas!.querySelectorAll(".knowledge-universe__graph-edge--related");
    expect(relatedEdges.length).toBeGreaterThan(0);
    for (const edge of relatedEdges) {
      expect(edge.getAttribute("marker-end")).toBeNull();
    }
  });
});

// t326: node names are not painted permanently. A name appears only while the pointer hovers that
// node, then retracts. Selection / the detail panel stay a separate click interaction.
describe("knowledge universe graph canvas — hover-only node labels", () => {
  function nodeLabel(root: ParentNode, nodeId: string) {
    return root.querySelector(`[data-node-id="${nodeId}"] .knowledge-universe__graph-node-label`);
  }

  it("does not render standing node names by default", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    renderCanvas(host);

    const canvas = host.querySelector(".knowledge-universe__graph-canvas");
    expect(canvas).toBeTruthy();
    expect(canvas!.querySelectorAll(".knowledge-universe__graph-node-label")).toHaveLength(0);
    expect(canvas!.querySelectorAll("[data-node-id]")).toHaveLength(GRAPH.nodes.length);
  });

  it("shows only the hovered node name and leaves other nodes unlabeled", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    renderCanvasWith(host, { hoveredNodeId: "node:a" });

    const canvas = host.querySelector(".knowledge-universe__graph-canvas");
    const labels = canvas!.querySelectorAll(".knowledge-universe__graph-node-label");
    expect(labels).toHaveLength(1);
    expect(nodeLabel(canvas!, "node:a")).toBeTruthy();
    expect(nodeLabel(canvas!, "node:b")).toBeNull();
    expect(nodeLabel(canvas!, "node:c")).toBeNull();
    expect(nodeLabel(canvas!, "node:me")).toBeNull();
  });

  it("removes the name after hover leaves", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    renderCanvasWith(host, { hoveredNodeId: "node:a" });
    expect(nodeLabel(host, "node:a")).toBeTruthy();

    renderCanvasWith(host, { hoveredNodeId: null });
    expect(host.querySelectorAll(".knowledge-universe__graph-node-label")).toHaveLength(0);
  });

  it("does not treat click-selection as a standing name", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    renderCanvasWith(host, { selectedNodeId: "node:a", hoveredNodeId: null });

    expect(host.querySelectorAll(".knowledge-universe__graph-node-label")).toHaveLength(0);
    expect(host.querySelector('[data-node-id="node:a"]')).toBeTruthy();
  });

  it("reports hover enter/leave without changing selection", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const onHoverNode = vi.fn();
    const onSelectNode = vi.fn();
    renderCanvasWith(host, { onHoverNode, onSelectNode });

    const nodeA = host.querySelector('[data-node-id="node:a"]');
    expect(nodeA).toBeTruthy();
    nodeA!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(onHoverNode).toHaveBeenCalledWith("node:a");
    nodeA!.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    expect(onHoverNode).toHaveBeenCalledWith(null);
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  it("still selects a node on click", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const onSelectNode = vi.fn();
    renderCanvasWith(host, { onSelectNode, hoveredNodeId: "node:a" });

    const node = host.querySelector('[data-node-id="node:a"]');
    node!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelectNode).toHaveBeenCalledWith("node:a");
  });
});
