// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-billing-projection-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { createPlan } = await import("../billing/plans-store.js");
const { __resetSubscriptionsForTest } = await import("../billing/subscriptions-store.js");
const { __resetCommercialOrdersForTest } = await import("./commercial-orders-store.js");
const { createSubscribeCommercialOrder } = await import("./create-order-service.js");
const { resolveTenantBillingProjectionStatus } = await import("./tenant-billing-projection.js");

describe("tenant-billing-projection", () => {
  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    await __resetSubscriptionsForTest();
    await __resetCommercialOrdersForTest();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns past_due when pending_payment commercial order exists", async () => {
    const plan = await createPlan({
      name: "Starter",
      billingCycle: "monthly",
      basePriceCents: 10_000,
      seatQuota: { viewer: 5 },
      botQuota: 2,
      pricing: [],
      createdByUserId: "admin",
      commercial: { purchaseMode: "self_serve", slot: "starter" },
    });
    await createSubscribeCommercialOrder({
      enterpriseId: "ent-proj",
      planId: plan.id,
    });
    const status = await resolveTenantBillingProjectionStatus("ent-proj");
    expect(status).toBe("past_due");
  });

  it("returns none when no subscription or orders", async () => {
    expect(await resolveTenantBillingProjectionStatus("ent-empty")).toBe("none");
  });
});
