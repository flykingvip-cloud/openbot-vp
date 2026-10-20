// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { AssetListFilters } from "../../capability/enterprise-capability/types.ts";
import { renderAssetFilterBar, type AssetFilterBarProps } from "./asset-filter-bar.ts";

function makeFilters(overrides: Partial<AssetListFilters> = {}): AssetListFilters {
  return {
    searchQuery: "",
    usageScenario: null,
    applicableTarget: null,
    domain: null,
    maturity: null,
    healthStatus: null,
    onlyInstallable: false,
    ...overrides,
  };
}

function makeProps(overrides: Partial<AssetFilterBarProps> = {}): AssetFilterBarProps {
  return {
    filters: makeFilters(),
    availableScenarios: ["销售管理", "客服管理", "HR招聘"],
    availableTargets: ["全企业", "销售部", "客服部"],
    onFilterChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
}

function renderToContainer(props: AssetFilterBarProps): HTMLElement {
  const container = document.createElement("div");
  render(renderAssetFilterBar(props), container);
  return container;
}

describe("renderAssetFilterBar", () => {
  it("renders a toolbar container", () => {
    const container = renderToContainer(makeProps());
    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar).not.toBeNull();
  });

  it("renders search input with correct placeholder", () => {
    const container = renderToContainer(makeProps());
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe("搜索能力名称或描述");
  });

  it("fires onFilterChange with searchQuery on input", () => {
    const onFilterChange = vi.fn();
    const container = renderToContainer(makeProps({ onFilterChange }));
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;

    input.value = "招聘";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onFilterChange).toHaveBeenCalledWith("searchQuery", "招聘");
  });

  it("renders scenario dropdown with available options", () => {
    const container = renderToContainer(makeProps());
    const selects = container.querySelectorAll("select");
    const scenarioSelect = selects[0];

    expect(scenarioSelect).not.toBeNull();
    const options = scenarioSelect.querySelectorAll("option");
    // "全部场景" + 3 scenarios
    expect(options.length).toBe(4);
    expect(options[0].textContent).toBe("全部场景");
    expect(options[1].textContent).toBe("销售管理");
  });

  it("fires onFilterChange with null when scenario default is selected", () => {
    const onFilterChange = vi.fn();
    const container = renderToContainer(
      makeProps({ filters: makeFilters({ usageScenario: "销售管理" }), onFilterChange }),
    );
    const selects = container.querySelectorAll("select");
    const scenarioSelect = selects[0];

    scenarioSelect.value = "";
    scenarioSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onFilterChange).toHaveBeenCalledWith("usageScenario", null);
  });

  it("renders target dropdown with available options", () => {
    const container = renderToContainer(makeProps());
    const selects = container.querySelectorAll("select");
    const targetSelect = selects[1];

    const options = targetSelect.querySelectorAll("option");
    expect(options[0].textContent).toBe("全部对象");
    expect(options.length).toBe(4); // default + 3 targets
  });

  it("renders domain dropdown with 6 domains", () => {
    const container = renderToContainer(makeProps());
    const selects = container.querySelectorAll("select");
    const domainSelect = selects[2];

    const options = domainSelect.querySelectorAll("option");
    expect(options[0].textContent).toBe("全部领域");
    // 6 domains + default
    expect(options.length).toBe(7);
  });

  it("renders maturity dropdown with 6 levels", () => {
    const container = renderToContainer(makeProps());
    const selects = container.querySelectorAll("select");
    const maturitySelect = selects[3];

    const options = maturitySelect.querySelectorAll("option");
    expect(options[0].textContent).toBe("全部");
    expect(options.length).toBe(7); // default + 6 levels
  });

  it("renders health status dropdown with 4 statuses", () => {
    const container = renderToContainer(makeProps());
    const selects = container.querySelectorAll("select");
    const healthSelect = selects[4];

    const options = healthSelect.querySelectorAll("option");
    expect(options[0].textContent).toBe("全部状态");
    expect(options.length).toBe(5); // default + 4 statuses
  });

  it("renders toggle switch with label text", () => {
    const container = renderToContainer(makeProps());
    const text = container.textContent ?? "";
    expect(text).toContain("只看我可安装");
  });

  it("toggle switch fires onFilterChange with boolean", () => {
    const onFilterChange = vi.fn();
    const container = renderToContainer(makeProps({ onFilterChange }));
    const toggle = container.querySelector('[role="switch"]') as HTMLElement;

    toggle.click();
    expect(onFilterChange).toHaveBeenCalledWith("onlyInstallable", true);
  });

  it("toggle switch reflects active state", () => {
    const container = renderToContainer(
      makeProps({ filters: makeFilters({ onlyInstallable: true }) }),
    );
    const toggle = container.querySelector('[role="switch"]') as HTMLElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("renders reset button", () => {
    const container = renderToContainer(makeProps());
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.textContent?.trim()).toBe("重置");
  });

  it("reset button fires onReset", () => {
    const onReset = vi.fn();
    const container = renderToContainer(makeProps({ onReset }));
    const button = container.querySelector("button") as HTMLButtonElement;

    button.click();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("fires onFilterChange with domain value on change", () => {
    const onFilterChange = vi.fn();
    const container = renderToContainer(makeProps({ onFilterChange }));
    const selects = container.querySelectorAll("select");
    const domainSelect = selects[2];

    domainSelect.value = "销售";
    domainSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onFilterChange).toHaveBeenCalledWith("domain", "销售");
  });
});
