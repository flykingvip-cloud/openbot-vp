import { describe, expect, it } from "vitest";
import {
  assertCommercialSeatProfileAligned,
  resolveSeatEntitlementProfileForSeat,
} from "./resolve-seat-entitlement-profile-for-seat.js";

describe("assertCommercialSeatProfileAligned", () => {
  it("passes when either side is missing", () => {
    expect(assertCommercialSeatProfileAligned(undefined, "pro_ai")).toBe(true);
    expect(assertCommercialSeatProfileAligned("pro_ai", undefined)).toBe(true);
  });

  it("passes when profile ids match", () => {
    expect(assertCommercialSeatProfileAligned("pro_ai", "pro_ai")).toBe(true);
  });

  it("fails when profile ids differ", () => {
    expect(assertCommercialSeatProfileAligned("basic_ai", "elite_ai")).toBe(false);
  });
});

describe("resolveSeatEntitlementProfileForSeat", () => {
  it("returns null for empty seat id", async () => {
    await expect(
      resolveSeatEntitlementProfileForSeat({ tenantId: "ent-1", seatId: "  " }),
    ).resolves.toBeNull();
  });
});
