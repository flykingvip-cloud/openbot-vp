import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildEmployeeStewardCutoverCatalogEntries,
  buildUserOwnedWorkspaceCatalogEntry,
  buildWorkspaceResourceId,
} from "./builders.js";
import { createEmptyWorkspaceCatalog, InMemoryWorkspaceResourceCatalog } from "./catalog.js";
import { resolveWorkspaceLocator } from "./strict-locator.js";

const managedCfg = { data: { mode: "managed" as const } };
const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "builders.ts"),
  "utf8",
);
const cutoverFn = source.slice(
  source.indexOf("export function buildEmployeeStewardCutoverCatalogEntries"),
  source.indexOf("export function buildLocalFolderIndexCatalogEntry"),
);

function seedCatalog(params?: { tenantId?: string; userId?: string; agentAssetId?: string }) {
  const tenantId = params?.tenantId ?? "tenant-a";
  const userId = params?.userId ?? "user-elle";
  const agentAssetId = params?.agentAssetId ?? "steward:builtin";
  const entry = buildUserOwnedWorkspaceCatalogEntry({
    tenantId,
    userId,
    agentAssetId,
    workspaceRoot: "/var/workspaces/tenant-a/steward",
    classification: "employee.steward.workspace",
  });
  return {
    entry,
    catalog: new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources: { [entry.resource.resourceId]: entry.resource },
      bindings: { [entry.binding.bindingId]: entry.binding },
    }),
  };
}

describe("Item 7 batch 18 S21 steward cutover catalog lookup", () => {
  it("replaces user-owned Catalog synthesis and reads existing SoT rows only", () => {
    expect(cutoverFn).not.toContain("buildUserOwnedWorkspaceCatalogEntry");
    expect(cutoverFn).toContain("catalog.getResource");
    expect(cutoverFn).toContain("buildWorkspaceResourceId");
    expect(
      resolveWorkspaceLocator({
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "missing_tenant_context", failClosed: true });
  });

  it("fail-closes when tenant, user, agentAsset, or catalog row is missing", () => {
    const { catalog } = seedCatalog();
    expect(() =>
      buildEmployeeStewardCutoverCatalogEntries({
        catalog,
        tenantId: "  ",
        userId: "user-elle",
        sourceRoot: "/legacy",
        targetRoot: "/d1e",
      }),
    ).toThrow(/tenant_id_required/);
    expect(() =>
      buildEmployeeStewardCutoverCatalogEntries({
        catalog,
        tenantId: "tenant-a",
        userId: "",
        sourceRoot: "/legacy",
        targetRoot: "/d1e",
      }),
    ).toThrow(/user_id_required/);
    expect(() =>
      buildEmployeeStewardCutoverCatalogEntries({
        catalog,
        tenantId: "tenant-a",
        userId: "user-elle",
        agentAssetId: "   ",
        sourceRoot: "/legacy",
        targetRoot: "/d1e",
      }),
    ).toThrow(/agent_asset_id_required/);
    expect(() =>
      buildEmployeeStewardCutoverCatalogEntries({
        catalog: createEmptyWorkspaceCatalog(),
        tenantId: "tenant-a",
        userId: "user-elle",
        sourceRoot: "/legacy",
        targetRoot: "/d1e",
      }),
    ).toThrow(/catalog_record_required/);
  });

  it("fail-closes on tenant mismatch and does not write the catalog", () => {
    const { entry } = seedCatalog({ tenantId: "tenant-a" });
    const forged = {
      ...entry.resource,
      tenantId: "tenant-b",
    };
    const catalog = new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources: { [forged.resourceId]: forged },
      bindings: { [entry.binding.bindingId]: entry.binding },
    });
    const before = catalog.snapshot();
    expect(() =>
      buildEmployeeStewardCutoverCatalogEntries({
        catalog,
        tenantId: "tenant-a",
        userId: "user-elle",
        sourceRoot: "/legacy",
        targetRoot: "/d1e",
      }),
    ).toThrow(/tenant_mismatch/);
    expect(catalog.snapshot()).toEqual(before);
  });

  it("pass-after reads the unique existing steward resource and keeps source/target locators", () => {
    const { catalog, entry } = seedCatalog();
    const built = buildEmployeeStewardCutoverCatalogEntries({
      catalog,
      tenantId: "tenant-a",
      userId: "user-elle",
      sourceRoot: "/legacy/source",
      targetRoot: "/d1e/target",
    });
    expect(built.resource.resourceId).toBe(entry.resource.resourceId);
    expect(built.resource.resourceId).toBe(
      buildWorkspaceResourceId({
        tenantId: "tenant-a",
        scope: {
          kind: "user_owned",
          userId: "user-elle",
          agentAssetId: "steward:builtin",
          proof: {
            source: "explicit_binding",
            ownerType: "user",
            ownerId: "user-elle",
            agentAssetId: "steward:builtin",
          },
        },
      }),
    );
    expect(built.sourceBinding.locator).toBe("/legacy/source");
    expect(built.targetBinding.locator).toBe("/d1e/target");
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
        grant: { kind: "user" as const, subjectId: "user-elle", purpose: "item7-batch18-s21" },
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
