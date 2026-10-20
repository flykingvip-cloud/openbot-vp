import { describe, expect, it } from "vitest";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import {
  isMalformedRegistryAssetEntry,
  repairMalformedRegistryAsset,
} from "./workspace-registry-repair.js";

function emptyStore(): AgentRegistryStore {
  return {
    version: 1,
    assets: {},
    deployments: {},
    revisions: {},
    ownerBindings: {},
    quarantine: {},
  };
}

describe("workspace-registry-repair", () => {
  it("detects slug-keyed registry assets as malformed", () => {
    expect(
      isMalformedRegistryAssetEntry({
        agentAssetId: "fengshui",
        legacyAgentId: "fengshui",
        agentSlug: "fengshui",
      }),
    ).toBe(true);
    expect(
      isMalformedRegistryAssetEntry({
        agentAssetId: "1515f244-b9f1-4509-9eb9-fd7e4f2b9e13",
        legacyAgentId: "fengshui",
        agentSlug: "fengshui",
      }),
    ).toBe(false);
  });

  it("repairs slug-keyed assets into opaque UUID assets", () => {
    const store = emptyStore();
    const nowIso = "2026-09-12T00:00:00.000Z";
    store.assets.fengshui = {
      agentAssetId: "fengshui",
      enterpriseId: "tenant-1",
      agentSlug: "fengshui",
      displayName: "风水文化顾问",
      status: "active",
      legacyAgentId: "fengshui",
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const result = repairMalformedRegistryAsset({
      store,
      tenantId: "tenant-1",
      legacyAgentId: "fengshui",
      nowIso,
    });

    expect(result.repaired).toBe(true);
    expect(result.agentAssetId).toBeTruthy();
    expect(result.agentAssetId).not.toBe("fengshui");
    expect(store.assets.fengshui).toBeUndefined();
    const replacement = Object.values(store.assets).find(
      (asset) => asset.legacyAgentId === "fengshui" && asset.status === "active",
    );
    expect(replacement?.agentAssetId).toBe(result.agentAssetId);
  });
});
