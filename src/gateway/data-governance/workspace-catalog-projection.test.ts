import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STEWARD_BUILTIN_AGENT_ASSET_ID } from "../workspace-resolver/steward-write.js";
import { resolvePathBSeatAgentWorkspaceLocator } from "../workspace/seat-visible-agent-projection.js";
import { createFileDataGovernanceCatalogStore } from "./catalog-store.js";
import {
  getSharedDataGovernanceCatalog,
  resetSharedDataGovernanceCatalogForTests,
} from "./runtime-catalog.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION, type CatalogRecord } from "./types.js";
import {
  ensureGovernedWorkspaceCatalogIdentity,
  ensureOccupiedSeatWorkspaceCatalog,
  loadExistingGovernedWorkspaceIdentity,
} from "./workspace-catalog-projection.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function workspaceRecord(params: {
  resourceId: string;
  tenantId: string;
  userId: string;
}): CatalogRecord {
  return {
    envelope: {
      resourceId: params.resourceId,
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: params.tenantId,
      owner: { kind: "user", userId: params.userId },
      scope: { kind: "user", userId: params.userId },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: `bind:${params.resourceId}`,
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    },
    bindings: [
      {
        bindingId: `bind:${params.resourceId}`,
        resourceId: params.resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: `unplaced://classified/${params.resourceId}`,
        state: "active",
        contentVersion: "v1",
      },
    ],
  };
}

describe("loadExistingGovernedWorkspaceIdentity", () => {
  it("omits Catalog when the durable store has no matching user-owned row", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-ws-proj-empty-"));
    tempDirs.push(stateDir);
    const loaded = await loadExistingGovernedWorkspaceIdentity({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "main",
      stateDir,
    });
    expect(loaded).toEqual({});
  });

  it("returns existing Catalog + exact agentAssetId for a unique user-owned row", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-ws-proj-hit-"));
    tempDirs.push(stateDir);
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(stateDir, "data-governance", "catalog.json"),
    });
    const resourceId = "ws:tenant-1:user:user-1:asset:asset-1";
    await store.put(workspaceRecord({ resourceId, tenantId: "tenant-1", userId: "user-1" }));

    const loaded = await loadExistingGovernedWorkspaceIdentity({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "research",
      stateDir,
    });
    expect(loaded.agentAssetId).toBe("asset-1");
    expect(loaded.catalog?.getResource(resourceId)?.resourceId).toBe(resourceId);
    expect(loaded.agentAssetId).not.toBe("research");
  });

  it("omits when the only asset id equals agentId", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-ws-proj-agentid-"));
    tempDirs.push(stateDir);
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(stateDir, "data-governance", "catalog.json"),
    });
    await store.put(
      workspaceRecord({
        resourceId: "ws:tenant-1:user:user-1:asset:main",
        tenantId: "tenant-1",
        userId: "user-1",
      }),
    );
    const loaded = await loadExistingGovernedWorkspaceIdentity({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "main",
      stateDir,
    });
    expect(loaded).toEqual({});
  });

  it("omits when two user-owned assets are present and agentId is unresolved", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-ws-proj-ambig-"));
    tempDirs.push(stateDir);
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(stateDir, "data-governance", "catalog.json"),
    });
    await store.put(
      workspaceRecord({
        resourceId: "ws:tenant-1:user:user-1:asset:asset-1",
        tenantId: "tenant-1",
        userId: "user-1",
      }),
    );
    await store.put(
      workspaceRecord({
        resourceId: "ws:tenant-1:user:user-1:asset:asset-2",
        tenantId: "tenant-1",
        userId: "user-1",
      }),
    );
    const loaded = await loadExistingGovernedWorkspaceIdentity({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "research",
      stateDir,
    });
    expect(loaded).toEqual({});
  });

  it("selects the registry-resolved asset among several user-owned rows", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-ws-proj-resolve-"));
    tempDirs.push(stateDir);
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(stateDir, "data-governance", "catalog.json"),
    });
    await store.put(
      workspaceRecord({
        resourceId: "ws:tenant-1:user:user-1:asset:asset-1",
        tenantId: "tenant-1",
        userId: "user-1",
      }),
    );
    await store.put(
      workspaceRecord({
        resourceId: "ws:tenant-1:user:user-1:asset:asset-2",
        tenantId: "tenant-1",
        userId: "user-1",
      }),
    );
    const registryStorePath = path.join(stateDir, "openbot-agent-registry.json");
    fs.writeFileSync(
      registryStorePath,
      `${JSON.stringify({
        version: 1,
        assets: {
          "asset-2": {
            agentAssetId: "asset-2",
            enterpriseId: "tenant-1",
            agentSlug: "sales",
            displayName: "sales",
            status: "active",
            legacyAgentId: "sales-bot",
            createdAt: "2026-08-18T00:00:00.000Z",
            updatedAt: "2026-08-18T00:00:00.000Z",
          },
        },
        deployments: {},
        revisions: {},
        ownerBindings: {},
        quarantine: {},
      })}\n`,
    );
    const loaded = await loadExistingGovernedWorkspaceIdentity({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "sales-bot",
      stateDir,
      registryStorePath,
    });
    expect(loaded.agentAssetId).toBe("asset-2");
    expect(loaded.catalog?.getResource("ws:tenant-1:user:user-1:asset:asset-2")?.resourceId).toBe(
      "ws:tenant-1:user:user-1:asset:asset-2",
    );
    expect(loaded.catalog?.getResource("ws:tenant-1:user:user-1:asset:asset-1")).toBeNull();
  });

  it("does not fall back to another user-owned row when the resolved asset is missing", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-ws-proj-miss-"));
    tempDirs.push(stateDir);
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(stateDir, "data-governance", "catalog.json"),
    });
    await store.put(
      workspaceRecord({
        resourceId: "ws:tenant-1:user:user-1:asset:asset-1",
        tenantId: "tenant-1",
        userId: "user-1",
      }),
    );
    const registryStorePath = path.join(stateDir, "openbot-agent-registry.json");
    fs.writeFileSync(
      registryStorePath,
      `${JSON.stringify({
        version: 1,
        assets: {
          "asset-9": {
            agentAssetId: "asset-9",
            enterpriseId: "tenant-1",
            agentSlug: "other",
            displayName: "other",
            status: "active",
            legacyAgentId: "sales-bot",
            createdAt: "2026-08-18T00:00:00.000Z",
            updatedAt: "2026-08-18T00:00:00.000Z",
          },
        },
        deployments: {},
        revisions: {},
        ownerBindings: {},
        quarantine: {},
      })}\n`,
    );
    const loaded = await loadExistingGovernedWorkspaceIdentity({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "sales-bot",
      stateDir,
      registryStorePath,
    });
    expect(loaded).toEqual({});
  });

  it("selects steward:builtin for the builtin steward among several user-owned rows", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-ws-proj-steward-"));
    tempDirs.push(stateDir);
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(stateDir, "data-governance", "catalog.json"),
    });
    await store.put(
      workspaceRecord({
        resourceId: "ws:tenant-1:user:user-1:asset:asset-1",
        tenantId: "tenant-1",
        userId: "user-1",
      }),
    );
    const stewardId = `ws:tenant-1:user:user-1:asset:${STEWARD_BUILTIN_AGENT_ASSET_ID}`;
    await store.put(
      workspaceRecord({
        resourceId: stewardId,
        tenantId: "tenant-1",
        userId: "user-1",
      }),
    );
    const loaded = await loadExistingGovernedWorkspaceIdentity({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "main",
      stateDir,
    });
    expect(loaded.agentAssetId).toBe(STEWARD_BUILTIN_AGENT_ASSET_ID);
    expect(loaded.catalog?.getResource(stewardId)?.resourceId).toBe(stewardId);
    expect(loaded.catalog?.getResource("ws:tenant-1:user:user-1:asset:asset-1")).toBeNull();
  });
});

describe("ensureGovernedWorkspaceCatalogIdentity", () => {
  it("mints steward:builtin so the builtin steward projects", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-ws-ens-steward-"));
    tempDirs.push(stateDir);
    const registryStorePath = path.join(stateDir, "openbot-agent-registry.json");
    const loaded = await ensureGovernedWorkspaceCatalogIdentity({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "main",
      cfg: {},
      workspaceLocator: "/ignored/legacy",
      stateDir,
      registryStorePath,
    });
    const resourceId = `ws:tenant-1:user:user-1:asset:${STEWARD_BUILTIN_AGENT_ASSET_ID}`;
    expect(loaded.agentAssetId).toBe(STEWARD_BUILTIN_AGENT_ASSET_ID);
    expect(loaded.catalog?.getResource(resourceId)?.resourceId).toBe(resourceId);
  });

  it("mints a UUID catalog row for a self-scope agent missing Registry and Catalog", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-ws-ens-skill-"));
    tempDirs.push(stateDir);
    const registryStorePath = path.join(stateDir, "openbot-agent-registry.json");
    const locator = path.join(stateDir, "workspace-bot-skill");
    fs.mkdirSync(locator, { recursive: true });
    const loaded = await ensureGovernedWorkspaceCatalogIdentity({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "bot-skill",
      cfg: {
        agents: {
          list: [{ id: "bot-skill", name: "Skill孵化", ownerId: "user-1" }],
        },
      },
      workspaceLocator: locator,
      stateDir,
      registryStorePath,
    });
    expect(loaded.agentAssetId).toBeTruthy();
    expect(loaded.agentAssetId).not.toBe("bot-skill");
    const resourceId = `ws:tenant-1:user:user-1:asset:${loaded.agentAssetId}`;
    expect(loaded.catalog?.getResource(resourceId)?.resourceId).toBe(resourceId);
    const registry = JSON.parse(fs.readFileSync(registryStorePath, "utf8")) as {
      assets: Record<string, { legacyAgentId?: string }>;
    };
    const minted = Object.values(registry.assets).find(
      (asset) => asset.legacyAgentId === "bot-skill",
    );
    expect(minted).toBeTruthy();
  });

  it("derives D1e locator when workspaceLocator is empty", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-ws-ens-cfg-"));
    tempDirs.push(stateDir);
    const registryStorePath = path.join(stateDir, "openbot-agent-registry.json");
    const loaded = await ensureGovernedWorkspaceCatalogIdentity({
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "bot-cfg",
      cfg: {
        agents: {
          list: [{ id: "bot-cfg", name: "Cfg", ownerId: "user-1" }],
        },
      },
      workspaceLocator: "",
      stateDir,
      registryStorePath,
    });
    const expectedLocator = path.join(
      stateDir,
      "tenants",
      "tenant-1",
      "users",
      "user-1",
      "OpenBot",
      "agents",
      "bot-cfg",
      "workspace",
    );
    expect(loaded.agentAssetId).toBeTruthy();
    expect(loaded.agentAssetId).not.toBe("bot-cfg");
    const resourceId = `ws:tenant-1:user:user-1:asset:${loaded.agentAssetId}`;
    expect(loaded.catalog?.getResource(resourceId)?.resourceId).toBe(resourceId);
    expect(
      loaded.catalog?.listBindingsForResource(resourceId).map((binding) => binding.locator),
    ).toContain(expectedLocator);
  });
});

describe("loadExistingGovernedWorkspaceIdentity occupied runtime id", () => {
  it("keeps a position row whose asset id is the runtime agent id only for the occupied seat", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-ws-runtime-id-"));
    tempDirs.push(stateDir);
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(stateDir, "data-governance", "catalog.json"),
    });
    const agentId = "agt-daniel-hhd-gmail-com-nchn5ey";
    const resourceId = `ws:001:seat:seat-ceo-daniel-main:asset:${agentId}`;
    const agentDir = `/root/.openbot/agents/${agentId}/agent`;
    await store.put({
      envelope: {
        resourceId,
        resourceType: "workspace",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "001",
        owner: { kind: "position", seatId: "seat-ceo-daniel-main" },
        scope: { kind: "tenant", tenantId: "001" },
        lifecycleState: "active",
        classification: "internal",
        governanceVersion: 1,
        canonicalBindingId: `bind:${resourceId}`,
        createdAt: "2026-09-16T00:00:00.000Z",
        updatedAt: "2026-09-16T00:00:00.000Z",
      },
      bindings: [
        {
          bindingId: `bind:${resourceId}`,
          resourceId,
          role: "canonical",
          storageKind: "filesystem",
          locator: agentDir,
          state: "active",
          contentVersion: "v1",
        },
      ],
    });
    const hidden = await loadExistingGovernedWorkspaceIdentity({
      tenantId: "001",
      userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      agentId,
      stateDir,
    });
    expect(hidden).toEqual({});
    const visible = await loadExistingGovernedWorkspaceIdentity({
      tenantId: "001",
      userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      agentId,
      stateDir,
      occupiedSeatId: "seat-ceo-daniel-main",
    });
    expect(visible.agentAssetId).toBe(agentId);
    expect(visible.catalog?.getResource(resourceId)?.ownerScope).toMatchObject({
      kind: "position_owned",
      seatId: "seat-ceo-daniel-main",
      agentAssetId: agentId,
    });
    expect(visible.catalog?.listBindingsForResource(resourceId)[0]?.locator).toBe(agentDir);
  });
});

describe("ensureOccupiedSeatWorkspaceCatalog", () => {
  it("stores a Path B tenant-user locator on the occupied seat", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "occupied-seat-catalog-"));
    tempDirs.push(stateDir);
    const locator = resolvePathBSeatAgentWorkspaceLocator({
      tenantId: "tenant-a",
      userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      agentId: "agt-daniel-hhd-gmail-com-nchn5ey",
      // Path B locators live on the tenant volume, not under the gateway state dir.
      tenantsRoot: path.join(stateDir, "tenants"),
    });
    expect(locator).not.toContain("workspace-agt-");
    expect(locator).toContain(
      path.join(
        "tenants",
        "tenant-a",
        "users",
        "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
        "OpenBot",
        "agents",
        "agt-daniel-hhd-gmail-com-nchn5ey",
        "workspace",
      ),
    );
    await ensureOccupiedSeatWorkspaceCatalog({
      tenantId: "tenant-a",
      seatId: "seat-ceo-daniel-main",
      agentAssetId: "asset-senior-secretary",
      locator,
      stateDir,
    });
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(
      "ws:tenant-a:seat:seat-ceo-daniel-main:asset:asset-senior-secretary",
    );
    expect(record?.envelope.owner).toMatchObject({
      kind: "position",
      seatId: "seat-ceo-daniel-main",
    });
    expect(record?.bindings.find((binding) => binding.role === "canonical")?.locator).toBe(locator);
  });
});
