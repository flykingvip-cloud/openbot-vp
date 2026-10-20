import { describe, expect, it } from "vitest";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import {
  buildHandoverOrganizationTree,
  isHandoverSuccessorCandidate,
  resolveHandoverOrgTreeQuery,
} from "./enterprise-handover-org-tree.ts";

function createReadModel(
  partial: Partial<Omit<EnterprisePortReadModel, "seatSummaries" | "memberSummaries">> & {
    seatSummaries?: Array<
      Omit<EnterprisePortReadModel["seatSummaries"][number], "currentEmployeeUser"> & {
        currentEmployeeUser?: string | null;
      }
    >;
    memberSummaries?: Array<
      Omit<EnterprisePortReadModel["memberSummaries"][number], "seatTeamLabel"> & {
        seatTeamLabel?: string | null;
      }
    >;
  },
): EnterprisePortReadModel {
  return {
    seatSummaries: (partial.seatSummaries ?? []).map((seat) => ({
      currentEmployeeUser: null,
      ...seat,
    })),
    memberSummaries: (partial.memberSummaries ?? []).map((member) => ({
      seatTeamLabel: null,
      ...member,
    })),
    authenticatedUser: partial.authenticatedUser ?? "admin@example.com",
  } as EnterprisePortReadModel;
}

describe("buildHandoverOrganizationTree", () => {
  it("builds nested departments and marks the active handover seat", () => {
    const { departments, positionLookup } = buildHandoverOrganizationTree({
      readModel: createReadModel({
        seatSummaries: [
          {
            seatId: "seat-ceo",
            title: "CEO",
            teamLabel: "管理层",
            status: "handover_pending",
            currentEmployeeLabel: "Alice",
            roleCode: null,
            defaultAgentId: null,
            agentIds: [],
            defaultSpaceIds: [],
            memoryScopeIds: [],
            responsibility: null,
          },
          {
            seatId: "seat-sales",
            title: "销售总监",
            teamLabel: "销售部/华东区",
            status: "occupied",
            currentEmployeeLabel: "Bob",
            roleCode: null,
            defaultAgentId: null,
            agentIds: [],
            defaultSpaceIds: [],
            memoryScopeIds: [],
            responsibility: null,
          },
        ],
        memberSummaries: [
          {
            user: "alice@example.com",
            displayLabel: "Alice",
            membershipRole: "member",
            status: "active",
            seatTitle: "CEO",
            seatStatus: "handover_pending",
          },
          {
            user: "bob@example.com",
            displayLabel: "Bob",
            membershipRole: "member",
            status: "active",
            seatTitle: "销售总监",
            seatStatus: "occupied",
          },
        ],
      }),
      handoverSeatId: "seat-ceo",
      handoverSeatTitle: "CEO",
      outgoingEmployeeUser: "alice@example.com",
      authenticatedUser: "admin@example.com",
    });

    expect(departments.some((department) => department.fullPath === "销售部")).toBe(true);
    const east = departments
      .find((department) => department.fullPath === "销售部")
      ?.childDepartments.find((child) => child.fullPath === "销售部/华东区");
    expect(east?.positions[0]?.seatTitle).toBe("销售总监");
    expect(positionLookup.get("seat-ceo")?.isHandoverSeat).toBe(true);
    expect(positionLookup.get("seat-sales")?.selectable).toBe(true);
  });

  it("filters nested departments by keyword query", () => {
    const { departments } = buildHandoverOrganizationTree({
      readModel: createReadModel({
        seatSummaries: [
          {
            seatId: "seat-sales",
            title: "销售总监",
            teamLabel: "销售部/华东区",
            status: "occupied",
            currentEmployeeLabel: "Bob",
            roleCode: null,
            defaultAgentId: null,
            agentIds: [],
            defaultSpaceIds: [],
            memoryScopeIds: [],
            responsibility: null,
          },
        ],
        memberSummaries: [
          {
            user: "bob@example.com",
            displayLabel: "Bob",
            membershipRole: "member",
            status: "active",
            seatTitle: "销售总监",
            seatStatus: "occupied",
          },
        ],
      }),
      handoverSeatId: "seat-ceo",
      handoverSeatTitle: "CEO",
      outgoingEmployeeUser: "alice@example.com",
      authenticatedUser: "admin@example.com",
      query: "华东",
    });

    expect(departments[0]?.fullPath).toBe("销售部");
    expect(departments[0]?.childDepartments[0]?.fullPath).toBe("销售部/华东区");
  });
});

describe("resolveHandoverOrgTreeQuery", () => {
  it("skips filtering when the input is an exact member email", () => {
    expect(
      resolveHandoverOrgTreeQuery({
        successorEmail: "bob@example.com",
        readModel: createReadModel({
          memberSummaries: [
            {
              user: "bob@example.com",
              displayLabel: "Bob",
              membershipRole: "member",
              status: "active",
              seatTitle: "销售总监",
              seatStatus: "occupied",
            },
          ],
        }),
      }),
    ).toBe("");
    expect(
      resolveHandoverOrgTreeQuery({
        successorEmail: "销售",
        readModel: createReadModel({ memberSummaries: [] }),
      }),
    ).toBe("销售");
  });
});

describe("isHandoverSuccessorCandidate", () => {
  it("rejects outgoing employee and inactive members", () => {
    expect(
      isHandoverSuccessorCandidate({
        member: {
          user: "alice@example.com",
          displayLabel: "Alice",
          membershipRole: "member",
          status: "active",
          seatTitle: "CEO",
          seatStatus: null,
          seatTeamLabel: null,
        },
        outgoingEmployeeUser: "alice@example.com",
        authenticatedUser: "admin@example.com",
      }),
    ).toBe(false);
  });
});
