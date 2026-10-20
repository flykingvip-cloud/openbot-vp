import { describe, expect, it, vi } from "vitest";
import {
  deriveManagedMemoryIndexNamespace,
  guardedMemoryIndexStart,
  ITEM7_STAGE_C_LEDGER_IDS,
  type CanonicalMemoryWorkspaceResolver,
  type Item7StageCLedgerId,
  type MemoryIndexTrustedIdentity,
  resolveMemoryIndexWorkspaceHandle,
  type ResolveMemoryIndexWorkspaceHandleParams,
} from "./memory-index-workspace-handle.js";
import {
  createMemoryWorkspaceHandle,
  type MemoryWorkspaceHandle,
  type MemoryWorkspaceLifecycle,
  type MemoryWorkspaceResolveResult,
} from "./memory-workspace-handle.js";

// ── test fixtures ────────────────────────────────────────────────────────────

/** Mint a branded MemoryWorkspaceHandle for tests; throws if construction is denied. */
function mint(overrides?: {
  tenantId?: string;
  resourceId?: string;
  memoryAssetResourceId?: string;
  canonicalObjectKey?: string;
  lifecycle?: MemoryWorkspaceLifecycle;
  agentAssetId?: string;
}): MemoryWorkspaceHandle {
  const tenantId = overrides?.tenantId ?? "tenant-a";
  const resourceId = overrides?.resourceId ?? "ws-res-1";
  const result = createMemoryWorkspaceHandle({
    resourceId,
    memoryAssetResourceId: overrides?.memoryAssetResourceId ?? "mem-res-1",
    tenantId,
    agentAssetId: overrides?.agentAssetId ?? "aa-1",
    bindingId: "bind-1",
    canonicalObjectKey: overrides?.canonicalObjectKey ?? `obj://${tenantId}/${resourceId}/memory`,
    governanceVersion: 1,
    fencingToken: "ft-1",
    lifecycle: overrides?.lifecycle ?? "active",
    // DARK permissions: search + export only. Compatible with retired/purged handles too.
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
    throw new Error(`test handle mint failed: ${result.reason}`);
  }
  return result.handle;
}

function okResolver(handle: MemoryWorkspaceHandle): CanonicalMemoryWorkspaceResolver {
  return async () => ({ ok: true, handle }) satisfies MemoryWorkspaceResolveResult;
}

function denyResolver(
  reasonCode: Extract<MemoryWorkspaceResolveResult, { ok: false }>["reasonCode"],
  reason: string,
): CanonicalMemoryWorkspaceResolver {
  return async () => ({ ok: false, reasonCode, reason }) satisfies MemoryWorkspaceResolveResult;
}

function trustedIdentity(
  overrides?: Partial<MemoryIndexTrustedIdentity>,
): MemoryIndexTrustedIdentity {
  const tenantId = overrides?.tenantId ?? "tenant-a";
  return {
    tenantId,
    userId: overrides?.userId ?? "user-1",
    actor: overrides?.actor ?? {
      userId: "user-1",
      tenantId,
      grant: { grantId: "g-1", role: "owner" },
    },
    resourceId: overrides?.resourceId,
    agentAssetId: overrides?.agentAssetId,
    expectedFencingToken: overrides?.expectedFencingToken,
    configuredCloudTenantId: overrides?.configuredCloudTenantId,
  };
}

function managedParams(
  ledgerId: Item7StageCLedgerId,
  over?: Partial<ResolveMemoryIndexWorkspaceHandleParams>,
): ResolveMemoryIndexWorkspaceHandleParams {
  return {
    op: "index",
    ledgerId,
    agentId: "main",
    securityProfile: "managed_enterprise",
    identity: trustedIdentity(),
    resolveCanonicalHandle: okResolver(mint()),
    ...over,
  };
}

// ── per-site matrix (each of C1..C5 independently covered, §七) ───────────────

describe.each(ITEM7_STAGE_C_LEDGER_IDS)("Item 7 Stage C op=index site %s", (ledgerId) => {
  it("personal_local returns the explicit security-profile-gated compat locator", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle({
      op: "index",
      ledgerId,
      agentId: "main",
      securityProfile: "personal_local",
      personalLocalCompatLocator: () => "/home/user/.openbot/workspace-main",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.profile).toBe("personal_local");
    expect(res.mode).toBe("legacy-compat");
    expect(res.locator).toBe("/home/user/.openbot/workspace-main");
    expect(res.handle).toBeNull();
  });

  it("personal_local fails closed when the compat locator provider is missing", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle({
      op: "index",
      ledgerId,
      agentId: "main",
      securityProfile: "personal_local",
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("personal_local_compat_locator_missing");
  });

  it("personal_local fails closed when the compat locator is empty (no default workspace)", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle({
      op: "index",
      ledgerId,
      agentId: "main",
      securityProfile: "personal_local",
      personalLocalCompatLocator: () => "   ",
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("personal_local_compat_locator_empty");
  });

  it("managed_enterprise fails closed with missing tenant context and never falls back to personal_local", async () => {
    const compat = vi.fn(() => "/home/user/.openbot/workspace-main");
    const res = await resolveMemoryIndexWorkspaceHandle({
      op: "index",
      ledgerId,
      agentId: "main",
      securityProfile: "managed_enterprise",
      identity: null,
      // Provided on purpose: managed must NOT consult the personal compat path.
      personalLocalCompatLocator: compat,
      resolveCanonicalHandle: okResolver(mint()),
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_requires_trusted_identity");
    expect(res.profile).toBe("managed_enterprise");
    expect(compat).not.toHaveBeenCalled();
  });

  it("managed_enterprise fails closed when actor/grant identity is absent", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle(
      managedParams(ledgerId, {
        identity: {
          tenantId: "tenant-a",
          userId: "user-1",
          // actor cast away to model a caller that omitted the server-trusted actor/grant
          actor: undefined as unknown as MemoryIndexTrustedIdentity["actor"],
        },
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_requires_trusted_identity");
  });

  it("managed_enterprise fails closed when the canonical resolver port is missing", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle(
      managedParams(ledgerId, { resolveCanonicalHandle: undefined }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_requires_canonical_resolver");
  });

  it("managed_enterprise propagates a Catalog miss denial (no host fallback)", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle(
      managedParams(ledgerId, {
        resolveCanonicalHandle: denyResolver(
          "missing_workspace_resource",
          "catalog miss; do not synthesize a workspace identity",
        ),
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_resolver_denied");
    expect(res.canonicalReasonCode).toBe("missing_workspace_resource");
  });

  it("managed_enterprise propagates an ambiguous-agent-asset denial", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle(
      managedParams(ledgerId, {
        resolveCanonicalHandle: denyResolver(
          "ambiguous_agent_asset",
          "agent asset is not uniquely bound",
        ),
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_resolver_denied");
    expect(res.canonicalReasonCode).toBe("ambiguous_agent_asset");
  });

  it("managed_enterprise fails closed on a cross-tenant actor", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle(
      managedParams(ledgerId, {
        identity: trustedIdentity({
          tenantId: "tenant-a",
          actor: { userId: "user-1", tenantId: "tenant-b" },
        }),
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_identity_actor_tenant_mismatch");
  });

  it("managed_enterprise fails closed when the resolved handle is bound to another tenant", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle(
      managedParams(ledgerId, {
        identity: trustedIdentity({ tenantId: "tenant-a" }),
        resolveCanonicalHandle: okResolver(mint({ tenantId: "tenant-b" })),
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_cross_tenant_handle");
  });

  it("managed_enterprise propagates an id-mismatch (resourceId not owned) denial", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle(
      managedParams(ledgerId, {
        resolveCanonicalHandle: denyResolver(
          "missing_workspace_resource",
          "workspace resource is not bound to identity.agentAssetId",
        ),
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_resolver_denied");
    expect(res.canonicalReasonCode).toBe("missing_workspace_resource");
  });

  it("managed_enterprise propagates a missing membership/binding denial", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle(
      managedParams(ledgerId, {
        resolveCanonicalHandle: denyResolver(
          "missing_binding",
          "workspace resource must have one active canonical binding",
        ),
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_resolver_denied");
    expect(res.canonicalReasonCode).toBe("missing_binding");
  });

  it("managed_enterprise resolves a valid full query to the canonical locator + namespace", async () => {
    const handle = mint({ tenantId: "tenant-a", resourceId: "ws-res-9" });
    const res = await resolveMemoryIndexWorkspaceHandle(
      managedParams(ledgerId, {
        identity: trustedIdentity({ tenantId: "tenant-a" }),
        resolveCanonicalHandle: okResolver(handle),
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.profile).toBe("managed_enterprise");
    expect(res.mode).toBe("canonical-handle");
    // canonical locator, NOT a guessed host path
    expect(res.locator).toBe(handle.canonicalObjectKey);
    expect(res.locator).toBe("obj://tenant-a/ws-res-9/memory");
    expect(res.namespace).toBe("managed:tenant-a:ws-res-9");
    // provenance retained (narrow the union to the managed variant for res.handle)
    if (res.profile !== "managed_enterprise") {
      return;
    }
    expect(res.handle.tenantId).toBe("tenant-a");
    expect(res.handle.resourceId).toBe("ws-res-9");
  });

  it.each<MemoryWorkspaceLifecycle>(["retired", "purged", "moving", "recovery_required"])(
    "managed_enterprise halts a %s (tombstoned/revoked) workspace",
    async (lifecycle) => {
      const res = await resolveMemoryIndexWorkspaceHandle(
        managedParams(ledgerId, { resolveCanonicalHandle: okResolver(mint({ lifecycle })) }),
      );
      expect(res.ok).toBe(false);
      if (res.ok) {
        return;
      }
      expect(res.reasonCode).toBe("managed_workspace_not_indexable");
    },
  );

  it("guarded start performs ZERO scan/read/index-write on the rejected path", async () => {
    const startIndex = vi.fn();
    const out = await guardedMemoryIndexStart({
      resolve: () =>
        resolveMemoryIndexWorkspaceHandle(
          managedParams(ledgerId, {
            resolveCanonicalHandle: denyResolver("missing_workspace_resource", "catalog miss"),
          }),
        ),
      startIndex,
    });
    expect(out.started).toBe(false);
    expect(startIndex).not.toHaveBeenCalled();
  });

  it("guarded start indexes with the canonical locator on a valid managed handle", async () => {
    const handle = mint({ tenantId: "tenant-a", resourceId: "ws-res-2" });
    const startIndex = vi.fn((ctx: { locator: string }) => ctx.locator);
    const out = await guardedMemoryIndexStart({
      resolve: () =>
        resolveMemoryIndexWorkspaceHandle(
          managedParams(ledgerId, {
            identity: trustedIdentity({ tenantId: "tenant-a" }),
            resolveCanonicalHandle: okResolver(handle),
          }),
        ),
      startIndex,
    });
    expect(out.started).toBe(true);
    if (!out.started) {
      return;
    }
    expect(startIndex).toHaveBeenCalledTimes(1);
    expect(out.locator).toBe(handle.canonicalObjectKey);
  });
});

// ── aggregate (batch) assertions across all five sites ────────────────────────

describe("Item 7 Stage C aggregate (all five op=index sites)", () => {
  it("covers exactly the five Stage C ledger ids (S30/S31/S32/S36/S37)", () => {
    expect([...ITEM7_STAGE_C_LEDGER_IDS]).toStrictEqual(["S30", "S31", "S32", "S36", "S37"]);
  });

  it("every site fails closed for managed_enterprise without trusted identity", async () => {
    for (const ledgerId of ITEM7_STAGE_C_LEDGER_IDS) {
      const res = await resolveMemoryIndexWorkspaceHandle(
        managedParams(ledgerId, { identity: null }),
      );
      expect(res.ok, `site ${ledgerId}`).toBe(false);
      if (res.ok) {
        continue;
      }
      expect(res.reasonCode, `site ${ledgerId}`).toBe("managed_requires_trusted_identity");
    }
  });

  it("every site resolves a valid managed query to a canonical handle", async () => {
    for (const ledgerId of ITEM7_STAGE_C_LEDGER_IDS) {
      const res = await resolveMemoryIndexWorkspaceHandle(
        managedParams(ledgerId, { resolveCanonicalHandle: okResolver(mint()) }),
      );
      expect(res.ok, `site ${ledgerId}`).toBe(true);
    }
  });

  it("rejects a non-index op even when otherwise valid (Stage C is op=index only)", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle({
      ...managedParams("S30"),
      op: "write",
    } as unknown as ResolveMemoryIndexWorkspaceHandleParams);
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("op_not_index");
  });

  it("rejects a ledger id outside Stage C (e.g. Stage D sync site S33)", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle({
      ...managedParams("S30"),
      ledgerId: "S33",
    } as unknown as ResolveMemoryIndexWorkspaceHandleParams);
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("unknown_stage_c_site");
  });
});

// ── §六 index lifecycle / isolation properties ────────────────────────────────

describe("Item 7 Stage C index lifecycle + isolation (§六)", () => {
  it("binds the index namespace to tenantId + resourceId", () => {
    const handle = mint({ tenantId: "tenant-x", resourceId: "ws-7" });
    expect(deriveManagedMemoryIndexNamespace(handle)).toBe("managed:tenant-x:ws-7");
  });

  it("a same-named agent in two tenants never shares an index root", async () => {
    const handleA = mint({ tenantId: "tenant-a", resourceId: "ws-1" });
    const handleB = mint({ tenantId: "tenant-b", resourceId: "ws-1" });
    const a = await resolveMemoryIndexWorkspaceHandle(
      managedParams("S30", {
        agentId: "shared-name",
        identity: trustedIdentity({ tenantId: "tenant-a" }),
        resolveCanonicalHandle: okResolver(handleA),
      }),
    );
    const b = await resolveMemoryIndexWorkspaceHandle(
      managedParams("S30", {
        agentId: "shared-name",
        identity: trustedIdentity({ tenantId: "tenant-b" }),
        resolveCanonicalHandle: okResolver(handleB),
      }),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      return;
    }
    expect(a.namespace).not.toBe(b.namespace);
    expect(a.locator).not.toBe(b.locator);
  });

  it("retains provenance (tenantId + resourceId) on the resolved handle", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle(
      managedParams("S32", {
        identity: trustedIdentity({ tenantId: "tenant-a" }),
        resolveCanonicalHandle: okResolver(mint({ tenantId: "tenant-a", resourceId: "ws-prov" })),
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok || res.profile !== "managed_enterprise") {
      return;
    }
    expect(res.handle.tenantId).toBe("tenant-a");
    expect(res.handle.resourceId).toBe("ws-prov");
  });

  it("a running index task that receives a revoke (re-resolve returns retired) halts", async () => {
    // First resolve is active (task running); the workspace is then revoked, so the next
    // resolve returns a retired handle and the guard refuses to (re)start the index.
    let call = 0;
    const resolver: CanonicalMemoryWorkspaceResolver = async () => {
      call += 1;
      return {
        ok: true,
        handle: mint({ lifecycle: call === 1 ? "active" : "retired" }),
      } satisfies MemoryWorkspaceResolveResult;
    };
    const first = await resolveMemoryIndexWorkspaceHandle(
      managedParams("S36", { resolveCanonicalHandle: resolver }),
    );
    expect(first.ok).toBe(true);

    const startIndex = vi.fn();
    const rerun = await guardedMemoryIndexStart({
      resolve: () =>
        resolveMemoryIndexWorkspaceHandle(
          managedParams("S36", { resolveCanonicalHandle: resolver }),
        ),
      startIndex,
    });
    expect(rerun.started).toBe(false);
    if (rerun.started) {
      return;
    }
    expect(rerun.reasonCode).toBe("managed_workspace_not_indexable");
    expect(startIndex).not.toHaveBeenCalled();
  });

  it("never recovers from an old host path: a managed denial yields no locator or handle", async () => {
    const res = await resolveMemoryIndexWorkspaceHandle(
      managedParams("S31", {
        resolveCanonicalHandle: denyResolver("missing_workspace_resource", "catalog miss"),
      }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect("locator" in res).toBe(false);
    expect("handle" in res).toBe(false);
  });

  it("treats index existence as non-authorizing: a compat locator does not satisfy managed", async () => {
    // Even though a legacy path 'exists', managed_enterprise must go through the canonical
    // resolver; a supplied personal compat locator is ignored on the managed branch.
    const res = await resolveMemoryIndexWorkspaceHandle({
      op: "index",
      ledgerId: "S37",
      agentId: "main",
      securityProfile: "managed_enterprise",
      identity: null,
      personalLocalCompatLocator: () => "/legacy/existing/index/root",
      resolveCanonicalHandle: okResolver(mint()),
    });
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.reasonCode).toBe("managed_requires_trusted_identity");
  });
});
