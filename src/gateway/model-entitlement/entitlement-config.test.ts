// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveModelEntitlementRoutingMode } from "./entitlement-config.js";

function cfgWithRoutingMode(mode: string): OpenBotConfig {
  return {
    gateway: { platform: { models: { entitlement: { routingMode: mode } } } },
  } as unknown as OpenBotConfig;
}

describe("resolveModelEntitlementRoutingMode (Phase 3 default = tier)", () => {
  it("defaults to tier when unset (Tier is the runtime source of truth)", () => {
    expect(resolveModelEntitlementRoutingMode(undefined)).toBe("tier");
    expect(resolveModelEntitlementRoutingMode({} as OpenBotConfig)).toBe("tier");
  });

  it("honors the explicit legacy escape hatch", () => {
    expect(resolveModelEntitlementRoutingMode(cfgWithRoutingMode("legacy"))).toBe("legacy");
  });

  it("honors an explicit tier setting", () => {
    expect(resolveModelEntitlementRoutingMode(cfgWithRoutingMode("tier"))).toBe("tier");
  });

  it("falls back to tier for an unrecognized value", () => {
    expect(resolveModelEntitlementRoutingMode(cfgWithRoutingMode("bogus"))).toBe("tier");
  });
});
