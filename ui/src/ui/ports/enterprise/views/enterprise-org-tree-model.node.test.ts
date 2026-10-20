import { describe, expect, it } from "vitest";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import {
  buildEnterpriseOrgTree,
  buildEnterpriseOrgTreeFromProvisionRows,
  matchesEnterpriseOrgQuery,
  resolveEnterpriseOrgTreeSearchQuery,
  searchEnterpriseOrgDirectory,
  sortEnterpriseOrgDepartmentLabels,
} from "./enterprise-org-tree-model.ts";

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
    organizationDepartmentPaths: partial.organizationDepartmentPaths ?? [],
    organizationChildOrders: partial.organizationChildOrders ?? {},
    authenticatedUser: partial.authenticatedUser ?? "admin@example.com",
  } as EnterprisePortReadModel;
}

describe("buildEnterpriseOrgTree", () => {
  it("builds nested departments from hierarchical team labels", () => {
    const tree = buildEnterpriseOrgTree({
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
          {
            seatId: "seat-ops",
            title: "运营经理",
            teamLabel: "运营部",
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
    });

    expect(tree.some((department) => department.fullPath === "运营部")).toBe(true);
    const sales = tree.find((department) => department.fullPath === "销售部");
    expect(sales?.childDepartments[0]?.fullPath).toBe("销售部/华东区");
    expect(sales?.childDepartments[0]?.positions[0]?.member?.user).toBe("bob@example.com");
  });

  it("binds members by seat id when duplicate seat titles exist", () => {
    const tree = buildEnterpriseOrgTree({
      readModel: createReadModel({
        seatSummaries: [
          {
            seatId: "seat-ceo-mgmt",
            title: "CEO",
            teamLabel: "管理层",
            status: "occupied",
            currentEmployeeLabel: "Daniel",
            roleCode: null,
            defaultAgentId: null,
            agentIds: [],
            defaultSpaceIds: [],
            memoryScopeIds: [],
            responsibility: null,
          },
          {
            seatId: "seat-ceo-root",
            title: "CEO",
            teamLabel: "upbeyond",
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
        memberSummaries: [
          {
            user: "daniel.hhd@gmail.com",
            displayLabel: "Daniel",
            membershipRole: "member",
            status: "active",
            seatTitle: "CEO",
            seatTeamLabel: "管理层",
            seatStatus: "occupied",
          },
        ],
      }),
    });
    const management = tree.find((department) => department.fullPath === "管理层");
    const upbeyond = tree.find((department) => department.fullPath === "upbeyond");
    expect(management?.positions[0]?.member?.user).toBe("daniel.hhd@gmail.com");
    expect(upbeyond?.positions[0]?.member).toBeNull();
  });

  it("renders mixed child order with saved childOrders", () => {
    const tree = buildEnterpriseOrgTree({
      readModel: createReadModel({
        organizationChildOrders: {
          销售部: ["seat:seat-manager", "department:销售部/一部"],
        },
        seatSummaries: [
          {
            seatId: "seat-manager",
            title: "销售经理",
            teamLabel: "销售部",
            status: "occupied",
            currentEmployeeLabel: "Owner",
            roleCode: null,
            defaultAgentId: null,
            agentIds: [],
            defaultSpaceIds: [],
            memoryScopeIds: [],
            responsibility: null,
          },
          {
            seatId: "seat-assistant",
            title: "销售助理",
            teamLabel: "销售部/一部",
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
        organizationDepartmentPaths: ["销售部/一部"],
      }),
    });
    const sales = tree.find((department) => department.fullPath === "销售部");
    expect(sales?.orderedChildren.map((child) => child.kind)).toEqual(["position", "department"]);
  });
});

describe("buildEnterpriseOrgTreeFromProvisionRows", () => {
  it("dedupes positions within the same team path", () => {
    const tree = buildEnterpriseOrgTreeFromProvisionRows([
      {
        employeeName: "Alice",
        employeeEmail: "alice@example.com",
        teamLabel: "销售部/华东区",
        seatTitle: "销售总监",
      },
      {
        employeeName: "Bob",
        employeeEmail: "bob@example.com",
        teamLabel: "销售部/华东区",
        seatTitle: "销售总监",
      },
    ]);

    expect(tree[0]?.childDepartments[0]?.positions).toHaveLength(1);
  });
});

describe("searchEnterpriseOrgDirectory", () => {
  it("returns breadcrumb matches for nested departments", () => {
    const matches = searchEnterpriseOrgDirectory({
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
      query: "华东",
    });

    expect(matches.some((match) => match.breadcrumb.includes("销售部"))).toBe(true);
    expect(matches.some((match) => match.kind === "team" && match.label === "华东区")).toBe(true);
  });
});

describe("resolveEnterpriseOrgTreeSearchQuery", () => {
  it("treats exact member emails and raw email input as non-filtering", () => {
    expect(
      resolveEnterpriseOrgTreeSearchQuery({
        input: "bob@example.com",
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
      resolveEnterpriseOrgTreeSearchQuery({
        input: "销售",
        readModel: createReadModel({ memberSummaries: [] }),
      }),
    ).toBe("销售");
  });
});

describe("sortEnterpriseOrgDepartmentLabels", () => {
  it("places ungrouped teams last", () => {
    expect(sortEnterpriseOrgDepartmentLabels("未分组", "销售部")).toBeGreaterThan(0);
  });
});

describe("matchesEnterpriseOrgQuery", () => {
  it("matches department path segments", () => {
    expect(
      matchesEnterpriseOrgQuery(
        {
          kind: "position",
          seatId: "seat-1",
          seatTitle: "销售总监",
          teamLabel: "销售部/华东区",
          seatStatus: "occupied",
          roleCode: null,
          member: null,
        },
        "华东",
      ),
    ).toBe(true);
  });
});
