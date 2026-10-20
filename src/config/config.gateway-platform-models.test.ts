import { describe, expect, it } from "vitest";
import { validateConfigObject } from "./config.js";

describe("gateway.platform.models schema (model-entitlement-chain)", () => {
  it("accepts entitlement.enforce enum values", () => {
    for (const enforce of ["off", "missing-allow", "strict"] as const) {
      const res = validateConfigObject({
        gateway: { platform: { models: { entitlement: { enforce } } } },
      });
      expect(res.ok, enforce).toBe(true);
    }
  });

  it("accepts the full platform.models shape (mode + aor + entitlement)", () => {
    const res = validateConfigObject({
      gateway: {
        platform: {
          models: {
            mode: "aor_enhanced",
            aor: { gatewayUrl: "http://127.0.0.1:18789", enableBandit: false },
            entitlement: { enforce: "missing-allow" },
            credentials: { mode: "catalog" },
          },
        },
      },
    });
    expect(res.ok).toBe(true);
  });

  it("accepts credentials.mode enum values (P4)", () => {
    for (const mode of ["legacy", "catalog"] as const) {
      const res = validateConfigObject({
        gateway: { platform: { models: { credentials: { mode } } } },
      });
      expect(res.ok, mode).toBe(true);
    }
  });

  it("rejects an invalid credentials.mode", () => {
    const res = validateConfigObject({
      gateway: { platform: { models: { credentials: { mode: "nope" } } } },
    });
    expect(res.ok).toBe(false);
  });

  it("rejects an invalid enforce value", () => {
    const res = validateConfigObject({
      gateway: { platform: { models: { entitlement: { enforce: "nope" } } } },
    });
    expect(res.ok).toBe(false);
  });

  it("rejects unknown keys under platform.models (strict)", () => {
    const res = validateConfigObject({
      gateway: { platform: { models: { bogus: true } } },
    });
    expect(res.ok).toBe(false);
  });
});
