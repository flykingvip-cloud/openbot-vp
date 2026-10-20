import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildUserOwnedWorkspaceCatalogEntry } from "../../gateway/workspace-resolver/builders.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
} from "../../gateway/workspace-resolver/catalog.js";
import { resolveWorkspaceLocator } from "../../gateway/workspace-resolver/strict-locator.js";
import { getAgentLocalStatuses } from "./agents.js";

vi.mock("../../gateway/session-utils.js", () => ({
  listAgentsForGateway: () => ({
    defaultId: "main",
    agents: [{ id: "main", name: "Main" }],
  }),
}));

vi.mock("../../config/sessions.js", () => ({
  resolveStorePath: () => "/tmp/item7-s04-sessions.json",
  loadSessionStore: () => ({}),
}));

const managedCfg = { data: { mode: "managed" as const } };

describe("Item 7 batch 1 S04 status-all agents", () => {
  it("fail-closes workspaceDir without TenantContext and does not call resolveAgentWorkspaceDir", async () => {
    const source = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "agents.ts"),
      "utf8",
    );
    expect(source).toContain("resolveWorkspaceLocator");
    expect(source).not.toContain("resolveAgentWorkspaceDir");

    const result = await getAgentLocalStatuses(managedCfg);
    expect(result.agents[0]?.workspaceDir).toBeNull();
    expect(
      resolveWorkspaceLocator({
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "missing_tenant_context", failClosed: true });
  });

  it("pass-after resolves the unique catalog locator when the complete query is provided", async () => {
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
    const attempt = {
      tenantContext: {
        tenantId: "tenant-a",
        userId: "user-elle",
        domain: "enterprise" as const,
      },
      tenantId: "tenant-a",
      actor: {
        userId: "user-elle",
        grant: { kind: "user" as const, subjectId: "user-elle", purpose: "item7-batch1-s04" },
      },
      resourceId: entry.resource.resourceId,
      agentAssetId: "asset-alpha",
      catalog,
      cfg: managedCfg,
    };
    const located = resolveWorkspaceLocator(attempt);
    expect(located.ok).toBe(true);
    if (!located.ok) {
      return;
    }
    const result = await getAgentLocalStatuses(managedCfg, attempt);
    expect(result.agents[0]?.workspaceDir).toBe("/var/workspaces/tenant-a/asset-alpha");
    expect(located.handle.locator).toBe("/var/workspaces/tenant-a/asset-alpha");
  });
});
