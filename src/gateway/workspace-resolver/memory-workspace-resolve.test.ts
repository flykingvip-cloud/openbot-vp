import { describe, expect, it } from "vitest";
import {
  createMemoryWorkspaceHandle,
  isMemoryWorkspaceHandle,
} from "../../memory/memory-workspace-handle.js";
import type { CatalogRecord } from "../data-governance/types.js";
import type { ExistingGovernedWorkspaceIdentity } from "../data-governance/workspace-catalog-projection.js";
import { buildUserOwnedWorkspaceCatalogEntry } from "./builders.js";
import { InMemoryWorkspaceResourceCatalog } from "./catalog.js";
import { resolveMemoryWorkspaceHandle } from "./memory-workspace-resolve.js";
import { resolveWorkspaceResource } from "./resolve.js";

const TENANT = "tenant-a";
const USER = "user-elle";
const AGENT_ID = "bot-slug";
const AGENT_ASSET = "asset-unique-1";

function identityFixture(): ExistingGovernedWorkspaceIdentity {
  const entry = buildUserOwnedWorkspaceCatalogEntry({
    tenantId: TENANT,
    userId: USER,
    agentAssetId: AGENT_ASSET,
    workspaceRoot: "/var/lib/openbot/workspaces/asset-unique-1",
    governanceVersion: 4,
  });
  return {
    agentAssetId: AGENT_ASSET,
    catalog: new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 4,
      status: "available",
      resources: { [entry.resource.resourceId]: entry.resource },
      bindings: { [entry.binding.bindingId]: entry.binding },
    }),
  };
}

function memoryRecord(params: {
  workspaceId: string;
  memoryId?: string;
  fencing?: number;
  tenantId?: string | null;
}): CatalogRecord {
  const memoryId = params.memoryId ?? "memory:tenant-a:source:cw-1";
  return {
    envelope: {
      resourceId: memoryId,
      resourceType: "memory",
      schemaVersion: 1,
      tenantId: params.tenantId === undefined ? TENANT : params.tenantId,
      owner: { kind: "user", userId: USER },
      scope: { kind: "user", userId: USER },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 4,
      canonicalBindingId: `canonical:${memoryId}`,
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z",
      projection: {
        canonicalKind: "cogniweave",
        sourceWorkspaceResourceId: params.workspaceId,
      },
      lastAcceptedFencingToken: params.fencing ?? 9,
    },
    bindings: [
      {
        bindingId: `canonical:${memoryId}`,
        resourceId: memoryId,
        role: "canonical",
        storageKind: "sqlite",
        locator: "/var/lib/openbot/memory/canonical.sqlite",
        state: "active",
        contentVersion: "1",
        objectKey: memoryId,
      },
    ],
  };
}

function ports(identity: ExistingGovernedWorkspaceIdentity, memory: CatalogRecord[]) {
  return {
    loadIdentity: async () => identity,
    listMemory: async () => memory,
  };
}

describe("U1 dark resolveMemoryWorkspaceHandle", () => {
  it("returns a branded handle from Catalog adapter without synthesizing Catalog", async () => {
    const identity = identityFixture();
    const resourceId = Object.keys(identity.catalog!.snapshot().resources)[0];
    const result = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      ports: ports(identity, [memoryRecord({ workspaceId: resourceId })]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(isMemoryWorkspaceHandle(result.handle)).toBe(true);
    expect(result.handle.resourceId).toBe(resourceId);
    expect(result.handle.memoryAssetResourceId).toBe("memory:tenant-a:source:cw-1");
    expect(result.handle.tenantId).toBe(TENANT);
    expect(result.handle.agentAssetId).toBe(AGENT_ASSET);
    expect(Object.hasOwn(result.handle, "ingest")).toBe(false);
    expect(result.handle.permissions.ingest).toBe(false);
    expect(result.handle.permissions.search).toBe(true);
  });

  it("denies missing resourceId, Memory Asset, Catalog miss, tenant mismatch, stale fencing, and ambiguous agentAssetId", async () => {
    const identity = identityFixture();
    const resourceId = Object.keys(identity.catalog!.snapshot().resources)[0];

    const catalogMiss = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      ports: ports({}, [memoryRecord({ workspaceId: resourceId })]),
    });
    expect(catalogMiss).toMatchObject({ ok: false, reasonCode: "missing_workspace_resource" });

    const missingResource = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      resourceId: "ws:missing",
      ports: ports(identity, [memoryRecord({ workspaceId: resourceId })]),
    });
    expect(missingResource).toMatchObject({ ok: false, reasonCode: "missing_workspace_resource" });

    const missingMemory = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      ports: ports(identity, []),
    });
    expect(missingMemory).toMatchObject({ ok: false, reasonCode: "missing_memory_asset" });

    const tenantMismatch = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: "tenant-b", userId: USER },
      ports: ports(identity, [memoryRecord({ workspaceId: resourceId })]),
    });
    expect(tenantMismatch).toMatchObject({ ok: false, reasonCode: "tenant_mismatch" });

    const stale = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      expectedFencingToken: "1",
      ports: ports(identity, [memoryRecord({ workspaceId: resourceId, fencing: 9 })]),
    });
    expect(stale).toMatchObject({ ok: false, reasonCode: "stale_fencing_token" });

    const ambiguous = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      ports: ports({ catalog: identity.catalog }, [memoryRecord({ workspaceId: resourceId })]),
    });
    expect(ambiguous).toMatchObject({ ok: false, reasonCode: "ambiguous_agent_asset" });
  });

  it("keeps resourceId stable when path/stateDir changes", async () => {
    const identity = identityFixture();
    const resourceId = Object.keys(identity.catalog!.snapshot().resources)[0];
    const first = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      stateDir: "/tmp/openbot-state-a",
      ports: ports(identity, [memoryRecord({ workspaceId: resourceId })]),
    });
    const second = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      stateDir: "/tmp/openbot-state-b",
      ports: ports(identity, [memoryRecord({ workspaceId: resourceId })]),
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.handle.resourceId).toBe(second.handle.resourceId);
      expect(first.handle.resourceId).toBe(resourceId);
    }
  });

  it("does not let a different agentId reach another AgentAsset memory", async () => {
    const identity = identityFixture();
    const resourceId = Object.keys(identity.catalog!.snapshot().resources)[0];
    const denied = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: "other-bot",
      actor: { tenantId: TENANT, userId: USER },
      ports: {
        loadIdentity: async () => ({}),
        listMemory: async () => [memoryRecord({ workspaceId: resourceId })],
      },
    });
    expect(denied).toMatchObject({ ok: false, reasonCode: "missing_workspace_resource" });
  });

  it("denies when configured cloud tenant differs from Handle.tenantId", async () => {
    const identity = identityFixture();
    const resourceId = Object.keys(identity.catalog!.snapshot().resources)[0];
    const result = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      configuredCloudTenantId: "cloud-other",
      ports: ports(identity, [memoryRecord({ workspaceId: resourceId })]),
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "tenant_mismatch" });
  });

  it("does not change the existing production resolver read path", () => {
    const identity = identityFixture();
    const resourceId = Object.keys(identity.catalog!.snapshot().resources)[0];
    const resolved = resolveWorkspaceResource({
      catalog: identity.catalog!,
      actor: { tenantId: TENANT, userId: USER },
      resourceId,
      operation: "read",
      purpose: "agent.tool.cwd",
    });
    expect(resolved.ok).toBe(true);
    expect(createMemoryWorkspaceHandle({ resourceId: "" }).ok).toBe(false);
  });

  it("maps missing resourceId by exact agentAssetId and ignores resources[0] order", async () => {
    const other = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: TENANT,
      userId: USER,
      agentAssetId: "asset-other",
      workspaceRoot: "/var/lib/openbot/workspaces/asset-other",
      governanceVersion: 4,
    });
    const mine = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: TENANT,
      userId: USER,
      agentAssetId: AGENT_ASSET,
      workspaceRoot: "/var/lib/openbot/workspaces/asset-unique-1",
      governanceVersion: 4,
    });
    const identity: ExistingGovernedWorkspaceIdentity = {
      agentAssetId: AGENT_ASSET,
      catalog: new InMemoryWorkspaceResourceCatalog({
        governanceVersion: 4,
        status: "available",
        resources: {
          [other.resource.resourceId]: other.resource,
          [mine.resource.resourceId]: mine.resource,
        },
        bindings: {
          [other.binding.bindingId]: other.binding,
          [mine.binding.bindingId]: mine.binding,
        },
      }),
    };
    expect(Object.keys(identity.catalog!.snapshot().resources)[0]).toBe(other.resource.resourceId);
    const result = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      ports: ports(identity, [memoryRecord({ workspaceId: mine.resource.resourceId })]),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handle.resourceId).toBe(mine.resource.resourceId);
    }

    const reversed = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      ports: ports(
        {
          agentAssetId: AGENT_ASSET,
          catalog: new InMemoryWorkspaceResourceCatalog({
            governanceVersion: 4,
            status: "available",
            resources: {
              [mine.resource.resourceId]: mine.resource,
              [other.resource.resourceId]: other.resource,
            },
            bindings: {
              [mine.binding.bindingId]: mine.binding,
              [other.binding.bindingId]: other.binding,
            },
          }),
        },
        [memoryRecord({ workspaceId: mine.resource.resourceId })],
      ),
    });
    expect(reversed.ok).toBe(true);
    if (reversed.ok) {
      expect(reversed.handle.resourceId).toBe(mine.resource.resourceId);
    }
  });

  it("denies zero, many, wrong-asset, and duplicate canonical workspace bindings", async () => {
    const mine = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: TENANT,
      userId: USER,
      agentAssetId: AGENT_ASSET,
      workspaceRoot: "/var/lib/openbot/workspaces/asset-unique-1",
      governanceVersion: 4,
    });
    const twin = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: TENANT,
      userId: USER,
      agentAssetId: AGENT_ASSET,
      workspaceRoot: "/var/lib/openbot/workspaces/asset-unique-1-b",
      governanceVersion: 4,
    });
    twin.resource.resourceId = `${mine.resource.resourceId}:twin`;
    twin.binding.resourceId = twin.resource.resourceId;
    twin.binding.bindingId = `${twin.resource.resourceId}:canonical`;
    const other = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: TENANT,
      userId: USER,
      agentAssetId: "asset-other",
      workspaceRoot: "/var/lib/openbot/workspaces/asset-other",
      governanceVersion: 4,
    });

    const none = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      ports: ports(
        {
          agentAssetId: AGENT_ASSET,
          catalog: new InMemoryWorkspaceResourceCatalog({
            governanceVersion: 4,
            status: "available",
            resources: { [other.resource.resourceId]: other.resource },
            bindings: { [other.binding.bindingId]: other.binding },
          }),
        },
        [memoryRecord({ workspaceId: other.resource.resourceId })],
      ),
    });
    expect(none).toMatchObject({ ok: false, reasonCode: "missing_workspace_resource" });

    const many = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      ports: ports(
        {
          agentAssetId: AGENT_ASSET,
          catalog: new InMemoryWorkspaceResourceCatalog({
            governanceVersion: 4,
            status: "available",
            resources: {
              [mine.resource.resourceId]: mine.resource,
              [twin.resource.resourceId]: twin.resource,
            },
            bindings: {
              [mine.binding.bindingId]: mine.binding,
              [twin.binding.bindingId]: twin.binding,
            },
          }),
        },
        [memoryRecord({ workspaceId: mine.resource.resourceId })],
      ),
    });
    expect(many).toMatchObject({ ok: false, reasonCode: "ambiguous_agent_asset" });

    const wrong = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      resourceId: other.resource.resourceId,
      ports: ports(
        {
          agentAssetId: AGENT_ASSET,
          catalog: new InMemoryWorkspaceResourceCatalog({
            governanceVersion: 4,
            status: "available",
            resources: {
              [mine.resource.resourceId]: mine.resource,
              [other.resource.resourceId]: other.resource,
            },
            bindings: {
              [mine.binding.bindingId]: mine.binding,
              [other.binding.bindingId]: other.binding,
            },
          }),
        },
        [memoryRecord({ workspaceId: other.resource.resourceId })],
      ),
    });
    expect(wrong).toMatchObject({ ok: false, reasonCode: "missing_workspace_resource" });

    const duplicate = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      ports: ports(
        {
          agentAssetId: AGENT_ASSET,
          catalog: new InMemoryWorkspaceResourceCatalog({
            governanceVersion: 4,
            status: "available",
            resources: { [mine.resource.resourceId]: mine.resource },
            bindings: {
              [mine.binding.bindingId]: mine.binding,
              [`${mine.binding.bindingId}:dup`]: {
                ...mine.binding,
                bindingId: `${mine.binding.bindingId}:dup`,
              },
            },
          }),
        },
        [memoryRecord({ workspaceId: mine.resource.resourceId })],
      ),
    });
    expect(duplicate).toMatchObject({ ok: false, reasonCode: "missing_binding" });
  });

  it("denies owner mismatch, merged Memory Asset identity, and duplicate memory canonical bindings", async () => {
    const identity = identityFixture();
    const resourceId = Object.keys(identity.catalog!.snapshot().resources)[0];

    const ownerMismatch = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      ports: ports(identity, [
        {
          ...memoryRecord({ workspaceId: resourceId }),
          envelope: {
            ...memoryRecord({ workspaceId: resourceId }).envelope,
            owner: { kind: "user", userId: "other-user" },
          },
        },
      ]),
    });
    expect(ownerMismatch).toMatchObject({ ok: false, reasonCode: "missing_binding" });

    const mergedIdentity = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      ports: ports(identity, [memoryRecord({ workspaceId: resourceId, memoryId: resourceId })]),
    });
    expect(mergedIdentity).toMatchObject({ ok: false, reasonCode: "missing_memory_asset" });

    const base = memoryRecord({ workspaceId: resourceId });
    const duplicateMemoryBinding = await resolveMemoryWorkspaceHandle({
      tenantId: TENANT,
      userId: USER,
      agentId: AGENT_ID,
      actor: { tenantId: TENANT, userId: USER },
      ports: ports(identity, [
        {
          ...base,
          bindings: [
            base.bindings[0],
            {
              ...base.bindings[0],
              bindingId: `${base.bindings[0].bindingId}:dup`,
            },
          ],
        },
      ]),
    });
    expect(duplicateMemoryBinding).toMatchObject({ ok: false, reasonCode: "missing_binding" });
  });
});
