import { describe, expect, it } from "vitest";
import { UserLearnedPreferencesPanel } from "./user-learned-preferences-panel.ts";

describe("UserLearnedPreferencesPanel", () => {
  it("registers custom element", () => {
    expect(customElements.get("user-learned-preferences-panel")).toBe(UserLearnedPreferencesPanel);
  });
});
