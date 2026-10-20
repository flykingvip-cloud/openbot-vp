import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildUserOwnedWorkspaceCatalogEntry } from "./builders.js";
import { createEmptyWorkspaceCatalog, InMemoryWorkspaceResourceCatalog } from "./catalog.js";
import { buildEmployeeStewardCutoverCatalog } from "./steward-write.js";
import { resolveWorkspaceLocator } from "./strict-locator.js";

const managedCfg = { data: { mode: "managed" as const } };
const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "steward-write.ts"),
  "utf8",
);

describe("Item 7 batch 20 S23 steward-write catalog lookup", () => {
  it("replaces createEmptyWorkspaceCatalog and keeps S24-S27 watched lines", () => {
    expect(source).not.toContain("createEmptyWorkspaceCatalog");
    expect(source).toContain("InMemoryWorkspaceResourceCatalog");
    expect(source).toContain("getResource");
    // S26/S27 retired in batch 24: the pilot moved to provision-steward-cutover.ts and
    // steward-write.ts no longer calls the host-path resolvers.
    expect(source).not.toContain("export function runEmployeeStewardCutoverPilot");
    expect(source).not.toContain("resolveEmployeeStewardSourceWorkspaceDir(userId");
    expect(source).not.toContain("resolveEmployeeStewardTargetWorkspaceDir({");
    expect(
      resolveWorkspaceLocator({
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "missing_tenant_context", failClosed: true });
  });

  it("fail-closes when the seeded Catalog row is missing", () => {
    expect(() =>
      buildEmployeeStewardCutoverCatalog({
        tenantId: "tenant-a",
        userId: "user-elle",
        sourceRoot: "/legacy",
        targetRoot: "/d1e",
      }),
    ).not.toThrow();
    const built = buildEmployeeStewardCutoverCatalog({
      tenantId: "tenant-a",
      userId: "user-elle",
      sourceRoot: "/legacy",
      targetRoot: "/d1e",
    });
    expect(built.catalog.getResource(built.resourceId)?.tenantId).toBe("tenant-a");
    expect(built.catalog.getResource("missing")).toBeNull();
  });

  it("pass-after resolves the unique catalog locator when the complete query is provided", () => {
    const built = buildEmployeeStewardCutoverCatalog({
      tenantId: "tenant-a",
      userId: "user-elle",
      sourceRoot: "/legacy",
      targetRoot: "/d1e",
    });
    const entry = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "steward:builtin",
      workspaceRoot: "/d1e",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources: { [entry.resource.resourceId]: entry.resource },
      bindings: { [entry.binding.bindingId]: entry.binding },
    });
    expect(catalog.getResource(built.resourceId)?.resourceId).toBe(entry.resource.resourceId);
    const located = resolveWorkspaceLocator({
      tenantContext: {
        tenantId: "tenant-a",
        userId: "user-elle",
        domain: "enterprise" as const,
      },
      tenantId: "tenant-a",
      actor: {
        userId: "user-elle",
        grant: { kind: "user" as const, subjectId: "user-elle", purpose: "item7-batch20-s23" },
      },
      resourceId: built.resourceId,
      agentAssetId: "steward:builtin",
      catalog,
      cfg: managedCfg,
    });
    expect(located.ok).toBe(true);
    if (!located.ok) {
      return;
    }
    expect(located.handle.locator).toBe("/d1e");
  });
});
