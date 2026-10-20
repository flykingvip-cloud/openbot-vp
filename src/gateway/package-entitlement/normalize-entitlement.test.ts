// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERAGE_POLICY,
  defaultMaxConcurrentRuns,
  normalizeEntitlementSnapshot,
} from "./normalize-entitlement.js";
import type { EntitlementSnapshot } from "./types.js";

describe("normalizeEntitlementSnapshot", () => {
  it("fills defaults for legacy snapshots", () => {
    const legacy = {
      planVersionId: "pv-1",
      monthlyPriceCents: 9900,
      monthlyCredits: 5000,
      maxSeats: {},
      maxBots: 10,
      maxConcurrentRuns: 0,
      allowedPolicies: [],
      allowedTiers: [],
      overagePolicy: DEFAULT_OVERAGE_POLICY,
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as EntitlementSnapshot;
    const normalized = normalizeEntitlementSnapshot(legacy);
    expect(normalized.maxConcurrentRuns).toBe(defaultMaxConcurrentRuns(10));
    expect(normalized.overagePolicy).toEqual(DEFAULT_OVERAGE_POLICY);
  });
});
