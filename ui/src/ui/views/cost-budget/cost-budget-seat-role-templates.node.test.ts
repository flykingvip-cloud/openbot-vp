import { describe, expect, it } from "vitest";
import type { EnterprisePortReadModel } from "../../ports/enterprise/semantic/enterprise-read-model.ts";
import {
  extractRoleCodePrefix,
  resolveAggregatedSuggestedRole,
  resolveSuggestedSeatRole,
} from "./cost-budget-seat-role-templates.ts";

const readModel = {
  memberSummaries: [
    {
      user: "bob@example.com",
      displayLabel: "Bob",
      membershipRole: "member",
      status: "active",
      seatTitle: "销售经理",
      seatTeamLabel: "销售部",
      seatStatus: "occupied",
    },
    {
      user: "alice@example.com",
      displayLabel: "Alice",
      membershipRole: "member",
      status: "active",
      seatTitle: "财务专员",
      seatTeamLabel: "财务部",
      seatStatus: "occupied",
    },
  ],
  seatSummaries: [
    {
      seatId: "org-seat-sales",
      title: "销售经理",
      teamLabel: "销售部",
      status: "occupied",
      currentEmployeeUser: "bob@example.com",
      currentEmployeeLabel: "Bob",
      roleCode: "SALES-L2-001",
      defaultAgentId: null,
      agentIds: [],
      defaultSpaceIds: [],
      memoryScopeIds: [],
      responsibility: null,
    },
    {
      seatId: "org-seat-fin",
      title: "财务专员",
      teamLabel: "财务部",
      status: "occupied",
      currentEmployeeUser: "alice@example.com",
      currentEmployeeLabel: "Alice",
      roleCode: "FIN-L1-001",
      defaultAgentId: null,
      agentIds: [],
      defaultSpaceIds: [],
      memoryScopeIds: [],
      responsibility: null,
    },
    {
      seatId: "org-seat-vacant",
      title: "空岗助理",
      teamLabel: "销售部",
      status: "vacant",
      currentEmployeeUser: null,
      currentEmployeeLabel: null,
      roleCode: "OPS-L1-001",
      defaultAgentId: null,
      agentIds: [],
      defaultSpaceIds: [],
      memoryScopeIds: [],
      responsibility: null,
    },
  ],
} as unknown as EnterprisePortReadModel;

describe("cost-budget-seat-role-templates", () => {
  it("extracts roleCode prefix", () => {
    expect(extractRoleCodePrefix("SALES-L2-001")).toBe("SALES");
    expect(extractRoleCodePrefix(null)).toBeNull();
  });

  it("resolves suggested role from builtin prefix and position override", () => {
    expect(
      resolveSuggestedSeatRole({
        roleCode: "SALES-L2-001",
        templates: { prefixRules: {}, positionOverrides: {} },
      }),
    ).toBe("creator");
    expect(
      resolveSuggestedSeatRole({
        orgSeatId: "org-seat-vacant",
        roleCode: "OPS-L1-001",
        templates: {
          prefixRules: {},
          positionOverrides: { "org-seat-vacant": "admin" },
        },
      }),
    ).toBe("admin");
  });

  it("aggregates highest suggested role for multi-select", () => {
    const role = resolveAggregatedSuggestedRole({
      userIds: ["bob@example.com", "alice@example.com"],
      readModel,
      templates: { prefixRules: {}, positionOverrides: {} },
    });
    expect(role).toBe("creator");
  });
});
