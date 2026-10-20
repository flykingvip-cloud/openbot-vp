import { page, userEvent } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Load the real cascade under test: base.css carries the global
// `:focus-visible { outline:none }` reset, workbench.css the component styles,
// and employee-embed.css the embed a11y overrides (imported last so its focus
// ring wins). Order matters.
import "../../styles/base.css";
import "../../styles/workbench.css";
import "./employee-embed.css";

/**
 * Task 1.9 (embed side) — a11y core path assertions (R9 / wave1-status §3).
 *
 * Covers the web-ui deliverable for the "login -> overview -> me -> open session"
 * path on the phone embed:
 *   - keyboard focus is VISIBLE (WCAG 2.4.7) despite the global outline reset,
 *   - key controls are screen-reader reachable (native role + accessible name +
 *     keyboard focusable),
 *   - touch targets are >= 44px on the focused path.
 *
 * Runs in real chromium so `:focus-visible` (keyboard modality) and computed
 * geometry are exercised for real.
 */

const PHONE = { width: 390, height: 844 } as const;

function mountMe(height: number): HTMLElement {
  const root = document.createElement("div");
  root.style.width = "100%";
  root.style.height = `${height}px`;
  root.innerHTML = `
    <div class="employee-workbench" style="height:100%">
      <main class="employee-workbench__main">
        <div class="employee-workbench__personal-settings-shell">
          <div class="employee-workbench__personal-settings-rail">
            <button class="employee-workbench__settings-tab is-active" type="button">个人资料</button>
            <button class="employee-workbench__settings-tab" type="button">安全</button>
          </div>
          <div class="employee-workbench__personal-settings-main">
            <div class="employee-workbench__settings-form-grid">
              <label class="employee-workbench__settings-field">姓名<input type="text" value="示例" /></label>
              <label class="employee-workbench__settings-field">邮箱<input type="email" value="a@b.co" /></label>
            </div>
            <button class="employee-workbench__settings-save" type="button">保存更改</button>
          </div>
        </div>
      </main>
    </div>`;
  document.body.appendChild(root);
  return root;
}

/** True when the element paints a perceivable focus ring (outline or shadow). */
function hasVisibleFocusRing(el: Element): boolean {
  const style = getComputedStyle(el);
  const outlineWidth = Number.parseFloat(style.outlineWidth || "0");
  const hasOutline = style.outlineStyle !== "none" && outlineWidth > 0;
  const hasShadow = style.boxShadow !== "none" && style.boxShadow !== "";
  return hasOutline || hasShadow;
}

beforeEach(() => {
  document.documentElement.classList.add("employee-embed", "employee-embed--mobile");
  document.body.style.margin = "0";
});

afterEach(() => {
  document.documentElement.classList.remove("employee-embed", "employee-embed--mobile");
  document.body.innerHTML = "";
  document.body.style.margin = "";
});

describe("employee embed a11y core path (me surface @ 390x844)", () => {
  it("shows a visible keyboard-focus ring on the first control", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    const root = mountMe(PHONE.height);
    const firstTab = root.querySelector(".employee-workbench__settings-tab") as HTMLElement;

    // Keyboard-tab from the document body so focus arrives via the keyboard
    // modality that triggers `:focus-visible` (a pointer click would not).
    let focused: Element | null = null;
    for (let i = 0; i < 8; i += 1) {
      await userEvent.tab();
      focused = document.activeElement;
      if (focused && focused.classList.contains("employee-workbench__settings-tab")) {
        break;
      }
    }

    expect(focused).toBe(firstTab);
    expect(firstTab.matches(":focus-visible")).toBe(true);
    expect(hasVisibleFocusRing(firstTab)).toBe(true);
  });

  it("exposes key controls to screen readers (native role + accessible name + focusable)", () => {
    const root = mountMe(PHONE.height);

    // Tabs + save button are native <button>s (implicit role="button") with a
    // non-empty text label (their accessible name) and are keyboard focusable.
    const controls = [
      ...root.querySelectorAll<HTMLElement>(".employee-workbench__settings-tab"),
      root.querySelector<HTMLElement>(".employee-workbench__settings-save")!,
    ];
    for (const control of controls) {
      expect(control.tagName).toBe("BUTTON");
      expect((control.textContent ?? "").trim().length).toBeGreaterThan(0);
      control.focus();
      expect(document.activeElement).toBe(control);
    }

    // Form inputs derive an accessible name from their wrapping <label>.
    const inputs = root.querySelectorAll<HTMLInputElement>(
      ".employee-workbench__settings-field input",
    );
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      const label = input.closest("label");
      expect(label, "each input must sit inside a <label> for its accessible name").not.toBeNull();
      expect((label?.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps focused touch targets >= 44px on the path", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    const root = mountMe(PHONE.height);
    const tab = root.querySelector(".employee-workbench__settings-tab") as HTMLElement;
    expect(tab.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
});
