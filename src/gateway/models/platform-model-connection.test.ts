import { describe, expect, it } from "vitest";
import { computeEffectiveModelSet } from "../model-entitlement/effective-set.js";
import {
  isPlatformModelConnectionSuccessful,
  partitionPlatformModelIds,
  retainPlatformPoolMembers,
} from "./platform-model-connection.js";

describe("isPlatformModelConnectionSuccessful", () => {
  it("treats a non-ok probe as disconnected even when the model is listed", () => {
    expect(
      isPlatformModelConnectionSuccessful({
        probeStatus: "auth",
        inGatewayCatalog: true,
        explicitlyConfigured: true,
      }),
    ).toBe(false);
    expect(
      isPlatformModelConnectionSuccessful({
        probeStatus: "ok",
        inGatewayCatalog: false,
        explicitlyConfigured: true,
      }),
    ).toBe(true);
  });

  it("does not treat an explicit config or a model list alone as connected", () => {
    expect(
      isPlatformModelConnectionSuccessful({
        probeStatus: null,
        inGatewayCatalog: true,
        explicitlyConfigured: true,
      }),
    ).toBe(false);
    expect(
      isPlatformModelConnectionSuccessful({
        probeStatus: null,
        inGatewayCatalog: true,
        explicitlyConfigured: false,
      }),
    ).toBe(true);
  });
});

describe("retainPlatformPoolMembers", () => {
  it("drops a connected id that is no longer in the platform pool", () => {
    const visible = retainPlatformPoolMembers(
      new Set(["removed/ghost", "provider/vision", "provider/offline"]),
      new Set(["provider/vision"]),
    );
    expect([...visible]).toEqual(["provider/vision"]);
  });
});

describe("partitionPlatformModelIds", () => {
  it("keeps enterprise-supplied ids and connected platform ids", () => {
    const parts = partitionPlatformModelIds(
      ["configured/offline", "configured/online", "ent/private/m"],
      new Set(["configured/online"]),
    );
    expect(parts.visible).toEqual(["configured/online", "ent/private/m"]);
    expect(parts.suppressed).toEqual(["configured/offline"]);
  });
});

describe("computeEffectiveModelSet connection filter", () => {
  it("drops platform models that are granted but not connected", () => {
    const result = computeEffectiveModelSet({
      entitlement: {
        tenantId: "t1",
        allowedModelIds: ["configured/offline", "configured/online"],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      grant: {
        tenantId: "t1",
        subjectType: "seat",
        subjectId: "seat-1",
        seatId: "seat-1",
        grantedModelIds: ["configured/offline", "configured/online", "ent/private/m"],
        status: "active",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      catalogActiveModelIds: ["configured/offline", "configured/online"],
      tenantOwnedActiveModelIds: ["ent/private/m"],
      platformConnectedModelIds: ["configured/online"],
    });
    expect(result.allowedModelIds).toEqual(["configured/online", "ent/private/m"]);
  });
});
