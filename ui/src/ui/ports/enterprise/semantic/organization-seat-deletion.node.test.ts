import { describe, expect, it } from "vitest";
import {
  isArchivePersonAndSeatDeleteVisible,
  isOrganizationSeatDeletable,
  partitionOrganizationSeatDeletionSelection,
  resolveOrganizationSeatDeleteEligibility,
} from "./organization-seat-deletion.ts";

describe("organization-seat-deletion", () => {
  it("allows vacant shell without member/offer/handover", () => {
    const eligibility = resolveOrganizationSeatDeleteEligibility({
      seatId: "s1",
      name: "空岗",
      teamLabel: "销售部",
      status: "VACANT",
      seatStatus: "vacant",
    });
    expect(eligibility.allowed).toBe(true);
    expect(
      isOrganizationSeatDeletable({
        seatId: "s1",
        name: "空岗",
        teamLabel: "销售部",
        status: "VACANT",
        seatStatus: "vacant",
      }),
    ).toBe(true);
  });

  it("blocks occupied seats with unbind guidance", () => {
    const eligibility = resolveOrganizationSeatDeleteEligibility({
      seatId: "s2",
      name: "市场专员",
      teamLabel: "市场部",
      status: "NORMAL",
      seatStatus: "occupied",
      memberUserId: "polo@example.com",
    });
    expect(eligibility.allowed).toBe(false);
    expect(eligibility.nextStep).toBe("unbind_or_handover");
    expect(eligibility.reason).toMatch(/空岗/);
  });

  it("allows pending-activation seats without a registered member", () => {
    const eligibility = resolveOrganizationSeatDeleteEligibility({
      seatId: "s3",
      name: "待激活岗",
      teamLabel: "市场部",
      status: "PENDING_ACTIVATION",
      seatStatus: "assigned",
      // UI rows often mirror pending email into memberUserId for display.
      memberUserId: "hire@example.com",
      pendingEmployeeUser: "hire@example.com",
    });
    expect(eligibility.allowed).toBe(true);
    expect(eligibility.nextStep).toBe("none");
  });

  it("blocks pending offer and active handover", () => {
    expect(
      resolveOrganizationSeatDeleteEligibility({
        seatId: "s4",
        name: "待确认",
        teamLabel: "市场部",
        status: "PENDING_CONFIRM",
        seatStatus: "assigned",
        offer: { offerId: "o1" },
      }).nextStep,
    ).toBe("resolve_offer");
    expect(
      resolveOrganizationSeatDeleteEligibility({
        seatId: "s5",
        name: "交接中",
        teamLabel: "市场部",
        status: "HANDOVER",
        seatStatus: "occupied",
        memberUserId: "leaving@example.com",
        handover: { handoverCaseId: "h1" },
      }).nextStep,
    ).toBe("wait_handover");
  });

  it("partitions bulk selection into deletable vs blocked", () => {
    const result = partitionOrganizationSeatDeletionSelection({
      rows: [
        {
          seatId: "vacant",
          name: "空",
          teamLabel: "A",
          status: "VACANT",
          seatStatus: "vacant",
        },
        {
          seatId: "pending",
          name: "待激活",
          teamLabel: "A",
          status: "PENDING_ACTIVATION",
          seatStatus: "assigned",
          memberUserId: "hire@example.com",
          pendingEmployeeUser: "hire@example.com",
        },
        {
          seatId: "busy",
          name: "在岗",
          teamLabel: "A",
          status: "NORMAL",
          seatStatus: "occupied",
          memberUserId: "u1",
        },
      ],
      selectedSeatIds: ["vacant", "pending", "busy", "missing"],
    });
    expect(result.deletable.map((row) => row.seatId)).toEqual(["vacant", "pending"]);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]?.row.seatId).toBe("busy");
    expect(result.missingSeatIds).toEqual(["missing"]);
  });

  it("shows 人岗同删 for a bound member or open handover, not a vacant shell", () => {
    expect(
      isArchivePersonAndSeatDeleteVisible({
        seatId: "s1",
        name: "空岗",
        teamLabel: "销售部",
        status: "VACANT",
        seatStatus: "vacant",
      }),
    ).toBe(false);
    expect(
      isArchivePersonAndSeatDeleteVisible({
        seatId: "s2",
        name: "待激活",
        teamLabel: "销售部",
        status: "PENDING_ACTIVATION",
        seatStatus: "assigned",
        memberUserId: "hire@example.com",
        pendingEmployeeUser: "hire@example.com",
      }),
    ).toBe(false);
    expect(
      isArchivePersonAndSeatDeleteVisible({
        seatId: "s3",
        name: "在岗",
        teamLabel: "销售部",
        status: "NORMAL",
        seatStatus: "occupied",
        memberUserId: "user-1",
      }),
    ).toBe(true);
    expect(
      isArchivePersonAndSeatDeleteVisible({
        seatId: "s4",
        name: "交接",
        teamLabel: "销售部",
        status: "HANDOVER",
        seatStatus: "handover_pending",
        handover: { handoverCaseId: "h1" },
      }),
    ).toBe(true);
  });
});
