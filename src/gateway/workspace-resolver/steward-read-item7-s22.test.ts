import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildUserOwnedWorkspaceCatalogEntry } from "./builders.js";
import { createEmptyWorkspaceCatalog, InMemoryWorkspaceResourceCatalog } from "./catalog.js";
import { readStewardWorkspaceFileContent } from "./steward-read.js";
import { resolveWorkspaceLocator } from "./strict-locator.js";

const managedCfg = { data: { mode: "managed" as const } };
const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "steward-read.ts"),
  "utf8",
);

describe("Item 7 batch 19 S22 steward-read catalog lookup", () => {
  it("replaces user-owned Catalog synthesis and reads existing SoT rows only", () => {
    expect(source).not.toContain("buildUserOwnedWorkspaceCatalogEntry");
    expect(source).toContain("catalog.getResource");
    expect(source).toContain("buildWorkspaceResourceId");
    expect(
      resolveWorkspaceLocator({
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "missing_tenant_context", failClosed: true });
  });

  it("fail-closes on missing tenant, user, or empty catalog without minting", () => {
    const entry = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "steward:builtin",
      workspaceRoot: "/var/workspaces/tenant-a/steward",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources: { [entry.resource.resourceId]: entry.resource },
      bindings: { [entry.binding.bindingId]: entry.binding },
    });
    expect(
      readStewardWorkspaceFileContent({
        catalog,
        actor: { tenantId: "tenant-a", userId: "user-elle" },
        tenantId: "  ",
        userId: "user-elle",
        roots: [{ agentAssetId: "steward:builtin", workspaceRoot: "/legacy" }],
        relativePath: "note.md",
      }),
    ).toMatchObject({ ok: false, reason: "tenant_id_required" });
    expect(
      readStewardWorkspaceFileContent({
        catalog,
        actor: { tenantId: "tenant-a", userId: "user-elle" },
        tenantId: "tenant-a",
        userId: "",
        roots: [{ agentAssetId: "steward:builtin", workspaceRoot: "/legacy" }],
        relativePath: "note.md",
      }),
    ).toMatchObject({ ok: false, reason: "user_id_required" });
    expect(
      readStewardWorkspaceFileContent({
        catalog: createEmptyWorkspaceCatalog(),
        actor: { tenantId: "tenant-a", userId: "user-elle" },
        tenantId: "tenant-a",
        userId: "user-elle",
        roots: [{ agentAssetId: "steward:builtin", workspaceRoot: "/legacy" }],
        relativePath: "note.md",
      }),
    ).toMatchObject({ ok: false, reason: "empty_catalog_synthesis_forbidden" });
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
        grant: { kind: "user" as const, subjectId: "user-elle", purpose: "item7-batch19-s22" },
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
