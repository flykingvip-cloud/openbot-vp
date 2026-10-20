// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGovernanceApprovalRequest } from "../enterprise-data/governance-approval-store.js";
import { seedEnterpriseDataCatalog } from "../enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore, saveEnterpriseDataStore } from "../enterprise-data/store.js";
import { upsertPlanEntitlementSnapshot } from "../package-entitlement/plan-version-entitlement-store.js";
import { createPlan } from "./plans-store.js";
import { resolveEnterpriseAIGovernanceProjection } from "./resolve-enterprise-ai-governance.js";
import { materializeSubscriptionRuntimeSnapshot } from "./subscription-transition-engine.js";
import { createSubscription } from "./subscriptions-store.js";
import { appendUsageLedgerEntry, __resetUsageLedgerForTest } from "./usage-ledger-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-gov-"));
}

describe("resolveEnterpriseAIGovernanceProjection", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("surfaces pending approvals and audit coverage gaps", async () => {
    dir = await tempDir();
    const enterpriseId = "ent-gov";
    const nowIso = "2026-06-15T12:00:00.000Z";
    const enterpriseDataPath = path.join(dir, "enterprise-data.json");
    const runtimePath = path.join(dir, "runtime.json");
    const ledgerPath = path.join(dir, "ledger.json");
    const plansPath = path.join(dir, "plans.json");
    const subsPath = path.join(dir, "subs.json");
    const entitlementPath = path.join(dir, "entitlement.json");

    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId: enterpriseId, nowIso });
    const source = Object.values(store.dataSources).find((item) => item.tenantId === enterpriseId)!;
    createGovernanceApprovalRequest({
      store,
      tenantId: enterpriseId,
      category: "source_onboarding",
      subjectId: source.sourceId,
      requestedBy: "emp-admin-001",
      nowIso,
    });
    await saveEnterpriseDataStore(store, enterpriseDataPath);

    const plan = await createPlan(
      {
        name: "Gov",
        billingCycle: "monthly",
        basePriceCents: 9900,
        seatQuota: { creator: 5 },
        botQuota: 3,
        pricing: [],
        createdByUserId: "test",
      },
      plansPath,
    );
    await upsertPlanEntitlementSnapshot(
      {
        planVersionId: plan.currentVersionId,
        monthlyPriceCents: 9900,
        monthlyCredits: 100,
        maxSeats: { creator: 5 },
        maxBots: 3,
        allowedPolicies: ["balanced"],
        allowedTiers: ["tier_b"],
        features: { auditLog: true, creditsV2Enabled: true },
      },
      entitlementPath,
    );
    const sub = await createSubscription(
      {
        enterpriseId,
        planId: plan.id,
        planVersionId: plan.currentVersionId,
        resolvedFromPlanId: true,
      },
      subsPath,
    );
    await materializeSubscriptionRuntimeSnapshot({
      enterpriseId,
      subscription: sub,
      storePaths: {
        plans: plansPath,
        entitlementSnapshot: entitlementPath,
        modelBinding: path.join(dir, "binding.json"),
        runtimeSnapshots: runtimePath,
      },
    });

    await __resetUsageLedgerForTest(ledgerPath);
    await appendUsageLedgerEntry(
      {
        enterpriseId,
        taskId: "task-with-auth",
        modelId: "openai/gpt-4o",
        tier: "tier_b",
        policyId: "balanced",
        creditsCharged: 5,
        providerCostCents: 10,
        tenantRevenueCents: 20,
        authorizationDecisionId: "auth-1",
        occurredAt: nowIso,
      },
      ledgerPath,
    );
    await appendUsageLedgerEntry(
      {
        enterpriseId,
        taskId: "task-missing-auth",
        modelId: "openai/gpt-4o",
        tier: "tier_b",
        policyId: "balanced",
        creditsCharged: 3,
        providerCostCents: 6,
        tenantRevenueCents: 12,
        occurredAt: nowIso,
      },
      ledgerPath,
    );

    const prevRollout = process.env.OPENBOT_CREDITS_V2_ROLLOUT;
    process.env.OPENBOT_CREDITS_V2_ROLLOUT = "full";
    try {
      const projection = await resolveEnterpriseAIGovernanceProjection(enterpriseId, {
        runtimeSnapshots: runtimePath,
        enterpriseData: enterpriseDataPath,
        usageLedger: ledgerPath,
      });

      expect(projection.pendingApprovalsCount).toBe(1);
      expect(projection.pendingApprovalsByCategory.source_onboarding).toBe(1);
      expect(projection.auditCoverageRatio).toBe(0.5);
      expect(projection.auditCoverageGap).toBe(1);
      expect(projection.complianceStatus).toBe("action_required");
      expect(projection.complianceIssues.some((issue) => issue.includes("待审批"))).toBe(true);
      expect(projection.creditsV2RolloutStage).toBe("full");
      expect(projection.creditsV2Effective).toBe(true);
    } finally {
      if (prevRollout === undefined) {
        delete process.env.OPENBOT_CREDITS_V2_ROLLOUT;
      } else {
        process.env.OPENBOT_CREDITS_V2_ROLLOUT = prevRollout;
      }
    }
  });
});
