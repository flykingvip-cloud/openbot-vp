// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-renew-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { __resetCreditPacksForTest, upsertCreditPack } = await import("./credit-packs-store.js");
const { __resetCommercialOrdersForTest } = await import("./commercial-orders-store.js");
const { __resetPaymentsForTest } = await import("./payments-store.js");
const { __resetTenantCreditsForTest, getTenantCreditsBalance } =
  await import("../billing/tenant-credits-store.js");
const { __resetSubscriptionsForTest } = await import("../billing/subscriptions-store.js");
const { createRenewCommercialOrder, createRechargeCreditsCommercialOrder, confirmManualPayment } =
  await import("./create-order-service.js");
const { createPlan } = await import("../billing/plans-store.js");
const { createSubscription, setSubscriptionCommercialContract } =
  await import("../billing/subscriptions-store.js");
const { buildCommercialContract } = await import("./commercial-contract.js");
const { fulfillCommercialOrder } = await import("./order-fulfillment.js");
const { resolveCycleWindow } = await import("../billing/runtime.js");

async function seedActiveSubscription(enterpriseId: string) {
  const plan = await createPlan({
    name: "Pro",
    billingCycle: "monthly",
    basePriceCents: 9900,
    seatQuota: { viewer: 5 },
    botQuota: 2,
    createdByUserId: "test",
    pricing: [],
  });
  const subscription = await createSubscription({
    enterpriseId,
    planId: plan.id,
    planVersionId: plan.currentVersionId,
    initialStatus: "active",
  });
  const contract = buildCommercialContract(new Date(), "monthly");
  const withContract =
    (await setSubscriptionCommercialContract(enterpriseId, subscription.id, contract)) ??
    subscription;
  return { plan, subscription: withContract };
}

describe("renew & credit pack commerce", () => {
  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    await __resetCommercialOrdersForTest();
    await __resetPaymentsForTest();
    await __resetSubscriptionsForTest();
    await __resetCreditPacksForTest();
    await __resetTenantCreditsForTest();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createRenewCommercialOrder uses locked plan version price", async () => {
    const { subscription } = await seedActiveSubscription("ent-renew");
    const result = await createRenewCommercialOrder({ enterpriseId: "ent-renew" });
    expect(result.autoPaid).toBe(false);
    expect(result.order.kind).toBe("renew");
    expect(result.order.amountCents).toBe(9900);
    expect(result.order.subscriptionId).toBe(subscription.id);
    expect(result.order.planVersionId).toBe(subscription.planVersionId);
  });

  it("renew fulfillment extends commercialContract", async () => {
    const { subscription } = await seedActiveSubscription("ent-renew");
    const created = await createRenewCommercialOrder({ enterpriseId: "ent-renew" });
    expect(created.payment).toBeTruthy();
    const confirmed = await confirmManualPayment({ paymentId: created.payment!.id });
    expect(confirmed.fulfillment?.deduped).toBe(false);
    const updated = confirmed.fulfillment?.subscription;
    expect(updated?.commercialContract?.contractStart).toBe(
      subscription.commercialContract!.contractEnd,
    );
    expect(Date.parse(updated!.commercialContract!.contractEnd)).toBeGreaterThan(
      Date.parse(subscription.commercialContract!.contractEnd),
    );
  });

  it("recharge credits requires active subscription", async () => {
    const pack = await upsertCreditPack({
      name: "任务加速包",
      credits: 500,
      priceCents: 19900,
    });
    await expect(
      createRechargeCreditsCommercialOrder({
        enterpriseId: "ent-none",
        creditPackId: pack.id,
      }),
    ).rejects.toThrow(/生效订阅/);
  });

  it("recharge fulfillment appends credits to current cycle", async () => {
    await seedActiveSubscription("ent-pack");
    const pack = await upsertCreditPack({
      name: "额外容量包",
      credits: 300,
      priceCents: 9900,
    });
    const created = await createRechargeCreditsCommercialOrder({
      enterpriseId: "ent-pack",
      creditPackId: pack.id,
    });
    const confirmed = await confirmManualPayment({ paymentId: created.payment!.id });
    expect(confirmed.fulfillment?.deduped).toBe(false);

    const { cycleStart } = resolveCycleWindow();
    const balance = await getTenantCreditsBalance("ent-pack", cycleStart);
    expect(balance?.monthlyCredits).toBeGreaterThanOrEqual(300);
  });

  it("fulfillCommercialOrder is idempotent for renew", async () => {
    await seedActiveSubscription("ent-idem");
    const created = await createRenewCommercialOrder({ enterpriseId: "ent-idem" });
    await confirmManualPayment({ paymentId: created.payment!.id });
    const second = await fulfillCommercialOrder(created.order.id);
    expect(second.deduped).toBe(true);
  });
});
