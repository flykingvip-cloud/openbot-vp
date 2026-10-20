// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withEnvAsync } from "../../test-utils/env.js";
import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { resolveAgentRunEntitlementScope } from "../model-entitlement/resolve-agent-run-scope.js";
import { upsertOwnershipRecord } from "../ownership-store.js";
import { withTempConfig } from "../test-temp-config.js";
import {
  bindAgentAssetToSeatForTenant,
  loadSeatAssetsStoreForTenantId,
  requireSeatAssetsStorePathForTenantId,
  resolveSeatAssetsStorePathForTenantId,
} from "./seat-store-loader.js";

const managedCfg = { data: { mode: "managed" as const } };

describe("seat-store-loader tenant isolation", () => {
  let stateDir = "";
  let tenantsRoot = "";

  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "seat-loader-state-"));
    tenantsRoot = path.join(stateDir, "tenants");
    await fs.mkdir(tenantsRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("resolves tenant seat-assets path when MULTITENANT is on", async () => {
    await withEnvAsync(
      {
        OPENBOT_MULTITENANT: "1",
        OPENBOT_TENANTS_ROOT: tenantsRoot,
        OPENBOT_STATE_DIR: stateDir,
        OPENCLAW_STATE_DIR: stateDir,
      },
      async () => {
        await withTempConfig({
          cfg: managedCfg,
          run: async () => {
            const resolved = resolveSeatAssetsStorePathForTenantId("001", managedCfg);
            expect(resolved).toBe(
              path.join(tenantsRoot, "001", "control-plane", "seat-assets.json"),
            );
            expect(requireSeatAssetsStorePathForTenantId("001", managedCfg)).toBe(resolved);
          },
        });
      },
    );
  });

  it("fail-closes when MULTITENANT is on but tenantId cannot resolve a path", async () => {
    await withEnvAsync(
      {
        OPENBOT_MULTITENANT: "1",
        OPENBOT_TENANTS_ROOT: tenantsRoot,
      },
      async () => {
        await withTempConfig({
          cfg: managedCfg,
          run: async () => {
            expect(() => requireSeatAssetsStorePathForTenantId("   ", managedCfg)).toThrow(
              /tenantId is required/,
            );
          },
        });
      },
    );
  });

  it("bindAgentAssetToSeatForTenant writes tenant store and not global when MULTITENANT on", async () => {
    await withEnvAsync(
      {
        OPENBOT_MULTITENANT: "1",
        OPENBOT_TENANTS_ROOT: tenantsRoot,
        OPENBOT_STATE_DIR: stateDir,
        OPENCLAW_STATE_DIR: stateDir,
      },
      async () => {
        await withTempConfig({
          cfg: managedCfg,
          run: async () => {
            // Seed seat in tenant store so binding has a seat row available for later resolution.
            const tenantPath = path.join(tenantsRoot, "001", "control-plane", "seat-assets.json");
            await fs.mkdir(path.dirname(tenantPath), { recursive: true });
            const nowIso = "2026-08-04T00:00:00.000Z";
            await fs.writeFile(
              tenantPath,
              JSON.stringify({
                version: 4,
                seats: {
                  "seat-emp-1": {
                    seatId: "seat-emp-1",
                    tenantId: "001",
                    title: "Employee",
                    status: "occupied",
                    currentEmployeeId: "user-1",
                    defaultSpaceIds: [],
                    defaultAgentAssetIds: [],
                    createdAt: nowIso,
                    updatedAt: nowIso,
                  },
                },
                bindings: {},
                accessPolicies: {},
                assetBindings: {},
                credentialBindings: {},
                handovers: {},
                offers: {},
                auditEvents: {},
              }),
              "utf8",
            );

            await bindAgentAssetToSeatForTenant({
              tenantId: "001",
              seatId: "seat-emp-1",
              agentId: "agt-new-bot",
              actorUserId: "user-1",
              nowIso,
              cfg: managedCfg,
            });

            const tenantStore = await loadSeatAssetsStoreForTenantId("001", managedCfg);
            expect(
              Object.values(tenantStore.assetBindings).some(
                (b) =>
                  b.assetType === "agent" &&
                  b.assetId === "agt-new-bot" &&
                  b.seatId === "seat-emp-1" &&
                  b.status === "active",
              ),
            ).toBe(true);

            const globalPath = path.join(stateDir, "openbot-enterprise-seat-assets.json");
            const globalExists = await fs
              .access(globalPath)
              .then(() => true)
              .catch(() => false);
            if (globalExists) {
              const globalStore = await loadEnterpriseSeatAssetsStore(globalPath);
              expect(
                Object.values(globalStore.assetBindings).some((b) => b.assetId === "agt-new-bot"),
              ).toBe(false);
            }

            upsertOwnershipRecord({
              tenantId: "001",
              subjectKind: "agent",
              subjectId: "agt-new-bot",
              positionId: "seat-emp-1",
              positionLabel: "Employee",
              createdByUserId: "user-1",
              createdByUserLabel: "user-1",
              currentManagerUserId: "user-1",
              currentManagerLabel: "user-1",
            });

            const scope = await resolveAgentRunEntitlementScope({ agentId: "agt-new-bot" });
            expect(scope).toMatchObject({
              tenantId: "001",
              seatId: "seat-emp-1",
              employeeId: "user-1",
            });
          },
        });
      },
    );
  });
});

describe("agent seat binding source guard", () => {
  it("keeps agents.create and ownership heal off bare global seat-assets I/O", async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const files = [
      path.join(root, "server-methods/agents.ts"),
      path.join(root, "agent-registry/agent-create-ownership.ts"),
    ];
    for (const file of files) {
      const source = await fs.readFile(file, "utf8");
      expect(source).not.toMatch(/loadEnterpriseSeatAssetsStore\(\s*\)/);
      expect(source).not.toMatch(/saveEnterpriseSeatAssetsStore\(\s*undefined\s*,/);
      expect(source).toMatch(/seat-store-loader/);
    }
  });

  it("keeps employee register/offer accept off bare global seat-assets I/O", async () => {
    const source = await fs.readFile(
      path.resolve(import.meta.dirname, "routes-employee-register.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/loadEnterpriseSeatAssetsStore\(\s*\)/);
    expect(source).not.toMatch(/saveEnterpriseSeatAssetsStore\(\s*undefined\s*,/);
    expect(source).toMatch(/loadSeatAssetsStoreForTenantId/);
    expect(source).toMatch(/saveSeatAssetsStoreForTenantId/);
  });
});
