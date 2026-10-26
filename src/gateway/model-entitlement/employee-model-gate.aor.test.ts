// @vitest-environment node
/**
 * P3 任务 13 — resolveEmployeeModelGate 的 AOR 选路路径。
 *
 * 验证：`aor_enhanced` + 套餐含 aorExecution 时，gate 在 EffectiveModelSet 内
 * 给出 `preferredModelOrder`（保集合重排）；`native` 不做 AOR 重排，但仍可因
 * P0 能力计划写出可执行顺序（allowlist 序）；allowlist 行为与 P1 一致。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(),
}));
vi.mock("../knowledge/reply-gateway-client.js", () => ({
  buildKnowledgeReplyGatewayClient: vi.fn(() => ({ user: "user@acme.test" })),
}));
vi.mock("../resource-catalog/list-enabled-model-ids.js", () => ({
  listEnabledResourceCatalogModelIds: vi.fn(async () => ({
    modelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
    catalogEmpty: false,
  })),
}));
vi.mock("../resource-catalog/models-catalog-store.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../resource-catalog/models-catalog-store.js")>();
  return {
    ...actual,
    listResourceModelCatalog: vi.fn(async () => [
      {
        modelId: "api-proxy-deepseek/cheap",
        provider: "api-proxy-deepseek",
        displayName: "cheap",
        tier: "tier_a",
        enabled: true,
        inputCostPer1MCents: 10,
        outputCostPer1MCents: 20,
        capabilities: ["tool_use"],
        contextWindow: 32_000,
        updatedAt: "2026-07-19T00:00:00.000Z",
      },
      {
        modelId: "api-proxy-deepseek/premium",
        provider: "api-proxy-deepseek",
        displayName: "premium",
        tier: "tier_c",
        enabled: true,
        inputCostPer1MCents: 1000,
        outputCostPer1MCents: 2000,
        capabilities: ["coding", "reasoning"],
        contextWindow: 200_000,
        updatedAt: "2026-07-19T00:00:00.000Z",
      },
    ]),
  };
});

import { buildRunModelSetSnapshot } from "../governance/spawn-snapshot-handoff.js";
import { resolveKnowledgeSourceContext } from "../knowledge/context.js";
import { planChildSpawnCapabilityRouting } from "./child-spawn-capability-routing.js";
import { resolveEmployeeModelGate } from "./employee-model-gate.js";
import { upsertEnterpriseModelEntitlement } from "./enterprise-model-entitlement-store.js";
import { upsertPlanVersionModelBinding } from "./plan-version-model-binding-store.js";
import { grantSeatModels } from "./seat-model-grant-store.js";

const mockResolveCtx = vi.mocked(resolveKnowledgeSourceContext);

const MODELS = {
  "api-proxy-deepseek": {
    baseUrl: "https://api.deepseek.com",
    api: "openai-completions",
    models: [{ id: "cheap" }, { id: "premium" }],
  },
};

function makeCfg(
  mode: "native" | "aor_enhanced",
  enforce = "missing-allow",
  aor?: { enableRoutingExplanations?: boolean; auditLogPath?: string },
): OpenBotConfig {
  return {
    gateway: {
      platform: {
        models: {
          mode,
          entitlement: { enforce },
          ...(aor ? { aor } : {}),
        },
      },
    },
    models: { providers: MODELS },
  } as unknown as OpenBotConfig;
}

let tempDir = "";
const storeOpts = () => ({
  entitlementStorePath: path.join(tempDir, "ent.json"),
  seatGrantStorePath: path.join(tempDir, "grant.json"),
  planVersionBindingStorePath: path.join(tempDir, "binding.json"),
  platformConnectedModelIdsOverride: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
});

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aor-gate-"));
  vi.clearAllMocks();
  mockResolveCtx.mockResolvedValue({
    tenantId: "acme",
    seatId: "seat-1",
    userId: "user-1",
    tenantName: "Acme",
    hasEnterpriseScope: true,
  } as never);
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function seedEntitlementAndGrant() {
  await upsertEnterpriseModelEntitlement(
    {
      tenantId: "acme",
      planVersionId: "pv-1",
      allowedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
    },
    storeOpts().entitlementStorePath,
  );
  await grantSeatModels(
    {
      tenantId: "acme",
      seatId: "seat-1",
      grantedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
    },
    storeOpts().seatGrantStorePath,
  );
}

describe("resolveEmployeeModelGate — AOR 选路（P3）", () => {
  it("aor_enhanced + cheapest 绑定 → preferredModelOrder 在授权集合内重排", async () => {
    await seedEntitlementAndGrant();
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-1",
        allowedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
        aorExecution: {
          taskTypeId: "summarization",
          selectorStrategy: "cheapest",
          evaluatorMode: "content",
        },
      },
      storeOpts().planVersionBindingStorePath,
    );

    const result = await resolveEmployeeModelGate({
      cfg: makeCfg("aor_enhanced"),
      gatewayClientUser: "user@acme.test",
      gatewayClientSessionDomain: "employee",
      ...storeOpts(),
    });

    expect(result.preferredModelOrder).toBeDefined();
    expect([...(result.preferredModelOrder ?? [])].toSorted()).toEqual(
      ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"].toSorted(),
    );
    expect(result.preferredModelOrder?.[0]).toBe("api-proxy-deepseek/cheap");
  });

  it("native 不做 AOR 重排，但仍可有 capability-plan preferredModelOrder", async () => {
    await seedEntitlementAndGrant();
    const result = await resolveEmployeeModelGate({
      cfg: makeCfg("native"),
      gatewayClientUser: "user@acme.test",
      gatewayClientSessionDomain: "employee",
      ...storeOpts(),
    });
    // native: no AOR selection / routing explanation
    expect(result.aorRouting).toBeUndefined();
    expect(result.aorFeedback).toBeUndefined();
    // P0 capability plan still emits an executable order (allowlist order, not AOR reshuffle)
    expect(result.capabilityPlan).toBeDefined();
    expect(result.preferredModelOrder).toEqual(result.allowlist);
    expect(result.preferredModelOrder).toEqual([
      "api-proxy-deepseek/cheap",
      "api-proxy-deepseek/premium",
    ]);
  });

  it("aor_enhanced 无 aorExecution 时使用默认 balanced Policy 排序", async () => {
    await seedEntitlementAndGrant();
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-1",
        allowedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
      },
      storeOpts().planVersionBindingStorePath,
    );
    const result = await resolveEmployeeModelGate({
      cfg: makeCfg("aor_enhanced"),
      gatewayClientUser: "user@acme.test",
      gatewayClientSessionDomain: "employee",
      ...storeOpts(),
    });
    expect(result.preferredModelOrder).toBeDefined();
    expect(result.preferredModelOrder?.toSorted()).toEqual(
      ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"].toSorted(),
    );
  });

  it("P1: task text coding.refactor drives AOR scoring (not package-static summarization)", async () => {
    await seedEntitlementAndGrant();
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-1",
        allowedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
        aorExecution: {
          // Package static would prefer cheapest for summarization; refactor + best_quality
          // should prefer premium (coding capability) via parent inheritance.
          taskTypeId: "summarization",
          selectorStrategy: "best_quality",
          evaluatorMode: "content",
        },
      },
      storeOpts().planVersionBindingStorePath,
    );

    const withTask = await resolveEmployeeModelGate({
      cfg: makeCfg("aor_enhanced"),
      gatewayClientUser: "user@acme.test",
      gatewayClientSessionDomain: "employee",
      taskText: "帮我重构这段支付回调",
      ...storeOpts(),
    });
    expect(withTask.capabilityPlan?.categoryId).toBe("coding.refactor");
    expect(withTask.aorRouting?.taskTypeId ?? withTask.capabilityPlan?.categoryId).toBe(
      "coding.refactor",
    );
    // Discriminative: coding-capable premium should rank above tool_use-only cheap.
    expect(withTask.preferredModelOrder?.[0]).toBe("api-proxy-deepseek/premium");

    const withoutTask = await resolveEmployeeModelGate({
      cfg: makeCfg("aor_enhanced"),
      gatewayClientUser: "user@acme.test",
      gatewayClientSessionDomain: "employee",
      // no taskText → heuristic_default → package-static summarization
      ...storeOpts(),
    });
    // Without task text → package-static summarization; both models lack summarization
    // scores (quality 0.5 tie) so cost tie-break puts cheap first — proves task text
    // changed ranking (premium first above), not merely package static binding.
    expect(withoutTask.capabilityPlan?.categoryId).toBe("default");
    expect(withoutTask.capabilityPlan?.classificationSource).toBe("heuristic_default");
    expect(withoutTask.preferredModelOrder?.[0]).toBe("api-proxy-deepseek/cheap");
    expect(withTask.preferredModelOrder?.[0]).not.toBe(withoutTask.preferredModelOrder?.[0]);
  });

  it("P1: contextParts exclude over-context models from preferredModelOrder", async () => {
    await seedEntitlementAndGrant();
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-1",
        allowedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
        aorExecution: {
          taskTypeId: "summarization",
          selectorStrategy: "cheapest",
          evaluatorMode: "content",
        },
      },
      storeOpts().planVersionBindingStorePath,
    );
    const result = await resolveEmployeeModelGate({
      cfg: makeCfg("aor_enhanced"),
      gatewayClientUser: "user@acme.test",
      gatewayClientSessionDomain: "employee",
      taskText: "summarize",
      contextParts: {
        historyText: "h".repeat(200_000),
        outputReserveTokens: 2000,
      },
      ...storeOpts(),
    });
    expect(result.allowlist).toEqual(["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"]);
    expect(result.preferredModelOrder).not.toContain("api-proxy-deepseek/cheap");
    expect(result.capabilityPlan?.executableModelIds).toEqual(["api-proxy-deepseek/premium"]);
    expect(result.capabilityPlan?.authorizedModelIds).toEqual([
      "api-proxy-deepseek/cheap",
      "api-proxy-deepseek/premium",
    ]);
  });

  it("P1: explanations off — effectiveRouting still cheapest; child inherits via snapshot", async () => {
    await seedEntitlementAndGrant();
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-1",
        allowedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
        aorExecution: {
          taskTypeId: "summarization",
          selectorStrategy: "cheapest",
          evaluatorMode: "content",
        },
      },
      storeOpts().planVersionBindingStorePath,
    );

    const gate = await resolveEmployeeModelGate({
      cfg: makeCfg("aor_enhanced", "missing-allow", {
        enableRoutingExplanations: false,
        // no auditLogPath — aorRouting must stay absent
      }),
      gatewayClientUser: "user@acme.test",
      gatewayClientSessionDomain: "employee",
      ...storeOpts(),
    });

    expect(gate.aorRouting).toBeUndefined();
    expect(gate.effectiveRouting).toEqual({
      mode: "aor_enhanced",
      selectorStrategy: "cheapest",
    });

    const parentSnapshot = buildRunModelSetSnapshot({
      runId: "parent-explanations-off",
      allowlist: gate.allowlist ?? [],
      preferredModelOrder: gate.preferredModelOrder,
      platformModelsMode: gate.effectiveRouting.mode,
      selectorStrategy: gate.effectiveRouting.selectorStrategy,
    });
    expect(parentSnapshot?.effectiveModelSet?.selectorStrategy).toBe("cheapest");
    expect(parentSnapshot?.effectiveModelSet?.platformModelsMode).toBe("aor_enhanced");

    const planned = planChildSpawnCapabilityRouting({
      cfg: makeCfg("native"), // trusted cfg would not invent aor; snapshot must win
      taskText: "summarize this note",
      parentSnapshot,
      authorizedModelIds: gate.allowlist ?? [],
      parentPreferredModelOrder: gate.preferredModelOrder,
      catalog: [
        {
          ref: { provider: "api-proxy-deepseek", id: "cheap" },
          cost: { inputPerMtok: 0.1, outputPerMtok: 0.2 },
          taskTypeScores: { summarization: 0.7 },
        },
        {
          ref: { provider: "api-proxy-deepseek", id: "premium" },
          cost: { inputPerMtok: 10, outputPerMtok: 20 },
          taskTypeScores: { summarization: 0.9 },
        },
      ],
    });
    expect(planned.inherited.mode).toBe("aor_enhanced");
    expect(planned.inherited.selectorStrategy).toBe("cheapest");
    expect(planned.inherited.source).toBe("parent_snapshot");
    // cheapest → cheap first even though premium scores higher on summarization
    expect(planned.preferredModelOrder[0]).toBe("api-proxy-deepseek/cheap");
  });

  it("P1: explanations off — best_quality still inherited by child", async () => {
    await seedEntitlementAndGrant();
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-1",
        allowedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
        aorExecution: {
          taskTypeId: "summarization",
          selectorStrategy: "best_quality",
          evaluatorMode: "content",
        },
      },
      storeOpts().planVersionBindingStorePath,
    );

    const gate = await resolveEmployeeModelGate({
      cfg: makeCfg("aor_enhanced", "missing-allow", { enableRoutingExplanations: false }),
      gatewayClientUser: "user@acme.test",
      gatewayClientSessionDomain: "employee",
      taskText: "帮我重构这段支付回调",
      ...storeOpts(),
    });

    expect(gate.aorRouting).toBeUndefined();
    expect(gate.effectiveRouting.selectorStrategy).toBe("best_quality");
    expect(gate.effectiveRouting.mode).toBe("aor_enhanced");

    const parentSnapshot = buildRunModelSetSnapshot({
      runId: "parent-bq-off",
      allowlist: gate.allowlist ?? [],
      preferredModelOrder: gate.preferredModelOrder,
      platformModelsMode: gate.effectiveRouting.mode,
      selectorStrategy: gate.effectiveRouting.selectorStrategy,
    });
    const planned = planChildSpawnCapabilityRouting({
      cfg: makeCfg("native"),
      taskText: "帮我重构这段支付回调",
      parentSnapshot,
      authorizedModelIds: gate.allowlist ?? [],
      parentPreferredModelOrder: gate.preferredModelOrder,
      catalog: [
        {
          ref: { provider: "api-proxy-deepseek", id: "cheap" },
          cost: { inputPerMtok: 0.1, outputPerMtok: 0.2 },
          taskTypeScores: { tool_use: 0.75 },
        },
        {
          ref: { provider: "api-proxy-deepseek", id: "premium" },
          cost: { inputPerMtok: 10, outputPerMtok: 20 },
          taskTypeScores: { coding: 0.8, reasoning: 0.85 },
        },
      ],
    });
    expect(planned.inherited.selectorStrategy).toBe("best_quality");
    expect(planned.preferredModelOrder[0]).toBe("api-proxy-deepseek/premium");
  });
});
