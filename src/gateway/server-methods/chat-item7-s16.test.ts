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
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "chat.ts"),
  "utf8",
);

describe("Item 7 batch 8 S16 chat mention client lookup", () => {
  it("replaces S16 ForClient with fail-closed resolveWorkspaceLocator and keeps host reads", () => {
    const lines = source.split(/\n/);
    expect(source).toContain("resolveWorkspaceLocator");
    expect(source).not.toContain("resolveAgentWorkspaceDirForClient");
    expect(lines[1016]).toContain("resolveEmployeeBuiltinStewardWorkspaceDir");
    expect(lines[1025]).toContain("resolveAgentWorkspaceDir");
    expect(lines[1838]).toContain("resolveWorkspaceLocator");
    expect(lines[1838]).toContain("r.ok");
    expect(lines[1838]).toContain("null");
    expect(lines[1840]).toContain("resolveAgentWorkspaceDir");
    expect(
      resolveWorkspaceLocator({
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "missing_tenant_context", failClosed: true });
    expect(
      resolveWorkspaceLocator({
        cfg: managedCfg,
        agentId: "main",
      }),
    ).toMatchObject({ ok: false, reasonCode: "agent_id_slug_query_forbidden", failClosed: true });
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
        grant: { kind: "user" as const, subjectId: "user-elle", purpose: "item7-batch8-s16" },
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
