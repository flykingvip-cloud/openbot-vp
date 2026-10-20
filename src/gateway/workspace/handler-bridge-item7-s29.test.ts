import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildUserOwnedWorkspaceCatalogEntry } from "../workspace-resolver/builders.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
} from "../workspace-resolver/catalog.js";
import { resolveWorkspaceLocator } from "../workspace-resolver/strict-locator.js";

const resolveTenantContextMock = vi.hoisted(() => vi.fn());
const resolveEmployeeWorkbenchActorMock = vi.hoisted(() => vi.fn());
const loadExistingGovernedWorkspaceIdentityMock = vi.hoisted(() => vi.fn());
const scheduleGatewayW2ResolvedShadowMock = vi.hoisted(() => vi.fn());

vi.mock("../tenant-context.js", () => ({
  resolveTenantContextForSessionStore: (...args: unknown[]) => resolveTenantContextMock(...args),
  resolveTenantContext: (...args: unknown[]) => resolveTenantContextMock(...args),
  resolveAgentWorkspaceDirForClient: async () => "/tmp/openbot-item7-cr-locator/asset-alpha",
  resolveControlPlaneStorePathForTenantId: () => undefined,
  resolveControlPlaneStorePathForClient: async () => undefined,
}));

vi.mock("../employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: (...args: unknown[]) => resolveEmployeeWorkbenchActorMock(...args),
}));

vi.mock("../data-governance/workspace-catalog-projection.js", () => ({
  loadExistingGovernedWorkspaceIdentity: (...args: unknown[]) =>
    loadExistingGovernedWorkspaceIdentityMock(...args),
  ensureGovernedWorkspaceCatalogIdentity: async () => ({}),
}));

vi.mock("../gateway-w2-shadow.js", () => ({
  scheduleGatewayW2ResolvedShadow: (...args: unknown[]) =>
    scheduleGatewayW2ResolvedShadowMock(...args),
}));

const managedCfg = { data: { mode: "managed" as const } };
const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "handler-bridge.ts"),
  "utf8",
);

const { resolveAuthorizedToolCwdDetailed, resolveTrustedAgentLocator } =
  await import("./handler-bridge.js");

function completeCatalog(workspaceRoot: string) {
  const entry = buildUserOwnedWorkspaceCatalogEntry({
    tenantId: "tenant-a",
    userId: "user-elle",
    agentAssetId: "asset-alpha",
    workspaceRoot,
  });
  const catalog = new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog().snapshot(),
    resources: { [entry.resource.resourceId]: entry.resource },
    bindings: { [entry.binding.bindingId]: entry.binding },
  });
  return { entry, catalog };
}

describe("Item 7 batch 9 S29 trusted agent locator", () => {
  beforeEach(() => {
    resolveTenantContextMock.mockReset();
    resolveEmployeeWorkbenchActorMock.mockReset();
    loadExistingGovernedWorkspaceIdentityMock.mockReset();
    scheduleGatewayW2ResolvedShadowMock.mockReset();
  });

  it("wires S29 through full trusted locator query (not cfg-only) and keeps ForClient retired", () => {
    expect(source).toContain("resolveAgentsHandlerWorkspaceLocator");
    expect(source).toContain('purpose: "trusted.agent.locator"');
    expect(source).toContain("resolveTrustedAgentLocator");
    expect(source).not.toContain("resolveAgentWorkspaceDirForClient");
    expect(source).not.toMatch(/resolveWorkspaceLocator\(\{\s*cfg:\s*params\.cfg\s*\}\)/);
    expect(source).toContain("reasonCode=");
    // Incomplete query still deny-closes at the strict locator.
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

  it("fail-before: missing tenant context rejects trusted agent locator", async () => {
    resolveTenantContextMock.mockResolvedValue(null);
    await expect(
      resolveTrustedAgentLocator({
        client: null,
        agentId: "main",
        cfg: managedCfg,
      }),
    ).rejects.toThrow(/missing_tenant_context/);
  });

  it("surfaces the S29 reasonCode when managed cwd authorization fails", async () => {
    resolveTenantContextMock.mockResolvedValue({
      tenantId: "tenant-a",
      userId: "user-elle",
      domain: "enterprise",
    });
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({ userId: "user-elle" });
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({});
    const resolved = await resolveAuthorizedToolCwdDetailed({
      client: { user: "elle@acme.com" } as never,
      cfg: managedCfg,
      userId: "user-elle",
      agentId: "research",
    });
    expect(resolved.cwd).toBeNull();
    expect(resolved.reasonCode).toMatch(/catalog_projection_miss|missing_agent_asset|catalog_miss/);
    expect(resolved.reasonCode).not.toBe("workspace_authorization_failed");
  });

  it("fail-before: incomplete catalog/asset rejects with precise reasonCode (not missing_grant)", async () => {
    resolveTenantContextMock.mockResolvedValue({
      tenantId: "tenant-a",
      userId: "user-elle",
      domain: "enterprise",
    });
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({ userId: "user-elle" });
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({});
    await expect(
      resolveTrustedAgentLocator({
        client: { user: "elle@acme.com" } as never,
        agentId: "research",
        cfg: managedCfg,
      }),
    ).rejects.toThrow(
      /catalog_projection_miss|missing_agent_asset|catalog_miss|missing_tenant|missing_actor/,
    );
  });

  it("pass-after resolves the unique catalog locator when the complete query is provided", async () => {
    const { entry, catalog } = completeCatalog("/var/workspaces/tenant-a/asset-alpha");
    resolveTenantContextMock.mockResolvedValue({
      tenantId: "tenant-a",
      userId: "user-elle",
      domain: "enterprise",
    });
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({ userId: "user-elle" });
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({
      catalog,
      agentAssetId: "asset-alpha",
    });

    const locator = await resolveTrustedAgentLocator({
      client: { user: "elle@acme.com" } as never,
      agentId: "research",
      cfg: managedCfg,
    });
    expect(locator).toBe("/var/workspaces/tenant-a/asset-alpha");
    expect(locator).toBe(entry.resource ? "/var/workspaces/tenant-a/asset-alpha" : locator);
  });

  it("rejects cross-tenant resource access even when actor ids match", () => {
    const foreign = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-b",
      userId: "user-elle",
      agentAssetId: "asset-alpha",
      workspaceRoot: "/var/workspaces/tenant-b/asset-alpha",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources: { [foreign.resource.resourceId]: foreign.resource },
      bindings: { [foreign.binding.bindingId]: foreign.binding },
    });
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
          grant: { kind: "user" as const, subjectId: "user-elle", purpose: "item7-batch9-s29" },
        },
        resourceId: foreign.resource.resourceId,
        agentAssetId: "asset-alpha",
        catalog,
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "tenant_mismatch", failClosed: true });
  });

  it("keeps ForClient retired (rollback does not rewrite freeze to zero)", () => {
    expect(source).not.toContain("resolveAgentWorkspaceDirForClient");
    expect(source).toContain("resolveAgentsHandlerWorkspaceLocator");
    expect(source).toContain("resolveTrustedAgentLocator");
  });
});
