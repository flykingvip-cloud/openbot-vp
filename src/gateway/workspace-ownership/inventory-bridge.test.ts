import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setPrimaryOwner } from "../agent-registry/ownership.js";
import { createAgentAsset } from "../agent-registry/registry.js";
import { createEmptyAgentRegistryStore } from "../agent-registry/types.js";
import { runWorkspaceInventory } from "../workspace-inventory/inventory.js";
import { classifyInventoryRecord, mapInventoryOwnershipStatus } from "./inventory-bridge.js";

const NOW = "2026-08-12T00:00:00.000Z";

describe("inventory ownership bridge", () => {
  it("classifies inventory agent asset records when registry evidence exists", () => {
    const store = createEmptyAgentRegistryStore();
    const asset = createAgentAsset({
      store,
      enterpriseId: "tenant-a",
      agentSlug: "bot",
      displayName: "Bot",
      nowIso: NOW,
    });
    setPrimaryOwner({
      store,
      ref: { enterpriseId: "tenant-a", agentAssetId: asset.agentAssetId },
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso: NOW,
    });

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-inv-bridge-"));
    try {
      const assetRoot = path.join(
        root,
        "tenants",
        "tenant-a",
        "users",
        "user-elle",
        "OpenBot",
        "agent-assets",
        asset.agentAssetId,
      );
      fs.mkdirSync(assetRoot, { recursive: true });
      fs.writeFileSync(path.join(assetRoot, "MEMORY.md"), "x");

      const report = runWorkspaceInventory({ containmentRoot: root });
      const record = report.records.find((r) => r.agentAssetId === asset.agentAssetId);
      expect(record).toBeTruthy();

      const scope = classifyInventoryRecord({
        record: record!,
        context: {
          trusted: { tenantId: "tenant-a", userId: "user-elle", domain: "employee" },
          registry: store,
          registryStatus: "available",
        },
      });
      expect(scope.kind).toBe("position_owned");
      expect(mapInventoryOwnershipStatus(scope)).toBe("proved");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
