import { afterEach, describe, expect, it } from "vitest";
// Load the embed stylesheet under test (vite injects it as a <style>).
import "./employee-embed.css";

const GRID_CLASS = "employee-workbench__signals-grid";

function mountGrid(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = `<div class="${GRID_CLASS}"><article class="employee-workbench__signal-card"></article></div>`;
  document.body.appendChild(host);
  return host.querySelector(`.${GRID_CLASS}`) as HTMLElement;
}

afterEach(() => {
  document.documentElement.classList.remove("employee-embed", "employee-embed--mobile");
  document.body.innerHTML = "";
});

describe("employee-embed: daily-overview cards (phone-scoped)", () => {
  it("hides the signals grid on the PHONE embed (employee-embed--mobile)", () => {
    document.documentElement.classList.add("employee-embed", "employee-embed--mobile");
    const grid = mountGrid();
    expect(getComputedStyle(grid).display).toBe("none");
  });

  it("keeps the grid on the macOS embed (employee-embed without --mobile) — full parity", () => {
    document.documentElement.classList.add("employee-embed");
    const grid = mountGrid();
    expect(getComputedStyle(grid).display).not.toBe("none");
  });

  it("does not affect non-embed (web)", () => {
    const grid = mountGrid(); // no embed classes on the root
    expect(getComputedStyle(grid).display).not.toBe("none");
  });
});
