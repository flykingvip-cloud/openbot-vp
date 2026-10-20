import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildUserOwnedWorkspaceCatalogEntry } from "../workspace-resolver/builders.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
} from "../workspace-resolver/catalog.js";
import { resolveWorkspaceLocator } from "../workspace-resolver/strict-locator.js";

const managedCfg = { data: { mode: "managed" as const } };
const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "group-workspace-file.ts"),
  "utf8",
);

describe("Item 7 batch 16 S17 group workspace file list catalog lookup", () => {
  it("replaces empty Catalog synthesis and does not mint a production Catalog row", () => {
    expect(source).not.toContain("createEmptyWorkspaceCatalog");
    expect(source).toContain("InMemoryWorkspaceResourceCatalog");
    expect(source).toContain("resources: {}");
    expect(source).toContain("resolveTrustedGroupLocator");
  });

  it("fail-closed: cfg-only and incomplete tenant queries do not yield a locator", () => {
    expect(
      resolveWorkspaceLocator({
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "missing_tenant_context", failClosed: true });
    expect(
      resolveWorkspaceLocator({
        tenantId: "tenant-a",
        agentAssetId: "asset-only",
        catalog: new InMemoryWorkspaceResourceCatalog({
          governanceVersion: 1,
          status: "available",
          resources: {},
          bindings: {},
        }),
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, failClosed: true });
    expect(
      resolveWorkspaceLocator({
        tenantContext: {
          tenantId: "tenant-a",
          userId: "user-elle",
          domain: "enterprise" as const,
        },
        tenantId: "tenant-a",
        actor: {
          userId: "user-elle",
          grant: { kind: "user" as const, subjectId: "user-elle", purpose: "item7-batch16-s17" },
        },
        catalog: new InMemoryWorkspaceResourceCatalog({
          governanceVersion: 1,
          status: "available",
          resources: {},
          bindings: {},
        }),
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "catalog_miss", failClosed: true });
  });

  it("fail-closed: catalog miss and ambiguous first-match stay denied", () => {
    const left = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "asset-alpha",
      workspaceRoot: "/var/workspaces/tenant-a/asset-alpha",
    });
    const right = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "asset-alpha",
      workspaceRoot: "/var/workspaces/tenant-a/asset-alpha-dup",
    });
    const ambiguous = new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources: {
        [left.resource.resourceId]: left.resource,
        [right.resource.resourceId]: right.resource,
      },
      bindings: {
        [left.binding.bindingId]: left.binding,
        [right.binding.bindingId]: right.binding,
      },
    });
    const denied = resolveWorkspaceLocator({
      tenantContext: {
        tenantId: "tenant-a",
        userId: "user-elle",
        domain: "enterprise" as const,
      },
      tenantId: "tenant-a",
      actor: {
        userId: "user-elle",
        grant: { kind: "user" as const, subjectId: "user-elle", purpose: "item7-batch16-s17" },
      },
      agentAssetId: "asset-alpha",
      catalog: ambiguous,
      cfg: managedCfg,
    });
    expect(denied.ok).toBe(false);
    if (denied.ok) {
      return;
    }
    expect(denied.failClosed).toBe(true);
    expect(["catalog_miss", "first_canonical_selection_forbidden"]).toContain(denied.reasonCode);
  });

  it("pass-after resolves the unique catalog locator when the complete query is provided", () => {
    const entry = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "asset-alpha",
      workspaceRoot: "/var/workspaces/tenant-a/asset-alpha",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources: { [entry.resource.resourceId]: entry.resource },
      bindings: { [entry.binding.bindingId]: entry.binding },
    });
    const located = resolveWorkspaceLocator({
      tenantContext: {
        tenantId: "tenant-a",
        userId: "user-elle",
        domain: "enterprise" as const,
      },
      tenantId: "tenant-a",
      actor: {
        userId: "user-elle",
        grant: { kind: "user" as const, subjectId: "user-elle", purpose: "item7-batch16-s17" },
      },
      resourceId: entry.resource.resourceId,
      agentAssetId: "asset-alpha",
      catalog,
      cfg: managedCfg,
    });
    expect(located.ok).toBe(true);
    if (!located.ok) {
      return;
    }
    expect(located.handle.locator).toBe("/var/workspaces/tenant-a/asset-alpha");
  });
});
