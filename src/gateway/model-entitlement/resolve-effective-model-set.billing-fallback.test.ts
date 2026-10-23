// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assignSeat, __resetSeatsForTest } from "../billing/seats-store.js";
import { registerEnterpriseModelAsset } from "../enterprise-model/asset-store.js";
import { upsertEnterpriseModelEntitlement } from "./enterprise-model-entitlement-store.js";
import { resolveEffectiveModelSet } from "./resolve-effective-model-set.js";
import { grantSeatModels } from "./seat-model-grant-store.js";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "me-billing-fallback-"));
});
afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

const entitlementStorePath = () => path.join(tempDir, "ent.json");
const seatGrantStorePath = () => path.join(tempDir, "grant.json");
const billingSeatsStorePath = () => path.join(tempDir, "billing-seats.json");

const baseCfg = {
  models: {
    providers: {
      "api-proxy-deepseek": {
        models: [{ id: "deepseek-chat" }],
      },
      ollama: {
        models: [{ id: "llama3.2" }],
      },
    },
  },
} as unknown as import("../../config/types.js").OpenBotConfig;

describe("resolveEffectiveModelSet — billing seat grant fallback", () => {
  it("org seatId 无 grant 时回退到 billing seat grant（按邮箱）", async () => {
    await upsertEnterpriseModelEntitlement(
      {
        tenantId: "t1",
        allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
      },
      entitlementStorePath(),
    );
    await __resetSeatsForTest(billingSeatsStorePath());
    const billingSeat = await assignSeat(
      {
        enterpriseId: "t1",
        userId: "elle@example.com",
        role: "viewer",
        botQuota: 0,
      },
      billingSeatsStorePath(),
    );
    await grantSeatModels(
      {
        tenantId: "t1",
        seatId: billingSeat.id,
        grantedModelIds: ["api-proxy-deepseek/deepseek-chat"],
      },
      seatGrantStorePath(),
    );

    const result = await resolveEffectiveModelSet({
      tenantId: "t1",
      seatId: "enterprise-seat-org-1",
      employeeId: "elle@example.com",
      userEmail: "elle@example.com",
      cfg: baseCfg,
      seatGrantInheritsEnterprise: true,
      requirePlatformCatalog: false,
      entitlementStorePath: entitlementStorePath(),
      seatGrantStorePath: seatGrantStorePath(),
      billingSeatsStorePath: billingSeatsStorePath(),
      platformConnectedModelIdsOverride: ["api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"],
    });

    expect(result.state).toBe("resolved");
    expect(result.allowedModelIds).toEqual(["api-proxy-deepseek/deepseek-chat"]);
  });

  it("platform user id + userEmail 可解析 billing seat grant", async () => {
    await upsertEnterpriseModelEntitlement(
      {
        tenantId: "t1",
        allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
      },
      entitlementStorePath(),
    );
    await __resetSeatsForTest(billingSeatsStorePath());
    const billingSeat = await assignSeat(
      {
        enterpriseId: "t1",
        userId: "elle@example.com",
        role: "viewer",
        botQuota: 0,
      },
      billingSeatsStorePath(),
    );
    await grantSeatModels(
      {
        tenantId: "t1",
        seatId: billingSeat.id,
        grantedModelIds: ["api-proxy-deepseek/deepseek-chat"],
      },
      seatGrantStorePath(),
    );

    const result = await resolveEffectiveModelSet({
      tenantId: "t1",
      seatId: "enterprise-seat-org-1",
      employeeId: "platform-user-elle",
      userEmail: "elle@example.com",
      cfg: baseCfg,
      seatGrantInheritsEnterprise: true,
      // Unit fixture without platform resource catalog: seed upper bound from cfg.
      requirePlatformCatalog: false,
      entitlementStorePath: entitlementStorePath(),
      seatGrantStorePath: seatGrantStorePath(),
      billingSeatsStorePath: billingSeatsStorePath(),
      platformConnectedModelIdsOverride: ["api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"],
    });

    expect(result.state).toBe("resolved");
    expect(result.allowedModelIds).toEqual(["api-proxy-deepseek/deepseek-chat"]);
  });

  it("org seat 有陈旧 grant 时仍优先 billing seat grant（员工会话真源）", async () => {
    await upsertEnterpriseModelEntitlement(
      {
        tenantId: "t1",
        allowedModelIds: ["api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"],
      },
      entitlementStorePath(),
    );
    await __resetSeatsForTest(billingSeatsStorePath());
    const billingSeat = await assignSeat(
      {
        enterpriseId: "t1",
        userId: "elle@example.com",
        role: "viewer",
        botQuota: 0,
      },
      billingSeatsStorePath(),
    );
    await grantSeatModels(
      {
        tenantId: "t1",
        seatId: billingSeat.id,
        grantedModelIds: ["api-proxy-deepseek/deepseek-chat"],
      },
      seatGrantStorePath(),
    );
    await grantSeatModels(
      {
        tenantId: "t1",
        seatId: "enterprise-seat-org-1",
        grantedModelIds: ["ollama/llama3.2"],
      },
      seatGrantStorePath(),
    );

    const result = await resolveEffectiveModelSet({
      tenantId: "t1",
      seatId: "enterprise-seat-org-1",
      employeeId: "platform-user-elle",
      userEmail: "elle@example.com",
      cfg: baseCfg,
      seatGrantInheritsEnterprise: true,
      requirePlatformCatalog: false,
      entitlementStorePath: entitlementStorePath(),
      seatGrantStorePath: seatGrantStorePath(),
      billingSeatsStorePath: billingSeatsStorePath(),
      platformConnectedModelIdsOverride: ["api-proxy-deepseek/deepseek-chat"],
    });

    expect(result.state).toBe("resolved");
    expect(result.allowedModelIds).toEqual(["api-proxy-deepseek/deepseek-chat"]);
  });

  it("explicit billing seat grant unions with org BYOK when employee email lookup is absent", async () => {
    const assetStorePath = path.join(tempDir, "assets.json");
    await upsertEnterpriseModelEntitlement(
      {
        tenantId: "t1",
        allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
      },
      entitlementStorePath(),
    );
    await __resetSeatsForTest(billingSeatsStorePath());
    const billingSeat = await assignSeat(
      {
        enterpriseId: "t1",
        userId: "ceo@example.com",
        role: "admin",
        botQuota: 1,
      },
      billingSeatsStorePath(),
    );
    await grantSeatModels(
      {
        tenantId: "t1",
        seatId: billingSeat.id,
        grantedModelIds: ["api-proxy-deepseek/deepseek-chat"],
      },
      seatGrantStorePath(),
    );
    const mimo = await registerEnterpriseModelAsset(
      {
        tenantId: "t1",
        connectionId: "conn-mimo",
        upstreamModelId: "mimo-v2.6-flash",
        enabled: true,
        healthStatus: "healthy",
      },
      assetStorePath,
    );
    await grantSeatModels(
      {
        tenantId: "t1",
        seatId: "org-seat-dabai",
        grantedModelIds: [mimo.runtimeModelId],
      },
      seatGrantStorePath(),
    );

    const result = await resolveEffectiveModelSet({
      tenantId: "t1",
      seatId: "org-seat-dabai",
      billingSeatId: billingSeat.id,
      cfg: baseCfg,
      seatGrantInheritsEnterprise: false,
      requirePlatformCatalog: false,
      entitlementStorePath: entitlementStorePath(),
      seatGrantStorePath: seatGrantStorePath(),
      billingSeatsStorePath: billingSeatsStorePath(),
      enterpriseModelAssetStorePath: assetStorePath,
      platformConnectedModelIdsOverride: ["api-proxy-deepseek/deepseek-chat"],
    });

    expect(result.state).toBe("resolved");
    expect(result.allowedModelIds).toEqual([
      "api-proxy-deepseek/deepseek-chat",
      mimo.runtimeModelId,
    ]);
  });
});

describe("mirrorBillingGrantToOrgSeats", () => {
  it("listOrgSeatIdsForEmployee 匹配 active binding", async () => {
    const { listOrgSeatIdsForEmployee } = await import("./mirror-billing-grant-to-org-seats.js");
    const ids = listOrgSeatIdsForEmployee("t1", "user@example.com", {
      b1: {
        tenantId: "t1",
        employeeId: "user@example.com",
        seatId: "org-seat-1",
        bindingStatus: "active",
      },
      b2: {
        tenantId: "t1",
        employeeId: "other@example.com",
        seatId: "org-seat-2",
        bindingStatus: "active",
      },
    });
    expect(ids).toEqual(["org-seat-1"]);
  });

  it("listOrgSeatIdsForEmployeeIdentity 可用 platform user id 匹配 binding", async () => {
    const { listOrgSeatIdsForEmployeeIdentity } =
      await import("./mirror-billing-grant-to-org-seats.js");
    const ids = await listOrgSeatIdsForEmployeeIdentity(
      "t1",
      { platformUserId: "platform-user-elle" },
      {
        b1: {
          tenantId: "t1",
          employeeId: "platform-user-elle",
          seatId: "org-seat-elle",
          bindingStatus: "active",
        },
      },
    );
    expect(ids).toEqual(["org-seat-elle"]);
  });
});
