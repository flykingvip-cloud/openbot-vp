// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dir: "" }));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    get CONFIG_DIR() {
      return mocks.dir;
    },
  };
});

import { buildCommercialContract } from "../commerce/commercial-contract.js";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { createPlan } from "./plans-store.js";
import { provisionEnterpriseSubscription } from "./subscription-provisioning.js";
import { getActiveSubscriptionRuntimeSnapshot } from "./subscription-runtime-snapshots-store.js";
import { materializeSubscriptionRuntimeSnapshot } from "./subscription-transition-engine.js";
import {
  createSubscription,
  getActiveSubscription,
  setSubscriptionCommercialContract,
} from "./subscriptions-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-srs-"));
}

describe("subscription runtime snapshot", () => {
  afterEach(async () => {
    if (mocks.dir) {
      await fs.rm(mocks.dir, { recursive: true, force: true });
      mocks.dir = "";
    }
  });

  it("materializes snapshot on subscribe provisioning", async () => {
    mocks.dir = await tempDir();
    const plan = await createPlan({
      name: "Snapshot Plan",
      billingCycle: "monthly",
      basePriceCents: 2000,
      seatQuota: { creator: 5 },
      botQuota: 3,
      pricing: [{ type: "usage", key: "ai_credits", priceCents: 10 }],
      createdByUserId: "tester",
    });
    await upsertPlanEntitlementSnapshot({
      planVersionId: plan.currentVersionId,
      monthlyPriceCents: 2000,
      monthlyCredits: 500,
      maxBots: 3,
      maxConcurrentRuns: 2,
    });
    await createSubscription({
      enterpriseId: "ent-snap",
      planId: plan.id,
      planVersionId: plan.currentVersionId,
    });
    const result = await provisionEnterpriseSubscription({
      enterpriseId: "ent-snap",
      planVersionId: plan.currentVersionId,
    });
    expect(result.runtimeSnapshotId).toBeTruthy();
    const snapshot = await getActiveSubscriptionRuntimeSnapshot("ent-snap");
    expect(snapshot?.planVersionId).toBe(plan.currentVersionId);
    expect(snapshot?.entitlementSnapshot.monthlyCredits).toBe(500);
    expect(snapshot?.billingMode).toBe("credits");
  });

  it("materializeSubscriptionRuntimeSnapshot appends new active snapshot", async () => {
    mocks.dir = await tempDir();
    const plan = await createPlan({
      name: "Transition",
      billingCycle: "monthly",
      basePriceCents: 1000,
      seatQuota: {},
      botQuota: 1,
      pricing: [],
      createdByUserId: "tester",
    });
    const sub = await createSubscription({
      enterpriseId: "ent-tr",
      planId: plan.id,
      planVersionId: plan.currentVersionId,
    });
    const first = await materializeSubscriptionRuntimeSnapshot({
      enterpriseId: "ent-tr",
      subscription: sub,
    });
    const second = await materializeSubscriptionRuntimeSnapshot({
      enterpriseId: "ent-tr",
      subscription: sub,
    });
    expect(first.id).not.toBe(second.id);
    const active = await getActiveSubscriptionRuntimeSnapshot("ent-tr");
    expect(active?.id).toBe(second.id);
  });

  it("preserves annual billingCycle when commercialContract is bound before provision", async () => {
    mocks.dir = await tempDir();
    const plan = await createPlan({
      name: "Annual Plan",
      billingCycle: "annual",
      basePriceCents: 12000,
      seatQuota: {},
      botQuota: 1,
      pricing: [],
      createdByUserId: "tester",
    });
    const sub = await createSubscription({
      enterpriseId: "ent-annual",
      planId: plan.id,
      planVersionId: plan.currentVersionId,
    });
    const withContract = await setSubscriptionCommercialContract(
      "ent-annual",
      sub.id,
      buildCommercialContract(new Date(), "annual"),
    );
    expect(withContract).toBeTruthy();
    await provisionEnterpriseSubscription({
      enterpriseId: "ent-annual",
      planVersionId: plan.currentVersionId,
      subscription: withContract!,
    });
    const snapshot = await getActiveSubscriptionRuntimeSnapshot("ent-annual");
    expect(snapshot?.pricingSnapshot.billingCycle).toBe("annual");
  });

  it("materializeSubscriptionRuntimeSnapshot normalizes legacy semiannual commercialContract to quarterly", async () => {
    mocks.dir = await tempDir();
    const plan = await createPlan({
      name: "Quarterly Plan",
      billingCycle: "quarterly",
      basePriceCents: 6000,
      seatQuota: {},
      botQuota: 1,
      pricing: [],
      createdByUserId: "tester",
    });
    const sub = await createSubscription({
      enterpriseId: "ent-semi",
      planId: plan.id,
      planVersionId: plan.currentVersionId,
    });
    const withContract = await setSubscriptionCommercialContract("ent-semi", sub.id, {
      ...buildCommercialContract(new Date(), "quarterly"),
      billingCycle: "semiannual",
    } as unknown as NonNullable<(typeof sub)["commercialContract"]>);
    const snapshot = await materializeSubscriptionRuntimeSnapshot({
      enterpriseId: "ent-semi",
      subscription: withContract!,
    });
    expect(snapshot.pricingSnapshot.billingCycle).toBe("quarterly");
  });

  it("falls back to locked plan billingCycle when commercialContract is absent", async () => {
    mocks.dir = await tempDir();
    const plan = await createPlan({
      name: "Legacy Annual",
      billingCycle: "annual",
      basePriceCents: 12000,
      seatQuota: {},
      botQuota: 1,
      pricing: [],
      createdByUserId: "tester",
    });
    const sub = await createSubscription({
      enterpriseId: "ent-legacy",
      planId: plan.id,
      planVersionId: plan.currentVersionId,
    });
    const snapshot = await materializeSubscriptionRuntimeSnapshot({
      enterpriseId: "ent-legacy",
      subscription: sub,
    });
    expect(snapshot.pricingSnapshot.billingCycle).toBe("annual");

    const provisioned = await provisionEnterpriseSubscription({
      enterpriseId: "ent-legacy",
      planVersionId: plan.currentVersionId,
      subscription: sub,
    });
    expect(provisioned.runtimeSnapshotId).toBeTruthy();
    const active = await getActiveSubscriptionRuntimeSnapshot("ent-legacy");
    expect(active?.pricingSnapshot.billingCycle).toBe("annual");
  });
  it("materialize sets expiresAt from commercialContract.contractEnd", async () => {
    mocks.dir = await tempDir();
    const plan = await createPlan({
      name: "Expiry",
      billingCycle: "monthly",
      basePriceCents: 1000,
      seatQuota: {},
      botQuota: 1,
      pricing: [{ type: "extra", key: "ai_credits", priceCents: 1 }],
      createdByUserId: "tester",
    });
    await upsertPlanEntitlementSnapshot({
      planVersionId: plan.currentVersionId,
      monthlyPriceCents: 1000,
      monthlyCredits: 100,
      maxBots: 1,
    });
    const sub = await createSubscription({
      enterpriseId: "ent-exp",
      planId: plan.id,
      planVersionId: plan.currentVersionId,
      startTime: "2026-01-01T00:00:00.000Z",
    });
    await setSubscriptionCommercialContract("ent-exp", sub.id, {
      billingCycle: "monthly",
      contractStart: "2026-01-01T00:00:00.000Z",
      contractEnd: "2026-02-01T00:00:00.000Z",
    });
    const active = await getActiveSubscription("ent-exp");
    const snap = await materializeSubscriptionRuntimeSnapshot({
      enterpriseId: "ent-exp",
      subscription: active!,
    });
    expect(snap.expiresAt).toBe("2026-02-01T00:00:00.000Z");
    expect(snap.effectiveAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
