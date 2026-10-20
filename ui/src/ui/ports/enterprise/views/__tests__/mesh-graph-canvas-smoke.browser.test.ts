/* @vitest-environment jsdom */
import { html, render } from "lit";
import { describe, expect, it } from "vitest";
import "../mesh-graph-canvas.ts";
import type { MeshGraphModel } from "../mesh-graphs-model.ts";

describe("enterprise-mesh-graph-canvas smoke", () => {
  it("renders filters and settles updateComplete", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const model: MeshGraphModel = {
      agents: [
        {
          id: "main",
          name: "大白管家",
          sessionCount: 1,
          groupCount: 1,
          totalCost: 0,
          statusLabel: "ok",
          intensity: 1,
        },
      ],
      groups: [
        {
          id: "g1",
          name: "upbeyond",
          humanCount: 1,
          botCount: 1,
          sessionCount: 0,
          totalCost: 0,
        },
      ],
      edges: [
        {
          agentId: "main",
          agentName: "大白管家",
          groupId: "g1",
          groupName: "upbeyond",
        },
      ],
    };

    render(
      html`<enterprise-mesh-graph-canvas
        .model=${model}
        .basePath=${""}
        .tenantId=${"acme"}
      ></enterprise-mesh-graph-canvas>`,
      container,
    );

    const canvas = container.querySelector("enterprise-mesh-graph-canvas") as
      | (HTMLElement & { updateComplete?: Promise<unknown> })
      | null;
    expect(canvas).not.toBeNull();
    expect(customElements.get("enterprise-mesh-graph-canvas")).toBeTruthy();

    const settled = await Promise.race([
      canvas!.updateComplete!.then(() => "ok" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2000)),
    ]);
    expect(settled).toBe("ok");
    expect(canvas!.querySelector(".enterprise-mesh-graphs__search")).not.toBeNull();
    expect(canvas!.querySelector(".enterprise-mesh-graphs__svg")).not.toBeNull();
    container.remove();
  });
});
