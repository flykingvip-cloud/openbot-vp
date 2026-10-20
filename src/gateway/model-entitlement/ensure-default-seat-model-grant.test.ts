// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertResourceModelCatalogEntry } from "../resource-catalog/models-catalog-store.js";
import { ensureDefaultSeatModelGrant } from "./ensure-default-seat-model-grant.js";
import { upsertEnterpriseModelEntitlement } from "./enterprise-model-entitlement-store.js";
import { resolveEffectiveModelSet } from "./resolve-effective-model-set.js";
import { getSeatModelGrant, grantSeatModels } from "./seat-model-grant-store.js";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "me-default-grant-"));
});
afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

const entitlementStorePath = () => path.join(tempDir, "ent.json");
const seatGrantStorePath = () => path.join(tempDir, "grant.json");
const modelCatalogStorePath = () => path.join(tempDir, "catalog.json");

const baseCfg = {
  models: {
    providers: {
      "api-proxy-deepseek": {
        models: [{ id: "deepseek-v4-flash" }],
      },
      "api-proxy-gpt": {
        models: [{ id: "gpt-5.2" }],
      },
    },
  },
} as unknown as import("../../config/types.js").OpenBotConfig;

async function seedEnterpriseModels() {
  await upsertResourceModelCatalogEntry(
    {
      modelId: "api-proxy-deepseek/deepseek-v4-flash",
      provider: "api-proxy-deepseek",
      displayName: "DeepSeek",
      tier: "tier_a",
      enabled: true,
    },
    modelCatalogStorePath(),
  );
  await upsertResourceModelCatalogEntry(
    {
      modelId: "api-proxy-gpt/gpt-5.2",
      provider: "api-proxy-gpt",
      displayName: "GPT",
      tier: "tier_b",
      enabled: true,
    },
    modelCatalogStorePath(),
  );
  await upsertEnterpriseModelEntitlement(
    {
      tenantId: "t1",
      planVersionId: "pv-1",
      allowedModelIds: ["api-proxy-deepseek/deepseek-v4-flash", "api-proxy-gpt/gpt-5.2"],
    },
    entitlementStorePath(),
  );
}

describe("ensureDefaultSeatModelGrant", () => {
  it("writes viewer / tier_a grant when seat has none", async () => {
    await seedEnterpriseModels();
    const result = await ensureDefaultSeatModelGrant({
      tenantId: "t1",
      seatId: "seat-new",
      actorUserId: "emp-1",
      entitlementStorePath: entitlementStorePath(),
      seatGrantStorePath: seatGrantStorePath(),
      modelCatalogStorePath: modelCatalogStorePath(),
    });
    expect(result.applied).toBe(true);
    expect(result.grant?.grantedModelIds).toEqual(["api-proxy-deepseek/deepseek-v4-flash"]);
    const persisted = await getSeatModelGrant("t1", "seat-new", seatGrantStorePath());
    expect(persisted?.grantedModelIds).toEqual(["api-proxy-deepseek/deepseek-v4-flash"]);
  });

  it("does not overwrite an existing active grant", async () => {
    await seedEnterpriseModels();
    await grantSeatModels(
      {
        tenantId: "t1",
        seatId: "seat-custom",
        grantedModelIds: ["api-proxy-gpt/gpt-5.2"],
      },
      seatGrantStorePath(),
    );
    const result = await ensureDefaultSeatModelGrant({
      tenantId: "t1",
      seatId: "seat-custom",
      entitlementStorePath: entitlementStorePath(),
      seatGrantStorePath: seatGrantStorePath(),
      modelCatalogStorePath: modelCatalogStorePath(),
    });
    expect(result.applied).toBe(false);
    expect(result.skippedReason).toContain("already has active");
    const persisted = await getSeatModelGrant("t1", "seat-custom", seatGrantStorePath());
    expect(persisted?.grantedModelIds).toEqual(["api-proxy-gpt/gpt-5.2"]);
  });
});

describe("resolveEffectiveModelSet — default seat grant heal", () => {
  it("lazy-applies viewer grant when seat has no model auth", async () => {
    await seedEnterpriseModels();
    const result = await resolveEffectiveModelSet({
      tenantId: "t1",
      seatId: "seat-unauth",
      cfg: baseCfg,
      seatGrantInheritsEnterprise: false,
      // main 默认托管目录 fail-closed；测试显式注入上界，聚焦 grant heal。
      catalogActiveModelIdsOverride: [
        "api-proxy-deepseek/deepseek-v4-flash",
        "api-proxy-gpt/gpt-5.2",
      ],
      platformConnectedModelIdsOverride: [
        "api-proxy-deepseek/deepseek-v4-flash",
        "api-proxy-gpt/gpt-5.2",
      ],
      entitlementStorePath: entitlementStorePath(),
      seatGrantStorePath: seatGrantStorePath(),
      modelCatalogStorePath: modelCatalogStorePath(),
    });
    expect(result.state).toBe("resolved");
    expect(result.allowedModelIds).toEqual(["api-proxy-deepseek/deepseek-v4-flash"]);
    const persisted = await getSeatModelGrant("t1", "seat-unauth", seatGrantStorePath());
    expect(persisted?.status).toBe("active");
    expect(persisted?.grantedModelIds).toEqual(["api-proxy-deepseek/deepseek-v4-flash"]);
  });
});
