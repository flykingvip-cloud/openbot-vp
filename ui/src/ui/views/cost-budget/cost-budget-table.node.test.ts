// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderCostBudgetKeyValueTable } from "./cost-budget-table.ts";

describe("renderCostBudgetKeyValueTable", () => {
  it("renders enterprise-table baseline markup", () => {
    const container = document.createElement("div");
    render(
      renderCostBudgetKeyValueTable(
        [
          { label: "aor_task", value: "12" },
          { label: "seat/viewer", value: "¥15.00" },
        ],
        { testId: "demo-kv-table" },
      ),
      container,
    );
    expect(container.querySelector('[data-testid="demo-kv-table"]')).toBeTruthy();
    expect(container.querySelector(".enterprise-table-wrap")).toBeTruthy();
    expect(container.querySelector(".enterprise-table")).toBeTruthy();
    expect(container.textContent).toContain("aor_task");
  });
});
