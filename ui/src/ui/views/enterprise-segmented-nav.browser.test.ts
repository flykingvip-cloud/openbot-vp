// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type EnterpriseSegmentedNavItem,
  renderEnterpriseSegmentedNav,
} from "./enterprise-segmented-nav.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

const items: EnterpriseSegmentedNavItem[] = [
  { id: "governance", label: "组织治理", hint: "运行与治理", active: true },
  { id: "structure", label: "组织架构", hint: "目录树", active: false },
];

describe("renderEnterpriseSegmentedNav", () => {
  it("marks the active item with aria-selected=true and .is-active", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderEnterpriseSegmentedNav(items, () => undefined),
      container,
    );

    const tabs = container.querySelectorAll<HTMLButtonElement>(".enterprise-segmented-nav__tab");
    expect(tabs).toHaveLength(2);

    const [activeTab, inactiveTab] = tabs;
    expect(activeTab.getAttribute("aria-selected")).toBe("true");
    expect(activeTab.classList.contains("is-active")).toBe(true);

    expect(inactiveTab.getAttribute("aria-selected")).toBe("false");
    expect(inactiveTab.classList.contains("is-active")).toBe(false);
  });

  it("renders a tablist container with role=tab items and title hints", () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderEnterpriseSegmentedNav(items, () => undefined),
      container,
    );

    expect(container.querySelector(".enterprise-segmented-nav")?.getAttribute("role")).toBe(
      "tablist",
    );
    const tabs = container.querySelectorAll<HTMLButtonElement>(".enterprise-segmented-nav__tab");
    expect(tabs[0]?.getAttribute("role")).toBe("tab");
    expect(tabs[0]?.getAttribute("title")).toBe("运行与治理");
  });

  it("calls onSelect with the item id when a tab is clicked", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onSelect = vi.fn();
    render(renderEnterpriseSegmentedNav(items, onSelect), container);

    const tabs = container.querySelectorAll<HTMLButtonElement>(".enterprise-segmented-nav__tab");
    tabs[1]?.click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("structure");
  });
});
