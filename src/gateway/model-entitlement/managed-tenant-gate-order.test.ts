// @vitest-environment node
/**
 * P0 regression: managed policy must apply before enforce=off / scope early-exit
 * so default config still strict-gates enterprise cron / external channel bots.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";

vi.mock("../resource-catalog/list-enabled-model-ids.js", () => ({
  listEnabledResourceCatalogModelIds: vi.fn(async () => ({
    modelIds: ["api-proxy-deepseek/cheap"],
    catalogEmpty: false,
  })),
}));

import { resolveEmployeeModelGate } from "./employee-model-gate.js";
import { upsertEnterpriseModelEntitlement } from "./enterprise-model-entitlement-store.js";
import { grantSeatModels } from "./seat-model-grant-store.js";

const MODELS = {
  "api-proxy-deepseek": {
    baseUrl: "https://api.deepseek.com",
    api: "openai-completions",
    models: [{ id: "cheap" }],
  },
};

/** Default product config that previously bypassed managed cron. */
function defaultCfg(): OpenBotConfig {
  return {
    gateway: {
      platform: {
        models: {
          mode: "native",
          entitlement: { enforce: "missing-allow", scope: "employee-chat" },
        },
      },
    },
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
        title: "Sales",
        teamLabel: "sales",
        roleCode: "member",
        currentEmployeeId: "emp-1",
        defaultSpaceIds: [],
        defaultAgentAssetIds: ["bot-enterprise"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    assetBindings: {
      "bind-1": {
        bindingId: "bind-1",
        seatId: "seat-1",
        tenantId: "tenant-a",
        assetType: "agent",
        assetId: "bot-enterprise",
        status: "active",
        boundAt: "2026-01-01T00:00:00.000Z",
      },
    },
    bindings: {},
  } as unknown as EnterpriseSeatAssetsStore;
}

describe("managed-tenant gate order (cron / external channel)", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "managed-gate-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("default enforce=missing-allow + scope=employee-chat still hard-denies enterprise cron bot", async () => {
    const entitlementStorePath = path.join(tempDir, "ent.json");
    const seatGrantStorePath = path.join(tempDir, "grant.json");
    // resolved-empty entitlement for managed tenant
    await upsertEnterpriseModelEntitlement(
      {
        tenantId: "tenant-a",
        planVersionId: "pv-1",
        allowedModelIds: [],
      },
      entitlementStorePath,
    );
    await grantSeatModels(
      {
        tenantId: "tenant-a",
        seatId: "seat-1",
        grantedModelIds: [],
      },
      seatGrantStorePath,
    );

    const result = await resolveEmployeeModelGate({
      cfg: defaultCfg(),
      agentId: "bot-enterprise",
      seatAssetsStore: seatStore(),
      entitlementStorePath,
      seatGrantStorePath,
    });

    // Must force allowlist (not skip) and empty → zero model egress.
    expect(result.allowlist).toEqual([]);
  });

  it("enforce=off + native still gates managed enterprise bot (no early return)", async () => {
    const entitlementStorePath = path.join(tempDir, "ent.json");
    const seatGrantStorePath = path.join(tempDir, "grant.json");
    await upsertEnterpriseModelEntitlement(
      {
        tenantId: "tenant-a",
        planVersionId: "pv-1",
        allowedModelIds: ["api-proxy-deepseek/cheap"],
      },
      entitlementStorePath,
    );
    await grantSeatModels(
      {
        tenantId: "tenant-a",
        seatId: "seat-1",
        grantedModelIds: ["api-proxy-deepseek/cheap"],
      },
      seatGrantStorePath,
    );

    const cfg = {
      gateway: {
        platform: {
          models: { mode: "native", entitlement: { enforce: "off", scope: "employee-chat" } },
        },
      },
      models: { providers: MODELS },
    } as unknown as OpenBotConfig;

    const result = await resolveEmployeeModelGate({
      cfg,
      agentId: "bot-enterprise",
      seatAssetsStore: seatStore(),
      entitlementStorePath,
      seatGrantStorePath,
      platformConnectedModelIdsOverride: ["api-proxy-deepseek/cheap"],
    });

    expect(result.allowlist).toEqual(["api-proxy-deepseek/cheap"]);
  });
});
