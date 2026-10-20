import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { resetSharedDataGovernanceCatalogForTests } from "./runtime-catalog.js";
import {
  collectSeatLegacyAgentIds,
  diagnoseAgentWorkspaceIdentity,
  findSeatContextForLegacyAgent,
  repairAgentWorkspaceIdentity,
} from "./workspace-identity-repair.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function seatStoreFixture(): EnterpriseSeatAssetsStore {
  return {
    version: 1,
    offers: {},
    bindings: {
      bind1: {
        bindingId: "bind1",
        seatId: "seat-wang",
        tenantId: "tenant-1",
        employeeId: "user-wang",
        bindingStatus: "active",
        effectiveAt: "2026-06-20T00:00:00.000Z",
      },
    },
    seats: {
      "seat-wang": {
        seatId: "seat-wang",
        tenantId: "tenant-1",
        title: "文化顾问岗",
        status: "assigned",
        currentEmployeeId: "user-wang",
        defaultAgentAssetIds: ["fengshui"],
        defaultSpaceIds: [],
        createdAt: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T00:00:00.000Z",
      },
    },
    assetBindings: {},
    credentialBindings: {},
    accessPolicies: {},
    auditEvents: {},
    handovers: {},
    enterpriseIdentities: {},
    identityUsagePolicies: {},
    dataSourceIdentityBindings: {},
    employeeIdentityEnrollments: {},
  };
}

describe("workspace-identity-repair", () => {
  it("finds seat context for legacy seat agent ids", () => {
    const ctx = findSeatContextForLegacyAgent({
      store: seatStoreFixture(),
      tenantId: "tenant-1",
      legacyAgentId: "fengshui",
    });
    expect(ctx).toEqual({ seatId: "seat-wang", userId: "user-wang" });
  });

  it("collects seat legacy agent ids", () => {
    expect(
      collectSeatLegacyAgentIds({
        store: seatStoreFixture(),
        tenantId: "tenant-1",
      }),
    ).toEqual(["fengshui"]);
  });

  it("diagnoses malformed registry assets for fengshui-like bots", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-ws-id-repair-"));
    tempDirs.push(stateDir);
    const registryStorePath = path.join(stateDir, "openbot-agent-registry.json");
    const nowIso = "2026-09-12T00:00:00.000Z";
    fs.writeFileSync(
      registryStorePath,
      JSON.stringify({
        version: 1,
        assets: {
          fengshui: {
            agentAssetId: "fengshui",
            enterpriseId: "tenant-1",
            agentSlug: "fengshui",
            displayName: "风水文化顾问",
            status: "active",
            legacyAgentId: "fengshui",
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        },
        deployments: {},
        revisions: {},
        ownerBindings: {},
        quarantine: {},
      }),
      "utf8",
    );

    const diagnosis = await diagnoseAgentWorkspaceIdentity({
      tenantId: "tenant-1",
      legacyAgentId: "fengshui",
      cfg: {
        agents: {
          list: [{ id: "fengshui", name: "风水文化顾问" }],
        },
      },
      stateDir,
      registryStorePath,
      seatStore: seatStoreFixture(),
    });

    expect(diagnosis.issue).toBe("malformed_registry_asset");
    expect(diagnosis.seatId).toBe("seat-wang");
  });

  it("repairs malformed registry and mints catalog on apply", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-ws-id-repair-apply-"));
    tempDirs.push(stateDir);
    const registryStorePath = path.join(stateDir, "openbot-agent-registry.json");
    const locator = path.join(stateDir, "workspace-fengshui");
    fs.mkdirSync(locator, { recursive: true });
    const nowIso = "2026-09-12T00:00:00.000Z";
    fs.writeFileSync(
      registryStorePath,
      JSON.stringify({
        version: 1,
        assets: {
          fengshui: {
            agentAssetId: "fengshui",
            enterpriseId: "tenant-1",
            agentSlug: "fengshui",
            displayName: "风水文化顾问",
            status: "active",
            legacyAgentId: "fengshui",
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        },
        deployments: {},
        revisions: {},
        ownerBindings: {},
        quarantine: {},
      }),
      "utf8",
    );

    const result = await repairAgentWorkspaceIdentity({
      tenantId: "tenant-1",
      legacyAgentId: "fengshui",
      cfg: {
        agents: {
          list: [{ id: "fengshui", name: "风水文化顾问", workspace: locator }],
        },
      },
      apply: true,
      stateDir,
      registryStorePath,
      seatStore: seatStoreFixture(),
      nowIso,
    });

    expect(result.actions.some((entry) => entry.action === "malformed_asset_repaired")).toBe(true);
    expect(result.actions.some((entry) => entry.action === "catalog_minted")).toBe(true);
    expect(result.diagnosis.issue).toBe("catalog_ready");
    expect(result.diagnosis.hasCatalog).toBe(true);
  });
});
