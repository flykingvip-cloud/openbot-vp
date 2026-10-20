import { describe, expect, it } from "vitest";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import {
  filterEnterpriseOrgDepartmentsByScope,
  organizationRowVisibleUnderScope,
  resolveOrganizationDepartmentScope,
} from "./enterprise-org-scope.ts";
import { buildEnterpriseOrgTree } from "./enterprise-org-tree-model.ts";

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
  const { seatSummaries, memberSummaries, ...rest } = partial;
  return {
    membershipRole: "member",
    authenticatedUser: "member@example.com",
    organizationDepartmentPaths: [],
    ...rest,
    seatSummaries: (seatSummaries ?? []).map((seat) => ({
      currentEmployeeUser: null,
      ...seat,
    })),
    memberSummaries: (memberSummaries ?? []).map((member) => ({
      seatTeamLabel: null,
      ...member,
    })),
  } as EnterprisePortReadModel;
}

describe("resolveOrganizationDepartmentScope", () => {
  it("returns null for enterprise admins", () => {
    expect(
      resolveOrganizationDepartmentScope(
        createReadModel({
          membershipRole: "enterprise-admin",
          authenticatedUser: "admin@example.com",
        }),
      ),
    ).toBeNull();
  });

  it("returns the member seat department path", () => {
    const scope = resolveOrganizationDepartmentScope(
      createReadModel({
        memberSummaries: [
          {
            user: "member@example.com",
            displayLabel: "Member",
            membershipRole: "member",
            status: "active",
            seatTitle: "销售总监",
            seatStatus: "occupied",
            seatTeamLabel: null,
          },
        ],
        seatSummaries: [
          {
            seatId: "seat-1",
            title: "销售总监",
            teamLabel: "销售部/华东区",
            status: "occupied",
            currentEmployeeLabel: "Member",
            roleCode: null,
            defaultAgentId: null,
            agentIds: [],
            defaultSpaceIds: [],
            memoryScopeIds: [],
            responsibility: null,
          },
        ],
      }),
    );
    expect(scope).toBe("销售部/华东区");
  });

  it("falls back to seatTeamLabel when organization seats are unavailable", () => {
    const scope = resolveOrganizationDepartmentScope(
      createReadModel({
        memberSummaries: [
          {
            user: "member@example.com",
            displayLabel: "Member",
            membershipRole: "member",
            status: "active",
            seatTitle: "销售总监",
            seatStatus: "occupied",
            seatTeamLabel: "销售部/华东区",
          },
        ],
        seatSummaries: [],
      }),
    );
    expect(scope).toBe("销售部/华东区");
  });
});

describe("filterEnterpriseOrgDepartmentsByScope", () => {
  it("keeps only the scoped department subtree", () => {
    const readModel = createReadModel({
      seatSummaries: [
        {
          seatId: "seat-east",
          title: "华东销售",
          teamLabel: "销售部/华东区",
          status: "occupied",
          currentEmployeeLabel: "A",
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
        {
          seatId: "seat-south",
          title: "华南销售",
          teamLabel: "销售部/华南区",
          status: "vacant",
          currentEmployeeLabel: null,
          roleCode: null,
          defaultAgentId: null,
          agentIds: [],
          defaultSpaceIds: [],
          memoryScopeIds: [],
          responsibility: null,
        },
      ],
      memberSummaries: [],
    });
    const filtered = filterEnterpriseOrgDepartmentsByScope(
      buildEnterpriseOrgTree({ readModel, includeVacantPositions: true }),
      "销售部/华东区",
    );
    expect(filtered[0]?.fullPath).toBe("销售部");
    expect(filtered[0]?.childDepartments[0]?.fullPath).toBe("销售部/华东区");
    expect(filtered[0]?.childDepartments).toHaveLength(1);
  });
});

describe("organizationRowVisibleUnderScope", () => {
  it("allows rows under the scoped path", () => {
    expect(organizationRowVisibleUnderScope("销售部/华东区/一组", "销售部/华东区")).toBe(true);
    expect(organizationRowVisibleUnderScope("销售部/华南区", "销售部/华东区")).toBe(false);
  });
});
