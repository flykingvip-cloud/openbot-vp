import { describe, expect, it } from "vitest";
import type { SeatWithGrantSummary } from "../../capability/cost-budget-billing/index.ts";
import type { EnterprisePortReadModel } from "../../ports/enterprise/semantic/enterprise-read-model.ts";
import {
  buildSeatGovernanceRows,
  buildSeatGovernanceSummary,
  listUnassignedOrgMembers,
  sortSeatGovernanceRowsForDrilldown,
} from "./cost-budget-seat-governance.ts";
import { buildAssignedSeatUserIdSet } from "./cost-budget-seat-selection.ts";

const readModel = {
  memberSummaries: [
    {
      user: "bob@example.com",
      displayLabel: "Bob",
      membershipRole: "member",
      status: "active",
      seatTitle: "销售经理",
      seatStatus: "occupied",
      seatTeamLabel: "销售部",
    },
    {
      user: "alice@example.com",
      displayLabel: "Alice",
      membershipRole: "member",
      status: "active",
      seatTitle: "销售助理",
      seatStatus: "occupied",
      seatTeamLabel: "销售部",
    },
    {
      user: "carol@example.com",
      displayLabel: "Carol",
      membershipRole: "member",
      status: "active",
      seatTitle: "财务专员",
      seatStatus: "occupied",
      seatTeamLabel: "财务部",
    },
  ],
} as EnterprisePortReadModel;

const seats: SeatWithGrantSummary[] = [
  {
    id: "seat-bob",
    enterpriseId: "acme",
    userId: "bob@example.com",
    currentRole: "admin",
    botQuota: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    grantedModelCount: 6,
  },
  {
    id: "seat-alice",
    enterpriseId: "acme",
    userId: "alice@example.com",
    currentRole: "viewer",
    botQuota: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    grantedModelCount: 1,
  },
];

const attribution = {
  subscribed: true,
  cycleStart: "2026-03-01T00:00:00.000Z",
  cycleEnd: "2026-04-01T00:00:00.000Z",
  rows: [
    {
      billingSeatId: "seat-bob",
      userId: "bob@example.com",
      billingRole: "admin" as const,
      seatCostCents: 4500,
      usageQuantity: 800,
      usageCostCents: 1600,
      totalCostCents: 6100,
    },
    {
      billingSeatId: "seat-alice",
      userId: "alice@example.com",
      billingRole: "viewer" as const,
      seatCostCents: 1000,
      usageQuantity: 400,
      usageCostCents: 800,
      totalCostCents: 1800,
    },
  ],
  summary: { seatCostCents: 5500, usageCostCents: 2400, totalCostCents: 7900 },
  missingPriceKeys: [],
};

describe("cost-budget-seat-governance", () => {
  it("sorts governance rows by department then position", () => {
    const rows = buildSeatGovernanceRows({
      seats,
      readModel,
      roleProfiles: [
        {
          role: "viewer",
          label: "只读",
          description: "",
          tierIds: [],
          modelIds: [],
          modelCount: 1,
          seatPriceCents: 1000,
        },
        {
          role: "admin",
          label: "管理",
          description: "",
          tierIds: [],
          modelIds: [],
          modelCount: 6,
          seatPriceCents: 5000,
        },
      ],
      analytics: {
        startTime: "2026-03-01T00:00:00.000Z",
        endTime: "2026-03-31T23:59:59.000Z",
        totalQuantity: 1200,
        byUser: {
          "alice@example.com": 400,
          "bob@example.com": 800,
        },
        byKey: {},
        recordCount: 2,
      },
      attribution,
    });
    expect(rows.map((row) => row.positionTitle)).toEqual(["销售经理", "销售助理"]);
    expect(rows.find((row) => row.memberLabel === "Alice")?.usageQuantity).toBe(400);
    expect(rows.find((row) => row.memberLabel === "Bob")?.cycleSeatCostCents).toBe(4500);
    expect(rows.find((row) => row.memberLabel === "Alice")?.cycleTotalCostCents).toBe(1800);
  });

  it("summarizes role counts and billing cycle costs", () => {
    const rows = buildSeatGovernanceRows({
      seats,
      readModel,
      roleProfiles: [
        {
          role: "viewer",
          label: "只读",
          description: "",
          tierIds: [],
          modelIds: [],
          modelCount: 1,
          seatPriceCents: 1000,
        },
        {
          role: "admin",
          label: "管理",
          description: "",
          tierIds: [],
          modelIds: [],
          modelCount: 6,
          seatPriceCents: 5000,
        },
      ],
      analytics: null,
      attribution,
    });
    expect(buildSeatGovernanceSummary(rows, attribution)).toEqual({
      viewerCount: 1,
      creatorCount: 0,
      adminCount: 1,
      estimatedSeatMonthlyCents: 6000,
      cycleSeatCostCents: 5500,
      cycleUsageCostCents: 2400,
      cycleTotalCostCents: 7900,
    });
  });

  it("lists org members with position but no billing seat", () => {
    const assigned = buildAssignedSeatUserIdSet(seats);
    const pending = listUnassignedOrgMembers(readModel, assigned);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.userId).toBe("carol@example.com");
    expect(pending[0]?.positionTitle).toBe("财务专员");
  });

  it("sorts governance rows by drill-down focus cost descending", () => {
    const rows = buildSeatGovernanceRows({
      seats,
      readModel,
      roleProfiles: [],
      analytics: null,
      attribution,
    });
    const byUsage = sortSeatGovernanceRowsForDrilldown(rows, "usage");
    expect(byUsage.map((row) => row.memberLabel)).toEqual(["Bob", "Alice"]);
    const bySeat = sortSeatGovernanceRowsForDrilldown(rows, "seat");
    expect(bySeat.map((row) => row.memberLabel)).toEqual(["Bob", "Alice"]);
  });
});
