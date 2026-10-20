import { describe, expect, it } from "vitest";
import { diagnosisViewModelFromQuery } from "./diagnosis-view-model.ts";

describe("diagnosis view model", () => {
  it("maps forbidden query to forbidden state", () => {
    const model = diagnosisViewModelFromQuery(
      {
        role: "enterprise",
        trusted: { tenantId: "tenant-a" },
        principal: {
          schemaVersion: 1,
          principalId: "user-a",
          kind: "user",
          tenantId: "tenant-a",
        },
        redactionProfile: "administrator",
      },
      {
        schemaVersion: 1,
        authorization: { outcome: "deny", reason: "forbidden" },
        items: [],
        nextCursor: null,
        redactionProfile: "administrator",
        audit: { decision: "deny", denyReason: "forbidden" },
      },
      null,
    );
    expect(model.permissionState).toBe("forbidden");
    expect(model.production?.apiLoadState).toBe("forbidden");
  });

  it("maps empty query to empty health tone", () => {
    const model = diagnosisViewModelFromQuery(
      {
        role: "platform",
        trusted: { tenantId: null },
        principal: {
          schemaVersion: 1,
          principalId: "platform-admin",
          kind: "user",
          tenantId: null,
        },
        redactionProfile: "administrator",
      },
      {
        schemaVersion: 1,
        authorization: { outcome: "allow", reason: "authorized" },
        items: [],
        nextCursor: null,
        redactionProfile: "administrator",
        audit: { decision: "allow" },
      },
      null,
    );
    expect(model.health.tone).toBe("empty");
    expect(model.production?.freshness.completeness).toBe("empty");
  });
});
