// @vitest-environment node

import { describe, expect, it } from "vitest";
import { resolveSeatConcurrencyCap } from "./resolve-seat-concurrency-cap.js";

describe("resolveSeatConcurrencyCap", () => {
  it("takes min of tenant and seat profile maxConcurrentRuns", async () => {
    const cap = await resolveSeatConcurrencyCap({
      enterpriseId: "ent-1",
      seat: {
        id: "seat-1",
        enterpriseId: "ent-1",
        userId: "u1",
        currentRole: "viewer",
        botQuota: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      tenantMaxConcurrentRuns: 4,
    });
    expect(cap.profileId).toBe("basic_ai");
    expect(cap.seatMaxConcurrentRuns).toBe(1);
    expect(cap.effectiveMaxConcurrentRuns).toBe(1);
  });

  it("uses tenant cap when seat profile allows more", async () => {
    const cap = await resolveSeatConcurrencyCap({
      enterpriseId: "ent-1",
      seat: {
        id: "seat-2",
        enterpriseId: "ent-1",
        userId: "u2",
        currentRole: "admin",
        botQuota: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      tenantMaxConcurrentRuns: 2,
    });
    expect(cap.profileId).toBe("elite_ai");
    expect(cap.seatMaxConcurrentRuns).toBe(4);
    expect(cap.effectiveMaxConcurrentRuns).toBe(2);
  });
});
