// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertPlanVersionModelBinding } from "../model-entitlement/plan-version-model-binding-store.js";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { PlanVersionCapabilityFrozenError } from "./plan-version-capability-guard.js";
import { createPlan } from "./plans-store.js";
import { createSubscription } from "./subscriptions-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-pv-guard-"));
}

describe("plan-version-capability-guard", () => {
  let dir: string;
  const plansPath = () => path.join(dir, "plans.json");
  const subsPath = () => path.join(dir, "subs.json");
  const entPath = () => path.join(dir, "ent.json");
  const bindingPath = () => path.join(dir, "binding.json");

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("allows first entitlement write on active unreferenced planVersion", async () => {
    dir = await tempDir();
    const plan = await createPlan(
      {
        name: "Guard Test",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: {},
        botQuota: 2,
        pricing: [],
        createdByUserId: "tester",
      },
      plansPath(),
    );
    await expect(
      upsertPlanEntitlementSnapshot(
        {
          planVersionId: plan.currentVersionId,
          monthlyPriceCents: 1000,
          monthlyCredits: 50,
          maxBots: 2,
        },
        entPath(),
        { plans: plansPath(), subscriptions: subsPath() },
      ),
    ).resolves.toMatchObject({ monthlyCredits: 50 });
  });

  it("rejects mutating active planVersion after initial snapshot", async () => {
    dir = await tempDir();
    const plan = await createPlan(
      {
        name: "Active Guard",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: {},
        botQuota: 2,
        pricing: [],
        createdByUserId: "tester",
      },
      plansPath(),
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 1000,
        monthlyCredits: 100,
        maxBots: 2,
      },
      entPath(),
    );
    await expect(
      upsertPlanEntitlementSnapshot(
        {
          planVersionId: plan.currentVersionId,
          monthlyPriceCents: 1000,
          monthlyCredits: 200,
          maxBots: 2,
        },
        entPath(),
        { plans: plansPath(), subscriptions: subsPath() },
      ),
    ).rejects.toBeInstanceOf(PlanVersionCapabilityFrozenError);
  });

  it("rejects mutating referenced planVersion via entitlement store", async () => {
    dir = await tempDir();
    const plan = await createPlan(
      {
        name: "Referenced Guard",
        billingCycle: "monthly",
        basePriceCents: 1000,
        seatQuota: {},
        botQuota: 2,
        pricing: [],
        createdByUserId: "tester",
      },
      plansPath(),
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 1000,
        monthlyCredits: 100,
        maxBots: 2,
      },
      entPath(),
    );
    await createSubscription(
      {
        enterpriseId: "ent-guard",
        planId: plan.id,
        planVersionId: plan.currentVersionId,
      },
      subsPath(),
    );
    await expect(
      upsertPlanEntitlementSnapshot(
        {
          planVersionId: plan.currentVersionId,
          monthlyPriceCents: 1000,
          monthlyCredits: 200,
          maxBots: 2,
        },
        entPath(),
        { plans: plansPath(), subscriptions: subsPath() },
      ),
    ).rejects.toBeInstanceOf(PlanVersionCapabilityFrozenError);

    await expect(
      upsertPlanVersionModelBinding(
        {
          planVersionId: plan.currentVersionId,
          allowedModelIds: ["openai/gpt-4o"],
        },
        bindingPath(),
        { plans: plansPath(), subscriptions: subsPath() },
      ),
    ).rejects.toBeInstanceOf(PlanVersionCapabilityFrozenError);
  });
});
