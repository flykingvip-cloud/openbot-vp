import { describe, expect, it } from "vitest";
import { resolveTenantCapabilities } from "./resolve-tenant-capabilities.js";

describe("resolveTenantCapabilities", () => {
  it("returns aor=true when platform models mode is aor_enhanced", () => {
    expect(
      resolveTenantCapabilities({
        gateway: { platform: { models: { mode: "aor_enhanced" } } },
      } as never),
    ).toEqual({ aor: true });
  });

  it("returns aor=false for native mode", () => {
    expect(
      resolveTenantCapabilities({
        gateway: { platform: { models: { mode: "native" } } },
      } as never),
    ).toEqual({ aor: false });
  });
});
