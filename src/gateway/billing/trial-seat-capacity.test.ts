import { describe, expect, it } from "vitest";
import {
  isTrialEnterprise,
  overlayTrialMaxSeats,
  trialSeatQuotaFromEnterprise,
} from "./trial-seat-capacity.js";

describe("trialSeatCapacity", () => {
  it("treats trial status, trialing billing, or trial plan as trial tenants", () => {
    expect(isTrialEnterprise({ status: "trial", plan: "trial", billingStatus: "trialing" })).toBe(
      true,
    );
    expect(isTrialEnterprise({ status: "paid", plan: "business", billingStatus: "active" })).toBe(
      false,
    );
    expect(isTrialEnterprise({ status: "paid", plan: "trial", billingStatus: "active" })).toBe(
      true,
    );
  });

  it("uses enterprise.seatQuota as the trial capacity source of truth", () => {
    expect(trialSeatQuotaFromEnterprise({ seatQuota: 500, trialSeatQuotaSnapshot: 5 })).toBe(500);
    expect(trialSeatQuotaFromEnterprise({ seatQuota: 0, trialSeatQuotaSnapshot: 10 })).toBe(10);
    expect(trialSeatQuotaFromEnterprise({ seatQuota: 0 })).toBe(5);
  });

  it("overlays catalog maxSeats with the tenant trial quota", () => {
    expect(overlayTrialMaxSeats({ maxSeats: { viewer: 1, creator: 2 } }, 500).maxSeats).toEqual({
      viewer: 500,
    });
    expect(overlayTrialMaxSeats({ maxSeats: { viewer: 1 } }, null).maxSeats).toEqual({
      viewer: 1,
    });
  });
});
