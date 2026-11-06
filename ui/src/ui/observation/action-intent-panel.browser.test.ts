import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { ActionIntent } from "../../../../src/observation/action-intent.js";
import { renderActionIntent } from "./action-intent-panel.ts";
describe("readonly action intent panel", () => {
  it("never claims verification without evidence or offers actions", () => {
    const container = document.createElement("div");
    render(renderActionIntent(null, 50), container);
    expect(container.textContent).toContain("状态未核验");
    expect(container.querySelectorAll("button,input,form,a")).toHaveLength(0);
    const invalid = {
      schemaVersion: 1,
      state: "verified",
      approval: null,
    } as unknown as ActionIntent;
    render(renderActionIntent(invalid, 50), container);
    expect(container.textContent).toContain("approval_mismatch");
  });
});
