import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWorkspaceResourceId,
  createMemoryWorkspaceCatalog,
  createWorkspaceBinding,
  createWorkspaceResourceResolver,
} from "./resource-resolver.js";
import type { WorkspaceResourceRecord } from "./types.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function seedWorkspace(root: string) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "hello.md"), "hi");
}

describe("workspace resource resolver", () => {
  it("authorizes before returning a constrained handle", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-res-"));
    tempDirs.push(root);
    const locator = path.join(root, "canonical");
    seedWorkspace(locator);

    const ownerScope = {
      kind: "position_owned" as const,
      seatId: "seat-1",
      agentAssetId: "asset-1",
    };
    const resourceId = buildWorkspaceResourceId({ tenantId: "t1", ownerScope });
    const resource: WorkspaceResourceRecord = {
      resourceId,
      resourceType: "workspace",
      tenantId: "t1",
      ownerScope,
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
    };
    const binding = createWorkspaceBinding({ resourceId, locator });
    const catalog = createMemoryWorkspaceCatalog({
      resources: [resource],
      bindings: [binding],
    });
    const resolver = createWorkspaceResourceResolver({ catalog });

    const denied = await resolver.resolve({
      actor: { tenantId: "t-other", principalId: "u1", profile: "managed_enterprise" },
      resourceId,
      operation: "read",
      purpose: "test",
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.denyReason).toBe("tenant_mismatch");
    }

    const allowed = await resolver.resolve({
      actor: { tenantId: "t1", principalId: "u1", profile: "managed_enterprise" },
      resourceId,
      operation: "list",
      purpose: "test",
    });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.handle.allowedOperations).toContain("list");
      expect(await allowed.handle.list?.()).toContain("hello.md");
      // Public handle must not encourage raw path reuse via enumerable API.
      expect(Object.keys(allowed.handle)).not.toContain("path");
    }
  });

  it("fails closed when catalog is unavailable in managed mode", async () => {
    const catalog = {
      currentEpoch: () => 0,
      bumpEpoch: () => {},
      getSnapshot: async () => null,
    };
    const resolver = createWorkspaceResourceResolver({ catalog, managedFailClosed: true });
    const result = await resolver.resolve({
      actor: { tenantId: "t1", principalId: "u1", profile: "managed_enterprise" },
      resourceId: "missing",
      operation: "write",
      purpose: "test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denyReason).toBe("catalog_unavailable");
    }
  });

  it("personal_local read uses degraded snapshot when live catalog is unavailable", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-deg-"));
    tempDirs.push(root);
    const locator = path.join(root, "ws");
    seedWorkspace(locator);
    const resourceId = "res-deg";
    const ownerScope = {
      kind: "user_owned" as const,
      userId: "u1",
      agentAssetId: "asset-1",
      proof: {
        source: "explicit_binding" as const,
        ownerType: "user" as const,
        ownerId: "u1",
        agentAssetId: "asset-1",
      },
    };
    const mem = createMemoryWorkspaceCatalog({
      resources: [
        {
          resourceId,
          resourceType: "workspace",
          tenantId: null,
          ownerScope,
          lifecycleState: "active",
          classification: "internal",
          governanceVersion: 1,
        },
      ],
      bindings: [
        createWorkspaceBinding({
          resourceId,
          locator,
          role: "canonical",
          state: "active",
        }),
      ],
    });
    const good = await mem.getSnapshot();
    const catalog = {
      currentEpoch: () => mem.currentEpoch(),
      bumpEpoch: (id: string) => mem.bumpEpoch(id),
      getSnapshot: async () => null,
      getDegradedSnapshot: async () => good,
    };
    const resolver = createWorkspaceResourceResolver({ catalog, managedFailClosed: true });
    const readOk = await resolver.resolve({
      actor: { tenantId: null, principalId: "u1", profile: "personal_local" },
      resourceId,
      operation: "read",
      purpose: "test",
    });
    expect(readOk.ok).toBe(true);

    const writeDenied = await resolver.resolve({
      actor: { tenantId: null, principalId: "u1", profile: "personal_local" },
      resourceId,
      operation: "write",
      purpose: "test",
    });
    expect(writeDenied.ok).toBe(false);
    if (!writeDenied.ok) {
      expect(writeDenied.denyReason).toBe("catalog_unavailable");
    }

    const managedDenied = await resolver.resolve({
      actor: { tenantId: "t1", principalId: "u1", profile: "managed_enterprise" },
      resourceId,
      operation: "read",
      purpose: "test",
    });
    expect(managedDenied.ok).toBe(false);
  });

  it("denies access for recovery_required / quarantined / archived without changing lifecycle", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-life-deny-"));
    tempDirs.push(root);
    const locator = path.join(root, "ws");
    seedWorkspace(locator);
    const resourceId = "res-blocked";
    const ownerScope = {
      kind: "user_owned" as const,
      userId: "u1",
      agentAssetId: "asset-1",
      proof: {
        source: "explicit_binding" as const,
        ownerType: "user" as const,
        ownerId: "u1",
        agentAssetId: "asset-1",
      },
    };
    for (const lifecycleState of ["recovery_required", "quarantined", "archived"] as const) {
      const catalog = createMemoryWorkspaceCatalog({
        resources: [
          {
            resourceId,
            resourceType: "workspace",
            tenantId: "t1",
            ownerScope,
            lifecycleState,
            classification: "internal",
            governanceVersion: 4,
          },
        ],
        bindings: [
          createWorkspaceBinding({
            resourceId,
            locator,
            role: "canonical",
            state: "active",
          }),
        ],
      });
      const resolver = createWorkspaceResourceResolver({ catalog });
      for (const operation of ["read", "write", "list"] as const) {
        const result = await resolver.resolve({
          actor: { tenantId: "t1", principalId: "u1", profile: "managed_enterprise" },
          resourceId,
          operation,
          purpose: "test",
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.denyReason).toBe("lifecycle_blocks_access");
        }
      }
      const snap = await catalog.getSnapshot();
      expect(snap?.resources.get(resourceId)?.lifecycleState).toBe(lifecycleState);
      expect(snap?.resources.get(resourceId)?.governanceVersion).toBe(4);
    }
  });

  it("rejects unknown ownership writes and compatibility writers", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-res-"));
    tempDirs.push(root);
    const locator = path.join(root, "compat");
    seedWorkspace(locator);
    const resourceId = "res-unknown";
    const catalog = createMemoryWorkspaceCatalog({
      resources: [
        {
          resourceId,
          resourceType: "workspace",
          tenantId: "t1",
          ownerScope: { kind: "unknown", reason: "empty_registry" },
          lifecycleState: "active",
          classification: "internal",
          governanceVersion: 1,
        },
      ],
      bindings: [
        createWorkspaceBinding({
          resourceId,
          locator,
          role: "compatibility",
          state: "read_only",
        }),
      ],
    });
    const resolver = createWorkspaceResourceResolver({ catalog });
    const writeUnknown = await resolver.resolve({
      actor: { tenantId: "t1", principalId: "u1", profile: "managed_enterprise" },
      resourceId,
      operation: "write",
      purpose: "test",
    });
    expect(writeUnknown.ok).toBe(false);
    if (!writeUnknown.ok) {
      expect(writeUnknown.denyReason).toBe("unknown_ownership");
    }
  });

  it("invalidates cache epoch after write authorization path bumps catalog", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-res-"));
    tempDirs.push(root);
    const locator = path.join(root, "canonical");
    seedWorkspace(locator);
    const ownerScope = {
      kind: "user_owned" as const,
      userId: "u1",
      agentAssetId: "asset-1",
      proof: {
        source: "explicit_binding" as const,
        ownerType: "user" as const,
        ownerId: "u1",
        agentAssetId: "asset-1",
      },
    };
    const resourceId = buildWorkspaceResourceId({ tenantId: "t1", ownerScope });
    const catalog = createMemoryWorkspaceCatalog({
      resources: [
        {
          resourceId,
          resourceType: "workspace",
          tenantId: "t1",
          ownerScope,
          lifecycleState: "active",
          classification: "internal",
          governanceVersion: 1,
        },
      ],
      bindings: [createWorkspaceBinding({ resourceId, locator, contentVersion: "v0" })],
    });
    const resolver = createWorkspaceResourceResolver({ catalog });
    const first = await resolver.resolve({
      actor: { tenantId: "t1", principalId: "u1", profile: "managed_enterprise" },
      resourceId,
      operation: "write",
      purpose: "test",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    await first.handle.writeText?.("next", "v0");
    const second = await resolver.resolve({
      actor: { tenantId: "t1", principalId: "u1", profile: "managed_enterprise" },
      resourceId,
      operation: "read",
      purpose: "test",
    });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.audit.cacheHit).toBe(false);
    }
  });
});
