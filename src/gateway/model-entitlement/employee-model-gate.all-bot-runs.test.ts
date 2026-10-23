// @vitest-environment node
/**
 * P5 任务 18.1 / 19.1 — scope=all-bot-runs 下按 bot 归属席位接入 entitlement 闸口。
 *
 * 验证：无 employee 会话（followup / 协作小组 / cron / 外部渠道）时，按 agentId 归属席位
 * 解析并 hard-deny；scope=employee-chat（默认）下这些路径不受影响；无归属 bot 放行。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";

vi.mock("../resource-catalog/list-enabled-model-ids.js", () => ({
  listEnabledResourceCatalogModelIds: vi.fn(async () => ({
    modelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
    catalogEmpty: false,
  })),
}));

import { registerEnterpriseModelAsset } from "../enterprise-model/asset-store.js";
import { resolveEmployeeModelGate } from "./employee-model-gate.js";
import { upsertEnterpriseModelEntitlement } from "./enterprise-model-entitlement-store.js";
import { grantSeatModels } from "./seat-model-grant-store.js";

const MODELS = {
  "api-proxy-deepseek": {
    baseUrl: "https://api.deepseek.com",
    api: "openai-completions",
    models: [{ id: "cheap" }, { id: "premium" }],
  },
};

function makeCfg(scope: "employee-chat" | "all-bot-runs"): OpenBotConfig {
  return {
    gateway: { platform: { models: { entitlement: { enforce: "missing-allow", scope } } } },
    models: { providers: MODELS },
  } as unknown as OpenBotConfig;
}

function seatStore(): EnterpriseSeatAssetsStore {
  return {
    version: 1,
    seats: {
      "seat-1": {
        seatId: "seat-1",
        tenantId: "tenant-a",
        status: "occupied",
        currentEmployeeId: "emp-1",
        defaultSpaceIds: [],
        defaultAgentAssetIds: ["bot-a"],
        createdAt: "x",
        updatedAt: "x",
      },
    },
    bindings: {},
    accessPolicies: {},
    assetBindings: {
      "ab-1": {
        assetBindingId: "ab-1",
        tenantId: "tenant-a",
        seatId: "seat-1",
        assetType: "agent",
        assetId: "bot-a",
        status: "active",
        source: "manual",
      },
    },
    credentialBindings: {},
    handovers: {},
  } as unknown as EnterpriseSeatAssetsStore;
}

let tempDir = "";
const storeOpts = () => ({
  entitlementStorePath: path.join(tempDir, "ent.json"),
  seatGrantStorePath: path.join(tempDir, "grant.json"),
  platformConnectedModelIdsOverride: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
});

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "p5-gate-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function seedSeatAuthorizedFor(modelIds: string[]) {
  await upsertEnterpriseModelEntitlement(
    {
      tenantId: "tenant-a",
      allowedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
    },
    storeOpts().entitlementStorePath,
  );
  await grantSeatModels(
    { tenantId: "tenant-a", seatId: "seat-1", grantedModelIds: modelIds },
    storeOpts().seatGrantStorePath,
  );
}

describe("resolveEmployeeModelGate — scope=all-bot-runs（按 bot 归属席位）", () => {
  it("默认 employee-chat：企业 bot 归属仍 managed gate（不再靠 scope 配置才解析）", async () => {
    await seedSeatAuthorizedFor(["api-proxy-deepseek/cheap"]);
    const result = await resolveEmployeeModelGate({
      cfg: makeCfg("employee-chat"),
      agentId: "bot-a",
      seatAssetsStore: seatStore(),
      ...storeOpts(),
    });
    // commercial-runtime-closure P0: always probe bot ownership; managed → force allowlist.
    expect(result.allowlist).toEqual(["api-proxy-deepseek/cheap"]);
  });

  it("all-bot-runs：按归属席位解析 → 仅授权模型进入 allowlist", async () => {
    await seedSeatAuthorizedFor(["api-proxy-deepseek/cheap"]);
    const result = await resolveEmployeeModelGate({
      cfg: makeCfg("all-bot-runs"),
      agentId: "bot-a",
      seatAssetsStore: seatStore(),
      ...storeOpts(),
    });
    expect(result.allowlist).toEqual(["api-proxy-deepseek/cheap"]);
  });

  it("all-bot-runs + resolved-empty：授权为空 → allowlist=[]（hard deny 语义）", async () => {
    await upsertEnterpriseModelEntitlement(
      { tenantId: "tenant-a", allowedModelIds: [] },
      storeOpts().entitlementStorePath,
    );
    const result = await resolveEmployeeModelGate({
      cfg: makeCfg("all-bot-runs"),
      agentId: "bot-a",
      seatAssetsStore: seatStore(),
      ...storeOpts(),
    });
    expect(result.allowlist).toEqual([]);
  });

  it("all-bot-runs + 无归属 bot：放行（不误杀，allowlist undefined）", async () => {
    await seedSeatAuthorizedFor(["api-proxy-deepseek/cheap"]);
    const result = await resolveEmployeeModelGate({
      cfg: makeCfg("all-bot-runs"),
      agentId: "unowned-bot",
      seatAssetsStore: seatStore(),
      ...storeOpts(),
    });
    expect(result.allowlist).toBeUndefined();
  });

  it("bot org seat BYOK unions with the commercial billing seat platform grant", async () => {
    const assetStorePath = path.join(tempDir, "assets.json");
    const mimo = await registerEnterpriseModelAsset(
      {
        tenantId: "tenant-a",
        connectionId: "conn-mimo",
        upstreamModelId: "mimo-v2.6-flash",
        enabled: true,
        healthStatus: "healthy",
      },
      assetStorePath,
    );
    await upsertEnterpriseModelEntitlement(
      {
        tenantId: "tenant-a",
        allowedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
      },
      storeOpts().entitlementStorePath,
    );
    await grantSeatModels(
      {
        tenantId: "tenant-a",
        seatId: "seat-1",
        grantedModelIds: [mimo.runtimeModelId],
      },
      storeOpts().seatGrantStorePath,
    );
    await grantSeatModels(
      {
        tenantId: "tenant-a",
        seatId: "billing-seat-ceo",
        grantedModelIds: ["api-proxy-deepseek/cheap"],
      },
      storeOpts().seatGrantStorePath,
    );

    const result = await resolveEmployeeModelGate({
      cfg: makeCfg("employee-chat"),
      agentId: "bot-a",
      commercialBillingSeatId: "billing-seat-ceo",
      seatAssetsStore: seatStore(),
      enterpriseModelAssetStorePath: assetStorePath,
      ...storeOpts(),
    });

    expect(result.allowlist).toEqual(["api-proxy-deepseek/cheap", mimo.runtimeModelId]);
  });

  it("协作群 owner 席位 override 优先于发言人 employee 会话", async () => {
    await seedSeatAuthorizedFor(["api-proxy-deepseek/cheap"]);
    const result = await resolveEmployeeModelGate({
      cfg: makeCfg("employee-chat"),
      agentId: "main",
      gatewayClientUser: "member@acme.test",
      gatewayClientSessionDomain: "employee",
      collaborationGroupOwnerEntitlement: {
        tenantId: "tenant-a",
        seatId: "seat-1",
        employeeId: "emp-1",
        userEmail: "owner@acme.test",
      },
      seatAssetsStore: seatStore(),
      ...storeOpts(),
    });
    expect(result.allowlist).toEqual(["api-proxy-deepseek/cheap"]);
  });
});
