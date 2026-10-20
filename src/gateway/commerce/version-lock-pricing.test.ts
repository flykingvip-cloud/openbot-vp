// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-commerce-lock-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { __resetPlansForTest, activatePlanVersion, createPlan, updatePlan } =
  await import("../billing/plans-store.js");
const { __resetSubscriptionsForTest, getActiveSubscription } =
  await import("../billing/subscriptions-store.js");
const { confirmManualPayment, createChangePlanCommercialOrder, createSubscribeCommercialOrder } =
  await import("./create-order-service.js");
const { __resetCommercialOrdersForTest } = await import("./commercial-orders-store.js");
const { __resetPaymentsForTest } = await import("./payments-store.js");

describe("change-plan version lock pricing", () => {
  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    await __resetPlansForTest();
    await __resetSubscriptionsForTest();
    await __resetCommercialOrdersForTest();
    await __resetPaymentsForTest();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses locked PlanVersion snapshot after Plan head price increases", async () => {
    const enterpriseId = "ent-lock-test";
    const starter = await createPlan({
      name: "Starter",
      billingCycle: "monthly",
      basePriceCents: 10_000,
      seatQuota: { viewer: 5 },
      botQuota: 2,
      pricing: [],
      createdByUserId: "admin",
      commercial: { purchaseMode: "self_serve", slot: "starter" },
    });
    const pro = await createPlan({
      name: "Professional",
      billingCycle: "monthly",
      basePriceCents: 30_000,
      seatQuota: { viewer: 20 },
      botQuota: 5,
      pricing: [],
      createdByUserId: "admin",
      commercial: { purchaseMode: "self_serve", slot: "professional" },
    });

    const subscribe = await createSubscribeCommercialOrder({
      enterpriseId,
      planId: starter.id,
    });
    expect(subscribe.order.amountCents).toBe(10_000);
    await confirmManualPayment({
      paymentId: subscribe.payment!.id,
      enterpriseId,
      requestId: "lock-sub",
    });

    const active = await getActiveSubscription(enterpriseId);
    expect(active?.planVersionId).toBeTruthy();
    const lockedVersionId = active!.planVersionId;

    const draft = await updatePlan({
      planId: starter.id,
      basePriceCents: 99_000,
      createdByUserId: "admin",
    });
    expect(draft).toBeTruthy();
    await activatePlanVersion({
      planId: starter.id,
      versionId: draft!.version.id,
      requestId: "activate-higher-price",
      changedByUserId: "admin",
    });

    const change = await createChangePlanCommercialOrder({
      enterpriseId,
      targetPlanId: pro.id,
    });
    expect(change.order.quotedPlanVersionIds?.[0]).toBe(lockedVersionId);
    const creditLine = change.order.lineItems.find((item) => item.label.includes("抵扣"));
    expect(creditLine?.label).toContain(lockedVersionId);
    expect(Math.abs(creditLine?.amountCents ?? 0)).toBeLessThan(99_000);
    expect(change.order.amountCents).toBeGreaterThan(0);
  });
});
