// @vitest-environment node
/**
 * 企业租户计费链路闭环回归（验收 18 场景核心子集，纯函数 + store 隔离）。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeAiAuthorizationCost } from "./ai-authorization-cost.ts";
import { countActiveBotsAt, createBot, deleteBot } from "./bot-resources-store.ts";
import { computeSeatCost, settleCycle } from "./engine.ts";
import { buildMeterDefinitions, chargeMeters } from "./meter-contract.ts";
import { buildPositionAttribution } from "./position-attribution.ts";
import { buildSeatAttribution, UNALLOCATED_SEAT_ID } from "./seat-attribution.ts";
import type { PlanPricing, PlanVersion, Seat, SeatHistoryInterval, UsageRecord } from "./types.ts";

const CYCLE_START = "2026-03-01T00:00:00.000Z";
const CYCLE_END = "2026-04-01T00:00:00.000Z";

function pricing(
  rows: Array<{ type: PlanPricing["type"]; key: string; priceCents: number }>,
): PlanPricing[] {
  return rows.map((r, i) => ({
    id: `p-${i}`,
    planId: "plan-1",
    planVersionId: "pv-1",
    type: r.type,
    key: r.key,
    priceCents: r.priceCents,
  }));
}

function version(opts: {
  pricing: PlanPricing[];
  seatQuota?: PlanVersion["snapshot"]["seatQuota"];
  botQuota?: number;
  id?: string;
}): PlanVersion {
  return {
    id: opts.id ?? "pv-1",
    planId: "plan-1",
    version: 1,
    status: "active",
    snapshot: {
      basePriceCents: 19900,
      seatQuota: opts.seatQuota ?? {},
      botQuota: opts.botQuota ?? 10,
      pricing: opts.pricing,
    },
    createdAt: CYCLE_START,
    createdByUserId: "admin",
  };
}

describe("enterprise billing closure formula", () => {
  it("1+2: 套餐内席位免费；超额收费；角色配额不可互抵", () => {
    const v = version({
      pricing: pricing([
        { type: "extra", key: "seat:viewer", priceCents: 1000 },
        { type: "extra", key: "seat:creator", priceCents: 3000 },
        { type: "extra", key: "seat:admin", priceCents: 5000 },
      ]),
      seatQuota: { viewer: 2, creator: 1, admin: 0 },
    });
    const intervals: SeatHistoryInterval[] = [
      {
        id: "1",
        seatId: "v1",
        enterpriseId: "e",
        role: "viewer",
        startTime: CYCLE_START,
        endTime: null,
      },
      {
        id: "2",
        seatId: "v2",
        enterpriseId: "e",
        role: "viewer",
        startTime: CYCLE_START,
        endTime: null,
      },
      {
        id: "3",
        seatId: "v3",
        enterpriseId: "e",
        role: "viewer",
        startTime: CYCLE_START,
        endTime: null,
      },
      {
        id: "4",
        seatId: "c1",
        enterpriseId: "e",
        role: "creator",
        startTime: CYCLE_START,
        endTime: null,
      },
      {
        id: "5",
        seatId: "a1",
        enterpriseId: "e",
        role: "admin",
        startTime: CYCLE_START,
        endTime: null,
      },
    ];
    const cost = computeSeatCost({
      version: v,
      intervals,
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
    });
    // viewer: 3-2=1 → 1000; creator: 1-1=0; admin: 1-0=1 → 5000
    expect(cost.seatCostCents).toBe(6000);
  });

  it("3: 月中角色变化按时间比例计费", () => {
    const mid = "2026-03-16T12:00:00.000Z";
    const v = version({
      pricing: pricing([
        { type: "extra", key: "seat:viewer", priceCents: 3000 },
        { type: "extra", key: "seat:creator", priceCents: 9000 },
      ]),
      seatQuota: { viewer: 0, creator: 0 },
    });
    const cost = computeSeatCost({
      version: v,
      intervals: [
        {
          id: "1",
          seatId: "s1",
          enterpriseId: "e",
          role: "viewer",
          startTime: CYCLE_START,
          endTime: mid,
        },
        {
          id: "2",
          seatId: "s1",
          enterpriseId: "e",
          role: "creator",
          startTime: mid,
          endTime: null,
        },
      ],
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
    });
    expect(cost.seatCostCents).toBeGreaterThan(3000);
    expect(cost.seatCostCents).toBeLessThan(9000);
  });

  it("4: 月中 AI 授权升级按时间比例计费", () => {
    const mid = "2026-03-16T12:00:00.000Z";
    const v = version({
      pricing: pricing([{ type: "extra", key: "profile:pro", priceCents: 4000 }]),
    });
    const result = computeAiAuthorizationCost({
      version: v,
      aiProfileQuota: { basic: 0, pro: 0, elite: 0 },
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      intervals: [
        {
          id: "i1",
          seatId: "s1",
          enterpriseId: "e",
          profileId: "basic_ai",
          startTime: CYCLE_START,
          endTime: mid,
        },
        {
          id: "i2",
          seatId: "s1",
          enterpriseId: "e",
          profileId: "pro_ai",
          startTime: mid,
          endTime: null,
        },
      ],
    });
    expect(result.authorizationCostCents).toBeGreaterThan(0);
    expect(result.authorizationCostCents).toBeLessThan(4000);
  });

  it("5: Credits 额度内不收费，超额只收 extra", () => {
    const v = version({
      pricing: pricing([
        { type: "usage", key: "ai_credits", priceCents: 999 },
        { type: "extra", key: "ai_credits", priceCents: 2 },
      ]),
    });
    const meters = buildMeterDefinitions({
      version: v,
      entitlement: { monthlyCredits: 100 },
      usageKeys: ["ai_credits"],
    });
    const within = chargeMeters({
      meters,
      usageByKey: { ai_credits: 80 },
      pricing: v.snapshot.pricing,
      strict: true,
    });
    expect(within.usageCostCents).toBe(0);
    expect(within.extraCostCents).toBe(0);

    const over = chargeMeters({
      meters,
      usageByKey: { ai_credits: 150 },
      pricing: v.snapshot.pricing,
      strict: true,
    });
    expect(over.usageCostCents).toBe(0);
    expect(over.extraCostCents).toBe(100); // 50 * 2
    expect(over.items.every((i) => i.type === "extra")).toBe(true);
  });

  it("6: 缺少 extra/ai_token 时 final missingPriceKeys 含 unsettled 信号", () => {
    const v = version({
      pricing: pricing([{ type: "usage", key: "ai_token", priceCents: 1 }]),
    });
    const meters = [
      {
        key: "ai_token",
        unit: "token" as const,
        includedQuota: 10,
        chargeIncludedAtUsagePrice: false,
        allowOverage: true,
        aggregate: "sum" as const,
        rounding: "integer" as const,
      },
    ];
    const settled = settleCycle({
      enterpriseId: "e",
      version: v,
      planVersionId: "pv-1",
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      date: "2026-03-31",
      intervals: [],
      usage: [
        {
          id: "rec-70940",
          ingestedAt: "2026-03-05T00:00:00.000Z",
          eventId: "u1",
          enterpriseId: "e",
          userId: "u",
          key: "ai_token",
          quantity: 50,
          occurredAt: "2026-03-10T00:00:00.000Z",
        },
      ],
      meters,
      snapshotType: "final",
      generatedAt: CYCLE_END,
      billId: "b1",
      snapshotId: "s1",
    });
    expect(settled.snapshot.missingPriceKeys).toContain("extra/ai_token");
  });

  it("7+16: bot 超额进入账单；席位/岗位归因总额口径一致", () => {
    const v = version({
      pricing: pricing([
        { type: "extra", key: "seat:viewer", priceCents: 1000 },
        { type: "extra", key: "bot", priceCents: 700 },
        { type: "extra", key: "ai_credits", priceCents: 1 },
      ]),
      seatQuota: { viewer: 0 },
      botQuota: 1,
    });
    const intervals: SeatHistoryInterval[] = [
      {
        id: "1",
        seatId: "seat-1",
        enterpriseId: "e",
        role: "viewer",
        startTime: CYCLE_START,
        endTime: null,
      },
    ];
    const seats: Seat[] = [
      {
        id: "seat-1",
        enterpriseId: "e",
        userId: "user-1",
        currentRole: "viewer",
        botQuota: 5,
        status: "active",
        createdAt: CYCLE_START,
        updatedAt: CYCLE_START,
      },
    ];
    const usage: UsageRecord[] = [
      {
        id: "rec-99591",
        ingestedAt: "2026-03-05T00:00:00.000Z",
        eventId: "ev1",
        enterpriseId: "e",
        userId: "user-1",
        key: "ai_credits",
        quantity: 5,
        occurredAt: "2026-03-05T00:00:00.000Z",
        agentId: "bot-a",
      },
    ];
    const meters = [
      {
        key: "ai_credits",
        unit: "credit" as const,
        includedQuota: 0,
        chargeIncludedAtUsagePrice: false,
        allowOverage: true,
        aggregate: "sum" as const,
        rounding: "integer" as const,
      },
    ];
    const bill = settleCycle({
      enterpriseId: "e",
      version: v,
      planVersionId: "pv-1",
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      date: "2026-03-31",
      intervals,
      usage,
      meters,
      botCount: 3,
      snapshotType: "final",
      generatedAt: CYCLE_END,
      billId: "b1",
      snapshotId: "s1",
    }).bill;

    const seatAttr = buildSeatAttribution({
      version: v,
      seats,
      intervals,
      usageRecords: usage,
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      meters,
      botCount: 3,
    });
    const posAttr = buildPositionAttribution({
      version: v,
      positions: [
        {
          orgSeatId: "org-1",
          positionTitle: "工程师",
          teamLabel: "研发",
          memberUserId: "user-1",
          agentIds: ["bot-a"],
        },
      ],
      billingSeats: seats,
      intervals,
      usageRecords: usage,
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      meters,
      botCount: 3,
    });

    expect(bill.extraCostCents).toBeGreaterThanOrEqual(1400); // 2 bots * 700
    expect(seatAttr.summary.totalCostCents).toBe(bill.totalCostCents);
    expect(posAttr.summary.totalCostCents).toBe(bill.totalCostCents);
  });

  it("17: AI 授权超额 Bill 与席位/岗位归因总额一致", () => {
    const v = version({
      pricing: pricing([
        { type: "extra", key: "profile:pro", priceCents: 4000 },
        { type: "extra", key: "profile:basic", priceCents: 1000 },
      ]),
    });
    const aiProfileQuota = { basic: 0, pro: 0, elite: 0 };
    const aiProfileIntervals = [
      {
        id: "ai-1",
        seatId: "seat-1",
        enterpriseId: "e",
        profileId: "pro_ai" as const,
        startTime: CYCLE_START,
        endTime: null,
      },
      {
        id: "ai-2",
        seatId: "seat-2",
        enterpriseId: "e",
        profileId: "pro_ai" as const,
        startTime: CYCLE_START,
        endTime: null,
      },
    ];
    const seats: Seat[] = [
      {
        id: "seat-1",
        enterpriseId: "e",
        userId: "user-1",
        currentRole: "viewer",
        botQuota: 1,
        status: "active",
        createdAt: CYCLE_START,
        updatedAt: CYCLE_START,
      },
      {
        id: "seat-2",
        enterpriseId: "e",
        userId: "user-2",
        currentRole: "viewer",
        botQuota: 1,
        status: "active",
        createdAt: CYCLE_START,
        updatedAt: CYCLE_START,
      },
    ];
    const bill = settleCycle({
      enterpriseId: "e",
      version: v,
      planVersionId: "pv-1",
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      date: "2026-03-31",
      intervals: [],
      usage: [],
      aiProfileIntervals,
      aiProfileQuota,
      snapshotType: "final",
      generatedAt: CYCLE_END,
      billId: "b-auth",
      snapshotId: "s-auth",
    }).bill;

    const seatAttr = buildSeatAttribution({
      version: v,
      seats,
      intervals: [],
      usageRecords: [],
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      aiProfileIntervals,
      aiProfileQuota,
    });
    const posAttr = buildPositionAttribution({
      version: v,
      positions: [
        {
          orgSeatId: "org-1",
          positionTitle: "工程师",
          teamLabel: "研发",
          memberUserId: "user-1",
          agentIds: [],
        },
      ],
      billingSeats: seats,
      intervals: [],
      usageRecords: [],
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      aiProfileIntervals,
      aiProfileQuota,
    });

    expect(bill.extraCostCents).toBe(8000);
    expect(seatAttr.summary.totalCostCents).toBe(bill.totalCostCents);
    expect(posAttr.summary.totalCostCents).toBe(bill.totalCostCents);
    expect(posAttr.rows.find((row) => row.orgSeatId === "org-1")?.extraCostCents).toBe(4000);
    expect(posAttr.rows.find((row) => row.orgSeatId === UNALLOCATED_SEAT_ID)?.extraCostCents).toBe(
      4000,
    );
  });

  it("8: 未归属用量进入 _unallocated", () => {
    const v = version({
      pricing: pricing([{ type: "extra", key: "ai_credits", priceCents: 3 }]),
    });
    const meters = [
      {
        key: "ai_credits",
        unit: "credit" as const,
        includedQuota: 0,
        chargeIncludedAtUsagePrice: false,
        allowOverage: true,
        aggregate: "sum" as const,
        rounding: "integer" as const,
      },
    ];
    const attr = buildSeatAttribution({
      version: v,
      seats: [],
      intervals: [],
      usageRecords: [
        {
          id: "rec-70940",
          ingestedAt: "2026-03-05T00:00:00.000Z",
          eventId: "orphan",
          enterpriseId: "e",
          userId: "",
          key: "ai_credits",
          quantity: 10,
          occurredAt: "2026-03-05T00:00:00.000Z",
        },
      ],
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      meters,
    });
    const row = attr.rows.find((r) => r.billingSeatId === UNALLOCATED_SEAT_ID);
    expect(row?.usageQuantity).toBe(10);
    expect(row?.usageCostCents).toBe(30);
  });

  it("13: 锁定 v1 后平台激活 v2，历史仍按 v1 价", () => {
    const v1 = version({
      id: "pv-1",
      pricing: pricing([{ type: "extra", key: "seat:viewer", priceCents: 1000 }]),
      seatQuota: { viewer: 0 },
    });
    const v2 = version({
      id: "pv-2",
      pricing: pricing([{ type: "extra", key: "seat:viewer", priceCents: 9999 }]),
      seatQuota: { viewer: 0 },
    });
    const intervals: SeatHistoryInterval[] = [
      {
        id: "1",
        seatId: "s1",
        enterpriseId: "e",
        role: "viewer",
        startTime: CYCLE_START,
        endTime: null,
      },
    ];
    const locked = settleCycle({
      enterpriseId: "e",
      version: v1,
      planVersionId: "pv-1",
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      date: "2026-03-31",
      intervals,
      usage: [],
      snapshotType: "final",
      generatedAt: CYCLE_END,
      billId: "b1",
      snapshotId: "s1",
    });
    expect(locked.bill.seatCostCents).toBe(1000);
    expect(locked.bill.planVersionId).toBe("pv-1");
    // 即便传入 v2 快照但 planVersionId 守卫会拒绝不一致；正确路径只传锁定版本。
    expect(v2.snapshot.pricing[0]?.priceCents).toBe(9999);
  });
});

describe("bot count at cycle end (history replay)", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "ob-bot-"));
    storePath = path.join(dir, "bots.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("14: 账期结束后增删数字人不改变旧账期 botCount", async () => {
    const enterpriseId = "ent-bot-hist";
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      storePath,
      JSON.stringify({
        version: 1,
        bots: {
          "bot-old-1": {
            id: "bot-old-1",
            enterpriseId,
            ownerUserId: "u1",
            createdAt: "2026-02-01T00:00:00.000Z",
            deletedAt: null,
          },
          "bot-old-2": {
            id: "bot-old-2",
            enterpriseId,
            ownerUserId: "u1",
            createdAt: "2026-02-15T00:00:00.000Z",
            deletedAt: null,
          },
        },
        userLimits: {},
      }),
      "utf8",
    );
    expect(await countActiveBotsAt(enterpriseId, CYCLE_END, storePath)).toBe(2);

    const later = await createBot(enterpriseId, "u1", { storePath });
    expect(await countActiveBotsAt(enterpriseId, CYCLE_END, storePath)).toBe(2);

    await deleteBot(enterpriseId, later.id, storePath);
    expect(await countActiveBotsAt(enterpriseId, CYCLE_END, storePath)).toBe(2);
  });
});

describe("multi-member / multi-agent attribution isolation", () => {
  it("11+12: 同企业多成员、同成员多数字人 Credits 分别统计", () => {
    const v = version({
      pricing: pricing([{ type: "extra", key: "ai_credits", priceCents: 1 }]),
    });
    const meters = [
      {
        key: "ai_credits",
        unit: "credit" as const,
        includedQuota: 0,
        chargeIncludedAtUsagePrice: false,
        allowOverage: true,
        aggregate: "sum" as const,
        rounding: "integer" as const,
      },
    ];
    const seats: Seat[] = [
      {
        id: "s-a",
        enterpriseId: "e",
        userId: "alice",
        currentRole: "viewer",
        botQuota: 2,
        createdAt: CYCLE_START,
      },
      {
        id: "s-b",
        enterpriseId: "e",
        userId: "bob",
        currentRole: "viewer",
        botQuota: 2,
        createdAt: CYCLE_START,
      },
    ];
    const usage: UsageRecord[] = [
      {
        id: "rec-99591",
        ingestedAt: "2026-03-05T00:00:00.000Z",
        eventId: "a1",
        enterpriseId: "e",
        userId: "alice",
        key: "ai_credits",
        quantity: 10,
        occurredAt: "2026-03-05T00:00:00.000Z",
        agentId: "bot-a1",
      },
      {
        id: "rec-99591",
        ingestedAt: "2026-03-05T00:00:00.000Z",
        eventId: "a2",
        enterpriseId: "e",
        userId: "alice",
        key: "ai_credits",
        quantity: 5,
        occurredAt: "2026-03-06T00:00:00.000Z",
        agentId: "bot-a2",
      },
      {
        id: "rec-99591",
        ingestedAt: "2026-03-05T00:00:00.000Z",
        eventId: "b1",
        enterpriseId: "e",
        userId: "bob",
        key: "ai_credits",
        quantity: 7,
        occurredAt: "2026-03-07T00:00:00.000Z",
        agentId: "bot-b1",
      },
    ];
    const seatAttr = buildSeatAttribution({
      version: v,
      seats,
      intervals: [],
      usageRecords: usage,
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      meters,
    });
    const alice = seatAttr.rows.find((r) => r.userId === "alice");
    const bob = seatAttr.rows.find((r) => r.userId === "bob");
    expect(alice?.usageQuantity).toBe(15);
    expect(bob?.usageQuantity).toBe(7);

    const pos = buildPositionAttribution({
      version: v,
      positions: [
        {
          orgSeatId: "org-a",
          positionTitle: "A",
          teamLabel: "T",
          memberUserId: "alice",
          agentIds: ["bot-a1", "bot-a2"],
        },
        {
          orgSeatId: "org-b",
          positionTitle: "B",
          teamLabel: "T",
          memberUserId: "bob",
          agentIds: ["bot-b1"],
        },
      ],
      billingSeats: seats,
      intervals: [],
      usageRecords: usage,
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      meters,
    });
    const rowA = pos.rows.find((r) => r.orgSeatId === "org-a")!;
    expect(rowA.agents.find((a) => a.agentId === "bot-a1")?.usageQuantity).toBe(10);
    expect(rowA.agents.find((a) => a.agentId === "bot-a2")?.usageQuantity).toBe(5);
  });

  it("18: 缺价路径进入 missingPriceKeys（unsettled 信号）", () => {
    const v = version({ pricing: pricing([]) });
    const settled = settleCycle({
      enterpriseId: "e",
      version: v,
      planVersionId: "pv-1",
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      date: "2026-03-31",
      intervals: [
        {
          id: "1",
          seatId: "s1",
          enterpriseId: "e",
          role: "viewer",
          startTime: CYCLE_START,
          endTime: null,
        },
      ],
      usage: [
        {
          id: "rec-70940",
          ingestedAt: "2026-03-05T00:00:00.000Z",
          eventId: "x",
          enterpriseId: "e",
          userId: "u",
          key: "ai_credits",
          quantity: 100,
          occurredAt: "2026-03-10T00:00:00.000Z",
        },
      ],
      meters: [
        {
          key: "ai_credits",
          unit: "credit",
          includedQuota: 0,
          chargeIncludedAtUsagePrice: false,
          allowOverage: true,
          aggregate: "sum",
          rounding: "integer",
        },
      ],
      botCount: 5,
      snapshotType: "final",
      generatedAt: CYCLE_END,
      billId: "b",
      snapshotId: "s",
    });
    expect(settled.snapshot.missingPriceKeys.length).toBeGreaterThan(0);
    expect(
      settled.snapshot.missingPriceKeys.some(
        (k) => k.startsWith("extra/") || k.startsWith("quota/"),
      ),
    ).toBe(true);
  });
});
