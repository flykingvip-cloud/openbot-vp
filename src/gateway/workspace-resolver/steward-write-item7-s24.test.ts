import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildUserOwnedWorkspaceCatalogEntry } from "./builders.js";
import { InMemoryWorkspaceResourceCatalog } from "./catalog.js";
import { resolveEmployeeStewardWritableWorkspaceDir } from "./steward-write.js";
import { resolveWorkspaceLocator } from "./strict-locator.js";

const managedCfg = { data: { mode: "managed" as const } };
const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "steward-write.ts"),
  "utf8",
);
const lines = source.split("\n");

describe("Item 7 batch 21 S24 steward source helper lookup", () => {
  it("replaces resolveEmployeeStewardSourceWorkspaceDir at the writable-dir site only", () => {
    // Anchor on the writable-dir site itself instead of a brittle absolute line index: batch 24
    // removed two now-unused cutover imports (advance/create) and moved the pilot out, shifting
    // these sites upward. The retirement invariant is the site content, not its line number.
    const sourceRootSite = lines.find((line) => line.includes("const sourceRoot ="));
    expect(sourceRootSite).toBeDefined();
    expect(sourceRootSite).toContain("resolveWorkspaceLocator");
    expect(sourceRootSite).not.toContain("resolveEmployeeStewardSourceWorkspaceDir");
    // Batch 22 extended the fail-closed guard to require the target binding too.
    const failClosedGuard = lines.find((line) =>
      line.includes("&& sourceRoot && targetRoot ? resolved.reason"),
    );
    expect(failClosedGuard).toContain("!resolved.ok && sourceRoot && targetRoot ? resolved.reason");
    // S26/S27 retired in batch 24: the pilot moved to provision-steward-cutover.ts and
    // steward-write.ts no longer calls the host-path resolvers.
    expect(source).not.toContain("export function runEmployeeStewardCutoverPilot");
    expect(source).not.toContain("resolveEmployeeStewardSourceWorkspaceDir(userId");
    expect(source).not.toContain("resolveEmployeeStewardTargetWorkspaceDir({");
    expect(source).not.toContain("process.cwd(");
    expect(
      resolveWorkspaceLocator({
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "missing_tenant_context", failClosed: true });
  });

  it("fail-closes on missing catalog, grant, or tenant mismatch without host fallback", () => {
    const missingCatalog = resolveEmployeeStewardWritableWorkspaceDir({
      tenantId: "tenant-a",
      userId: "user-elle",
      cfg: managedCfg,
    });
    expect(missingCatalog).toMatchObject({ ok: false, reason: "catalog_record_required" });

    const entry = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "steward:builtin",
      workspaceRoot: "/legacy",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: { [entry.resource.resourceId]: entry.resource },
      bindings: { [entry.binding.bindingId]: entry.binding },
    });
    expect(
      resolveEmployeeStewardWritableWorkspaceDir({
        tenantId: "tenant-a",
        userId: "user-elle",
        cfg: managedCfg,
        catalog,
      }),
    ).toMatchObject({ ok: false, reason: "catalog_record_required" });
    expect(
      resolveEmployeeStewardWritableWorkspaceDir({
        tenantId: "tenant-b",
        userId: "user-elle",
        cfg: managedCfg,
        catalog,
        grant: { kind: "user", subjectId: "user-elle", purpose: "item7-batch21-s24" },
      }),
    ).toMatchObject({ ok: false, reason: "catalog_record_required" });
  });

  it("pass-after reads the existing Catalog source locator", () => {
    const entry = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "steward:builtin",
      workspaceRoot: "/legacy-source",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
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
        grant: { kind: "user" as const, subjectId: "user-elle", purpose: "item7-batch21-s24" },
      },
      resourceId: entry.resource.resourceId,
      agentAssetId: "steward:builtin",
      catalog,
      cfg: managedCfg,
    });
    expect(located.ok).toBe(true);
    if (!located.ok) {
      return;
    }
    expect(located.handle.locator).toBe("/legacy-source");
  });
});
