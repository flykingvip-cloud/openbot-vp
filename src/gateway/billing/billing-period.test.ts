// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  addUtcMonths,
  buildSettlementKey,
  ContractEndedError,
  countMonthsInCycleWindow,
  cycleWindowAtPeriodIndex,
  deterministicBillId,
  InvalidContractError,
  isCycleComplete,
  listCompletedSettlementCycles,
  listCreditsResetWindowsInCycle,
  resolveContainingCycle,
  resolveCreditsResetCycle,
  resolveCycleWindowFromAnchor,
  resolveLatestCompletedCycle,
} from "./billing-period.ts";
import type { Subscription } from "./types.ts";

describe("countMonthsInCycleWindow", () => {
  it("full annual window is 12 months", () => {
    expect(countMonthsInCycleWindow("2026-01-15T00:00:00.000Z", "2027-01-15T00:00:00.000Z")).toBe(
      12,
    );
  });

  it("truncated annual 6 months is 6 not 12", () => {
    expect(countMonthsInCycleWindow("2026-01-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z")).toBe(
      6,
    );
  });

  it("truncated quarterly to 1 month is 1 not 3", () => {
    expect(countMonthsInCycleWindow("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z")).toBe(
      1,
    );
  });

  it("full quarterly window is 3 months", () => {
    expect(countMonthsInCycleWindow("2026-01-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z")).toBe(
      3,
    );
  });

  it("mid-month start to month-start end counts partial last reset window", () => {
    // [1/15, 2/15) + [2/15, 3/01) → 2；不得只计 1 个「完整月」
    expect(countMonthsInCycleWindow("2026-01-15T00:00:00.000Z", "2026-03-01T00:00:00.000Z")).toBe(
      2,
    );
  });

  it("month-end anchor to mid-month end counts 2 windows without chain drift", () => {
    // [1/31, 2/28) + [2/28, 3/15) → 2（锚点始终 1/31，禁止 1/31→2/28→3/28 漂移）
    expect(countMonthsInCycleWindow("2026-01-31T00:00:00.000Z", "2026-03-15T00:00:00.000Z")).toBe(
      2,
    );
  });
});

describe("listCreditsResetWindowsInCycle (partial months)", () => {
  it("2026-01-15 → 2026-03-01 returns 2 credits reset windows", () => {
    const windows = listCreditsResetWindowsInCycle(
      "2026-01-15T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
    );
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({
      cycleStart: "2026-01-15T00:00:00.000Z",
      cycleEnd: "2026-02-15T00:00:00.000Z",
      purpose: "credits_reset",
      periodIndex: 0,
    });
    expect(windows[1]).toMatchObject({
      cycleStart: "2026-02-15T00:00:00.000Z",
      cycleEnd: "2026-03-01T00:00:00.000Z",
      purpose: "credits_reset",
      periodIndex: 1,
      truncatedByContractEnd: true,
    });
    expect(countMonthsInCycleWindow("2026-01-15T00:00:00.000Z", "2026-03-01T00:00:00.000Z")).toBe(
      2,
    );
  });

  it("2026-01-31 → 2026-03-15 counts 2 windows from original month-end anchor", () => {
    const anchor = "2026-01-31T00:00:00.000Z";
    const end = "2026-03-15T00:00:00.000Z";
    const windows = listCreditsResetWindowsInCycle(anchor, end);
    expect(windows).toHaveLength(2);
    // 从原始锚点推算，非链式：+1 → Feb28，+2 → Mar31
    expect(windows[0].cycleStart).toBe(anchor);
    expect(windows[0].cycleEnd).toBe(addUtcMonths(anchor, 1));
    expect(windows[0].cycleEnd).toBe("2026-02-28T00:00:00.000Z");
    expect(windows[1].cycleStart).toBe(addUtcMonths(anchor, 1));
    expect(windows[1].cycleStart).toBe("2026-02-28T00:00:00.000Z");
    expect(windows[1].cycleEnd).toBe(end);
    expect(windows[1].truncatedByContractEnd).toBe(true);
    // 禁止链式漂移：不得出现 3/28 作为第二窗起点
    expect(windows[1].cycleStart).not.toBe("2026-03-28T00:00:00.000Z");
    expect(countMonthsInCycleWindow(anchor, end)).toBe(2);
  });
});

describe("addUtcMonths + cycleWindowAtPeriodIndex (no chain drift)", () => {
  it("computes every boundary from original anchor, not previous end", () => {
    const anchor = "2026-01-31T12:00:00.000Z";
    const p0 = cycleWindowAtPeriodIndex({
      anchorIso: anchor,
      billingCycle: "monthly",
      periodIndex: 0,
      source: "subscription_start",
      purpose: "usage_settlement",
    });
    const p1 = cycleWindowAtPeriodIndex({
      anchorIso: anchor,
      billingCycle: "monthly",
      periodIndex: 1,
      source: "subscription_start",
      purpose: "usage_settlement",
    });
    const p2 = cycleWindowAtPeriodIndex({
      anchorIso: anchor,
      billingCycle: "monthly",
      periodIndex: 2,
      source: "subscription_start",
      purpose: "usage_settlement",
    });
    expect(p0.cycleStart).toBe(anchor);
    expect(p0.cycleEnd).toBe(addUtcMonths(anchor, 1));
    expect(p1.cycleStart).toBe(addUtcMonths(anchor, 1));
    expect(p1.cycleEnd).toBe(addUtcMonths(anchor, 2));
    expect(p2.cycleStart).toBe(addUtcMonths(anchor, 2));
    expect(p2.cycleEnd).toBe(addUtcMonths(anchor, 3));
    expect(addUtcMonths(p0.cycleEnd, 1)).not.toBe(p1.cycleEnd);
  });

  it("leap year Feb 29 recovery", () => {
    const anchor = "2024-01-31T00:00:00.000Z";
    const p0 = cycleWindowAtPeriodIndex({
      anchorIso: anchor,
      billingCycle: "monthly",
      periodIndex: 0,
      source: "commercial_contract",
      purpose: "usage_settlement",
    });
    expect(p0.cycleEnd).toBe("2024-02-29T00:00:00.000Z");
    const p1 = cycleWindowAtPeriodIndex({
      anchorIso: anchor,
      billingCycle: "monthly",
      periodIndex: 1,
      source: "commercial_contract",
      purpose: "usage_settlement",
    });
    expect(p1.cycleStart).toBe("2024-02-29T00:00:00.000Z");
    expect(p1.cycleEnd).toBe("2024-03-31T00:00:00.000Z");
  });
});

describe("resolveContainingCycle vs resolveLatestCompletedCycle", () => {
  const sub = {
    id: "sub-1",
    startTime: "2026-01-01T00:00:00.000Z",
    commercialContract: {
      billingCycle: "monthly" as const,
      contractStart: "2026-01-01T00:00:00.000Z",
      contractEnd: "2027-01-01T00:00:00.000Z",
    },
  } satisfies Pick<Subscription, "id" | "startTime" | "commercialContract">;

  it("containing mid-cycle is open period; latest completed is previous", () => {
    const at = new Date("2026-02-15T00:00:00.000Z");
    const containing = resolveContainingCycle(sub, at);
    expect(containing.periodIndex).toBe(1);
    expect(containing.purpose).toBe("usage_settlement");
    expect(containing.cycleStart).toBe("2026-02-01T00:00:00.000Z");

    const completed = resolveLatestCompletedCycle(sub, at);
    expect(completed).not.toBeNull();
    expect(completed!.periodIndex).toBe(0);
    expect(completed!.cycleStart).toBe("2026-01-01T00:00:00.000Z");
  });

  it("before first cycle ends: no completed cycle", () => {
    const at = new Date("2026-01-15T00:00:00.000Z");
    expect(resolveLatestCompletedCycle(sub, at)).toBeNull();
  });

  it("exactly at cycle boundary: previous period is completed", () => {
    const at = new Date("2026-02-01T00:00:00.000Z");
    const completed = resolveLatestCompletedCycle(sub, at);
    expect(completed!.periodIndex).toBe(0);
  });

  it("credits_reset is always monthly under annual contract", () => {
    const annual = {
      id: "sub-a",
      startTime: "2026-03-15T00:00:00.000Z",
      commercialContract: {
        billingCycle: "annual" as const,
        contractStart: "2026-03-15T00:00:00.000Z",
        contractEnd: "2027-03-15T00:00:00.000Z",
      },
    };
    const credits = resolveCreditsResetCycle(annual, new Date("2026-08-01T00:00:00.000Z"));
    expect(credits.purpose).toBe("credits_reset");
    expect(credits.billingCycle).toBe("monthly");
    expect(credits.cycleStart).toBe("2026-07-15T00:00:00.000Z");
    expect(credits.cycleEnd).toBe("2026-08-15T00:00:00.000Z");
  });

  it("continuous subscription multi-period from anchor (no drift over 14 months)", () => {
    // contractEnd 须覆盖完整 14 个周期，否则 at>=contractEnd 时不得 preview
    const long = {
      id: "sub-14",
      startTime: "2026-01-01T00:00:00.000Z",
      commercialContract: {
        billingCycle: "monthly" as const,
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2028-01-01T00:00:00.000Z",
      },
    };
    const anchor = long.commercialContract.contractStart;
    for (let i = 0; i < 14; i++) {
      const start = addUtcMonths(anchor, i);
      const mid = new Date(Date.parse(start) + 5 * 86_400_000);
      const w = resolveContainingCycle(long, mid);
      expect(w.periodIndex).toBe(i);
      expect(w.cycleStart).toBe(addUtcMonths(anchor, i));
      expect(w.cycleEnd).toBe(addUtcMonths(anchor, i + 1));
    }
  });

  it("continuous 14 months from month-end anchor (Jan 31) has no chain drift", () => {
    const eom = {
      id: "sub-eom",
      startTime: "2026-01-31T00:00:00.000Z",
      commercialContract: {
        billingCycle: "monthly" as const,
        contractStart: "2026-01-31T00:00:00.000Z",
        contractEnd: "2027-04-30T00:00:00.000Z",
      },
    };
    const anchor = eom.commercialContract.contractStart;
    for (let i = 0; i < 14; i++) {
      const start = addUtcMonths(anchor, i);
      const mid = new Date(Date.parse(start) + 3 * 86_400_000);
      const w = resolveContainingCycle(eom, mid);
      expect(w.periodIndex).toBe(i);
      const fromAnchorStart = addUtcMonths(anchor, i);
      const fromAnchorEnd = addUtcMonths(anchor, i + 1);
      expect(w.cycleStart).toBe(fromAnchorStart);
      expect(w.cycleEnd).toBe(fromAnchorEnd);
      // 链式推进（上一期末 +1m）在月末锚点下会漂移，from-anchor 公式不受影响
      if (i >= 1) {
        const chainedStart = addUtcMonths(addUtcMonths(anchor, i - 1), 1);
        if (chainedStart !== fromAnchorStart) {
          expect(w.cycleStart).not.toBe(chainedStart);
        }
      }
    }
  });
});

describe("legacy resolveCycleWindowFromAnchor + keys", () => {
  it("still resolves containing window", () => {
    const w = resolveCycleWindowFromAnchor({
      anchorIso: "2026-01-10T00:00:00.000Z",
      billingCycle: "monthly",
      at: new Date("2026-03-15T00:00:00.000Z"),
      source: "subscription_start",
    });
    expect(w.cycleStart).toBe("2026-03-10T00:00:00.000Z");
    expect(w.periodIndex).toBe(2);
  });

  it("settlement key deterministic", () => {
    const key = buildSettlementKey({
      enterpriseId: "ent-a",
      subscriptionId: "sub-1",
      planVersionId: "pv-1",
      cycleStart: "2026-01-01T00:00:00.000Z",
      cycleEnd: "2026-02-01T00:00:00.000Z",
    });
    expect(deterministicBillId(key)).toBe(deterministicBillId(key));
  });

  it("isCycleComplete", () => {
    expect(isCycleComplete("2026-02-01T00:00:00.000Z", new Date("2026-01-31T23:59:59.999Z"))).toBe(
      false,
    );
    expect(isCycleComplete("2026-02-01T00:00:00.000Z", new Date("2026-02-01T00:00:00.000Z"))).toBe(
      true,
    );
  });
});

describe("contractEnd clamps all three period purposes", () => {
  it("annual contract cannot generate second year cycle", () => {
    const sub = {
      id: "sub-annual",
      startTime: "2026-01-01T00:00:00.000Z",
      commercialContract: {
        billingCycle: "annual" as const,
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2027-01-01T00:00:00.000Z",
      },
    };
    const midYear = resolveContainingCycle(sub, new Date("2026-06-15T00:00:00.000Z"));
    expect(midYear.periodIndex).toBe(0);
    expect(midYear.cycleEnd).toBe("2027-01-01T00:00:00.000Z");

    expect(() => resolveContainingCycle(sub, new Date("2027-01-01T00:00:00.000Z"))).toThrow(
      ContractEndedError,
    );
    expect(() => resolveContainingCycle(sub, new Date("2027-02-01T00:00:00.000Z"))).toThrow(
      ContractEndedError,
    );
  });

  it("quarterly contract cannot generate next quarter after end", () => {
    const sub = {
      id: "sub-q",
      startTime: "2026-01-01T00:00:00.000Z",
      commercialContract: {
        billingCycle: "quarterly" as const,
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2026-04-01T00:00:00.000Z",
      },
    };
    const q0 = resolveContainingCycle(sub, new Date("2026-02-15T00:00:00.000Z"));
    expect(q0.periodIndex).toBe(0);
    expect(q0.cycleEnd).toBe("2026-04-01T00:00:00.000Z");
    expect(() => resolveContainingCycle(sub, new Date("2026-04-01T00:00:00.000Z"))).toThrow(
      ContractEndedError,
    );
  });

  it("on contractEnd day: final can settle last period, preview next fails", () => {
    const sub = {
      id: "sub-end",
      startTime: "2026-01-01T00:00:00.000Z",
      commercialContract: {
        billingCycle: "monthly" as const,
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2026-02-01T00:00:00.000Z",
      },
    };
    const atEnd = new Date("2026-02-01T00:00:00.000Z");
    const completed = listCompletedSettlementCycles(sub, atEnd);
    expect(completed).toHaveLength(1);
    expect(completed[0].periodIndex).toBe(0);
    expect(completed[0].cycleEnd).toBe("2026-02-01T00:00:00.000Z");

    expect(() => resolveContainingCycle(sub, atEnd)).toThrow(ContractEndedError);
    expect(() => resolveCreditsResetCycle(sub, atEnd)).toThrow(ContractEndedError);
  });

  it("truncated last period clamps cycleEnd to contractEnd", () => {
    // period 1 raw would be [Feb15, Mar15); clamped to Mar1 by contractEnd
    const w = cycleWindowAtPeriodIndex({
      anchorIso: "2026-01-15T00:00:00.000Z",
      billingCycle: "monthly",
      periodIndex: 1,
      source: "commercial_contract",
      purpose: "usage_settlement",
      contractEndIso: "2026-03-01T00:00:00.000Z",
    });
    expect(w.cycleStart).toBe("2026-02-15T00:00:00.000Z");
    expect(w.cycleEnd).toBe("2026-03-01T00:00:00.000Z");
    expect(w.truncatedByContractEnd).toBe(true);
  });

  it("credits_reset refuses after contractEnd (no new bucket)", () => {
    const sub = {
      id: "sub-cr",
      startTime: "2026-01-01T00:00:00.000Z",
      commercialContract: {
        billingCycle: "annual" as const,
        contractStart: "2026-01-01T00:00:00.000Z",
        contractEnd: "2027-01-01T00:00:00.000Z",
      },
    };
    const ok = resolveCreditsResetCycle(sub, new Date("2026-12-15T00:00:00.000Z"));
    expect(ok.purpose).toBe("credits_reset");
    expect(() => resolveCreditsResetCycle(sub, new Date("2027-01-01T00:00:00.000Z"))).toThrow(
      ContractEndedError,
    );
  });

  it("rejects invalid contract bounds contractEnd <= contractStart", () => {
    const sub = {
      id: "sub-bad",
      startTime: "2026-01-01T00:00:00.000Z",
      commercialContract: {
        billingCycle: "monthly" as const,
        contractStart: "2026-06-01T00:00:00.000Z",
        contractEnd: "2026-06-01T00:00:00.000Z",
      },
    };
    expect(() => resolveContainingCycle(sub, new Date("2026-06-01T12:00:00.000Z"))).toThrow(
      InvalidContractError,
    );
  });

  it("renewal uses new contract anchor (not infinite extension)", () => {
    const renewed = {
      id: "sub-renew",
      startTime: "2026-01-01T00:00:00.000Z",
      commercialContract: {
        billingCycle: "annual" as const,
        contractStart: "2027-01-01T00:00:00.000Z",
        contractEnd: "2028-01-01T00:00:00.000Z",
      },
    };
    const w = resolveContainingCycle(renewed, new Date("2027-06-01T00:00:00.000Z"));
    expect(w.cycleStart).toBe("2027-01-01T00:00:00.000Z");
    expect(w.periodIndex).toBe(0);
    expect(w.cycleEnd).toBe("2028-01-01T00:00:00.000Z");
  });
});
