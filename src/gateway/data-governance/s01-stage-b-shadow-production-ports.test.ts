import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEmptyAgentRegistryStore } from "../agent-registry/types.js";
import {
  createProductionS01StewardRegistryPort,
  createS01ReadOnlyDurableCatalogView,
  loadS01StageBShadowProductionDeps,
  S01ReadOnlyDurableCatalogView,
} from "./s01-stage-b-shadow-production-ports.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION, type CatalogRecord } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tenantId = "ent-456";
const userId = "usr-123";
const agentAssetId = "asset-steward-1";
const resourceId = `ws:${tenantId}:user:${userId}:asset:${agentAssetId}`;

function durableWorkspace(): CatalogRecord {
  return {
    envelope: {
      resourceId,
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId,
      owner: { kind: "user", userId },
      scope: { kind: "user", userId },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: `${resourceId}:canonical`,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
    bindings: [
      {
        bindingId: `${resourceId}:canonical`,
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: "/legacy/helper-cwd",
        state: "active",
        contentVersion: "v1",
      },
    ],
  };
}

describe("S01 Stage B shadow production ports", () => {
  it("does not use InMemory or unique-row guess as the production path", () => {
    const src = readFileSync(join(__dirname, "s01-stage-b-shadow-production-ports.ts"), "utf-8");
    expect(src).not.toMatch(/InMemoryWorkspaceResourceCatalog/);
    expect(src).not.toMatch(/createInMemoryS01StewardRegistryPort/);
    expect(src).not.toMatch(/createInMemoryS01MembershipPort/);
    expect(src).not.toMatch(/loadExistingGovernedWorkspaceIdentity/);
    expect(src).toMatch(/getSharedDataGovernanceCatalog/);
    expect(src).toMatch(/resolveLegacyAgentId/);
    expect(src).toMatch(/OPENBOT_S01_ATTESTATION_SECRET/);
  });

  it("parses agentAssetId from durable resourceId instead of catalog: synthesis", () => {
    const view = createS01ReadOnlyDurableCatalogView([durableWorkspace()]);
    expect(view).toBeInstanceOf(S01ReadOnlyDurableCatalogView);
    const resource = view.getResource(resourceId);
    expect(resource?.ownerScope).toMatchObject({
      kind: "user_owned",
      userId,
      agentAssetId,
    });
    expect(JSON.stringify(resource?.ownerScope)).not.toContain("catalog:");
  });

  it("skips user-owned rows that cannot parse an asset id", () => {
    const view = createS01ReadOnlyDurableCatalogView([
      {
        ...durableWorkspace(),
        envelope: {
          ...durableWorkspace().envelope,
          resourceId: `ws:${tenantId}:user:${userId}`,
        },
      },
    ]);
    expect(view.snapshot().resources).toEqual({});
  });

  it("does not invent steward main → agentAssetId when Registry has no unique slug", () => {
    const store = createEmptyAgentRegistryStore();
    const port = createProductionS01StewardRegistryPort(store);
    expect(port.resolveUniqueAgentAssetId({ tenantId, agentId: "main" })).toBeNull();
  });

  it("rejects steward main when agentAssetId equals the slug", () => {
    const store = createEmptyAgentRegistryStore();
    store.assets.main = {
      agentAssetId: "main",
      enterpriseId: tenantId,
      agentSlug: "main",
      displayName: "Main",
      status: "active",
      legacyAgentId: "main",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    };
    const port = createProductionS01StewardRegistryPort(store);
    expect(port.resolveUniqueAgentAssetId({ tenantId, agentId: "main" })).toBeNull();
  });

  it("Plan A: unique tenant+slug main resolves a stable agentAssetId", () => {
    const store = createEmptyAgentRegistryStore();
    store.assets[agentAssetId] = {
      agentAssetId,
      enterpriseId: tenantId,
      agentSlug: "main",
      displayName: "Steward post",
      status: "active",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    };
    const port = createProductionS01StewardRegistryPort(store);
    expect(port.resolveUniqueAgentAssetId({ tenantId, agentId: "main" })).toBe(agentAssetId);
  });

  it("resolves a non-main legacy agentId to its asset", () => {
    const store = createEmptyAgentRegistryStore();
    store.assets[agentAssetId] = {
      agentAssetId,
      enterpriseId: tenantId,
      agentSlug: "steward-work",
      displayName: "Steward work",
      status: "active",
      legacyAgentId: "mapped-steward",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    };
    const port = createProductionS01StewardRegistryPort(store);
    expect(port.resolveUniqueAgentAssetId({ tenantId, agentId: "mapped-steward" })).toBe(
      agentAssetId,
    );
  });

  it("loads injected durable records without writing Catalog", async () => {
    const deps = await loadS01StageBShadowProductionDeps({
      tenantId,
      userId,
      durableWorkspaceRecords: [durableWorkspace()],
      registryStore: createEmptyAgentRegistryStore(),
    });
    expect(deps.catalog).toBeInstanceOf(S01ReadOnlyDurableCatalogView);
    expect(deps.catalog?.getResource(resourceId)?.ownerScope).toMatchObject({ agentAssetId });
    expect(deps.registry?.resolveUniqueAgentAssetId({ tenantId, agentId: "main" })).toBeNull();
    expect(deps.principal).toBeNull();
    expect(deps.memberships).toBeNull();
  });
});
