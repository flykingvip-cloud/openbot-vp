// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  estimateCreditReservation,
  paygOveragePreflightAllowed,
} from "./estimate-credit-reservation.js";

describe("estimate credit reservation + PAYG preflight", () => {
  it("returns zero hold for enterprise_budget mode", async () => {
    const result = await estimateCreditReservation({
      enterpriseId: "ent",
      billingMode: "enterprise_budget",
      entitlement: {
        monthlyCredits: 100,
        overagePolicy: { type: "block", allowBurstConcurrency: false },
      },
    });
    expect(result.reservedCredits).toBe(0);
    expect(result.source).toBe("none");
  });

  it("requires at least min unit in credits mode", async () => {
    const result = await estimateCreditReservation({
      enterpriseId: "ent",
      billingMode: "credits",
      entitlement: {
        monthlyCredits: 100,
        overagePolicy: { type: "block", allowBurstConcurrency: false },
      },
    });
    expect(result.reservedCredits).toBeGreaterThanOrEqual(1);
    expect(result.source).toBe("meter_min_unit");
  });

  it("blocks PAYG without meter allowOverage or price", () => {
    expect(
      paygOveragePreflightAllowed({
        overagePolicyType: "pay_as_you_go",
        meterAllowOverage: false,
        extraUnitPriceCents: 10,
      }).allowed,
    ).toBe(false);
    expect(
      paygOveragePreflightAllowed({
        overagePolicyType: "pay_as_you_go",
        meterAllowOverage: true,
        extraUnitPriceCents: 0,
      }).allowed,
    ).toBe(false);
    expect(
      paygOveragePreflightAllowed({
        overagePolicyType: "pay_as_you_go",
        meterAllowOverage: true,
        extraUnitPriceCents: 12,
      }).allowed,
    ).toBe(true);
  });
});
