import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import {
  createWorkspaceCutoverOperation,
  transitionWorkspaceCutoverOperation,
} from "../workspace-cutover/index.js";
import { WorkspaceResourceAccess } from "./access.js";
import { buildGroupWorkspaceCatalogEntry } from "./builders.js";
import { WorkspaceResolverCache } from "./cache.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
  withCatalogEntries,
} from "./catalog.js";
import {
  invalidateWorkspaceResourceCacheAfterWrite,
  openWorkspaceResourceAccess,
  resolveWorkspaceResource,
} from "./resolve.js";

const managedCfg = { data: { mode: "managed" as const } } satisfies OpenBotConfig;

function mkGroupFixture(): { root: string; catalog: ReturnType<typeof withCatalogEntries> } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-ws-resolver-"));
  const groupDir = path.join(root, "groups", "group-1");
  fs.mkdirSync(path.join(groupDir, "deliverables"), { recursive: true });
  fs.writeFileSync(path.join(groupDir, "deliverables", "report.pdf"), "pdf-bytes");

  const entry = buildGroupWorkspaceCatalogEntry({
    tenantId: "tenant-a",
    groupId: "group-1",
    workspaceRoot: groupDir,
  });
  const catalog = withCatalogEntries(createEmptyWorkspaceCatalog(), entry);
  return { root, catalog };
}

describe("workspace resource resolver", () => {
  it("resolves read access to canonical binding without exposing path in result", () => {
    const { catalog } = mkGroupFixture();
    const resolved = resolveWorkspaceResource({
      catalog,
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      resourceId: "ws:tenant-a:group:group-1",
      operation: "read",
      purpose: "group-file.read",
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.audit.bindingId).toContain("canonical");
    expect(JSON.stringify(resolved)).not.toContain("groups/group-1");

    const access = openWorkspaceResourceAccess({ catalog, resolved });
    expect(access).toBeTruthy();
    const buf = access!.readRelativeFile("deliverables/report.pdf");
    expect(buf?.toString()).toBe("pdf-bytes");
  });

  it("denies cross-tenant resource access", () => {
    const { catalog } = mkGroupFixture();
    const resolved = resolveWorkspaceResource({
      catalog,
      actor: { tenantId: "tenant-b", userId: "user-bob" },
      resourceId: "ws:tenant-a:group:group-1",
      operation: "read",
      purpose: "group-file.read",
    });
    expect(resolved).toMatchObject({ ok: false, reason: "tenant_mismatch" });
  });

  it("managed write fails closed when catalog is unavailable", () => {
    const { catalog: base } = mkGroupFixture();
    const snap = base.snapshot();
    const catalog = createEmptyWorkspaceCatalog({ status: "unavailable" });
    const unavailable = withCatalogEntries(catalog, {
      resource: snap.resources["ws:tenant-a:group:group-1"],
      binding: snap.bindings["ws:tenant-a:group:group-1:canonical"],
    });

    const resolved = resolveWorkspaceResource({
      catalog: unavailable,
      cfg: managedCfg,
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      resourceId: "ws:tenant-a:group:group-1",
      operation: "write",
      purpose: "group-file.write",
    });
    expect(resolved).toMatchObject({ ok: false, reason: "catalog_unavailable" });
  });

  it("managed degraded read allowed only when snapshot permits", () => {
    const snap = mkGroupFixture().catalog.snapshot();
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "unavailable",
      allowDegradedRead: true,
      resources: snap.resources,
      bindings: snap.bindings,
    });

    const resolved = resolveWorkspaceResource({
      catalog,
      cfg: managedCfg,
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      resourceId: "ws:tenant-a:group:group-1",
      operation: "read",
      purpose: "group-file.read",
    });
    expect(resolved.ok).toBe(true);
  });

  it("rejects unknown ownership for write", () => {
    const snap = mkGroupFixture().catalog.snapshot();
    const resource = {
      ...snap.resources["ws:tenant-a:group:group-1"],
      ownerScope: { kind: "unknown" as const, reason: "empty_registry" },
    };
    const catalog = withCatalogEntries(createEmptyWorkspaceCatalog(), {
      resource,
      binding: snap.bindings["ws:tenant-a:group:group-1:canonical"],
    });
    const resolved = resolveWorkspaceResource({
      catalog,
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      resourceId: resource.resourceId,
      operation: "write",
      purpose: "group-file.write",
    });
    expect(resolved).toMatchObject({ ok: false, reason: "unknown_ownership" });
  });

  it("uses cache and invalidates after write", () => {
    const { catalog } = mkGroupFixture();
    const cache = new WorkspaceResolverCache();
    const params = {
      catalog,
      cache,
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      resourceId: "ws:tenant-a:group:group-1",
      operation: "read" as const,
      purpose: "group-file.read",
    };
    const first = resolveWorkspaceResource(params);
    const second = resolveWorkspaceResource(params);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.audit.cacheHit).toBe(true);
    }
    invalidateWorkspaceResourceCacheAfterWrite(cache, params.resourceId);
    const third = resolveWorkspaceResource(params);
    expect(third.ok).toBe(true);
    if (third.ok) {
      expect(third.audit.cacheHit).toBe(false);
    }
  });

  it("adapter enforces containment on relative paths", () => {
    const access = new WorkspaceResourceAccess({
      resourceId: "ws:test",
      bindingId: "b1",
      operation: "read",
      purpose: "test",
      rootPath: "/tmp/workspace",
    });
    expect(access.resolveRelativePath("../etc/passwd")).toBeNull();
    expect(access.resolveRelativePath("deliverables/a.pdf")).toContain("deliverables/a.pdf");
  });

  it("rejects write when two active canonical bindings exist", () => {
    const { catalog: base, root } = mkGroupFixture();
    const snap = base.snapshot();
    const resourceId = "ws:tenant-a:group:group-1";
    const legacyBinding = snap.bindings["ws:tenant-a:group:group-1:canonical"];
    const duplicateBinding = {
      ...legacyBinding,
      bindingId: "ws:tenant-a:group:group-1:canonical:legacy",
      locator: path.join(root, "groups", "group-1-legacy"),
    };
    fs.mkdirSync(duplicateBinding.locator, { recursive: true });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      ...snap,
      bindings: {
        ...snap.bindings,
        [duplicateBinding.bindingId]: duplicateBinding,
      },
    });
    const resolved = resolveWorkspaceResource({
      catalog,
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      resourceId,
      operation: "write",
      purpose: "group-file.write",
    });
    expect(resolved).toMatchObject({ ok: false, reason: "binding_not_writable" });
  });

  it("routes writes to source binding before cutover and target after cutover", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-ws-cutover-"));
    const legacyDir = path.join(root, "legacy");
    const targetDir = path.join(root, "target");
    fs.mkdirSync(path.join(legacyDir, "deliverables"), { recursive: true });
    fs.mkdirSync(path.join(targetDir, "deliverables"), { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "deliverables", "report.pdf"), "legacy-bytes");
    fs.writeFileSync(path.join(targetDir, "deliverables", "report.pdf"), "target-bytes");

    const resourceId = "ws:tenant-a:group:group-cutover";
    const resource = {
      resourceId,
      resourceType: "workspace" as const,
      tenantId: "tenant-a",
      ownerScope: { kind: "group_owned" as const, groupId: "group-cutover" },
      lifecycleState: "active" as const,
      classification: "collaboration_group",
      governanceVersion: 1,
    };
    const sourceBindingId = `${resourceId}:canonical:legacy`;
    const targetBindingId = `${resourceId}:canonical`;
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: { [resourceId]: resource },
      bindings: {
        [sourceBindingId]: {
          bindingId: sourceBindingId,
          resourceId,
          role: "canonical",
          locator: legacyDir,
          state: "active",
          contentVersion: "v1",
        },
        [targetBindingId]: {
          bindingId: targetBindingId,
          resourceId,
          role: "compatibility",
          locator: targetDir,
          state: "read_only",
          contentVersion: "v2",
        },
      },
    });

    const preparedCutover = transitionWorkspaceCutoverOperation({
      operation: createWorkspaceCutoverOperation({
        operationId: "op-prepared",
        resourceId,
        sourceBindingId,
        targetBindingId,
        expectedContentVersion: "v2",
      }),
      nextState: "prepared",
    });
    const preparedWrite = resolveWorkspaceResource({
      catalog,
      cutoverOperations: [preparedCutover],
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      resourceId,
      operation: "write",
      purpose: "group-file.write",
    });
    expect(preparedWrite.ok).toBe(true);
    if (preparedWrite.ok) {
      expect(preparedWrite.bindingId).toBe(sourceBindingId);
    }

    let cutover = preparedCutover;
    for (const step of [
      "write_frozen",
      "copied_or_adopted",
      "verified",
      "dual_read_verified",
      "resolver_write_cutover",
    ] as const) {
      cutover = transitionWorkspaceCutoverOperation({ operation: cutover, nextState: step });
    }
    const cutoverCatalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: { [resourceId]: resource },
      bindings: {
        [sourceBindingId]: {
          bindingId: sourceBindingId,
          resourceId,
          role: "canonical",
          locator: legacyDir,
          state: "read_only",
          contentVersion: "v1",
        },
        [targetBindingId]: {
          bindingId: targetBindingId,
          resourceId,
          role: "canonical",
          locator: targetDir,
          state: "active",
          contentVersion: "v2",
        },
      },
    });

    const targetWrite = resolveWorkspaceResource({
      catalog: cutoverCatalog,
      cutoverOperations: [cutover],
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      resourceId,
      operation: "write",
      purpose: "group-file.write",
    });
    expect(targetWrite.ok).toBe(true);
    if (targetWrite.ok) {
      expect(targetWrite.bindingId).toBe(targetBindingId);
      const access = openWorkspaceResourceAccess({
        catalog: cutoverCatalog,
        resolved: targetWrite,
      });
      expect(access?.readRelativeFile("deliverables/report.pdf")?.toString()).toBe("target-bytes");
    }

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("denies all writes during write_frozen cutover phase", () => {
    const { catalog } = mkGroupFixture();
    const resourceId = "ws:tenant-a:group:group-1";
    const snap = catalog.snapshot();
    const sourceBindingId = "ws:tenant-a:group:group-1:canonical";
    let cutover = createWorkspaceCutoverOperation({
      operationId: "op-frozen",
      resourceId,
      sourceBindingId,
      targetBindingId: `${resourceId}:canonical:v2`,
      expectedContentVersion: "v2",
    });
    cutover = transitionWorkspaceCutoverOperation({ operation: cutover, nextState: "prepared" });
    cutover = transitionWorkspaceCutoverOperation({
      operation: cutover,
      nextState: "write_frozen",
    });

    const resolved = resolveWorkspaceResource({
      catalog,
      cutoverOperations: [cutover],
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      resourceId,
      operation: "write",
      purpose: "group-file.write",
    });
    expect(resolved).toMatchObject({ ok: false, reason: "binding_not_found" });
    expect(snap.bindings[sourceBindingId]).toBeTruthy();
  });
});

/**
 * Fixture profile: synthetic catalog with 1 resource / 1 binding, local tmp dir, Vitest default profile.
 * Performance gates (P0-c §8.4) are tracked separately; this suite validates correctness only.
 */
