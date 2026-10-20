import { describe, expect, it } from "vitest";
import { renderUserProfileInstructions } from "./render.js";
import { DEFAULT_USER_PROFILE } from "./types.js";

describe("renderUserProfileInstructions confirmation", () => {
  const proactive = {
    ...DEFAULT_USER_PROFILE,
    confirmationPreference: "proactive" as const,
  };

  it("does not inject avoid-confirmation copy when enterprise ask is not off", () => {
    for (const execAsk of ["on-miss", "always"] as const) {
      const text = renderUserProfileInstructions(proactive, { execAsk });
      expect(text).not.toMatch(/avoid unnecessary confirmation/i);
      expect(text).toMatch(/still obey the current approval policy/i);
    }
  });

  it("treats a missing ask as the on-miss default and still requires approvals", () => {
    const text = renderUserProfileInstructions(proactive);
    expect(text).not.toMatch(/avoid unnecessary confirmation/i);
    expect(text).toMatch(/still obey the current approval policy/i);
  });

  it("keeps the proactive sentence only when enterprise ask is off", () => {
    const text = renderUserProfileInstructions(proactive, { execAsk: "off" });
    expect(text).toMatch(/avoid unnecessary confirmation/i);
    expect(text).not.toMatch(/still obey the current approval policy/i);
  });
});
