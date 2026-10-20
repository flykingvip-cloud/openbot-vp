// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSubscription } from "../billing/subscriptions-store.js";
import { getEnterpriseModelEntitlement } from "./enterprise-model-entitlement-store.js";
import {
  refreshEnterpriseModelEntitlement,
  refreshEntitlementsForPlanVersion,
} from "./entitlement-projection.js";
import { upsertPlanVersionModelBinding } from "./plan-version-model-binding-store.js";

let dir: string;
let subscriptionsStorePath: string;
let planBindingStorePath: string;
let entitlementStorePath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ent-proj-"));
  subscriptionsStorePath = path.join(dir, "subs.json");
  planBindingStorePath = path.join(dir, "binding.json");
  entitlementStorePath = path.join(dir, "entitlement.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const opts = () => ({ subscriptionsStorePath, planBindingStorePath, entitlementStorePath });

describe("refreshEnterpriseModelEntitlement (task 9 wiring)", () => {
  it("projects locked planVersion binding → enterprise entitlement", async () => {
    await createSubscription(
      { enterpriseId: "t1", planId: "plan-a", planVersionId: "pv-1" },
      subscriptionsStorePath,
    );
    await upsertPlanVersionModelBinding(
      { planVersionId: "pv-1", allowedModelIds: ["api-proxy-gpt/gpt-5.2", "api-proxy-claude/c"] },
      planBindingStorePath,
    );

    const result = await refreshEnterpriseModelEntitlement("t1", opts());
    expect(result?.planVersionId).toBe("pv-1");
    expect([...(result?.allowedModelIds ?? [])].toSorted()).toEqual([
      "api-proxy-claude/c",
      "api-proxy-gpt/gpt-5.2",
    ]);

    const persisted = await getEnterpriseModelEntitlement("t1", entitlementStorePath);
    expect([...(persisted?.allowedModelIds ?? [])].toSorted()).toEqual([
      "api-proxy-claude/c",
      "api-proxy-gpt/gpt-5.2",
    ]);
  });

  it("subscription present but binding missing → resolved empty set (not missing)", async () => {
    await createSubscription(
      { enterpriseId: "t2", planId: "plan-b", planVersionId: "pv-x" },
      subscriptionsStorePath,
    );
    const result = await refreshEnterpriseModelEntitlement("t2", opts());
    expect(result).not.toBeNull();
    expect(result?.allowedModelIds).toEqual([]);
    // persisted as a real record → runtime treats as resolved-empty (hard deny), not missing-allow
    const persisted = await getEnterpriseModelEntitlement("t2", entitlementStorePath);
    expect(persisted).not.toBeNull();
    expect(persisted?.allowedModelIds).toEqual([]);
  });

  it("no active subscription → null (no write)", async () => {
    const result = await refreshEnterpriseModelEntitlement("t3", opts());
    expect(result).toBeNull();
    expect(await getEnterpriseModelEntitlement("t3", entitlementStorePath)).toBeNull();
  });

  it("tier-backed binding projects from tiers by default, ignoring the stale model cache (Phase 3)", async () => {
    const { upsertResourceModelCatalogEntry } =
      await import("../resource-catalog/models-catalog-store.js");
    const modelCatalogStorePath = path.join(dir, "catalog.json");
    await upsertResourceModelCatalogEntry(
      { modelId: "api-proxy-gpt/gpt-5.2", tier: "tier_a", enabled: true },
      modelCatalogStorePath,
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "api-proxy-claude/c", tier: "tier_b", enabled: true },
      modelCatalogStorePath,
    );
    await createSubscription(
      { enterpriseId: "t-tier", planId: "plan-t", planVersionId: "pv-tier" },
      subscriptionsStorePath,
    );
    // Binding is tier-backed; its allowedModelIds cache intentionally diverges from tier_a and must
    // be ignored at runtime (Tier is the source of truth).
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-tier",
        allowedModelIds: ["api-proxy-claude/c"],
        allowedTiers: ["tier_a"],
      },
      planBindingStorePath,
    );

    // No explicit routingMode → defaults to tier (Phase 3 runtime tier-first).
    const result = await refreshEnterpriseModelEntitlement("t-tier", {
      subscriptionsStorePath,
      planBindingStorePath,
      entitlementStorePath,
      modelCatalogStorePath,
    });
    expect(result?.allowedModelIds).toEqual(["api-proxy-gpt/gpt-5.2"]);

    const persisted = await getEnterpriseModelEntitlement("t-tier", entitlementStorePath);
    expect(persisted?.allowedModelIds).toEqual(["api-proxy-gpt/gpt-5.2"]);
  });

  it("explicit legacy routingMode keeps a tier-backed binding on its model cache (escape hatch)", async () => {
    const { upsertResourceModelCatalogEntry } =
      await import("../resource-catalog/models-catalog-store.js");
    const modelCatalogStorePath = path.join(dir, "catalog.json");
    await upsertResourceModelCatalogEntry(
      { modelId: "api-proxy-gpt/gpt-5.2", tier: "tier_a", enabled: true },
      modelCatalogStorePath,
    );
    await createSubscription(
      { enterpriseId: "t-legacy", planId: "plan-l", planVersionId: "pv-legacy" },
      subscriptionsStorePath,
    );
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-legacy",
        allowedModelIds: ["api-proxy-claude/c"],
        allowedTiers: ["tier_a"],
      },
      planBindingStorePath,
    );

    const result = await refreshEnterpriseModelEntitlement("t-legacy", {
      subscriptionsStorePath,
      planBindingStorePath,
      entitlementStorePath,
      modelCatalogStorePath,
      routingMode: "legacy",
    });
    expect(result?.allowedModelIds).toEqual(["api-proxy-claude/c"]);
  });

  it("refreshEntitlementsForPlanVersion refreshes all existing subscribers (Issue 2)", async () => {
    // Two tenants subscribed to pv-9; a third on a different version.
    await createSubscription(
      { enterpriseId: "ta", planId: "p", planVersionId: "pv-9" },
      subscriptionsStorePath,
    );
    await createSubscription(
      { enterpriseId: "tb", planId: "p", planVersionId: "pv-9" },
      subscriptionsStorePath,
    );
    await createSubscription(
      { enterpriseId: "tc", planId: "p", planVersionId: "pv-other" },
      subscriptionsStorePath,
    );
    // Platform sets/changes the binding for pv-9.
    await upsertPlanVersionModelBinding(
      { planVersionId: "pv-9", allowedModelIds: ["api-proxy-gpt/gpt-5.2"] },
      planBindingStorePath,
    );

    const refreshed = await refreshEntitlementsForPlanVersion("pv-9", opts());
    expect(refreshed.toSorted()).toEqual(["ta", "tb"]);

    // Both subscribers now hold the new entitlement; the unrelated tenant does not.
    expect(
      (await getEnterpriseModelEntitlement("ta", entitlementStorePath))?.allowedModelIds,
    ).toEqual(["api-proxy-gpt/gpt-5.2"]);
    expect(
      (await getEnterpriseModelEntitlement("tb", entitlementStorePath))?.allowedModelIds,
    ).toEqual(["api-proxy-gpt/gpt-5.2"]);
    expect(await getEnterpriseModelEntitlement("tc", entitlementStorePath)).toBeNull();
  });
});
