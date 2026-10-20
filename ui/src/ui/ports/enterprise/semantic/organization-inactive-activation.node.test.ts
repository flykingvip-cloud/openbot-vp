import { describe, expect, it } from "vitest";
import {
  isOrganizationInactiveStatus,
  organizationStatusMatchesInactiveFilter,
  partitionOrganizationActivationSelection,
} from "./organization-inactive-activation.ts";

describe("organization inactive activation helpers", () => {
  it("treats vacant and pending activation as inactive", () => {
    expect(isOrganizationInactiveStatus("VACANT")).toBe(true);
    expect(isOrganizationInactiveStatus("PENDING_ACTIVATION")).toBe(true);
    expect(isOrganizationInactiveStatus("NORMAL")).toBe(false);
    expect(organizationStatusMatchesInactiveFilter("VACANT")).toBe(true);
    expect(organizationStatusMatchesInactiveFilter(null)).toBe(false);
  });

  it("partitions emails to send and seats needing email", () => {
    const result = partitionOrganizationActivationSelection({
      selectedSeatIds: ["a", "b", "c", "d", "missing"],
      rows: [
        {
          seatId: "a",
          name: "岗岗",
          teamLabel: "销售部",
          status: "PENDING_ACTIVATION",
          pendingEmployeeUser: "a@example.com",
        },
        {
          seatId: "b",
          name: "空岗",
          teamLabel: "销售部",
          status: "VACANT",
          pendingEmployeeUser: null,
        },
        {
          seatId: "c",
          name: "重复邮箱",
          teamLabel: "销售部",
          status: "PENDING_ACTIVATION",
          pendingEmployeeUser: "A@example.com",
        },
        {
          seatId: "d",
          name: "正常",
          teamLabel: "销售部",
          status: "NORMAL",
          pendingEmployeeUser: null,
        },
      ],
    });
    expect(result.emailsToSend).toEqual(["a@example.com"]);
    expect(result.seatsNeedingEmail.map((row) => row.seatId)).toEqual(["b"]);
    expect(result.ignoredSeatIds).toEqual(["d", "missing"]);
  });
});
