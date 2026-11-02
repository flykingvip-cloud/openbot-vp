// @vitest-environment node
// Feature: model-entitlement-chain P2 (task 10)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-model-grant-handlers-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../billing/scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../billing/scope.js")>();
  return {
    ...actual,
    resolveBillingScope: vi.fn(async () => ({
      enterpriseId: "ent-test",
      user: { id: "user-1" },
      membership: null,
      isEnterpriseAdmin: true,
      permissions: new Set([actual.USAGE_BUDGET_PERMISSION]),
    })),
  };
});

const { configHolder } = vi.hoisted(() => ({
  configHolder: {
    current: {
      models: {
        providers: {
          "api-proxy-deepseek": { models: [{ id: "deepseek-chat" }] },
          ollama: { models: [{ id: "llama3.2" }] },
        },
      },
    } as {
      models: { providers: Record<string, { models: Array<{ id: string }> }> };
      agents?: { defaults?: { models?: Record<string, unknown> } };
    },
  },
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => configHolder.current,
}));

const { platformModelBindingHandlers, enterpriseModelGrantHandlers } =
  await import("./model-entitlement-management.js");
const { upsertEnterpriseModelEntitlement } =
  await import("../model-entitlement/enterprise-model-entitlement-store.js");

const allHandlers = {
  ...platformModelBindingHandlers,
  ...enterpriseModelGrantHandlers,
};

type HandlerError = { code?: string; message?: string };

async function invoke<P = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
  context: GatewayRequestHandlerOptions["context"] | Record<string, unknown> = {},
): Promise<{ ok: boolean; payload: P; error: HandlerError }> {
  const handler = allHandlers[method];
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
    context: context as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("platform-model-binding.*", () => {
  it("sets, gets, and lists a binding", async () => {
    const { createPlan } = await import("../billing/plans-store.js");
    const plan = await createPlan({
      name: "入门版",
      billingCycle: "monthly",
      basePriceCents: 9900,
      seatQuota: {},
      botQuota: 5,
      pricing: [],
      createdByUserId: "platform-admin",
    });
    const set = await invoke<{ binding: { allowedModelIds: string[] } }>(
      "platform-model-binding.set",
      {
        planVersionId: plan.currentVersionId,
        allowedModelIds: ["ollama/llama3.2", "api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"],
      },
    );
    expect(set.ok).toBe(true);
    expect(set.payload.binding.allowedModelIds).toEqual([
      "ollama/llama3.2",
      "api-proxy-deepseek/deepseek-chat",
    ]);

    const got = await invoke<{ binding: { planVersionId: string } | null }>(
      "platform-model-binding.get",
      { planVersionId: plan.currentVersionId },
    );
    expect(got.payload.binding?.planVersionId).toBe(plan.currentVersionId);

    const list = await invoke<{ bindings: unknown[] }>("platform-model-binding.list");
    expect(list.payload.bindings).toHaveLength(1);
  });

  it("rejects invalid aorExecution", async () => {
    const res = await invoke("platform-model-binding.set", {
      planVersionId: "pv-2",
      allowedModelIds: [],
      aorExecution: { taskTypeId: "chat", selectorStrategy: "nope", evaluatorMode: "x" },
    });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe("INVALID_REQUEST");
  });

  it("rejects missing planVersionId", async () => {
    const res = await invoke("platform-model-binding.set", { allowedModelIds: [] });
    expect(res.ok).toBe(false);
  });

  it("rejects unknown planVersionId", async () => {
    const res = await invoke("platform-model-binding.set", {
      planVersionId: "pv-missing",
      allowedModelIds: [],
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("套餐版本不存在");
  });

  it("rejects model ids outside current catalog", async () => {
    const { createPlan } = await import("../billing/plans-store.js");
    const plan = await createPlan({
      name: "入门版",
      billingCycle: "monthly",
      basePriceCents: 9900,
      seatQuota: {},
      botQuota: 5,
      pricing: [],
      createdByUserId: "platform-admin",
    });
    const res = await invoke("platform-model-binding.set", {
      planVersionId: plan.currentVersionId,
      allowedModelIds: ["legacy/removed"],
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("不在当前平台目录内");
  });

  it("rejects clearing models on an active plan version", async () => {
    const { createPlan } = await import("../billing/plans-store.js");
    const { upsertPlanVersionModelBinding } =
      await import("../model-entitlement/plan-version-model-binding-store.js");
    const plan = await createPlan({
      name: "专业版",
      billingCycle: "monthly",
      basePriceCents: 49900,
      seatQuota: {},
      botQuota: 30,
      pricing: [],
      createdByUserId: "platform-admin",
    });
    await upsertPlanVersionModelBinding({
      planVersionId: plan.currentVersionId,
      allowedModelIds: ["ollama/llama3.2"],
    });
    const res = await invoke("platform-model-binding.set", {
      planVersionId: plan.currentVersionId,
      allowedModelIds: [],
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("已生效版本不能清空可用模型集合");
  });

  it("rejects manual model rewrite on a tier-backed binding (legacy bypass closed)", async () => {
    const { createPlan } = await import("../billing/plans-store.js");
    const { upsertPlanVersionModelBinding } =
      await import("../model-entitlement/plan-version-model-binding-store.js");
    const plan = await createPlan({
      name: "Tier 版",
      billingCycle: "monthly",
      basePriceCents: 49900,
      seatQuota: {},
      botQuota: 30,
      pricing: [],
      createdByUserId: "platform-admin",
    });
    // Tier-backed binding: allowedModelIds is a derived cache of tier_a.
    await upsertPlanVersionModelBinding({
      planVersionId: plan.currentVersionId,
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
      allowedTiers: ["tier_a"],
    });
    // The legacy entry must NOT be able to rewrite the model set back into a manual dual-truth.
    const res = await invoke("platform-model-binding.set", {
      planVersionId: plan.currentVersionId,
      allowedModelIds: ["ollama/llama3.2"],
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("Tier 投影管理");
  });
});

describe("enterprise-model-grant.*", () => {
  it("grants models within entitlement and lists them", async () => {
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-test",
      allowedModelIds: ["a/x", "b/y"],
    });

    const grant = await invoke<{ grant: { grantedModelIds: string[] } }>(
      "enterprise-model-grant.grant",
      { subjectType: "seat", subjectId: "seat-1", grantedModelIds: ["a/x"] },
    );
    expect(grant.ok).toBe(true);
    expect(grant.payload.grant.grantedModelIds).toEqual(["a/x"]);

    const list = await invoke<{ allowedModelIds: string[]; grants: unknown[] }>(
      "enterprise-model-grant.list",
    );
    expect(list.payload.allowedModelIds).toEqual(["a/x", "b/y"]);
    expect(list.payload.grants).toHaveLength(1);
  });

  it("rejects overreach: granting a model outside entitlement", async () => {
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-test",
      allowedModelIds: ["a/x"],
    });
    const res = await invoke("enterprise-model-grant.grant", {
      subjectType: "seat",
      subjectId: "seat-1",
      grantedModelIds: ["a/x", "c/z"],
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("c/z");
  });

  it("drops grants for deleted enterprise assets and still allows edits around a registered but unverified model", async () => {
    const { setModelGrant, getModelGrant } =
      await import("../model-entitlement/seat-model-grant-store.js");
    const { createEnterpriseModelConnection } =
      await import("../enterprise-model/connection-store.js");
    const { registerEnterpriseModelAsset } = await import("../enterprise-model/asset-store.js");
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-test",
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"],
    });
    const draft = await createEnterpriseModelConnection({
      tenantId: "ent-test",
      providerType: "openai-compatible",
      displayName: "未验证连接",
      baseUrl: "https://draft.example/v1",
    });
    const unverified = await registerEnterpriseModelAsset({
      tenantId: "ent-test",
      connectionId: draft.connectionId,
      upstreamModelId: "mimo-v2.6-flash",
      enabled: true,
      healthStatus: "unknown",
    });
    await setModelGrant({
      tenantId: "ent-test",
      subjectType: "seat",
      subjectId: "seat-stale",
      grantedModelIds: [
        "api-proxy-deepseek/deepseek-chat",
        unverified.runtimeModelId,
        "ent/cea43bf898/deepseek-v4-flash",
        "ent/cc41dd5419/mimo-v2.6-flash",
      ],
    });

    const listed = await invoke<{
      grants: Array<{ subjectId: string; grantedModelIds: string[] }>;
      ceilingModelIds: string[];
    }>("enterprise-model-grant.list");
    expect(listed.ok).toBe(true);
    const seat = listed.payload.grants.find((grant) => grant.subjectId === "seat-stale");
    expect(seat?.grantedModelIds).toEqual([
      "api-proxy-deepseek/deepseek-chat",
      unverified.runtimeModelId,
    ]);
    expect(listed.payload.ceilingModelIds).not.toContain(unverified.runtimeModelId);
    expect(listed.payload.ceilingModelIds).not.toContain("ent/cea43bf898/deepseek-v4-flash");

    const kept = await invoke("enterprise-model-grant.grant", {
      subjectType: "seat",
      subjectId: "seat-stale",
      grantedModelIds: [
        "api-proxy-deepseek/deepseek-chat",
        "ollama/llama3.2",
        unverified.runtimeModelId,
      ],
    });
    expect(kept.ok).toBe(true);

    const removed = await invoke("enterprise-model-grant.grant", {
      subjectType: "seat",
      subjectId: "seat-stale",
      grantedModelIds: ["api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"],
    });
    expect(removed.ok).toBe(true);
    expect(
      (
        await getModelGrant({
          tenantId: "ent-test",
          subjectType: "seat",
          subjectId: "seat-stale",
        })
      )?.grantedModelIds.toSorted(),
    ).toEqual(["api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"]);

    const added = await invoke("enterprise-model-grant.grant", {
      subjectType: "seat",
      subjectId: "seat-stale",
      grantedModelIds: [
        "api-proxy-deepseek/deepseek-chat",
        "ollama/llama3.2",
        "ent/cea43bf898/qwen3.6-35b-a3b",
      ],
    });
    expect(added.ok).toBe(false);
    expect(added.error.message).toContain("ent/cea43bf898/qwen3.6-35b-a3b");
  });

  it("tells the enterprise admin when a self-supplied connection probe has failed", async () => {
    const { createEnterpriseModelConnection, updateEnterpriseModelConnection } =
      await import("../enterprise-model/connection-store.js");
    const { registerEnterpriseModelAsset } = await import("../enterprise-model/asset-store.js");
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-test",
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    const connection = await createEnterpriseModelConnection({
      tenantId: "ent-test",
      providerType: "openai-compatible",
      displayName: "内网推理",
      baseUrl: "https://private.example/v1",
    });
    await updateEnterpriseModelConnection({
      tenantId: "ent-test",
      connectionId: connection.connectionId,
      status: "invalid_credential",
      healthStatus: "unhealthy",
      skipEndpointInvalidation: true,
      lastVerificationResult: {
        code: "ENTERPRISE_MODEL_INVALID_CREDENTIAL",
        message: "凭证无效",
      },
    });
    await registerEnterpriseModelAsset({
      tenantId: "ent-test",
      connectionId: connection.connectionId,
      upstreamModelId: "deepseek-v4-flash",
      enabled: true,
      healthStatus: "unhealthy",
    });

    const listed = await invoke<{
      unusableModels: Array<{ kind: string; title: string; detail: string }>;
    }>("enterprise-model-grant.list");
    expect(listed.ok).toBe(true);
    expect(listed.payload.unusableModels).toEqual([
      expect.objectContaining({
        kind: "connection",
        title: "内网推理",
      }),
    ]);
    expect(listed.payload.unusableModels[0]?.detail).toContain("凭证无效");
  });

  it("rejects grant when no entitlement record exists", async () => {
    const res = await invoke("enterprise-model-grant.grant", {
      subjectType: "seat",
      subjectId: "seat-1",
      grantedModelIds: ["a/x"],
    });
    expect(res.ok).toBe(false);
  });

  it("backfills a missing entitlement before granting an active plan model", async () => {
    const { createSubscription } = await import("../billing/subscriptions-store.js");
    const { upsertPlanVersionModelBinding } =
      await import("../model-entitlement/plan-version-model-binding-store.js");
    const { getEnterpriseModelEntitlement } =
      await import("../model-entitlement/enterprise-model-entitlement-store.js");
    await upsertPlanVersionModelBinding({
      planVersionId: "pv-backfill",
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });
    await createSubscription({
      enterpriseId: "ent-test",
      planId: "plan-a",
      planVersionId: "pv-backfill",
    });

    const grant = await invoke<{ grant: { grantedModelIds: string[] } }>(
      "enterprise-model-grant.grant",
      {
        subjectType: "seat",
        subjectId: "seat-1",
        grantedModelIds: ["api-proxy-deepseek/deepseek-chat"],
      },
    );

    expect(grant.ok).toBe(true);
    expect(grant.payload.grant.grantedModelIds).toEqual(["api-proxy-deepseek/deepseek-chat"]);
    expect((await getEnterpriseModelEntitlement("ent-test"))?.allowedModelIds).toEqual([
      "api-proxy-deepseek/deepseek-chat",
    ]);
  });

  it("clears a stale entitlement when an active plan has no model binding", async () => {
    const { createSubscription } = await import("../billing/subscriptions-store.js");
    const { getEnterpriseModelEntitlement } =
      await import("../model-entitlement/enterprise-model-entitlement-store.js");
    await createSubscription({
      enterpriseId: "ent-test",
      planId: "plan-a",
      planVersionId: "pv-no-binding",
    });
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-test",
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
      planVersionId: "pv-no-binding",
    });

    const grant = await invoke("enterprise-model-grant.grant", {
      subjectType: "seat",
      subjectId: "seat-1",
      grantedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });

    expect(grant.ok).toBe(false);
    expect(grant.error.message).toContain("尚未配置模型绑定");
    expect((await getEnterpriseModelEntitlement("ent-test"))?.allowedModelIds).toEqual([]);
  });

  it("revokes a grant", async () => {
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-test",
      allowedModelIds: ["a/x"],
    });
    await invoke("enterprise-model-grant.grant", {
      subjectType: "seat",
      subjectId: "seat-1",
      grantedModelIds: ["a/x"],
    });
    const revoke = await invoke<{ grant: { status: string } }>("enterprise-model-grant.revoke", {
      subjectType: "seat",
      subjectId: "seat-1",
    });
    expect(revoke.ok).toBe(true);
    expect(revoke.payload.grant.status).toBe("revoked");
  });

  it("rejects grant from a non-admin enterprise member (Issue 1 governance)", async () => {
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-test",
      allowedModelIds: ["a/x"],
    });
    const { resolveBillingScope } = await import("../billing/scope.js");
    vi.mocked(resolveBillingScope).mockResolvedValueOnce({
      enterpriseId: "ent-test",
      user: { id: "member-1" } as never,
      membership: null,
      isEnterpriseAdmin: false,
      permissions: new Set(),
    });
    const res = await invoke("enterprise-model-grant.grant", {
      subjectType: "seat",
      subjectId: "seat-1",
      grantedModelIds: ["a/x"],
    });
    expect(res.ok).toBe(false);
    expect(res.error.message).toContain("企业管理员");
  });

  it("union mergeMode preserves existing seat grants", async () => {
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-test",
      allowedModelIds: ["a/x", "b/y", "c/z"],
    });
    await invoke("enterprise-model-grant.grant", {
      subjectType: "seat",
      subjectId: "seat-1",
      grantedModelIds: ["a/x", "b/y"],
    });
    const res = await invoke<{ grant: { grantedModelIds: string[] } }>(
      "enterprise-model-grant.grant",
      {
        subjectType: "seat",
        subjectId: "seat-1",
        grantedModelIds: ["c/z"],
        mergeMode: "union",
      },
    );
    expect(res.ok).toBe(true);
    expect(res.payload.grant.grantedModelIds.toSorted()).toEqual(["a/x", "b/y", "c/z"]);
  });

  it("grantBatch atomically unions across seats", async () => {
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-test",
      allowedModelIds: ["a/x", "ent/new"],
    });
    await invoke("enterprise-model-grant.grant", {
      subjectType: "seat",
      subjectId: "seat-1",
      grantedModelIds: ["a/x"],
    });
    const res = await invoke<{ grants: Array<{ subjectId: string; grantedModelIds: string[] }> }>(
      "enterprise-model-grant.grantBatch",
      {
        mergeMode: "union",
        grants: [
          { subjectType: "seat", subjectId: "seat-1", grantedModelIds: ["ent/new"] },
          { subjectType: "seat", subjectId: "seat-2", grantedModelIds: ["ent/new"] },
        ],
      },
    );
    expect(res.ok).toBe(true);
    expect(res.payload.grants).toHaveLength(2);
    const bySeat = Object.fromEntries(
      res.payload.grants.map((g) => [g.subjectId, g.grantedModelIds.toSorted()]),
    );
    expect(bySeat["seat-1"]).toEqual(["a/x", "ent/new"]);
    expect(bySeat["seat-2"]).toEqual(["ent/new"]);
  });

  it("lists only platform models with a successful connection and keeps raw entitlement", async () => {
    const { recordModelProbeResults } = await import("../models/model-probe-store.js");
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-test",
      allowedModelIds: [
        "api-proxy-deepseek/deepseek-chat",
        "configured/offline",
        "ent/private/qwen",
      ],
    });
    await invoke("enterprise-model-grant.grant", {
      subjectType: "seat",
      subjectId: "seat-1",
      grantedModelIds: [
        "api-proxy-deepseek/deepseek-chat",
        "configured/offline",
        "ent/private/qwen",
      ],
    });

    const hidden = await invoke<{
      allowedModelIds: string[];
      subscriptionModelIds: string[];
      ceilingModelIds: string[];
      suppressedPlatformModelIds: string[];
    }>("enterprise-model-grant.list");
    expect(hidden.ok).toBe(true);
    expect(hidden.payload.allowedModelIds).toEqual([
      "api-proxy-deepseek/deepseek-chat",
      "configured/offline",
      "ent/private/qwen",
    ]);
    expect(hidden.payload.subscriptionModelIds).toEqual(["ent/private/qwen"]);
    expect(hidden.payload.ceilingModelIds).toEqual(["ent/private/qwen"]);
    expect(hidden.payload.suppressedPlatformModelIds).toEqual([
      "api-proxy-deepseek/deepseek-chat",
      "configured/offline",
    ]);

    await recordModelProbeResults({
      finishedAt: 1,
      results: [
        {
          provider: "api-proxy-deepseek",
          model: "api-proxy-deepseek/deepseek-chat",
          label: "deepseek",
          source: "env",
          status: "ok",
        },
        {
          provider: "configured",
          model: "configured/offline",
          label: "offline",
          source: "env",
          status: "auth",
        },
      ],
    });

    const shown = await invoke<{
      subscriptionModelIds: string[];
      suppressedPlatformModelIds: string[];
      platformModels: Array<{ modelId: string }>;
    }>(
      "enterprise-model-grant.list",
      {},
      {
        loadGatewayModelCatalog: async () => [
          { provider: "configured", id: "offline" },
          { provider: "api-proxy-deepseek", id: "deepseek-chat" },
        ],
      },
    );
    expect(shown.payload.subscriptionModelIds.toSorted()).toEqual(
      ["api-proxy-deepseek/deepseek-chat", "ent/private/qwen"].toSorted(),
    );
    expect(shown.payload.suppressedPlatformModelIds).toEqual(["configured/offline"]);
    expect(shown.payload.platformModels.map((model) => model.modelId)).not.toContain(
      "configured/offline",
    );
  });

  it("hides platform models removed from the pool even when a stale probe succeeded", async () => {
    const { recordModelProbeResults } = await import("../models/model-probe-store.js");
    const previous = configHolder.current;
    configHolder.current = {
      models: {
        providers: {
          "api-proxy-deepseek": { models: [{ id: "deepseek-chat" }] },
          "live-provider": { models: [{ id: "vision-model" }] },
        },
      },
      agents: {
        defaults: {
          models: {
            "api-proxy-deepseek/kept-by-allowlist": {},
          },
        },
      },
    };
    try {
      await upsertEnterpriseModelEntitlement({
        tenantId: "ent-test",
        allowedModelIds: [
          "api-proxy-deepseek/deepseek-chat",
          "live-provider/vision-model",
          "api-proxy-deepseek/kept-by-allowlist",
          "removed-vendor/ghost-chat",
          "ent/private/qwen",
        ],
      });
      await invoke("enterprise-model-grant.grant", {
        subjectType: "seat",
        subjectId: "seat-1",
        grantedModelIds: [
          "api-proxy-deepseek/deepseek-chat",
          "live-provider/vision-model",
          "api-proxy-deepseek/kept-by-allowlist",
          "removed-vendor/ghost-chat",
          "ent/private/qwen",
        ],
      });
      await recordModelProbeResults({
        finishedAt: 2,
        results: [
          {
            provider: "api-proxy-deepseek",
            model: "api-proxy-deepseek/deepseek-chat",
            label: "deepseek",
            source: "env",
            status: "ok",
          },
          {
            provider: "live-provider",
            model: "live-provider/vision-model",
            label: "vision",
            source: "env",
            status: "ok",
          },
          {
            provider: "api-proxy-deepseek",
            model: "api-proxy-deepseek/kept-by-allowlist",
            label: "allowlist",
            source: "env",
            status: "ok",
          },
          {
            provider: "removed-vendor",
            model: "removed-vendor/ghost-chat",
            label: "ghost",
            source: "env",
            status: "ok",
          },
        ],
      });

      const listed = await invoke<{
        ceilingModelIds: string[];
        subscriptionModelIds: string[];
        suppressedPlatformModelIds: string[];
      }>(
        "enterprise-model-grant.list",
        {},
        {
          loadGatewayModelCatalog: async () => [
            { provider: "removed-vendor", id: "ghost-chat" },
            { provider: "live-provider", id: "vision-model" },
            { provider: "api-proxy-deepseek", id: "deepseek-chat" },
            { provider: "api-proxy-deepseek", id: "kept-by-allowlist" },
          ],
        },
      );
      expect(listed.ok).toBe(true);
      expect(listed.payload.ceilingModelIds.toSorted()).toEqual(
        [
          "api-proxy-deepseek/deepseek-chat",
          "api-proxy-deepseek/kept-by-allowlist",
          "ent/private/qwen",
          "live-provider/vision-model",
        ].toSorted(),
      );
      expect(listed.payload.subscriptionModelIds).not.toContain("removed-vendor/ghost-chat");
      expect(listed.payload.suppressedPlatformModelIds).toContain("removed-vendor/ghost-chat");
    } finally {
      configHolder.current = previous;
    }
  });

  it("lifts a verified enterprise model into the seat ceiling when asset health was left unknown", async () => {
    const { createEnterpriseModelConnection, updateEnterpriseModelConnection } =
      await import("../enterprise-model/connection-store.js");
    const { getEnterpriseModelAsset, registerEnterpriseModelAsset } =
      await import("../enterprise-model/asset-store.js");
    const verified = await createEnterpriseModelConnection({
      tenantId: "ent-test",
      providerType: "openai-compatible",
      displayName: "BYOK",
      baseUrl: "https://private.example/v1",
    });
    await updateEnterpriseModelConnection({
      tenantId: "ent-test",
      connectionId: verified.connectionId,
      status: "active",
      healthStatus: "healthy",
      skipEndpointInvalidation: true,
    });
    const asset = await registerEnterpriseModelAsset({
      tenantId: "ent-test",
      connectionId: verified.connectionId,
      upstreamModelId: "private-qwen",
      enabled: true,
      healthStatus: "unknown",
    });
    const disabled = await registerEnterpriseModelAsset({
      tenantId: "ent-test",
      connectionId: verified.connectionId,
      upstreamModelId: "disabled-one",
      enabled: false,
      healthStatus: "unknown",
    });
    const draft = await createEnterpriseModelConnection({
      tenantId: "ent-test",
      providerType: "openai-compatible",
      displayName: "Draft",
      baseUrl: "https://draft.example/v1",
    });
    const hidden = await registerEnterpriseModelAsset({
      tenantId: "ent-test",
      connectionId: draft.connectionId,
      upstreamModelId: "not-ready",
      enabled: true,
      healthStatus: "unknown",
    });
    await upsertEnterpriseModelEntitlement({
      tenantId: "ent-test",
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
    });

    const listed = await invoke<{
      ceilingModelIds: string[];
      tenantOwnedModelIds: string[];
    }>("enterprise-model-grant.list");
    expect(listed.ok).toBe(true);
    expect(listed.payload.tenantOwnedModelIds).toContain(asset.runtimeModelId);
    expect(listed.payload.tenantOwnedModelIds).not.toContain(hidden.runtimeModelId);
    expect(listed.payload.tenantOwnedModelIds).not.toContain(disabled.runtimeModelId);
    expect(listed.payload.ceilingModelIds).toContain(asset.runtimeModelId);
    expect(listed.payload.ceilingModelIds).not.toContain(hidden.runtimeModelId);
    expect((await getEnterpriseModelAsset("ent-test", asset.assetId))?.healthStatus).toBe(
      "healthy",
    );
    expect((await getEnterpriseModelAsset("ent-test", hidden.assetId))?.healthStatus).toBe(
      "unknown",
    );
    expect((await getEnterpriseModelAsset("ent-test", disabled.assetId))?.healthStatus).toBe(
      "unknown",
    );

    const granted = await invoke("enterprise-model-grant.grant", {
      subjectType: "seat",
      subjectId: "seat-private",
      grantedModelIds: [asset.runtimeModelId],
    });
    expect(granted.ok).toBe(true);

    const rejected = await invoke("enterprise-model-grant.grant", {
      subjectType: "seat",
      subjectId: "seat-hidden",
      grantedModelIds: [hidden.runtimeModelId],
    });
    expect(rejected.ok).toBe(false);
  });
});

describe("platform-model-binding.overview (P6 套餐⇄模型统一视图)", () => {
  it("聚合套餐 + 当前版本模型绑定 + 平台目录 + 反向索引", async () => {
    const { createPlan } = await import("../billing/plans-store.js");
    const planA = await createPlan({
      name: "入门版",
      billingCycle: "monthly",
      basePriceCents: 9900,
      seatQuota: {},
      botQuota: 5,
      pricing: [],
      createdByUserId: "platform-admin",
    });
    const planB = await createPlan({
      name: "专业版",
      billingCycle: "monthly",
      basePriceCents: 49900,
      seatQuota: {},
      botQuota: 30,
      pricing: [],
      createdByUserId: "platform-admin",
    });
    // 绑定：入门版含本地模型，专业版含 deepseek + 本地
    await invoke("platform-model-binding.set", {
      planVersionId: planA.currentVersionId,
      allowedModelIds: ["ollama/llama3.2"],
    });
    await invoke("platform-model-binding.set", {
      planVersionId: planB.currentVersionId,
      allowedModelIds: ["api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"],
    });

    const res = await invoke<{
      catalog: string[];
      plans: Array<{ planId: string; name: string; allowedModelIds: string[] }>;
      reverseIndex: Record<string, string[]>;
    }>("platform-model-binding.overview");

    expect(res.ok).toBe(true);
    // 平台目录（来自 mock 的 cfg.models.providers）
    expect(res.payload.catalog.toSorted()).toEqual([
      "api-proxy-deepseek/deepseek-chat",
      "ollama/llama3.2",
    ]);
    // 每个套餐携带其当前版本的 allowedModelIds
    const rowA = res.payload.plans.find((p) => p.planId === planA.id)!;
    const rowB = res.payload.plans.find((p) => p.planId === planB.id)!;
    expect(rowA.allowedModelIds).toEqual(["ollama/llama3.2"]);
    expect(rowB.allowedModelIds.toSorted()).toEqual([
      "api-proxy-deepseek/deepseek-chat",
      "ollama/llama3.2",
    ]);
    // 反向索引：本地模型被两个套餐包含（N:N 视图）
    expect(res.payload.reverseIndex["ollama/llama3.2"].toSorted()).toEqual(
      [planA.id, planB.id].toSorted(),
    );
    expect(res.payload.reverseIndex["api-proxy-deepseek/deepseek-chat"]).toEqual([planB.id]);
  });
});
