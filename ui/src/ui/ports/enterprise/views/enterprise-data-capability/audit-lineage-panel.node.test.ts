// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderAuditLineagePanel } from "./audit-lineage-panel.ts";

function mount(template: unknown): HTMLElement {
  const container = document.createElement("div");
  render(template as never, container);
  return container;
}

describe("renderAuditLineagePanel", () => {
  it("renders the reverse chain in Insight → Source Data order", () => {
    const container = mount(
      renderAuditLineagePanel({
        overview: {
          lineageCount: 1,
          supplyAuditCount: 1,
          materializationFailureCount: 0,
          recentReverseChain: [
            { role: "insight", id: "obj-insight", label: "流失风险" },
            { role: "metric", id: "obj-metric", label: "流失评分" },
            { role: "projection", id: "proj-1", label: "客户流失风险洞察" },
            {
              role: "connector_action",
              id: "crm-salesforce::crm.customer.read_summary@v2",
              label: "crm.customer.read_summary@v2",
            },
            { role: "source_data", id: "src-crm", label: "Salesforce CRM" },
          ],
        },
        loading: false,
        error: null,
        projectionFailureCount: null,
      }),
    );
    const chain = container.querySelector('[data-testid="audit-lineage-reverse-chain"]');
    const roles = Array.from(chain?.querySelectorAll("[data-role]") ?? []).map((node) =>
      node.getAttribute("data-role"),
    );
    expect(roles).toEqual(["insight", "metric", "projection", "connector_action", "source_data"]);
    expect(chain?.querySelector(".edc-metric-row")).toBeNull();
    expect(chain?.querySelector(".edc-kv-stack")).not.toBeNull();
    expect(container.textContent).toContain("连接动作");
    expect(container.textContent).toContain("crm.customer.read_summary@v2");
    expect(container.textContent).not.toContain("ConnectorAction@version");
    expect(container.textContent).toContain("源数据");
  });
});
