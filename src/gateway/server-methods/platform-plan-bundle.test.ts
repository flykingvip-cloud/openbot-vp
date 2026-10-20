// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-platform-plan-bundle-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    models: {
      providers: {
        "api-proxy-deepseek": { models: [{ id: "deepseek-chat" }] },
        ollama: { models: [{ id: "llama3.2" }] },
        openai: { models: [{ id: "gpt-4o" }] },
      },
    },
  }),
}));

vi.mock("../model-entitlement/plan-binding-vision.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../model-entitlement/plan-binding-vision.js")>();
  return {
    ...actual,
    planBindingIncludesVisionModel: vi.fn(async () => true),
  };
});

const { platformPlanBundleHandlers } = await import("./platform-plan-bundle.js");
const { planBindingIncludesVisionModel } =
  await import("../model-entitlement/plan-binding-vision.js");
const { getPlanEntitlementSnapshot } =
  await import("../package-entitlement/plan-version-entitlement-store.js");
const { createSubscription, getActiveSubscription } =
  await import("../billing/subscriptions-store.js");
const { getEnterpriseModelEntitlement } =
  await import("../model-entitlement/enterprise-model-entitlement-store.js");

type HandlerError = { code?: string; message?: string };

async function invoke<P = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; payload: P; error: HandlerError }> {
  const handler = platformPlanBundleHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: { ok: boolean; payload: P; error: HandlerError } | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "admin@example.com" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload: payload as P, error: (error ?? {}) as HandlerError };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  vi.mocked(planBindingIncludesVisionModel).mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("platform-plan-bundle.*", () => {
  it("create creates plan, first version, and binding in one request", async () => {
    const res = await invoke<{
      plan: { currentVersionId: string; name: string };
      version: { id: string; status: string } | null;
      binding: { allowedModelIds: string[] } | null;
    }>("platform-plan-bundle.create", {
      name: "专业版",
      billingCycle: "monthly",
      basePriceCents: 49900,
      botQuota: 30,
      seatQuota: { viewer: 10, creator: 5 },
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    expect(res.ok).toBe(true);
    expect(res.payload.plan.name).toBe("专业版");
    expect(res.payload.version?.status).toBe("active");
    expect(res.payload.binding?.allowedModelIds).toEqual(["api-proxy-deepseek/deepseek-chat"]);
  });

  it("create persists maxConcurrentRuns and overagePolicy on entitlement snapshot", async () => {
    const res = await invoke<{
      entitlementSnapshot: {
        maxConcurrentRuns: number;
        overagePolicy: { type: string; allowBurstConcurrency: boolean };
      } | null;
    }>("platform-plan-bundle.create", {
      name: "并发版",
      billingCycle: "monthly",
      basePriceCents: 59900,
      botQuota: 20,
      monthlyCredits: 10000,
      maxConcurrentRuns: 6,
      overagePolicy: { type: "credits_only", allowBurstConcurrency: true },
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    expect(res.ok).toBe(true);
    expect(res.payload.entitlementSnapshot?.maxConcurrentRuns).toBe(6);
    expect(res.payload.entitlementSnapshot?.overagePolicy).toEqual({
      type: "credits_only",
      allowBurstConcurrency: true,
    });
  });

  it("create persists workflow, knowledge, and governance fields on entitlement snapshot", async () => {
    const res = await invoke<{
      entitlementSnapshot: {
        maxWorkflows?: number;
        maxKnowledgeBases?: number;
        allowCustomPolicy?: boolean;
        allowPrivateModels?: boolean;
        features?: {
          auditLog?: boolean;
          mfa?: boolean;
          sso?: boolean;
          vpcIsolation?: boolean;
        };
      } | null;
    }>("platform-plan-bundle.create", {
      name: "治理版",
      billingCycle: "monthly",
      basePriceCents: 159900,
      botQuota: 120,
      monthlyCredits: 30000,
      maxConcurrentRuns: 20,
      maxWorkflows: 50,
      maxKnowledgeBases: 50,
      allowCustomPolicy: true,
      allowPrivateModels: true,
      features: {
        auditLog: true,
        mfa: true,
        sso: true,
        vpcIsolation: false,
      },
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    expect(res.ok).toBe(true);
    expect(res.payload.entitlementSnapshot?.maxWorkflows).toBe(50);
    expect(res.payload.entitlementSnapshot?.maxKnowledgeBases).toBe(50);
    expect(res.payload.entitlementSnapshot?.allowCustomPolicy).toBe(true);
    expect(res.payload.entitlementSnapshot?.allowPrivateModels).toBe(true);
    expect(res.payload.entitlementSnapshot?.features).toEqual({
      auditLog: true,
      mfa: true,
      sso: true,
      vpcIsolation: false,
    });
  });

  it("create-version creates a draft version and writes the provided binding", async () => {
    const created = await invoke<{
      plan: { id: string; currentVersionId: string };
    }>("platform-plan-bundle.create", {
      name: "入门版",
      billingCycle: "monthly",
      basePriceCents: 9900,
      botQuota: 5,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 2 }],
      allowedModelIds: ["ollama/llama3.2"],
    });
    const res = await invoke<{
      version: { id: string; status: string };
      binding: { allowedModelIds: string[] } | null;
    }>("platform-plan-bundle.create-version", {
      planId: created.payload.plan.id,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 3 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"],
    });
    expect(res.ok).toBe(true);
    expect(res.payload.version.status).toBe("draft");
    expect(res.payload.binding?.allowedModelIds.toSorted()).toEqual([
      "api-proxy-deepseek/deepseek-chat",
      "ollama/llama3.2",
    ]);
  });

  it("update creates a draft version and writes the provided binding", async () => {
    const created = await invoke<{
      plan: { id: string };
    }>("platform-plan-bundle.create", {
      name: "增长版",
      billingCycle: "monthly",
      basePriceCents: 19900,
      botQuota: 8,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 4 }],
      allowedModelIds: ["ollama/llama3.2"],
    });
    const res = await invoke<{
      plan: { name: string };
      version: { status: string; version: number };
      binding: { allowedModelIds: string[] } | null;
    }>("platform-plan-bundle.update", {
      planId: created.payload.plan.id,
      name: "增长版 Plus",
      basePriceCents: 29900,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 6 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    expect(res.ok).toBe(true);
    expect(res.payload.plan.name).toBe("增长版 Plus");
    expect(res.payload.version.status).toBe("draft");
    expect(res.payload.version.version).toBe(2);
    expect(res.payload.binding?.allowedModelIds).toEqual(["api-proxy-deepseek/deepseek-chat"]);
  });

  it("derives allowedModelIds from allowedTiers (Tier is the source of truth)", async () => {
    const { upsertResourceModelCatalogEntry } =
      await import("../resource-catalog/models-catalog-store.js");
    // Seed the resource catalog: tier_a -> deepseek, tier_b -> llama (both enabled).
    await upsertResourceModelCatalogEntry({
      modelId: "api-proxy-deepseek/deepseek-chat",
      tier: "tier_a",
      enabled: true,
    });
    await upsertResourceModelCatalogEntry({
      modelId: "ollama/llama3.2",
      tier: "tier_b",
      enabled: true,
    });

    const res = await invoke<{ binding: { allowedModelIds: string[] } | null }>(
      "platform-plan-bundle.create",
      {
        name: "Tier 派生版",
        billingCycle: "monthly",
        basePriceCents: 9900,
        botQuota: 5,
        pricing: [{ type: "usage", key: "ai_token", priceCents: 2 }],
        allowedTiers: ["tier_a"],
        // Client intentionally sends a model NOT in tier_a; the backend must override it with the
        // tier_a projection, proving Tier (not the manual list) is the source of truth.
        allowedModelIds: ["ollama/llama3.2"],
      },
    );
    expect(res.ok).toBe(true);
    expect(res.payload.binding?.allowedModelIds).toEqual(["api-proxy-deepseek/deepseek-chat"]);
  });

  it("keeps manual allowedModelIds when no tiers are provided (legacy binding)", async () => {
    const res = await invoke<{ binding: { allowedModelIds: string[] } | null }>(
      "platform-plan-bundle.create",
      {
        name: "Legacy 手工版",
        billingCycle: "monthly",
        basePriceCents: 9900,
        botQuota: 5,
        pricing: [{ type: "usage", key: "ai_token", priceCents: 2 }],
        allowedModelIds: ["ollama/llama3.2"],
      },
    );
    expect(res.ok).toBe(true);
    expect(res.payload.binding?.allowedModelIds).toEqual(["ollama/llama3.2"]);
  });

  it("persists per-model budgets independently of modelQuota (Phase 4)", async () => {
    const res = await invoke<{
      binding: {
        allowedModelIds: string[];
        modelQuota?: Record<string, { maxRequests?: number; maxTokens?: number }>;
        modelBudgets?: Record<string, { monthlyCreditsCap?: number; spendCapCents?: number }>;
      } | null;
    }>("platform-plan-bundle.create", {
      name: "模型预算版",
      billingCycle: "monthly",
      basePriceCents: 49900,
      botQuota: 10,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
      modelQuota: { "api-proxy-deepseek/deepseek-chat": { maxRequests: 100 } },
      modelBudgets: {
        "api-proxy-deepseek/deepseek-chat": { monthlyCreditsCap: 5000, spendCapCents: 20000 },
      },
    });
    expect(res.ok).toBe(true);
    // modelBudgets is stored separately from modelQuota (distinct口径).
    expect(res.payload.binding?.modelBudgets).toEqual({
      "api-proxy-deepseek/deepseek-chat": { monthlyCreditsCap: 5000, spendCapCents: 20000 },
    });
    expect(res.payload.binding?.modelQuota).toEqual({
      "api-proxy-deepseek/deepseek-chat": { maxRequests: 100 },
    });
  });

  it("rejects modelBudgets entries outside allowedModelIds", async () => {
    const res = await invoke("platform-plan-bundle.create", {
      name: "越界预算版",
      billingCycle: "monthly",
      basePriceCents: 100,
      botQuota: 1,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 1 }],
      allowedModelIds: ["ollama/llama3.2"],
      modelBudgets: { "api-proxy-deepseek/deepseek-chat": { monthlyCreditsCap: 100 } },
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("modelBudgets");
  });

  it("overview returns plans with version-level binding health", async () => {
    await invoke("platform-plan-bundle.create", {
      name: "企业版",
      billingCycle: "monthly",
      basePriceCents: 99900,
      botQuota: 100,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 8 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    const res = await invoke<{
      catalog: string[];
      plans: Array<{
        plan: { name: string };
        versions: Array<{
          bindingState: string;
          activationReady: boolean;
          activationBlockers: string[];
        }>;
      }>;
    }>("platform-plan-bundle.overview");
    expect(res.ok).toBe(true);
    expect(res.payload.catalog.toSorted()).toEqual([
      "api-proxy-deepseek/deepseek-chat",
      "ollama/llama3.2",
      "openai/gpt-4o",
    ]);
    expect(res.payload.plans).toHaveLength(1);
    expect(res.payload.plans[0]?.plan.name).toBe("企业版");
    expect(res.payload.plans[0]?.versions[0]?.bindingState).toBe("valid");
    expect(res.payload.plans[0]?.versions[0]?.activationReady).toBe(true);
    expect(res.payload.plans[0]?.versions[0]?.activationBlockers).toEqual([]);
  });

  it("list returns bundle plan rows", async () => {
    await invoke("platform-plan-bundle.create", {
      name: "企业版",
      billingCycle: "monthly",
      basePriceCents: 99900,
      botQuota: 100,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 8 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    const res = await invoke<{
      plans: Array<{ plan: { name: string }; versions: Array<{ bindingState: string }> }>;
    }>("platform-plan-bundle.list");
    expect(res.ok).toBe(true);
    expect(res.payload.plans).toHaveLength(1);
    expect(res.payload.plans[0]?.plan.name).toBe("企业版");
    expect(res.payload.plans[0]?.versions[0]?.bindingState).toBe("valid");
  });

  it("get returns a single bundle plan row", async () => {
    const created = await invoke<{
      plan: { id: string };
    }>("platform-plan-bundle.create", {
      name: "专业版",
      billingCycle: "monthly",
      basePriceCents: 49900,
      botQuota: 30,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    const res = await invoke<{
      plan: { id: string; name: string };
      versions: Array<{ versionId: string; bindingState: string }>;
    }>("platform-plan-bundle.get", { planId: created.payload.plan.id });
    expect(res.ok).toBe(true);
    expect(res.payload.plan.id).toBe(created.payload.plan.id);
    expect(res.payload.plan.name).toBe("专业版");
    expect(res.payload.versions[0]?.bindingState).toBe("valid");
  });

  it("activate activates a draft version through the bundle interface", async () => {
    const created = await invoke<{
      plan: { id: string };
    }>("platform-plan-bundle.create", {
      name: "企业版",
      billingCycle: "monthly",
      basePriceCents: 99900,
      botQuota: 100,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 8 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    const draft = await invoke<{
      version: { id: string; status: string };
    }>("platform-plan-bundle.create-version", {
      planId: created.payload.plan.id,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 10 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"],
    });
    const res = await invoke<{
      planVersion: { id: string; status: string };
      binding: { allowedModelIds: string[] };
    }>("platform-plan-bundle.activate", {
      planId: created.payload.plan.id,
      versionId: draft.payload.version.id,
      requestId: "bundle-activate-1",
    });
    expect(res.ok).toBe(true);
    expect(res.payload.planVersion.id).toBe(draft.payload.version.id);
    expect(res.payload.planVersion.status).toBe("active");
    expect(res.payload.binding.allowedModelIds.toSorted()).toEqual([
      "api-proxy-deepseek/deepseek-chat",
      "ollama/llama3.2",
    ]);
  });

  it("activate auto-migrates active subscriptions on the same plan to the new version", async () => {
    const created = await invoke<{
      plan: { id: string; currentVersionId: string };
    }>("platform-plan-bundle.create", {
      name: "Auto Sync",
      billingCycle: "monthly",
      basePriceCents: 39900,
      botQuota: 10,
      monthlyCredits: 1000,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });

    await createSubscription({
      enterpriseId: "ent-sync",
      planId: created.payload.plan.id,
      planVersionId: created.payload.plan.currentVersionId,
    });

    const draft = await invoke<{
      version: { id: string; status: string };
      binding: { allowedModelIds: string[] } | null;
    }>("platform-plan-bundle.create-version", {
      planId: created.payload.plan.id,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
      allowedModelIds: ["ollama/llama3.2"],
      monthlyCredits: 1000,
    });

    const res = await invoke<{
      planVersion: { id: string; status: string };
      autoMigratedEnterprises?: string[];
    }>("platform-plan-bundle.activate", {
      planId: created.payload.plan.id,
      versionId: draft.payload.version.id,
      requestId: "bundle-auto-sync-1",
    });

    expect(res.ok).toBe(true);
    expect(res.payload.planVersion.id).toBe(draft.payload.version.id);
    expect(res.payload.autoMigratedEnterprises).toEqual(["ent-sync"]);

    const subscription = await getActiveSubscription("ent-sync");
    expect(subscription?.planVersionId).toBe(draft.payload.version.id);

    const entitlement = await getEnterpriseModelEntitlement("ent-sync");
    expect(entitlement?.planVersionId).toBe(draft.payload.version.id);
    expect(entitlement?.allowedModelIds).toEqual(["ollama/llama3.2"]);
  });

  it("activate rejects a version with invalid binding", async () => {
    const created = await invoke<{
      plan: { id: string };
    }>("platform-plan-bundle.create", {
      name: "专业版",
      billingCycle: "monthly",
      basePriceCents: 49900,
      botQuota: 10,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    const draft = await invoke<{
      version: { id: string };
    }>("platform-plan-bundle.create-version", {
      planId: created.payload.plan.id,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 9 }],
      allowedModelIds: ["ollama/llama3.2"],
    });
    const { upsertPlanVersionModelBinding } =
      await import("../model-entitlement/plan-version-model-binding-store.js");
    await upsertPlanVersionModelBinding(
      {
        planVersionId: draft.payload.version.id,
        allowedModelIds: ["legacy/removed"],
      },
      path.join(tmpDir, "openbot-plan-model-binding.json"),
    );
    const res = await invoke("platform-plan-bundle.activate", {
      planId: created.payload.plan.id,
      versionId: draft.payload.version.id,
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("不在当前平台目录内");
  });

  it("deprecate deprecates an active version through the bundle interface", async () => {
    const created = await invoke<{
      plan: { id: string; currentVersionId: string };
    }>("platform-plan-bundle.create", {
      name: "团队版",
      billingCycle: "monthly",
      basePriceCents: 29900,
      botQuota: 12,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 5 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    const res = await invoke<{
      planVersion: { id: string; status: string };
      binding?: { allowedModelIds: string[] };
    }>("platform-plan-bundle.deprecate", {
      planId: created.payload.plan.id,
      versionId: created.payload.plan.currentVersionId,
    });
    expect(res.ok).toBe(true);
    expect(res.payload.planVersion.id).toBe(created.payload.plan.currentVersionId);
    expect(res.payload.planVersion.status).toBe("deprecated");
    expect(res.payload.binding?.allowedModelIds).toEqual(["api-proxy-deepseek/deepseek-chat"]);
  });

  it("delete-version deletes a deprecated version through the bundle interface", async () => {
    const created = await invoke<{
      plan: { id: string; currentVersionId: string };
    }>("platform-plan-bundle.create", {
      name: "删除版",
      billingCycle: "monthly",
      basePriceCents: 19900,
      botQuota: 5,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 4 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    const draft = await invoke<{
      version: { id: string };
    }>("platform-plan-bundle.create-version", {
      planId: created.payload.plan.id,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 7 }],
      allowedModelIds: ["ollama/llama3.2"],
    });
    const act = await invoke("platform-plan-bundle.activate", {
      planId: created.payload.plan.id,
      versionId: draft.payload.version.id,
      requestId: "bundle-delete-activate",
    });
    expect(act.ok).toBe(true);
    const deprecatedVersionId = created.payload.plan.currentVersionId;
    expect(await getPlanEntitlementSnapshot(deprecatedVersionId)).not.toBeNull();
    const del = await invoke<{ deletedVersionId: string }>("platform-plan-bundle.delete-version", {
      planId: created.payload.plan.id,
      versionId: deprecatedVersionId,
    });
    expect(del.ok).toBe(true);
    expect(del.payload.deletedVersionId).toBe(deprecatedVersionId);
    expect(await getPlanEntitlementSnapshot(deprecatedVersionId)).toBeNull();
  });

  it("rejects bundle writes with catalog-external model ids", async () => {
    const res = await invoke("platform-plan-bundle.create", {
      name: "错误版",
      billingCycle: "monthly",
      basePriceCents: 100,
      botQuota: 1,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 1 }],
      allowedModelIds: ["legacy/removed"],
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("不在当前平台目录内");
  });

  it("rejects bundle create with empty allowedModelIds", async () => {
    const res = await invoke("platform-plan-bundle.create", {
      name: "空模型版",
      billingCycle: "monthly",
      basePriceCents: 100,
      botQuota: 1,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 1 }],
      allowedModelIds: [],
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("至少需绑定 1 个可用模型");
  });

  it("rejects bundle create-version with empty allowedModelIds", async () => {
    const created = await invoke<{ plan: { id: string } }>("platform-plan-bundle.create", {
      name: "Base",
      billingCycle: "monthly",
      basePriceCents: 100,
      botQuota: 1,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 1 }],
      allowedModelIds: ["ollama/llama3.2"],
    });
    const res = await invoke("platform-plan-bundle.create-version", {
      planId: created.payload.plan.id,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 1 }],
      allowedModelIds: [],
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("至少需绑定 1 个可用模型");
  });

  it("sets marketing tags with default uniqueness", async () => {
    const first = await invoke<{ plan: { id: string } }>("platform-plan-bundle.create", {
      name: "Starter",
      billingCycle: "monthly",
      basePriceCents: 100,
      botQuota: 1,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 1 }],
      allowedModelIds: ["ollama/llama3.2"],
    });
    const second = await invoke<{ plan: { id: string } }>("platform-plan-bundle.create", {
      name: "Growth",
      billingCycle: "monthly",
      basePriceCents: 200,
      botQuota: 1,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 1 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    await invoke("platform-plan-bundle.set-marketing-tags", {
      planId: first.payload.plan.id,
      marketingTags: ["default"],
    });
    const tagged = await invoke<{ plan: { marketingTags?: string[] } }>(
      "platform-plan-bundle.set-marketing-tags",
      {
        planId: second.payload.plan.id,
        marketingTags: ["default", "recommended"],
      },
    );
    expect(tagged.ok).toBe(true);
    expect(tagged.payload?.plan.marketingTags).toEqual(["default", "recommended"]);
    const refreshed = await invoke<{
      plans: Array<{ plan: { id: string; marketingTags?: string[] } }>;
    }>("platform-plan-bundle.list");
    const firstPlan = refreshed.payload?.plans.find((row) => row.plan.id === first.payload.plan.id);
    expect(firstPlan?.plan.marketingTags).toBeUndefined();
  });

  it("sets matching profile metadata on plan", async () => {
    const created = await invoke<{ plan: { id: string } }>("platform-plan-bundle.create", {
      name: "Professional",
      billingCycle: "monthly",
      basePriceCents: 100,
      botQuota: 1,
      pricing: [{ type: "usage", key: "ai_token", priceCents: 1 }],
      allowedModelIds: ["ollama/llama3.2"],
    });
    expect(created.ok).toBe(true);
    const updated = await invoke<{ plan: { matchingProfile?: { targetPersonas?: string[] } } }>(
      "platform-plan-bundle.set-matching-profile",
      {
        planId: created.payload.plan.id,
        matchingProfile: {
          targetPersonas: ["team-6-20", "creator-heavy"],
          matchingPriority: 20,
          inPlanFlexibilityNotes: "可在套餐内调整岗位模型绑定。",
        },
      },
    );
    expect(updated.ok).toBe(true);
    expect(updated.payload?.plan.matchingProfile?.targetPersonas).toEqual([
      "team-6-20",
      "creator-heavy",
    ]);
  });

  it("diff compares two plan versions via bundle RPC", async () => {
    const created = await invoke<{
      plan: { id: string; currentVersionId: string };
      version: { id: string };
    }>("platform-plan-bundle.create", {
      name: "Diff 套餐",
      billingCycle: "monthly",
      basePriceCents: 10000,
      botQuota: 5,
      pricing: [{ type: "seat", key: "viewer", priceCents: 1000 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    expect(created.ok).toBe(true);
    const draft = await invoke<{ version: { id: string } }>("platform-plan-bundle.create-version", {
      planId: created.payload.plan.id,
      pricing: [{ type: "seat", key: "viewer", priceCents: 2000 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    expect(draft.ok).toBe(true);
    const diffRes = await invoke<{ diff: { entries: unknown[] } }>("platform-plan-bundle.diff", {
      fromVersionId: created.payload.version.id,
      toVersionId: draft.payload.version.id,
    });
    expect(diffRes.ok).toBe(true);
    expect(Array.isArray(diffRes.payload.diff.entries)).toBe(true);
  });

  it("consistency returns binding integrity issues", async () => {
    const res = await invoke<{ issues: Array<{ code: string }> }>(
      "platform-plan-bundle.consistency",
    );
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.payload.issues)).toBe(true);
  });

  it("rejects bundle create when binding has no vision-capable model", async () => {
    vi.mocked(planBindingIncludesVisionModel).mockResolvedValueOnce(false);
    const res = await invoke("platform-plan-bundle.create", {
      name: "无视觉版",
      billingCycle: "monthly",
      basePriceCents: 9900,
      botQuota: 5,
      pricing: [{ type: "seat", key: "viewer", priceCents: 1000 }],
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("视觉模型");
  });
});
