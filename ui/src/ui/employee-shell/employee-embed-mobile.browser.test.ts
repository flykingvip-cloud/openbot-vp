import { page } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Load the real workbench + embed stylesheets under test (vite injects them as
// <style> tags). Order matters: workbench.css first (base layout), then the
// embed overrides so the phone-scoped rules win on equal specificity.
import "../../styles/workbench.css";
import "./employee-embed.css";

/**
 * Task 1.1 — mobile employee shell (overview / me) viewport regression (R5.5).
 *
 * Renders the real workbench DOM structure inside the phone embed scope
 * (`employee-embed` + `employee-embed--mobile`) at the two supported phone
 * viewports and asserts the acceptance criteria:
 *   - no horizontal overflow (scrollWidth <= clientWidth),
 *   - key regions collapse to a single column,
 *   - touch targets are >= 44px.
 *
 * These run in real chromium (vitest browser mode) so layout/geometry and media
 * queries (<=430 / <=380) are exercised for real, not in jsdom.
 */

const PHONE_VIEWPORTS = [
  { name: "iPhone-ish 390x844", width: 390, height: 844 },
  { name: "small Android 360x800", width: 360, height: 800 },
] as const;

function mountOverview(height: number): HTMLElement {
  const root = document.createElement("div");
  root.style.width = "100%";
  root.style.height = `${height}px`;
  root.innerHTML = `
    <div class="employee-workbench" style="height:100%">
      <aside class="employee-workbench__sidebar">nav</aside>
      <main class="employee-workbench__main">
        <header class="employee-workbench__header"><h1>今日概览</h1></header>
        <div class="employee-workbench__signals-grid">
          <article class="employee-workbench__signal-card">日程管理</article>
          <article class="employee-workbench__signal-card">待办任务</article>
          <article class="employee-workbench__signal-card">即将协作</article>
          <article class="employee-workbench__signal-card">公告</article>
        </div>
      </main>
    </div>`;
  document.body.appendChild(root);
  return root;
}

function mountMe(height: number): HTMLElement {
  const root = document.createElement("div");
  root.style.width = "100%";
  root.style.height = `${height}px`;
  root.innerHTML = `
    <div class="employee-workbench" style="height:100%">
      <aside class="employee-workbench__sidebar">nav</aside>
      <main class="employee-workbench__main">
        <div class="employee-workbench__personal-settings-shell">
          <div class="employee-workbench__personal-settings-rail">
            <button class="employee-workbench__settings-tab is-active" type="button">个人资料</button>
            <button class="employee-workbench__settings-tab" type="button">安全</button>
          </div>
          <div class="employee-workbench__personal-settings-main">
            <div class="employee-workbench__settings-form-grid">
              <label class="employee-workbench__settings-field">姓名<input value="示例" /></label>
              <label class="employee-workbench__settings-field">邮箱<input value="a@b.co" /></label>
            </div>
          </div>
        </div>
      </main>
    </div>`;
  document.body.appendChild(root);
  return root;
}

/** Number of resolved column tracks in a computed `grid-template-columns`. */
function columnTrackCount(el: Element): number {
  const value = getComputedStyle(el).gridTemplateColumns;
  if (!value || value === "none") {
    return 0;
  }
  return value.split(/\s+/).filter(Boolean).length;
}

function hasNoHorizontalOverflow(): boolean {
  const doc = document.documentElement;
  return doc.scrollWidth <= doc.clientWidth;
}

beforeEach(() => {
  document.documentElement.classList.add("employee-embed", "employee-embed--mobile");
  // Neutralize the default UA body margin so it can't manufacture overflow.
  document.body.style.margin = "0";
});

afterEach(() => {
  document.documentElement.classList.remove("employee-embed", "employee-embed--mobile");
  document.body.innerHTML = "";
  document.body.style.margin = "";
});

for (const vp of PHONE_VIEWPORTS) {
  describe(`phone embed @ ${vp.name}`, () => {
    it("overview: no horizontal overflow and main uses the full width (single column)", async () => {
      await page.viewport(vp.width, vp.height);
      const root = mountOverview(vp.height);

      expect(hasNoHorizontalOverflow()).toBe(true);

      // The hidden sidebar must not leave an empty 232px grid track shoving the
      // main into a cramped ~158px column — main should span (almost) the full
      // viewport width once the embed collapses to a single column.
      const main = root.querySelector(".employee-workbench__main") as HTMLElement;
      expect(main.getBoundingClientRect().width).toBeGreaterThan(vp.width * 0.8);

      // Phone trim: the four-card overview grid is hidden on the phone shell.
      const grid = root.querySelector(".employee-workbench__signals-grid") as HTMLElement;
      expect(getComputedStyle(grid).display).toBe("none");
    });

    it("me: single-column settings, >=44px touch targets, no horizontal overflow", async () => {
      await page.viewport(vp.width, vp.height);
      const root = mountMe(vp.height);

      expect(hasNoHorizontalOverflow()).toBe(true);

      // Settings form collapses from its 2-column desktop grid to a single
      // column on the phone.
      const formGrid = root.querySelector(".employee-workbench__settings-form-grid") as HTMLElement;
      expect(columnTrackCount(formGrid)).toBe(1);

      // Touch targets: settings tabs are >=44px tall on the phone (base is 40px).
      const tab = root.querySelector(".employee-workbench__settings-tab") as HTMLElement;
      expect(tab.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    });
  });
}
