import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// Item 7 S28: tool-cwd.ts user-owned Catalog synthesis retired; pins live in item7 tests.
import { buildUserOwnedWorkspaceCatalogEntry } from "./builders.js";
import { createEmptyWorkspaceCatalog, withCatalogEntries } from "./catalog.js";
import { listGroupWorkspaceRelativeDir } from "./group-read.js";
import { resolveAuthorizedAgentToolWorkspaceCwd } from "./tool-cwd.js";

function catalogWithUserWorkspace(params: {
  tenantId: string;
  userId: string;
  agentAssetId: string;
  workspaceRoot: string;
}) {
  return withCatalogEntries(
    createEmptyWorkspaceCatalog(),
    buildUserOwnedWorkspaceCatalogEntry({
      ...params,
      classification: "agent.tool.cwd",
    }),
  );
}

describe("listGroupWorkspaceRelativeDir", () => {
  it("lists deliverables directory entries through resolver", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-group-list-"));
    const groupDir = path.join(root, "groups", "g-list");
    fs.mkdirSync(path.join(groupDir, "deliverables"), { recursive: true });
    fs.writeFileSync(path.join(groupDir, "deliverables", "a.md"), "a");
    fs.writeFileSync(path.join(groupDir, "deliverables", "b.pdf"), "b");

    const result = listGroupWorkspaceRelativeDir({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g-list",
      workspaceRoot: groupDir,
      relativeDir: "deliverables",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toEqual(["a.md", "b.pdf"]);
      expect(result.resourceId).toBe("ws:tenant-a:group:g-list");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects traversal in relativeDir", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-group-list-deny-"));
    const groupDir = path.join(root, "groups", "g-deny");
    fs.mkdirSync(groupDir, { recursive: true });

    const result = listGroupWorkspaceRelativeDir({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      groupId: "g-deny",
      workspaceRoot: groupDir,
      relativeDir: "../escape",
    });
    expect(result).toMatchObject({ ok: false, reason: "list_denied" });
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("resolveAuthorizedAgentToolWorkspaceCwd", () => {
  it("returns real root after list authorization", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-tool-cwd-"));
    const workspaceDir = path.join(root, "agents", "main");
    fs.mkdirSync(path.join(workspaceDir, "output"), { recursive: true });

    const result = resolveAuthorizedAgentToolWorkspaceCwd({
      catalog: catalogWithUserWorkspace({
        tenantId: "tenant-a",
        userId: "user-elle",
        agentAssetId: "agent:main",
        workspaceRoot: workspaceDir,
      }),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      userId: "user-elle",
      agentId: "main",
      agentAssetId: "agent:main",
      workspaceRoot: workspaceDir,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cwd).toBe(fs.realpathSync(workspaceDir));
      expect(result.resourceId).toBe("ws:tenant-a:user:user-elle:asset:agent:main");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("denies cross-tenant tool cwd", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-tool-cwd-xtenant-"));
    const workspaceDir = path.join(root, "agents", "main");
    fs.mkdirSync(workspaceDir, { recursive: true });

    const result = resolveAuthorizedAgentToolWorkspaceCwd({
      catalog: catalogWithUserWorkspace({
        tenantId: "tenant-a",
        userId: "user-elle",
        agentAssetId: "agent:main",
        workspaceRoot: workspaceDir,
      }),
      actor: { tenantId: "tenant-b", userId: "user-bob" },
      tenantId: "tenant-a",
      userId: "user-elle",
      agentId: "main",
      agentAssetId: "agent:main",
      workspaceRoot: workspaceDir,
    });
    expect(result).toMatchObject({ ok: false, reason: "tenant_mismatch" });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("denies a missing catalog instead of synthesizing an empty one", () => {
    const result = resolveAuthorizedAgentToolWorkspaceCwd({
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      userId: "user-elle",
      agentId: "main",
      workspaceRoot: "/tmp/ws",
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "empty_catalog_synthesis_forbidden",
    });
  });

  it("denies an empty catalog that lacks the workspace record", () => {
    const result = resolveAuthorizedAgentToolWorkspaceCwd({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      userId: "user-elle",
      agentId: "main",
      agentAssetId: "agent:main",
      workspaceRoot: "/tmp/ws",
    });
    expect(result).toMatchObject({ ok: false, reason: "empty_catalog_synthesis_forbidden" });
  });

  it("denies when the catalog has records but not this workspace", () => {
    const result = resolveAuthorizedAgentToolWorkspaceCwd({
      catalog: catalogWithUserWorkspace({
        tenantId: "tenant-a",
        userId: "user-elle",
        agentAssetId: "agent:other",
        workspaceRoot: "/tmp/other",
      }),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      userId: "user-elle",
      agentId: "main",
      agentAssetId: "agent:main",
      workspaceRoot: "/tmp/ws",
    });
    expect(result).toMatchObject({ ok: false, reason: "catalog_record_required" });
  });

  it("accepts an existing seat-owned catalog row for the same agentAssetId", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-tool-cwd-seat-"));
    const workspaceDir = path.join(root, "agents", "main");
    fs.mkdirSync(workspaceDir, { recursive: true });
    const resourceId = "ws:tenant-a:seat:seat-1:asset:agent:main";
    const catalog = withCatalogEntries(createEmptyWorkspaceCatalog(), {
      resource: {
        resourceId,
        resourceType: "workspace",
        tenantId: "tenant-a",
        ownerScope: { kind: "position_owned", seatId: "seat-1", agentAssetId: "agent:main" },
        lifecycleState: "active",
        classification: "agent.tool.cwd",
        governanceVersion: 1,
      },
      binding: {
        bindingId: `${resourceId}:canonical`,
        resourceId,
        role: "canonical",
        locator: workspaceDir,
        state: "active",
        contentVersion: "v1",
      },
    });
    const result = resolveAuthorizedAgentToolWorkspaceCwd({
      catalog,
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      userId: "user-elle",
      agentId: "main",
      agentAssetId: "agent:main",
      workspaceRoot: workspaceDir,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cwd).toBe(fs.realpathSync(workspaceDir));
      expect(result.resourceId).toBe(resourceId);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("denies agentId used as agentAssetId", () => {
    const result = resolveAuthorizedAgentToolWorkspaceCwd({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "tenant-a", userId: "user-elle" },
      tenantId: "tenant-a",
      userId: "user-elle",
      agentId: "main",
      agentAssetId: "main",
      workspaceRoot: "/tmp/ws",
    });
    expect(result).toMatchObject({ ok: false, reason: "agent_asset_id_required" });
  });
});
