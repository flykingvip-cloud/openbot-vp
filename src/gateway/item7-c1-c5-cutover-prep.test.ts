import { describe, expect, it, vi } from "vitest";
import {
  memoryIndexAccessCacheComponent,
  personalLocalAccessContext,
  resolveMemoryIndexAccess,
} from "../memory/memory-index-access-context.js";
import type { CanonicalMemoryWorkspaceResolver } from "../memory/memory-index-workspace-handle.js";
import { buildMemorySearchGovernanceFromCallEntry } from "../memory/memory-search-governance.js";
import {
  createMemoryWorkspaceHandle,
  type MemoryWorkspaceHandle,
  type MemoryWorkspaceLifecycle,
  type MemoryWorkspaceResolveResult,
} from "../memory/memory-workspace-handle.js";
import { ownershipProofForEnterpriseOperationalIdentity } from "./data-governance/ownership-proof.js";
import {
  C1_C5_BATCH_EXPECTATIONS,
  C1_C5_CUTOVER_LOCKS,
  C1_C5_LEDGER_IDS,
  C1_C5_PER_SITE_CHECKLIST,
  C1_C5_SITES,
  MANAGED_ENTERPRISE_SWITCH_PLAN,
  PERSONAL_LOCAL_COMPAT_PLAN,
  RETIREMENT_SCAN_EXPECTED_CHANGE_DRAFT,
  assertC1C5PrepLocks,
  classifyBackgroundIdentityDefer,
  isC1C5ProductionCutoverAuthorized,
  plannedManagedIndexCacheIsolationKey,
  plannedPersonalLocalCacheIsolationKey,
  siteByLedgerId,
} from "./item7-c1-c5-cutover-prep.js";
import { evaluateStageCManagedIdentityShadow } from "./item7-stage-c-identity-shadow.js";

function mint(overrides?: {
  tenantId?: string;
  resourceId?: string;
  fencingToken?: string;
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
    fencingToken: overrides?.fencingToken ?? "ft-1",
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

function systemOwnedGovernance() {
  return {
    tenantId: "tenant-a",
    ownershipProof: ownershipProofForEnterpriseOperationalIdentity({ tenantId: "tenant-a" }),
  };
}

describe("C1–C5 cutover PREP locks (production switch is not executed)", () => {
  it("pins remaining=10, liveWriteWatchIndex=10, implementationVerified=false, LIVE=forbidden", () => {
    const locks = assertC1C5PrepLocks();
    expect(locks.remaining).toBe(10);
    expect(locks.liveWriteWatchIndex).toBe(10);
    expect(locks.frozenWriteWatchIndex).toBe(38);
    expect(locks.retiredThisChange).toBe(0);
    expect(locks.implementationVerified).toBe(false);
    expect(locks.deployAuthorized).toBe(false);
    expect(locks.live).toBe("forbidden");
    expect(locks.item7).toBe("not-met");
    expect(locks.productionSwitch).toBe(false);
    expect(locks.scanModified).toBe(false);
    expect(locks.phase1bExecutionBlocked).toBe(true);
    expect(locks.i3Executed).toBe(false);
    expect(isC1C5ProductionCutoverAuthorized()).toBe(false);
    expect(C1_C5_CUTOVER_LOCKS.productionSwitch).toBe(false);
  });

  it("records five legacy sites with trustedIdentityAtCallSite=false and productionSwitch=false", () => {
    expect(C1_C5_SITES).toHaveLength(5);
    expect(C1_C5_LEDGER_IDS).toEqual(["S30", "S31", "S32", "S36", "S37"]);
    for (const site of C1_C5_SITES) {
      expect(site.trustedIdentityAtCallSite).toBe(false);
      expect(site.productionSwitch).toBe(false);
      expect(site.staysLegacy).toBe(true);
      expect(site.symbol).toBe("resolveAgentWorkspaceDir");
      expect(site.op).toBe("index");
      expect(siteByLedgerId(site.ledgerId).label).toBe(site.label);
    }
    expect(MANAGED_ENTERPRISE_SWITCH_PLAN.productionSwitch).toBe(false);
    expect(PERSONAL_LOCAL_COMPAT_PLAN.neverManagedFallback).toBe(true);
    expect(PERSONAL_LOCAL_COMPAT_PLAN.productionSwitch).toBe(false);
  });

  it("keeps the per-site checklist unexecuted and the scan draft unapplied", () => {
    expect(C1_C5_PER_SITE_CHECKLIST).toHaveLength(5);
    for (const row of C1_C5_PER_SITE_CHECKLIST) {
      expect(row.executed).toBe(false);
    }
    expect(RETIREMENT_SCAN_EXPECTED_CHANGE_DRAFT.status).toBe("draft-only");
    expect(RETIREMENT_SCAN_EXPECTED_CHANGE_DRAFT.canonicalScanModified).toBe(false);
    expect(RETIREMENT_SCAN_EXPECTED_CHANGE_DRAFT.applyForbidden).toBe(true);
    expect(RETIREMENT_SCAN_EXPECTED_CHANGE_DRAFT.projectedIfC1C5Retired.remaining).toBe(5);
  });
});

describe("C1–C5 tenant/resource/epoch cache isolation (planned keys, no production writes)", () => {
  it("isolates same-named agents across tenants", () => {
    const a = plannedManagedIndexCacheIsolationKey({
      tenantId: "tenant-a",
      resourceId: "ws-1",
      fencingToken: "ft-1",
      governanceEpoch: 1,
      agentId: "main",
    });
    const b = plannedManagedIndexCacheIsolationKey({
      tenantId: "tenant-b",
      resourceId: "ws-1",
      fencingToken: "ft-1",
      governanceEpoch: 1,
      agentId: "main",
    });
    expect(a).not.toBe(b);
    expect(a).toContain("tenant-a");
    expect(b).toContain("tenant-b");
  });

  it("isolates a resourceId rebind (never reuses a stale instance)", () => {
    const first = plannedManagedIndexCacheIsolationKey({
      tenantId: "tenant-a",
      resourceId: "ws-1",
      fencingToken: "ft-1",
      governanceEpoch: 1,
      agentId: "main",
    });
    const rebound = plannedManagedIndexCacheIsolationKey({
      tenantId: "tenant-a",
      resourceId: "ws-2",
      fencingToken: "ft-1",
      governanceEpoch: 1,
      agentId: "main",
    });
    expect(first).not.toBe(rebound);
  });

  it("isolates stale epoch / fencing tokens", () => {
    const live = plannedManagedIndexCacheIsolationKey({
      tenantId: "tenant-a",
      resourceId: "ws-1",
      fencingToken: "ft-1",
      governanceEpoch: 1,
      agentId: "main",
    });
    const staleFence = plannedManagedIndexCacheIsolationKey({
      tenantId: "tenant-a",
      resourceId: "ws-1",
      fencingToken: "ft-2",
      governanceEpoch: 1,
      agentId: "main",
    });
    const staleEpoch = plannedManagedIndexCacheIsolationKey({
      tenantId: "tenant-a",
      resourceId: "ws-1",
      fencingToken: "ft-1",
      governanceEpoch: 2,
      agentId: "main",
    });
    expect(live).not.toBe(staleFence);
    expect(live).not.toBe(staleEpoch);
    expect(staleFence).not.toBe(staleEpoch);
  });

  it("never collides personal_local with a managed namespace", () => {
    const personal = plannedPersonalLocalCacheIsolationKey("main");
    const managed = plannedManagedIndexCacheIsolationKey({
      tenantId: "tenant-a",
      resourceId: "ws-1",
      fencingToken: "ft-1",
      governanceEpoch: 1,
      agentId: "main",
    });
    expect(personal).toBe("personal_local:main");
    expect(managed).not.toBe(personal);
    expect(memoryIndexAccessCacheComponent({ profile: "personal_local" })).toBe("personal_local");
  });
});

describe("C1–C5 batch fail-closed foundation (shared across sites, no production writes)", () => {
  it("catalog miss → managed_deny / managed_catalog_miss on every C1–C5 ledger", async () => {
    const expected = C1_C5_BATCH_EXPECTATIONS.find((row) => row.caseId === "catalog_miss");
    expect(expected?.productionWrite).toBe(false);
    for (const ledgerId of C1_C5_LEDGER_IDS) {
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
        ledgerId,
        resolveCanonicalHandle: resolver,
      });
      expect(result.outcome).toBe("managed_deny");
      expect(result.reasonCode).toBe("managed_catalog_miss");
      expect(result.managedLocator).toBeNull();
      expect(result.ledgerId).toBe(ledgerId);
    }
  });

  it("tenant mismatch → managed_deny on every C1–C5 ledger", async () => {
    for (const ledgerId of C1_C5_LEDGER_IDS) {
      const result = await evaluateStageCManagedIdentityShadow({
        governance: governanceFixture("tenant-a", "user-1"),
        agentId: "agent-x",
        ledgerId,
        resolveCanonicalHandle: async () =>
          ({
            ok: true,
            handle: mint({ tenantId: "tenant-b" }),
          }) satisfies MemoryWorkspaceResolveResult,
      });
      expect(result.outcome).toBe("managed_deny");
      expect(result.reasonCode).toBe("managed_tenant_mismatch");
      expect(result.managedLocator).toBeNull();
    }
  });

  it("ownership mismatch (system-owned proof) → managed_deny / managed_grant_denied", async () => {
    const resolver = vi.fn(
      async () => ({ ok: true, handle: mint() }) satisfies MemoryWorkspaceResolveResult,
    );
    const result = await evaluateStageCManagedIdentityShadow({
      governance: systemOwnedGovernance(),
      agentId: "agent-x",
      resolveCanonicalHandle: resolver,
    });
    expect(result.outcome).toBe("managed_deny");
    expect(result.reasonCode).toBe("managed_grant_denied");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("membership/grant missing (seat, no acting user) → managed_defer, resolver not reached", async () => {
    for (const ledgerId of C1_C5_LEDGER_IDS) {
      const resolver = vi.fn(
        async () => ({ ok: true, handle: mint() }) satisfies MemoryWorkspaceResolveResult,
      );
      const result = await evaluateStageCManagedIdentityShadow({
        governance: seatGovernanceFixture(),
        agentId: "agent-x",
        ledgerId,
        resolveCanonicalHandle: resolver,
      });
      expect(result.outcome).toBe("managed_defer");
      expect(result.reasonCode).toBe("managed_membership_missing");
      expect(resolver).not.toHaveBeenCalled();
    }
  });

  it("stale fencing token → managed_deny / managed_workspace_not_indexable", async () => {
    for (const ledgerId of C1_C5_LEDGER_IDS) {
      const result = await evaluateStageCManagedIdentityShadow({
        governance: governanceFixture(),
        agentId: "agent-x",
        ledgerId,
        resolveCanonicalHandle: async () =>
          ({
            ok: false,
            reasonCode: "stale_fencing_token",
            reason: "stale epoch",
          }) satisfies MemoryWorkspaceResolveResult,
      });
      expect(result.outcome).toBe("managed_deny");
      expect(result.reasonCode).toBe("managed_workspace_not_indexable");
      expect(result.managedLocator).toBeNull();
    }
  });

  it("workspace not indexable (retired/purged/moving/recovery_required) → managed_deny", async () => {
    const lifecycles: MemoryWorkspaceLifecycle[] = [
      "retired",
      "purged",
      "moving",
      "recovery_required",
    ];
    for (const lifecycle of lifecycles) {
      const result = await evaluateStageCManagedIdentityShadow({
        governance: governanceFixture(),
        agentId: "agent-x",
        ledgerId: "S32",
        resolveCanonicalHandle: async () =>
          ({
            ok: true,
            handle: mint({ lifecycle }),
          }) satisfies MemoryWorkspaceResolveResult,
      });
      expect(result.outcome).toBe("managed_deny");
      expect(result.reasonCode).toBe("managed_workspace_not_indexable");
    }
  });

  it("background identity defer when no server-built governance is present", () => {
    expect(
      classifyBackgroundIdentityDefer({
        hasServerBuiltGovernance: false,
        provenanceSource: "background",
      }),
    ).toBe("managed_background_deferred");
    expect(
      classifyBackgroundIdentityDefer({
        hasServerBuiltGovernance: false,
        provenanceSource: "call-entry",
      }),
    ).toBe("managed_identity_required");
  });

  it("personal_local regression: short-circuits without calling the canonical resolver", async () => {
    const resolver = vi.fn(
      async () => ({ ok: true, handle: mint() }) satisfies MemoryWorkspaceResolveResult,
    );
    const access = await resolveMemoryIndexAccess(personalLocalAccessContext(), {
      agentId: "agent-x",
      ledgerId: "S32",
    });
    expect(access.ok).toBe(true);
    if (access.ok) {
      expect(access.access.profile).toBe("personal_local");
    }
    expect(resolver).not.toHaveBeenCalled();
    expect(PERSONAL_LOCAL_COMPAT_PLAN.neverManagedFallback).toBe(true);
  });

  it("managed success still does not authorize a production switch", async () => {
    const resolver: CanonicalMemoryWorkspaceResolver = async () =>
      ({ ok: true, handle: mint() }) satisfies MemoryWorkspaceResolveResult;
    const result = await evaluateStageCManagedIdentityShadow({
      governance: governanceFixture(),
      agentId: "agent-x",
      resolveCanonicalHandle: resolver,
    });
    expect(result.outcome).toBe("managed_success");
    expect(result.managedLocator).toBe("obj://tenant-a/ws-1/memory");
    expect(isC1C5ProductionCutoverAuthorized()).toBe(false);
    expect(MANAGED_ENTERPRISE_SWITCH_PLAN.productionSwitch).toBe(false);
  });
});
