// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildMeterDefinitions,
  chargeMeters,
  MeterValidationError,
  meterAmountCents,
  splitMeterUsage,
  toPersistedMeters,
  usageQuotaFromEntitlement,
  normalizeMeterInput,
  validateMetersAgainstPricing,
  WELL_KNOWN_METER_DEFAULTS,
} from "./meter-contract.ts";
import type { PlanVersion } from "./types.ts";

function versionWithPricing(
  rows: Array<{ type: "usage" | "extra" | "seat"; key: string; priceCents: number }>,
  meters?: PlanVersion["snapshot"]["meters"],
): PlanVersion {
  return {
    id: "pv-1",
    planId: "plan-1",
    version: 1,
    status: "active",
    snapshot: {
      basePriceCents: 0,
      seatQuota: {},
      botQuota: 0,
      pricing: rows.map((r, i) => ({
        id: `p${i}`,
        planId: "plan-1",
        planVersionId: "pv-1",
        type: r.type,
        key: r.key,
        priceCents: r.priceCents,
      })),
      ...(meters ? { meters } : {}),
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByUserId: "admin",
  };
}

describe("splitMeterUsage", () => {
  it("splits included and overage", () => {
    expect(splitMeterUsage("k", 100, 80)).toMatchObject({ included: 80, overage: 20 });
    expect(splitMeterUsage("k", 50, 80)).toMatchObject({ included: 50, overage: 0 });
  });
});

describe("ai_credits package-included semantics", () => {
  it("WELL_KNOWN default: chargeIncluded=false even when only usage price exists", () => {
    expect(WELL_KNOWN_METER_DEFAULTS.ai_credits.chargeIncludedAtUsagePrice).toBe(false);
  });

  it("does not charge package included credits when only usage price is present", () => {
    // 仅 usage 价、无 extra — 旧逻辑会 chargeIncluded=true，错误地对套餐内额度收费
    const version = versionWithPricing([{ type: "usage", key: "ai_credits", priceCents: 1 }]);
    const meters = buildMeterDefinitions({
      version,
      entitlement: { monthlyCredits: 100 },
      usageKeys: ["ai_credits"],
    });
    expect(meters.find((m) => m.key === "ai_credits")?.chargeIncludedAtUsagePrice).toBe(false);
    expect(meters.find((m) => m.key === "ai_credits")?.includedQuota).toBe(100);

    const r = chargeMeters({
      meters,
      usageByKey: { ai_credits: 80 },
      pricing: version.snapshot.pricing,
      strict: true,
    });
    // 80 全在套餐内 → 0 元；无 overage
    expect(r.usageCostCents).toBe(0);
    expect(r.extraCostCents).toBe(0);
  });

  it("charges only overage when extra price exists", () => {
    const version = versionWithPricing([
      { type: "usage", key: "ai_credits", priceCents: 1 },
      { type: "extra", key: "ai_credits", priceCents: 5 },
    ]);
    const meters = buildMeterDefinitions({
      version,
      entitlement: { monthlyCredits: 100 },
      usageKeys: ["ai_credits"],
    });
    const r = chargeMeters({
      meters,
      usageByKey: { ai_credits: 120 },
      pricing: version.snapshot.pricing,
      strict: true,
    });
    expect(r.usageCostCents).toBe(0);
    expect(r.extraCostCents).toBe(100); // 20 * 5
  });

  it("persisted meter chargeIncluded=true can opt into charging included", () => {
    const version = versionWithPricing(
      [{ type: "usage", key: "ai_credits", priceCents: 1 }],
      [
        {
          key: "ai_credits",
          unit: "credit",
          includedQuota: 100,
          chargeIncludedAtUsagePrice: true,
          allowOverage: false,
        },
      ],
    );
    const meters = buildMeterDefinitions({
      version,
      entitlement: { monthlyCredits: 999 }, // 持久化 includedQuota 可被 entitlement 覆盖
      usageKeys: ["ai_credits"],
    });
    // entitlement 覆盖配额，但不改 charge 标志
    expect(meters[0].chargeIncludedAtUsagePrice).toBe(true);
    expect(meters[0].includedQuota).toBe(999);
    const r = chargeMeters({
      meters,
      usageByKey: { ai_credits: 10 },
      pricing: version.snapshot.pricing,
      strict: true,
    });
    expect(r.usageCostCents).toBe(10);
  });

  it("persisted meters are authoritative over price-based inference", () => {
    const version = versionWithPricing(
      [
        { type: "usage", key: "task", priceCents: 10 },
        { type: "extra", key: "task", priceCents: 20 },
      ],
      [
        {
          key: "task",
          unit: "count",
          includedQuota: 5,
          chargeIncludedAtUsagePrice: false,
          allowOverage: true,
        },
      ],
    );
    const meters = buildMeterDefinitions({ version, usageKeys: ["task"] });
    expect(meters).toHaveLength(1);
    expect(meters[0].chargeIncludedAtUsagePrice).toBe(false);
    const r = chargeMeters({
      meters,
      usageByKey: { task: 8 },
      pricing: version.snapshot.pricing,
      strict: true,
    });
    expect(r.usageCostCents).toBe(0);
    expect(r.extraCostCents).toBe(60); // 3 * 20
  });
});

describe("no implicit ai_token mapping", () => {
  it("does not invent ai_token from credits", () => {
    const version = versionWithPricing([{ type: "extra", key: "ai_token", priceCents: 2 }]);
    const meters = buildMeterDefinitions({
      version,
      entitlement: { monthlyCredits: 5000 },
      usageKeys: ["ai_token", "ai_credits"],
    });
    expect(meters.find((m) => m.key === "ai_token")?.includedQuota).toBe(0);
    expect(meters.find((m) => m.key === "ai_credits")?.includedQuota).toBe(5000);
  });
});

describe("freezeMetersForNewPlanVersion — pricing update", () => {
  it("rebuilds keys from new pricing and preserves chargeIncluded for existing keys", async () => {
    const { freezeMetersForNewPlanVersion } = await import("./meter-contract.ts");
    const previous = [
      {
        key: "ai_credits",
        unit: "credit" as const,
        chargeIncludedAtUsagePrice: false,
        allowOverage: true,
        includedQuota: 500,
      },
      {
        key: "legacy_meter",
        unit: "count" as const,
        chargeIncludedAtUsagePrice: true,
        allowOverage: false,
      },
    ];
    const version = versionWithPricing(
      [
        { type: "extra", key: "ai_credits", priceCents: 5 },
        { type: "usage", key: "new_task", priceCents: 10 }, // new key after price update
      ],
      previous,
    );
    // freeze ignores snapshot.meters for key set; uses pricing + previous policy flags
    const frozen = freezeMetersForNewPlanVersion({
      version: {
        ...version,
        snapshot: { ...version.snapshot, meters: undefined },
      },
      previousMeters: previous,
    });
    const keys = frozen.map((m) => m.key).toSorted();
    expect(keys).toContain("ai_credits");
    expect(keys).toContain("new_task");
    expect(keys).not.toContain("legacy_meter"); // removed with pricing
    const credits = frozen.find((m) => m.key === "ai_credits")!;
    expect(credits.chargeIncludedAtUsagePrice).toBe(false); // preserved
    expect(credits.includedQuota).toBe(500); // preserved explicit quota
    const task = frozen.find((m) => m.key === "new_task")!;
    expect(task.chargeIncludedAtUsagePrice).toBe(true); // pure usage default
  });

  it("does not blindly copy previous meters when pricing drops a key", async () => {
    const { freezeMetersForNewPlanVersion } = await import("./meter-contract.ts");
    const previous = [
      {
        key: "old_only",
        unit: "count" as const,
        chargeIncludedAtUsagePrice: true,
        allowOverage: true,
      },
    ];
    const version = versionWithPricing([{ type: "extra", key: "ai_credits", priceCents: 1 }]);
    const frozen = freezeMetersForNewPlanVersion({
      version,
      previousMeters: previous,
    });
    expect(frozen.map((m) => m.key)).toEqual(["ai_credits"]);
  });
});

describe("toPersistedMeters / usageQuotaFromEntitlement", () => {
  it("round-trips chargeIncluded flag", () => {
    const persisted = toPersistedMeters([
      {
        key: "ai_credits",
        unit: "credit",
        includedQuota: 100,
        chargeIncludedAtUsagePrice: false,
        allowOverage: true,
        aggregate: "sum",
        rounding: "integer",
      },
    ]);
    expect(persisted[0].chargeIncludedAtUsagePrice).toBe(false);
  });

  it("only returns ai_credits", () => {
    expect(usageQuotaFromEntitlement({ monthlyCredits: 5000 })).toEqual({ ai_credits: 5000 });
  });
});

describe("meterAmountCents", () => {
  it("integer cents", () => {
    expect(meterAmountCents(3, 10)).toBe(30);
  });
});

describe("validateMetersAgainstPricing", () => {
  it("rejects duplicate keys, negative quota, invalid unit", () => {
    const pricing = [
      {
        id: "1",
        planId: "p",
        planVersionId: "v",
        type: "extra" as const,
        key: "ai_credits",
        priceCents: 1,
      },
    ];
    expect(() =>
      validateMetersAgainstPricing(
        [
          {
            key: "ai_credits",
            unit: "credit",
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
          {
            key: "ai_credits",
            unit: "credit",
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
        ],
        pricing,
      ),
    ).toThrow(MeterValidationError);

    expect(() =>
      validateMetersAgainstPricing(
        [
          {
            key: "ai_credits",
            unit: "credit",
            includedQuota: -1,
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
        ],
        pricing,
      ),
    ).toThrow(MeterValidationError);

    expect(() =>
      validateMetersAgainstPricing(
        [
          {
            key: "ai_credits",
            unit: "bogus" as "credit",
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
        ],
        pricing,
      ),
    ).toThrow(MeterValidationError);
  });

  it("rejects chargeIncluded without usage price and allowOverage without extra", () => {
    expect(() =>
      validateMetersAgainstPricing(
        [
          {
            key: "ai_token",
            unit: "token",
            chargeIncludedAtUsagePrice: true,
            allowOverage: false,
          },
        ],
        [],
      ),
    ).toThrow(/usage\/ai_token/);

    expect(() =>
      validateMetersAgainstPricing(
        [
          {
            key: "ai_credits",
            unit: "credit",
            chargeIncludedAtUsagePrice: false,
            allowOverage: true,
          },
        ],
        [],
      ),
    ).toThrow(/extra\/ai_credits/);
  });

  it("rejects pricing usage/extra keys without meter", () => {
    expect(() =>
      validateMetersAgainstPricing(
        [],
        [
          {
            id: "1",
            planId: "p",
            planVersionId: "v",
            type: "usage",
            key: "workflow_run",
            priceCents: 10,
          },
        ],
      ),
    ).toThrow(/workflow_run/);
  });

  it("accepts consistent meters and pricing", () => {
    expect(() =>
      validateMetersAgainstPricing(
        [
          {
            key: "ai_token",
            unit: "token",
            chargeIncludedAtUsagePrice: true,
            allowOverage: true,
          },
        ],
        [
          {
            id: "1",
            planId: "p",
            planVersionId: "v",
            type: "usage",
            key: "ai_token",
            priceCents: 1,
          },
          {
            id: "2",
            planId: "p",
            planVersionId: "v",
            type: "extra",
            key: "ai_token",
            priceCents: 2,
          },
        ],
      ),
    ).not.toThrow();
  });
});

describe("normalizeMeterInput illegal quota", () => {
  it("rejects negative, NaN, and non-finite quota", () => {
    expect(() =>
      normalizeMeterInput([
        {
          key: "x",
          unit: "count",
          includedQuota: -1,
          chargeIncludedAtUsagePrice: false,
          allowOverage: false,
        },
      ]),
    ).toThrow(MeterValidationError);

    expect(() =>
      normalizeMeterInput([
        {
          key: "x",
          unit: "count",
          includedQuota: Number.NaN,
          chargeIncludedAtUsagePrice: false,
          allowOverage: false,
        },
      ]),
    ).toThrow(MeterValidationError);

    expect(() =>
      normalizeMeterInput([
        {
          key: "x",
          unit: "count",
          includedQuota: Number.POSITIVE_INFINITY,
          chargeIncludedAtUsagePrice: false,
          allowOverage: false,
        },
      ]),
    ).toThrow(MeterValidationError);

    expect(() =>
      normalizeMeterInput([
        {
          key: "x",
          unit: "bogus" as "count",
          chargeIncludedAtUsagePrice: false,
          allowOverage: false,
        },
      ]),
    ).toThrow(MeterValidationError);
  });

  it("accepts zero and positive integer quota", () => {
    const ok = normalizeMeterInput([
      {
        key: "x",
        unit: "count",
        includedQuota: 0,
        chargeIncludedAtUsagePrice: false,
        allowOverage: false,
      },
      {
        key: "y",
        unit: "token",
        includedQuota: 10.4,
        chargeIncludedAtUsagePrice: false,
        allowOverage: false,
      },
    ]);
    expect(ok[0].includedQuota).toBe(0);
    expect(ok[1].includedQuota).toBe(10);
  });
});
