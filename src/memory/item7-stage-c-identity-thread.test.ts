import { describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { managedAccessContext } from "./memory-index-access-context.js";
import type { CanonicalMemoryWorkspaceResolver } from "./memory-index-workspace-handle.js";
import {
  createMemoryWorkspaceHandle,
  type MemoryWorkspaceHandle,
  type MemoryWorkspaceLifecycle,
  type MemoryWorkspaceResolveResult,
} from "./memory-workspace-handle.js";
import { getMemorySearchManager } from "./search-manager.js";
import "./test-runtime-mocks.js";

/**
 * Item 7 Stage C identity-thread integration: getMemorySearchManager routes a
 * managed_enterprise access context through the canonical fail-closed resolver
 * BEFORE any manager / scan / index-write, and keeps personal_local / absent on
 * the legacy path. These assertions focus on the fail-closed dispatch (which
 * returns before manager construction, so no workspace/embeddings are needed).
 */

function mint(overrides?: {
  tenantId?: string;
  resourceId?: string;
  lifecycle?: MemoryWorkspaceLifecycle;
}): MemoryWorkspaceHandle {
  const tenantId = overrides?.tenantId ?? "tenant-a";
  const resourceId = overrides?.resourceId ?? "ws-1";
  const result = createMemoryWorkspaceHandle({
    resourceId,
    memoryAssetResourceId: "mem-1",
    tenantId,
    agentAssetId: "aa-1",
    bindingId: "bind-1",
    canonicalObjectKey: `obj://${tenantId}/${resourceId}/memory`,
    governanceVersion: 1,
    fencingToken: "ft-1",
    lifecycle: overrides?.lifecycle ?? "active",
    permissions: {
      search: true,
      ingest: false,
      distill: false,
      prune: false,
      reset: false,
      export: true,
    },
  });
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.handle;
}

function managedCtx(resolver: CanonicalMemoryWorkspaceResolver, tenantId = "tenant-a") {
  const built = managedAccessContext({
    tenantId,
    userId: "user-1",
    resolveCanonicalHandle: resolver,
  });
  if (!built.ok) {
    throw new Error(built.reason);
  }
  return built.context;
}

// Managed binding is honored only on the cogniweave backend. The up-front resolve
// (and its fail-closed denials) run at dispatch before any manager is built, so a
// minimal cogniweave cfg suffices for these dispatch-level assertions.
const MANAGED_CFG = { memory: { backend: "cogniweave" } } as OpenBotConfig;

describe("Item 7 Stage C getMemorySearchManager identity thread + managed fail-closed", () => {
  it("fails closed (catalog miss) for managed and builds no manager", async () => {
    const resolver = vi.fn(
      async (_params: Parameters<CanonicalMemoryWorkspaceResolver>[0]) =>
        ({
          ok: false,
          reasonCode: "missing_workspace_resource",
          reason: "catalog miss",
        }) satisfies MemoryWorkspaceResolveResult,
    );
    const result = await getMemorySearchManager({
      cfg: MANAGED_CFG,
      agentId: "agent-x",
      accessContext: managedCtx(resolver),
    });
    expect(result.manager).toBeNull();
    expect(result.error?.startsWith("managed_catalog_miss")).toBe(true);
    // Identity was threaded to the canonical resolver (not re-guessed from agentId).
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver.mock.calls[0]?.[0]).toMatchObject({
      tenantId: "tenant-a",
      userId: "user-1",
      agentId: "agent-x",
    });
  });

  it("fails closed (ambiguous) for managed", async () => {
    const result = await getMemorySearchManager({
      cfg: MANAGED_CFG,
      agentId: "agent-x",
      accessContext: managedCtx(async () => ({
        ok: false,
        reasonCode: "ambiguous_agent_asset",
        reason: "ambiguous",
      })),
    });
    expect(result.manager).toBeNull();
    expect(result.error?.startsWith("managed_catalog_ambiguous")).toBe(true);
  });

  it("fails closed on a cross-tenant resolved handle", async () => {
    const result = await getMemorySearchManager({
      cfg: MANAGED_CFG,
      agentId: "agent-x",
      accessContext: managedCtx(okResolverCrossTenant()),
    });
    expect(result.manager).toBeNull();
    expect(result.error?.startsWith("managed_tenant_mismatch")).toBe(true);
  });

  it("fails closed (workspace not indexable) on a tombstoned/revoked handle", async () => {
    const result = await getMemorySearchManager({
      cfg: MANAGED_CFG,
      agentId: "agent-x",
      accessContext: managedCtx(async () => ({ ok: true, handle: mint({ lifecycle: "retired" }) })),
    });
    expect(result.manager).toBeNull();
    expect(result.error?.startsWith("managed_workspace_not_indexable")).toBe(true);
  });

  it("never throws on a managed denial (background/gateway stays up, observable reason)", async () => {
    await expect(
      getMemorySearchManager({
        cfg: MANAGED_CFG,
        agentId: "agent-x",
        accessContext: managedCtx(async () => ({
          ok: false,
          reasonCode: "missing_binding",
          reason: "no binding",
        })),
      }),
    ).resolves.toMatchObject({ manager: null });
  });

  it("personal_local / absent access context does NOT invoke the managed resolver or fail closed managed", async () => {
    // No accessContext + memorySearch disabled: legacy path yields a null manager
    // WITHOUT any managed_* error (personal_local compat, never a managed fallback).
    const result = await getMemorySearchManager({ cfg: {} as OpenBotConfig, agentId: "agent-x" });
    expect(result.error?.startsWith("managed_")).not.toBe(true);
  });

  it("fails closed for managed on a non-cogniweave backend (local index isolation deferred; resolver not called)", async () => {
    const resolver = vi.fn(
      async (_params: Parameters<CanonicalMemoryWorkspaceResolver>[0]) =>
        ({ ok: true, handle: mint() }) satisfies MemoryWorkspaceResolveResult,
    );
    const result = await getMemorySearchManager({
      cfg: { memory: { backend: "qmd" } } as OpenBotConfig,
      agentId: "agent-x",
      accessContext: managedCtx(resolver),
    });
    expect(result.manager).toBeNull();
    expect(result.error).toBe("managed_backend_not_cogniweave");
    // Refused at dispatch before resolving: the frozen qmd/builtin local index
    // root is never touched (isolation deferred to its retirement).
    expect(resolver).toHaveBeenCalledTimes(0);
  });
});

function okResolverCrossTenant(): CanonicalMemoryWorkspaceResolver {
  // identity is tenant-a but the resolver returns a handle bound to tenant-b.
  return async () => ({ ok: true, handle: mint({ tenantId: "tenant-b" }) });
}
