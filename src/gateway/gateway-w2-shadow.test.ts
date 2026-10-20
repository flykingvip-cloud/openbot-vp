import { describe, expect, it } from "vitest";
import { scheduleGatewayW2ResolvedShadow } from "./gateway-w2-shadow.js";

describe("gateway W2 batch-6 shadow", () => {
  it("schedules without throwing when env is off", () => {
    expect(() =>
      scheduleGatewayW2ResolvedShadow({
        siteId: "S20-tools-catalog-workspace",
        resolvedLocator: "/host/ws",
      }),
    ).not.toThrow();
  });
});
