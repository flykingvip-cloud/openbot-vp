// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveCreditsResetCycle,
  resolveContainingCycle,
  resolvePaymentContractCycle,
} from "./billing-period.ts";
import { createPlan, __resetPlansForTest } from "./plans-store.ts";
import { resolveEnterpriseCreditsResetWindow, resolveEnterpriseCycleWindow } from "./runtime.ts";
import {
  createSubscription,
  setSubscriptionCommercialContract,
  __resetSubscriptionsForTest,
} from "./subscriptions-store.ts";

let tmpDir: string;
let plansPath: string;
let subsPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ob-cycle-"));
  plansPath = path.join(tmpDir, "plans.json");
  subsPath = path.join(tmpDir, "subs.json");
  await __resetPlansForTest(plansPath);
  await __resetSubscriptionsForTest(subsPath);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("three period concepts stay independent", () => {
  it("annual payment contract ≠ monthly credits reset", () => {
    const sub = {
      id: "sub-1",
      startTime: "2026-03-15T00:00:00.000Z",
      commercialContract: {
        billingCycle: "annual" as const,
        contractStart: "2026-03-15T00:00:00.000Z",
        contractEnd: "2027-03-15T00:00:00.000Z",
      },
    };
    const at = new Date("2026-08-01T00:00:00.000Z");
    const payment = resolvePaymentContractCycle(sub, at, "annual");
    const usage = resolveContainingCycle(sub, at, "annual", "usage_settlement");
    const credits = resolveCreditsResetCycle(sub, at);

    expect(payment.purpose).toBe("payment_contract");
    expect(usage.purpose).toBe("usage_settlement");
    expect(credits.purpose).toBe("credits_reset");

    // 年付：付款/出账窗是整年
    expect(usage.billingCycle).toBe("annual");
    expect(usage.cycleStart).toBe("2026-03-15T00:00:00.000Z");
    expect(usage.cycleEnd).toBe("2027-03-15T00:00:00.000Z");

    // Credits：始终 monthly 切片
    expect(credits.billingCycle).toBe("monthly");
    expect(credits.cycleStart).toBe("2026-07-15T00:00:00.000Z");
    expect(credits.cycleEnd).toBe("2026-08-15T00:00:00.000Z");
  });
});

describe("resolveEnterpriseCycleWindow — usage settlement", () => {
  it("uses subscription commercialContract for annual settlement, not calendar month", async () => {
    const plan = await createPlan(
      {
        name: "Annual",
        billingCycle: "annual",
        basePriceCents: 100_00,
        seatQuota: { viewer: 5 },
        botQuota: 3,
        pricing: [{ type: "extra", key: "ai_credits", priceCents: 1 }],
        createdByUserId: "admin",
      },
      plansPath,
    );
    const ver = await (
      await import("./plans-store.ts")
    ).getPlanVersion(plan.currentVersionId, plansPath);
    expect(ver?.snapshot.meters?.length).toBeGreaterThan(0);

    const sub = await createSubscription(
      {
        enterpriseId: "ent-cycle",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        startTime: "2026-03-15T00:00:00.000Z",
      },
      subsPath,
    );
    await setSubscriptionCommercialContract(
      "ent-cycle",
      sub.id,
      {
        billingCycle: "annual",
        contractStart: "2026-03-15T00:00:00.000Z",
        contractEnd: "2027-03-15T00:00:00.000Z",
      },
      subsPath,
    );

    const w = await resolveEnterpriseCycleWindow(
      "ent-cycle",
      new Date("2026-08-01T00:00:00.000Z"),
      {
        plans: plansPath,
        subscriptions: subsPath,
      },
    );
    expect(w.cycleStart).toBe("2026-03-15T00:00:00.000Z");
    expect(w.purpose).toBe("usage_settlement");
  });

  it("falls back to calendar month only without subscription", async () => {
    const w = await resolveEnterpriseCycleWindow("ent-none", new Date("2026-08-15T00:00:00.000Z"), {
      plans: plansPath,
      subscriptions: subsPath,
    });
    expect(w.cycleStart).toBe("2026-08-01T00:00:00.000Z");
    expect(w.source).toBe("calendar_month_fallback");
  });
});

describe("credits reset is monthly even under annual contract", () => {
  it("resolveTenantCreditsStatus uses monthly credits_reset not annual payment window", async () => {
    const plan = await createPlan(
      {
        name: "AnnualCredits",
        billingCycle: "annual",
        basePriceCents: 999_00,
        seatQuota: { viewer: 2 },
        botQuota: 1,
        pricing: [{ type: "extra", key: "ai_credits", priceCents: 1 }],
        createdByUserId: "admin",
      },
      plansPath,
    );
    const sub = await createSubscription(
      {
        enterpriseId: "ent-cred",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        startTime: "2026-01-15T00:00:00.000Z",
      },
      subsPath,
    );
    await setSubscriptionCommercialContract(
      "ent-cred",
      sub.id,
      {
        billingCycle: "annual",
        contractStart: "2026-01-15T00:00:00.000Z",
        contractEnd: "2027-01-15T00:00:00.000Z",
      },
      subsPath,
    );
    const { resolveTenantCreditsStatus } = await import("./record-credit-usage.ts");
    const status = await resolveTenantCreditsStatus(
      "ent-cred",
      { subscriptions: subsPath, plans: plansPath },
      new Date("2026-08-01T00:00:00.000Z"),
    );
    // monthly slice from Jan 15 → Jul 15 – Aug 15, NOT full year
    expect(status?.cycleStart).toBe("2026-07-15T00:00:00.000Z");
  });

  it("delayed report after upgrade uses locked subscriptionId not new active contract", async () => {
    const planOld = await createPlan(
      {
        name: "Old",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: {},
        botQuota: 1,
        pricing: [{ type: "extra", key: "ai_credits", priceCents: 1 }],
        createdByUserId: "admin",
      },
      plansPath,
    );
    const planNew = await createPlan(
      {
        name: "New",
        billingCycle: "monthly",
        basePriceCents: 2000,
        seatQuota: {},
        botQuota: 1,
        pricing: [{ type: "extra", key: "ai_credits", priceCents: 1 }],
        createdByUserId: "admin",
      },
      plansPath,
    );
    // Old subscription on anchor 2026-01-10
    const oldSub = await createSubscription(
      {
        enterpriseId: "ent-upg",
        planId: planOld.id,
        planVersionId: planOld.currentVersionId,
        startTime: "2026-01-10T00:00:00.000Z",
      },
      subsPath,
    );
    await setSubscriptionCommercialContract(
      "ent-upg",
      oldSub.id,
      {
        billingCycle: "monthly",
        contractStart: "2026-01-10T00:00:00.000Z",
        contractEnd: "2026-02-10T00:00:00.000Z",
      },
      subsPath,
    );
    // Upgrade: new active subscription with different anchor 2026-06-01
    const { transitionSubscriptionStatus } = await import("./subscriptions-store.ts");
    await transitionSubscriptionStatus("ent-upg", oldSub.id, "canceled", subsPath);
    const newSub = await createSubscription(
      {
        enterpriseId: "ent-upg",
        planId: planNew.id,
        planVersionId: planNew.currentVersionId,
        startTime: "2026-06-01T00:00:00.000Z",
      },
      subsPath,
    );
    await setSubscriptionCommercialContract(
      "ent-upg",
      newSub.id,
      {
        billingCycle: "monthly",
        contractStart: "2026-06-01T00:00:00.000Z",
        contractEnd: "2026-07-01T00:00:00.000Z",
      },
      subsPath,
    );

    // Locked old sub → credits window from Jan 10 anchor
    const locked = await resolveEnterpriseCreditsResetWindow(
      "ent-upg",
      new Date("2026-01-25T00:00:00.000Z"),
      { subscriptions: subsPath },
      oldSub,
    );
    expect(locked.cycleStart).toBe("2026-01-10T00:00:00.000Z");
    expect(locked.purpose).toBe("credits_reset");

    // Active (new) sub at same timestamp would differ if we wrongly used active only
    const active = await resolveEnterpriseCreditsResetWindow(
      "ent-upg",
      new Date("2026-01-25T00:00:00.000Z"),
      { subscriptions: subsPath },
    );
    // active is newSub starting Jun 1 — containing for Jan 25 is period 0 before start → periodIndex 0 = Jun1?
    // at < anchor → period 0 starts Jun 1
    expect(active.cycleStart).toBe("2026-06-01T00:00:00.000Z");
    expect(active.cycleStart).not.toBe(locked.cycleStart);
  });
});
