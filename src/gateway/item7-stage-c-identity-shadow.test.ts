import { describe, expect, it, vi } from "vitest";
import type { CanonicalMemoryWorkspaceResolver } from "../memory/memory-index-workspace-handle.js";
import { buildMemorySearchGovernanceFromCallEntry } from "../memory/memory-search-governance.js";
import {
  createMemoryWorkspaceHandle,
  type MemoryWorkspaceHandle,
  type MemoryWorkspaceLifecycle,
  type MemoryWorkspaceResolveResult,
} from "../memory/memory-workspace-handle.js";
import {
  evaluateStageCManagedIdentityShadow,
  isStageCIdentityShadowEnabled,
  runStageCManagedIdentityShadowIfEnabled,
} from "./item7-stage-c-identity-shadow.js";

function mint(overrides?: {
  tenantId?: string;
  lifecycle?: MemoryWorkspaceLifecycle;
}): MemoryWorkspaceHandle {
  const tenantId = overrides?.tenantId ?? "tenant-a";
  const result = createMemoryWorkspaceHandle({
    resourceId: "ws-1",
    memoryAssetResourceId: "mem-1",
    tenantId,
    agentAssetId: "aa-1",
    bindingId: "bind-1",
    canonicalObjectKey: `obj://${tenantId}/ws-1/memory`,
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

function governanceFixture(tenantId = "tenant-a", userId = "user-1") {
  // User-owned governance (no seat) -> deriveManagedAccessContextFromGovernance resolves the userId
  // directly, reaching the canonical resolver.
  const g = buildMemorySearchGovernanceFromCallEntry({ tenantId, userId });
  if (!g) {
    throw new Error("governance fixture build failed");
  }
  return g;
}

function seatGovernanceFixture(tenantId = "tenant-a", seatId = "seat-1") {
  const g = buildMemorySearchGovernanceFromCallEntry({ tenantId, seatId });
  if (!g) {
    throw new Error("seat governance fixture build failed");
  }
  return g;
}

const ENABLED_ENV = { OPENBOT_ITEM7_STAGE_C_IDENTITY_SHADOW: "1" } as NodeJS.ProcessEnv;

describe("Item 7 Stage C Phase C managed identity shadow (shadow-only, read-only)", () => {
  it("is disabled by default and enabled only via the explicit env flag", () => {
    expect(isStageCIdentityShadowEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isStageCIdentityShadowEnabled(ENABLED_ENV)).toBe(true);
    expect(
      isStageCIdentityShadowEnabled({
        OPENBOT_ITEM7_STAGE_C_IDENTITY_SHADOW: "0",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("records managed_success when the canonical handle resolves, WITHOUT building a manager", async () => {
    const resolver = vi.fn(
      async (_p: Parameters<CanonicalMemoryWorkspaceResolver>[0]) =>
        ({ ok: true, handle: mint() }) satisfies MemoryWorkspaceResolveResult,
    );
    const result = await evaluateStageCManagedIdentityShadow({
      governance: governanceFixture(),
      agentId: "agent-x",
      resolveCanonicalHandle: resolver,
    });
    expect(result.outcome).toBe("managed_success");
    expect(result.managedLocator).toBe("obj://tenant-a/ws-1/memory");
    expect(result.ledgerId).toBe("S32");
    expect(resolver).toHaveBeenCalledTimes(1);
    // Identity threaded to the resolver, not guessed from agentId.
    expect(resolver.mock.calls[0]?.[0]).toMatchObject({ tenantId: "tenant-a", userId: "user-1" });
  });

  it("records managed_deny on a canonical catalog miss (no host fallback)", async () => {
    const resolver = vi.fn(
      async () =>
        ({
          ok: false,
          reasonCode: "missing_workspace_resource",
          reason: "catalog miss",
        }) satisfies MemoryWorkspaceResolveResult,
    );
    const result = await evaluateStageCManagedIdentityShadow({
      governance: governanceFixture(),
      agentId: "agent-x",
      resolveCanonicalHandle: resolver,
    });
    expect(result.outcome).toBe("managed_deny");
    expect(result.reasonCode).toBe("managed_catalog_miss");
    expect(result.managedLocator).toBeNull();
  });

  it("records managed_deny (tenant mismatch) when the resolved handle crosses tenant", async () => {
    const resolver = vi.fn(
      async () =>
        ({
          ok: true,
          handle: mint({ tenantId: "tenant-b" }),
        }) satisfies MemoryWorkspaceResolveResult,
    );
    const result = await evaluateStageCManagedIdentityShadow({
      governance: governanceFixture("tenant-a", "user-1"),
      agentId: "agent-x",
      resolveCanonicalHandle: resolver,
    });
    expect(result.outcome).toBe("managed_deny");
    expect(result.reasonCode).toBe("managed_tenant_mismatch");
    expect(result.managedLocator).toBeNull();
  });

  it("defers a seat-owned governance when no acting user is threaded (not a coverage gap)", async () => {
    const resolver = vi.fn(
      async () => ({ ok: true, handle: mint() }) satisfies MemoryWorkspaceResolveResult,
    );
    const result = await evaluateStageCManagedIdentityShadow({
      governance: seatGovernanceFixture(),
      agentId: "agent-x",
      resolveCanonicalHandle: resolver,
    });
    expect(result.outcome).toBe("managed_defer");
    expect(result.reasonCode).toBe("managed_membership_missing");
    // No acting user -> the canonical resolver is never reached (fail-closed, no scan/read).
    expect(resolver).not.toHaveBeenCalled();
  });

  it("resolves a seat-owned governance to managed_success once an acting user is threaded", async () => {
    const resolver = vi.fn(
      async () => ({ ok: true, handle: mint() }) satisfies MemoryWorkspaceResolveResult,
    );
    const result = await evaluateStageCManagedIdentityShadow({
      governance: seatGovernanceFixture(),
      agentId: "agent-x",
      authenticatedUserId: "user-1",
      resolveCanonicalHandle: resolver,
    });
    expect(result.outcome).toBe("managed_success");
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("runStageCManagedIdentityShadowIfEnabled is a no-op (null) when disabled", async () => {
    const resolver = vi.fn(
      async () => ({ ok: true, handle: mint() }) satisfies MemoryWorkspaceResolveResult,
    );
    const result = await runStageCManagedIdentityShadowIfEnabled({
      governance: governanceFixture(),
      agentId: "agent-x",
      env: {} as NodeJS.ProcessEnv,
      resolveCanonicalHandle: resolver,
    });
    expect(result).toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("defers (no coverage gap) when enabled but no server-built governance is present", async () => {
    const result = await runStageCManagedIdentityShadowIfEnabled({
      governance: undefined,
      agentId: "agent-x",
      env: ENABLED_ENV,
    });
    expect(result?.outcome).toBe("managed_defer");
    expect(result?.reasonCode).toBe("managed_identity_required");
    expect(result?.managedLocator).toBeNull();
  });

  it("runs the shadow when enabled and returns the managed success outcome", async () => {
    const resolver = vi.fn(
      async () => ({ ok: true, handle: mint() }) satisfies MemoryWorkspaceResolveResult,
    );
    const result = await runStageCManagedIdentityShadowIfEnabled({
      governance: governanceFixture(),
      agentId: "agent-x",
      env: ENABLED_ENV,
      resolveCanonicalHandle: resolver,
    });
    expect(result?.outcome).toBe("managed_success");
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});
