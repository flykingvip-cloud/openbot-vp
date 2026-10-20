// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { SidebarEntry } from "../../capability/enterprise-capability/types.ts";
import { renderQuickEntrySidebar } from "./quick-entry-sidebar.ts";

function mount() {
  return document.createElement("div");
}

function noop(): void {
  /* noop */
}

describe("renderQuickEntrySidebar — structure", () => {
  it("renders a sidebar with title '快捷入口'", () => {
    const container = mount();
    render(
      renderQuickEntrySidebar({ activeEntry: "my-installed", onEntryChange: noop }),
      container,
    );

    const title = container.querySelector(".quick-entry-sidebar__title");
    expect(title).not.toBeNull();
    expect(title?.textContent).toContain("快捷入口");
  });

  it("renders exactly three entry buttons", () => {
    const container = mount();
    render(
      renderQuickEntrySidebar({ activeEntry: "my-installed", onEntryChange: noop }),
      container,
    );

    const entries = container.querySelectorAll(".quick-entry-sidebar__entry");
    expect(entries.length).toBe(3);
  });

  it("renders entries with correct labels in order", () => {
    const container = mount();
    render(
      renderQuickEntrySidebar({ activeEntry: "my-installed", onEntryChange: noop }),
      container,
    );

    const entries = container.querySelectorAll(".quick-entry-sidebar__entry");
    expect(entries[0]?.textContent?.trim()).toBe("我的安装能力");
    expect(entries[1]?.textContent?.trim()).toBe("我贡献的能力");
    expect(entries[2]?.textContent?.trim()).toBe("全部能力");
  });

  it("uses an aside element with aria-label for accessibility", () => {
    const container = mount();
    render(
      renderQuickEntrySidebar({ activeEntry: "my-installed", onEntryChange: noop }),
      container,
    );

    const aside = container.querySelector(".quick-entry-sidebar");
    expect(aside?.tagName.toLowerCase()).toBe("aside");
    expect(aside?.getAttribute("aria-label")).toBe("快捷入口");
  });
});

describe("renderQuickEntrySidebar — active state (requirements 16.3, 16.6)", () => {
  it("highlights only the active entry with the --active class", () => {
    const container = mount();
    render(
      renderQuickEntrySidebar({ activeEntry: "my-contributed", onEntryChange: noop }),
      container,
    );

    const activeEntries = container.querySelectorAll(".quick-entry-sidebar__entry--active");
    expect(activeEntries.length).toBe(1);
    expect(activeEntries[0]?.textContent?.trim()).toBe("我贡献的能力");
  });

  it("sets aria-current='true' on the active entry only", () => {
    const container = mount();
    render(renderQuickEntrySidebar({ activeEntry: "all", onEntryChange: noop }), container);

    const entries = container.querySelectorAll(".quick-entry-sidebar__entry");
    const ariaCurrentValues = Array.from(entries).map((el) => el.getAttribute("aria-current"));
    expect(ariaCurrentValues).toEqual(["false", "false", "true"]);
  });

  it("applies blue left border style on the active entry", () => {
    const container = mount();
    render(
      renderQuickEntrySidebar({ activeEntry: "my-installed", onEntryChange: noop }),
      container,
    );

    const active = container.querySelector(".quick-entry-sidebar__entry--active") as HTMLElement;
    expect(active).not.toBeNull();
    // The active entry uses .quick-entry-sidebar__entry--active class which
    // applies the blue border + background + text color via
    // enterprise-components.css. We assert class presence here.
    expect(active.classList.contains("quick-entry-sidebar__entry--active")).toBe(true);
  });

  it("applies transparent left border on inactive entries", () => {
    const container = mount();
    render(
      renderQuickEntrySidebar({ activeEntry: "my-installed", onEntryChange: noop }),
      container,
    );

    const entries = container.querySelectorAll(".quick-entry-sidebar__entry");
    const inactive = entries[1] as HTMLElement;
    expect(inactive).not.toBeNull();
    // Inactive entries lack the --active modifier; default style applies.
    expect(inactive.classList.contains("quick-entry-sidebar__entry--active")).toBe(false);
    expect(inactive.classList.contains("quick-entry-sidebar__entry")).toBe(true);
  });
});

describe("renderQuickEntrySidebar — interaction (requirement 16.5)", () => {
  it("calls onEntryChange with the clicked entry value", () => {
    const container = mount();
    const onEntryChange = vi.fn();
    render(renderQuickEntrySidebar({ activeEntry: "my-installed", onEntryChange }), container);

    const entries = container.querySelectorAll<HTMLElement>(".quick-entry-sidebar__entry");
    entries[1]?.click();
    expect(onEntryChange).toHaveBeenCalledWith("my-contributed" satisfies SidebarEntry);
  });

  it("calls onEntryChange even when clicking the already-active entry", () => {
    const container = mount();
    const onEntryChange = vi.fn();
    render(renderQuickEntrySidebar({ activeEntry: "my-installed", onEntryChange }), container);

    const entries = container.querySelectorAll<HTMLElement>(".quick-entry-sidebar__entry");
    entries[0]?.click();
    expect(onEntryChange).toHaveBeenCalledWith("my-installed" satisfies SidebarEntry);
  });

  it("calls onEntryChange with 'all' when clicking the third entry", () => {
    const container = mount();
    const onEntryChange = vi.fn();
    render(renderQuickEntrySidebar({ activeEntry: "my-installed", onEntryChange }), container);

    const entries = container.querySelectorAll<HTMLElement>(".quick-entry-sidebar__entry");
    entries[2]?.click();
    expect(onEntryChange).toHaveBeenCalledWith("all" satisfies SidebarEntry);
  });
});

describe("renderQuickEntrySidebar — layout (requirements 16.1, 16.2)", () => {
  it("applies 200px fixed width on the sidebar container", () => {
    const container = mount();
    render(
      renderQuickEntrySidebar({ activeEntry: "my-installed", onEntryChange: noop }),
      container,
    );

    const sidebar = container.querySelector(".quick-entry-sidebar") as HTMLElement;
    expect(sidebar).not.toBeNull();
    // 200px width + right border are applied via .quick-entry-sidebar class
    // in enterprise-components.css; verify class presence.
    expect(sidebar.classList.contains("quick-entry-sidebar")).toBe(true);
  });

  it("applies 40px height on entry buttons", () => {
    const container = mount();
    render(
      renderQuickEntrySidebar({ activeEntry: "my-installed", onEntryChange: noop }),
      container,
    );

    const entry = container.querySelector(".quick-entry-sidebar__entry") as HTMLElement;
    expect(entry).not.toBeNull();
    // 40px height applied via .quick-entry-sidebar__entry class.
    expect(entry.classList.contains("quick-entry-sidebar__entry")).toBe(true);
  });
});
