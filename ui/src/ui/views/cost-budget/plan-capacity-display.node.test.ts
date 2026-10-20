import { describe, expect, it } from "vitest";
import { i18n } from "../../../i18n/index.ts";
import type { Plan } from "../../capability/cost-budget-billing/index.ts";
import { buildPlanCapacitySummary } from "./plan-capacity-display.ts";

function plan(partial: Partial<Plan> & Pick<Plan, "id" | "name">): Plan {
  return {
    billingCycle: "monthly",
    basePriceCents: 89_900,
    currentVersionId: "pv-1",
    seatQuota: { viewer: 20, creator: 10 },
    botQuota: 120,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("buildPlanCapacitySummary", () => {
  it("uses plan seat/bot totals for professional slot", async () => {
    await i18n.setLocale("zh-CN");
    const summary = buildPlanCapacitySummary({
      plan: plan({ id: "p-pro", name: "Professional" }),
    });
    expect(summary.slotKey).toBe("professional");
    expect(summary.teamMembers).toBe(30);
    expect(summary.aiEmployees).toBe(120);
    expect(summary.concurrentRuns).toBe(20);
    expect(summary.monthlyCredits).toBe(30_000);
  });

  it("uses the updated starter fallback concurrency from the package matrix", () => {
    const summary = buildPlanCapacitySummary({
      plan: plan({
        id: "p-starter",
        name: "Starter",
        seatQuota: { viewer: 6, creator: 3, admin: 1 },
        botQuota: 30,
      }),
    });
    expect(summary.teamMembers).toBe(10);
    expect(summary.aiEmployees).toBe(30);
    expect(summary.concurrentRuns).toBe(5);
  });

  it("prefers entitlement concurrent and credits", () => {
    const summary = buildPlanCapacitySummary({
      plan: plan({ id: "p-pro", name: "Professional", botQuota: 50 }),
      entitlement: { maxConcurrentRuns: 25, monthlyCredits: 12_000 },
    });
    expect(summary.concurrentRuns).toBe(25);
    expect(summary.monthlyCredits).toBe(12_000);
    expect(summary.capacitySource).toBe("entitlement");
  });

  it("marks enterprise as contact sales", () => {
    const summary = buildPlanCapacitySummary({
      plan: plan({
        id: "p-ent",
        name: "Enterprise",
        basePriceCents: 0,
        botQuota: 0,
        seatQuota: {},
      }),
    });
    expect(summary.contactSales).toBe(true);
    expect(summary.slotKey).toBe("enterprise");
  });

  it("tolerates missing seatQuota on legacy plan snapshots", () => {
    const summary = buildPlanCapacitySummary({
      plan: {
        id: "plan-1",
        name: "Growth",
        billingCycle: "monthly",
        basePriceCents: 0,
        currentVersionId: "pv-1",
        seatQuota: {},
        botQuota: 10,
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(summary.aiEmployees).toBe(10);
    expect(summary.teamMembers).toBe(0);
  });
});
