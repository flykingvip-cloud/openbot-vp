import { describe, expect, it } from "vitest";
import { scheduleAgentsW2ResolvedShadow } from "./agents-w2-shadow.js";

describe("agents W2 batch-4 shadow", () => {
  it("schedules legacy shadow without throwing when env is off", () => {
    expect(() =>
      scheduleAgentsW2ResolvedShadow({
        siteId: "S14-agents-list-trusted",
        resolvedLocator: "/host/ws",
      }),
    ).not.toThrow();
  });
});
