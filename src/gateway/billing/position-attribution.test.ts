import { describe, expect, it } from "vitest";
import {
  buildPositionAttribution,
  resolveUsageRecordOrgSeatId,
  type OrgPositionContext,
} from "./position-attribution.ts";
import type { PlanVersion, Seat, SeatHistoryInterval, UsageRecord } from "./types.ts";

const version: PlanVersion = {
  id: "pv-1",
  planId: "plan-1",
  version: 1,
  status: "active",
  snapshot: {
    basePriceCents: 0,
    seatQuota: { viewer: 0, creator: 0, admin: 0 },
    botQuota: 5,
    pricing: [
      {
        id: "p1",
        planId: "plan-1",
        planVersionId: "pv-1",
        type: "extra",
        key: "seat:viewer",
        priceCents: 1000,
      },
      {
        id: "p2",
        planId: "plan-1",
        planVersionId: "pv-1",
        type: "extra",
        key: "ai_token",
        priceCents: 2,
      },
    ],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  createdByUserId: "admin",
};

const meters = [
  {
    key: "ai_token",
    unit: "token" as const,
    includedQuota: 0,
    chargeIncludedAtUsagePrice: false,
    allowOverage: true,
    aggregate: "sum" as const,
    rounding: "integer" as const,
  },
];

const positions: OrgPositionContext[] = [
  {
    orgSeatId: "org-sales",
    positionTitle: "销售助理",
    teamLabel: "销售部",
    memberUserId: "alice@example.com",
    agentIds: ["agent-a", "agent-b"],
  },
];

describe("position-attribution", () => {
  it("resolves org seat from agentId and orgSeatId tags", () => {
    const byAgent: UsageRecord = {
      id: "u1",
      enterpriseId: "ent",
      userId: "alice@example.com",
      eventId: "e1",
      key: "ai_token",
      quantity: 100,
      occurredAt: "2026-03-10T00:00:00.000Z",
      ingestedAt: "2026-03-10T00:00:00.000Z",
      agentId: "agent-a",
    };
    const bySeat: UsageRecord = {
      ...byAgent,
      id: "u2",
      eventId: "e2",
      agentId: null,
      orgSeatId: "org-sales",
      quantity: 50,
    };
    expect(resolveUsageRecordOrgSeatId(byAgent, positions)).toBe("org-sales");
    expect(resolveUsageRecordOrgSeatId(bySeat, positions)).toBe("org-sales");
  });

  it("builds position rows with per-agent usage breakdown", () => {
    const cycleStart = "2026-03-01T00:00:00.000Z";
    const cycleEnd = "2026-04-01T00:00:00.000Z";
    const billingSeats: Seat[] = [
      {
        id: "bill-1",
        enterpriseId: "ent",
        userId: "alice@example.com",
        currentRole: "viewer",
        botQuota: 1,
        createdAt: cycleStart,
      },
    ];
    const intervals: SeatHistoryInterval[] = [
      {
        id: "sh-1",
        seatId: "bill-1",
        enterpriseId: "ent",
        role: "viewer",
        startTime: cycleStart,
        endTime: null,
      },
    ];
    const usageRecords: UsageRecord[] = [
      {
        id: "u1",
        enterpriseId: "ent",
        userId: "alice@example.com",
        eventId: "e1",
        key: "ai_token",
        quantity: 400,
        occurredAt: "2026-03-10T00:00:00.000Z",
        ingestedAt: "2026-03-10T00:00:00.000Z",
        agentId: "agent-a",
      },
      {
        id: "u2",
        enterpriseId: "ent",
        userId: "alice@example.com",
        eventId: "e2",
        key: "ai_token",
        quantity: 100,
        occurredAt: "2026-03-11T00:00:00.000Z",
        ingestedAt: "2026-03-11T00:00:00.000Z",
        agentId: "agent-b",
      },
      {
        id: "u3",
        enterpriseId: "ent",
        userId: "alice@example.com",
        eventId: "e3",
        key: "ai_token",
        quantity: 50,
        occurredAt: "2026-03-12T00:00:00.000Z",
        ingestedAt: "2026-03-12T00:00:00.000Z",
      },
    ];

    const result = buildPositionAttribution({
      version,
      positions,
      billingSeats,
      intervals,
      usageRecords,
      cycleStart,
      cycleEnd,
      meters,
    });

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.seatCostCents).toBe(1000);
    expect(row.usageCostCents).toBe(1100);
    expect(row.agents.find((a) => a.agentId === "agent-a")?.usageQuantity).toBe(400);
    expect(row.agents.find((a) => a.agentId === "agent-b")?.usageQuantity).toBe(100);
    expect(row.unallocatedAgentUsageQuantity).toBe(50);
  });

  it("includes AI authorization extra on mapped positions and unallocated auth on _unallocated", () => {
    const cycleStart = "2026-03-01T00:00:00.000Z";
    const cycleEnd = "2026-04-01T00:00:00.000Z";
    const authVersion: PlanVersion = {
      ...version,
      snapshot: {
        ...version.snapshot,
        pricing: [
          ...version.snapshot.pricing,
          {
            id: "p3",
            planId: "plan-1",
            planVersionId: "pv-1",
            type: "extra",
            key: "profile:pro",
            priceCents: 4000,
          },
        ],
      },
    };
    const billingSeats: Seat[] = [
      {
        id: "bill-1",
        enterpriseId: "ent",
        userId: "alice@example.com",
        currentRole: "viewer",
        botQuota: 1,
        createdAt: cycleStart,
      },
      {
        id: "bill-2",
        enterpriseId: "ent",
        userId: "bob@example.com",
        currentRole: "viewer",
        botQuota: 1,
        createdAt: cycleStart,
      },
    ];
    const intervals: SeatHistoryInterval[] = [
      {
        id: "sh-1",
        seatId: "bill-1",
        enterpriseId: "ent",
        role: "viewer",
        startTime: cycleStart,
        endTime: null,
      },
      {
        id: "sh-2",
        seatId: "bill-2",
        enterpriseId: "ent",
        role: "viewer",
        startTime: cycleStart,
        endTime: null,
      },
    ];
    const result = buildPositionAttribution({
      version: authVersion,
      positions: [
        {
          orgSeatId: "org-sales",
          positionTitle: "销售助理",
          teamLabel: "销售部",
          memberUserId: "alice@example.com",
          agentIds: [],
        },
      ],
      billingSeats,
      intervals,
      usageRecords: [],
      cycleStart,
      cycleEnd,
      meters,
      aiProfileQuota: { basic: 0, pro: 0, elite: 0 },
      aiProfileIntervals: [
        {
          id: "ai-1",
          seatId: "bill-1",
          enterpriseId: "ent",
          profileId: "pro_ai",
          startTime: cycleStart,
          endTime: null,
        },
        {
          id: "ai-2",
          seatId: "bill-2",
          enterpriseId: "ent",
          profileId: "pro_ai",
          startTime: cycleStart,
          endTime: null,
        },
      ],
    });

    const mapped = result.rows.find((row) => row.orgSeatId === "org-sales");
    expect(mapped?.extraCostCents).toBe(4000);
    const unallocated = result.rows.find((row) => row.orgSeatId === "_unallocated");
    expect(unallocated?.extraCostCents).toBe(4000);
    expect(result.summary.extraCostCents).toBe(8000);
  });

  it("prorates mid-cycle AI profile upgrades like formal settlement", () => {
    const cycleStart = "2026-03-01T00:00:00.000Z";
    const cycleEnd = "2026-04-01T00:00:00.000Z";
    const mid = "2026-03-16T12:00:00.000Z";
    const authVersion: PlanVersion = {
      ...version,
      snapshot: {
        ...version.snapshot,
        pricing: [
          {
            id: "p3",
            planId: "plan-1",
            planVersionId: "pv-1",
            type: "extra",
            key: "profile:pro",
            priceCents: 4000,
          },
        ],
      },
    };
    const billingSeats: Seat[] = [
      {
        id: "bill-1",
        enterpriseId: "ent",
        userId: "alice@example.com",
        currentRole: "viewer",
        botQuota: 1,
        createdAt: cycleStart,
      },
    ];
    const result = buildPositionAttribution({
      version: authVersion,
      positions: [
        {
          orgSeatId: "org-sales",
          positionTitle: "销售助理",
          teamLabel: "销售部",
          memberUserId: "alice@example.com",
          agentIds: [],
        },
      ],
      billingSeats,
      intervals: [
        {
          id: "sh-1",
          seatId: "bill-1",
          enterpriseId: "ent",
          role: "viewer",
          startTime: cycleStart,
          endTime: null,
        },
      ],
      usageRecords: [],
      cycleStart,
      cycleEnd,
      meters,
      aiProfileQuota: { basic: 0, pro: 0, elite: 0 },
      aiProfileIntervals: [
        {
          id: "ai-1",
          seatId: "bill-1",
          enterpriseId: "ent",
          profileId: "basic_ai",
          startTime: cycleStart,
          endTime: mid,
        },
        {
          id: "ai-2",
          seatId: "bill-1",
          enterpriseId: "ent",
          profileId: "pro_ai",
          startTime: mid,
          endTime: null,
        },
      ],
    });

    const mapped = result.rows.find((row) => row.orgSeatId === "org-sales");
    expect(mapped?.extraCostCents).toBeGreaterThan(0);
    expect(mapped?.extraCostCents).toBeLessThan(4000);
    expect(result.summary.extraCostCents).toBe(mapped?.extraCostCents);
  });
});
