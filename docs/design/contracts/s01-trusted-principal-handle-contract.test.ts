import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceOwnerScope } from "../../../src/gateway/workspace-ownership/types.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
} from "../../../src/gateway/workspace-resolver/catalog.js";
import type {
  WorkspaceBindingRecord,
  WorkspaceResourceRecord,
} from "../../../src/gateway/workspace-resolver/types.js";
import {
  classifyS01PrincipalKind,
  createInMemoryS01MembershipPort,
  deriveCapabilitiesFromBinding,
  evaluateS01AuthorizedToolCwd,
  issueTrustedPrincipal,
  parseTrustedPrincipal,
  projectWorkspaceHandleView,
  queryAuthorizedCwdViews,
  S01_ATTESTATION_DOMAIN,
  S01_ATTESTATION_TEST_SECRET,
  S01_D1D5_PRODUCTION_CATALOG_WRITE,
  S01_D1D5_PRODUCTION_SRC_MODULE,
  S01_D1D5_SECOND_MEMORY_WORKSPACE_HANDLE_ENTRY,
  S01_D1D5_WIRED_TO_GET_REPLY,
  S01_INDEPENDENT_CATALOG_TABLES,
  S01_MEMORY_ASSET_RESOURCE_ID_INDEPENDENT_OF_WORKSPACE_HANDLE,
  S01_PRINCIPAL_MAX_AGE_MS,
  S01_SESSION_HMAC_TEST_SECRET,
  S01_WORKSPACE_HANDLE_PERSISTENT_PK,
  s01AuditRecordId,
  s01AuthorizedToolCwdErrorCodeSchema,
  signS01SessionHmac,
  verifySourceProof,
  type S01PresentedSourceProof,
  type S01TrustMaterial,
  type TrustedPrincipal,
} from "./s01-trusted-principal-handle-contract.js";

const NOW = 1_725_000_000_000;
const repoRoot = join(import.meta.dir, "../../..");

const verifiedSession = {
  userId: "usr-123",
  tenantId: "ent-456",
  sessionDomain: "employee" as const,
  source: "platform-auth-session" as const,
  sessionId: "sess-abc",
};

const sessionTrust: S01TrustMaterial = {
  attestationSecret: S01_ATTESTATION_TEST_SECRET,
  source: {
    source: "platform-auth-session",
    sessionHmacSecret: S01_SESSION_HMAC_TEST_SECRET,
  },
};

const presentedSessionProof: S01PresentedSourceProof = {
  source: "platform-auth-session",
  sessionId: "sess-abc",
  hmac: signS01SessionHmac(S01_SESSION_HMAC_TEST_SECRET, "sess-abc"),
};

const principal = issueTrustedPrincipal({
  verifiedSession,
  presentedProof: presentedSessionProof,
  trust: sessionTrust,
  resolvedAt: NOW,
}) as TrustedPrincipal;

const memberships = createInMemoryS01MembershipPort({
  memberships: [{ userId: "usr-123", tenantId: "ent-456" }],
});

function workspaceEntry(params: {
  resourceId: string;
  tenantId: string;
  userId?: string;
  locator: string;
  lifecycleState?: WorkspaceResourceRecord["lifecycleState"];
  role?: WorkspaceBindingRecord["role"];
  bindingState?: WorkspaceBindingRecord["state"];
  bindingId?: string;
  contentVersion?: string;
  ownerScope?: WorkspaceOwnerScope;
}): { resource: WorkspaceResourceRecord; binding: WorkspaceBindingRecord } {
  const userId = params.userId ?? "usr-123";
  const ownerScope: WorkspaceOwnerScope = params.ownerScope ?? {
    kind: "user_owned",
    userId,
    agentAssetId: "asset-alpha",
    proof: {
      source: "explicit_binding",
      ownerType: "user",
      ownerId: userId,
      agentAssetId: "asset-alpha",
    },
  };
  return {
    resource: {
      resourceId: params.resourceId,
      resourceType: "workspace",
      tenantId: params.tenantId,
      ownerScope,
      lifecycleState: params.lifecycleState ?? "active",
      classification: "internal",
      governanceVersion: 1,
    },
    binding: {
      bindingId: params.bindingId ?? `${params.resourceId}:canonical`,
      resourceId: params.resourceId,
      role: params.role ?? "canonical",
      locator: params.locator,
      state: params.bindingState ?? "active",
      contentVersion: params.contentVersion ?? "v1",
    },
  };
}

function catalogWith(
  entries: Array<{ resource: WorkspaceResourceRecord; binding: WorkspaceBindingRecord }>,
  extraBindings: WorkspaceBindingRecord[] = [],
): InMemoryWorkspaceResourceCatalog {
  const resources: Record<string, WorkspaceResourceRecord> = {};
  const bindings: Record<string, WorkspaceBindingRecord> = {};
  for (const entry of entries) {
    resources[entry.resource.resourceId] = entry.resource;
    bindings[entry.binding.bindingId] = entry.binding;
  }
  for (const binding of extraBindings) {
    bindings[binding.bindingId] = binding;
  }
  return new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog().snapshot(),
    resources,
    bindings,
  });
}

describe("S01 D1 trusted principal contract", () => {
  it("issues from verified session and rejects incomplete identity", () => {
    expect(parseTrustedPrincipal(principal, NOW, S01_ATTESTATION_TEST_SECRET)).toEqual(principal);
    expect(
      issueTrustedPrincipal({
        verifiedSession: { ...verifiedSession, tenantId: "" },
        presentedProof: presentedSessionProof,
        trust: sessionTrust,
      }),
    ).toBeNull();
    expect(
      parseTrustedPrincipal({ userId: "usr-123" }, NOW, S01_ATTESTATION_TEST_SECRET),
    ).toBeNull();
  });

  it("refuses identity fields supplied from untrusted wire params", () => {
    expect(
      issueTrustedPrincipal({
        verifiedSession,
        resolvedAt: NOW,
        presentedProof: presentedSessionProof,
        trust: sessionTrust,
        wireIdentity: { tenantId: "ent-456" },
      }),
    ).toBeNull();
    expect(
      issueTrustedPrincipal({
        verifiedSession,
        resolvedAt: NOW,
        presentedProof: presentedSessionProof,
        trust: sessionTrust,
        wireIdentity: { userId: "usr-123", resourceId: "wsr_alpha" },
      }),
    ).toBeNull();
  });

  it("rejects forged and expired principals", () => {
    const forged = { ...principal, userId: "usr-forged" };
    expect(parseTrustedPrincipal(forged, NOW, S01_ATTESTATION_TEST_SECRET)).toBeNull();
    expect(
      parseTrustedPrincipal(
        principal,
        NOW + S01_PRINCIPAL_MAX_AGE_MS + 1,
        S01_ATTESTATION_TEST_SECRET,
      ),
    ).toBeNull();
  });

  it("requires server-owned session, proxy, and device secrets before issue", () => {
    expect(
      issueTrustedPrincipal({
        verifiedSession,
        presentedProof: { ...presentedSessionProof, hmac: "forged-hmac" },
        trust: sessionTrust,
        resolvedAt: NOW,
      }),
    ).toBeNull();
    expect(
      verifySourceProof(
        verifiedSession,
        {
          source: "trusted-proxy-header",
          clientIp: "10.0.0.9",
          trustedUserHeader: "usr-123",
        },
        { source: "trusted-proxy-header", ipAllowlist: ["10.0.0.1"] },
      ),
    ).toBe(false);
    const proxyPrincipal = issueTrustedPrincipal({
      verifiedSession: { ...verifiedSession, source: "trusted-proxy-header" },
      presentedProof: {
        source: "trusted-proxy-header",
        clientIp: "10.0.0.1",
        trustedUserHeader: "usr-123",
      },
      trust: {
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        source: { source: "trusted-proxy-header", ipAllowlist: ["10.0.0.1"] },
      },
      resolvedAt: NOW,
    });
    expect(proxyPrincipal?.source).toBe("trusted-proxy-header");
    expect(
      issueTrustedPrincipal({
        verifiedSession: { ...verifiedSession, source: "device-token" },
        presentedProof: { source: "device-token", token: "device-a" },
        trust: {
          attestationSecret: S01_ATTESTATION_TEST_SECRET,
          source: { source: "device-token", expectedToken: "device-b" },
        },
        resolvedAt: NOW,
      }),
    ).toBeNull();
  });

  it("rejects hmac that only matches a caller-supplied expectedHmac, not the server secret", () => {
    const selfCompared = "caller-supplied-mac";
    expect(
      issueTrustedPrincipal({
        verifiedSession,
        presentedProof: {
          source: "platform-auth-session",
          sessionId: "sess-abc",
          hmac: selfCompared,
        },
        trust: sessionTrust,
        resolvedAt: NOW,
      }),
    ).toBeNull();
    expect(
      verifySourceProof(
        verifiedSession,
        { source: "platform-auth-session", sessionId: "sess-abc", hmac: selfCompared },
        { source: "platform-auth-session", sessionHmacSecret: S01_SESSION_HMAC_TEST_SECRET },
      ),
    ).toBe(false);
  });

  it("rejects principals whose attestation was recomputed with unkeyed SHA-256", () => {
    const unkeyed = createHash("sha256")
      .update(S01_ATTESTATION_DOMAIN)
      .update("\0")
      .update(principal.userId)
      .update("\0")
      .update(principal.tenantId)
      .update("\0")
      .update(principal.sessionDomain)
      .update("\0")
      .update(principal.source)
      .update("\0")
      .update(principal.sessionId)
      .update("\0")
      .update(String(principal.resolvedAt))
      .digest("hex");
    expect(unkeyed).not.toBe(principal.attestation);
    expect(
      parseTrustedPrincipal(
        { ...principal, attestation: unkeyed },
        NOW,
        S01_ATTESTATION_TEST_SECRET,
      ),
    ).toBeNull();
    expect(parseTrustedPrincipal(principal, NOW, "wrong-attestation-secret")).toBeNull();
  });

  it("refuses wire ownerId / principal / executedBy injection", () => {
    expect(
      issueTrustedPrincipal({
        verifiedSession,
        presentedProof: presentedSessionProof,
        trust: sessionTrust,
        resolvedAt: NOW,
        wireIdentity: { ownerId: "usr-123" },
      }),
    ).toBeNull();
    expect(
      issueTrustedPrincipal({
        verifiedSession,
        presentedProof: presentedSessionProof,
        trust: sessionTrust,
        resolvedAt: NOW,
        wireIdentity: { principal: { userId: "usr-123" } },
      }),
    ).toBeNull();
    expect(
      issueTrustedPrincipal({
        verifiedSession,
        presentedProof: presentedSessionProof,
        trust: sessionTrust,
        resolvedAt: NOW,
        wireIdentity: { executedBy: "usr-123" },
      }),
    ).toBeNull();
  });

  it("issued principal is frozen", () => {
    expect(Object.isFrozen(principal)).toBe(true);
  });

  it("classifyS01PrincipalKind maps platform / enterprise / employee", () => {
    expect(classifyS01PrincipalKind("platform")).toBe("platform");
    expect(classifyS01PrincipalKind("enterprise")).toBe("managed-enterprise");
    expect(classifyS01PrincipalKind("employee")).toBe("managed-employee");
  });
});

describe("S01 D2/D3 catalog typed views", () => {
  it("projects Handle and authorized CWD from Catalog records without extra tables", () => {
    const entry = workspaceEntry({
      resourceId: "wsr_alpha",
      tenantId: "ent-456",
      userId: "usr-123",
      locator: "/workspace/group-alpha",
    });
    const catalog = catalogWith([entry]);
    const handle = projectWorkspaceHandleView(catalog, "wsr_alpha");
    expect(handle).toMatchObject({
      id: "wsr_alpha",
      kind: "workspace",
      tenantId: "ent-456",
      ownerId: "usr-123",
      ownerScope: { kind: "user_owned", userId: "usr-123" },
      rootPath: "/workspace/group-alpha",
      fencing: { contentVersion: "v1", bindingId: "wsr_alpha:canonical" },
      provenance: { source: "workspace-resource-catalog" },
    });
    expect(handle?.provenance.source).toBe("workspace-resource-catalog");
    expect(deriveCapabilitiesFromBinding(entry.binding)).toEqual([
      "read",
      "write",
      "execute",
      "list",
    ]);
    expect(
      queryAuthorizedCwdViews(catalog, principal, memberships).map((view) => view.rootPath),
    ).toEqual(["/workspace/group-alpha"]);
    expect(S01_INDEPENDENT_CATALOG_TABLES).toEqual([
      "workspace_handles",
      "authorized_cwds",
      "tenant_memberships",
    ]);
    expect(S01_WORKSPACE_HANDLE_PERSISTENT_PK).toBe("resourceId");
    expect(S01_MEMORY_ASSET_RESOURCE_ID_INDEPENDENT_OF_WORKSPACE_HANDLE).toBe(true);
    expect(S01_D1D5_WIRED_TO_GET_REPLY).toBe(false);
    expect(S01_D1D5_PRODUCTION_CATALOG_WRITE).toBe("none");
    expect(S01_D1D5_PRODUCTION_SRC_MODULE).toBe(false);
    expect(S01_D1D5_SECOND_MEMORY_WORKSPACE_HANDLE_ENTRY).toBe(false);
  });

  it("does not project compatibility-only or duplicate canonical bindings", () => {
    const compatibilityOnly = catalogWith([
      workspaceEntry({
        resourceId: "wsr_compat",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/compat",
        role: "compatibility",
      }),
    ]);
    expect(projectWorkspaceHandleView(compatibilityOnly, "wsr_compat")).toBeNull();

    const duplicate = catalogWith(
      [
        workspaceEntry({
          resourceId: "wsr_dup",
          tenantId: "ent-456",
          userId: "usr-123",
          locator: "/workspace/dup",
        }),
      ],
      [
        {
          bindingId: "wsr_dup:canonical-2",
          resourceId: "wsr_dup",
          role: "canonical",
          locator: "/workspace/dup-other",
          state: "active",
          contentVersion: "v2",
        },
      ],
    );
    expect(projectWorkspaceHandleView(duplicate, "wsr_dup")).toBeNull();
  });

  it("handle includes ownerScope and catalog provenance", () => {
    const catalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_alpha",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/group-alpha",
      }),
    ]);
    const handle = projectWorkspaceHandleView(catalog, "wsr_alpha");
    expect(handle?.ownerScope).toMatchObject({ kind: "user_owned", userId: "usr-123" });
    expect(handle?.provenance.source).toBe("workspace-resource-catalog");
  });
});

describe("S01 D4 evaluateS01AuthorizedToolCwd", () => {
  it("resolves an authorized cwd from the in-memory Catalog adapter", async () => {
    const catalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_alpha",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/group-alpha",
      }),
    ]);
    const result = await evaluateS01AuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_alpha",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedPath).toBe("/workspace/group-alpha");
      expect(result.accessMode).toBe("authorized");
      expect(result.handle.id).toBe("wsr_alpha");
      expect(result.handle.fencing.contentVersion).toBe("v1");
      expect(result.audit.sessionId).toBe("sess-abc");
      expect(result.audit.auditRecordId).toBe(
        s01AuditRecordId(principal, "/workspace/group-alpha", "read"),
      );
    }
  });

  it("fail-closes without a principal even if allowAnonymousLocal is set", async () => {
    const result = await evaluateS01AuthorizedToolCwd({
      catalog: createEmptyWorkspaceCatalog(),
      principal: null,
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      allowAnonymousLocal: true,
      now: NOW,
      targetResourceId: "wsr_alpha",
    });
    expect(result).toMatchObject({
      ok: false,
      code: "ERR_PRINCIPAL_REQUIRED",
      failClosed: true,
      retryable: false,
    });
  });

  it("maps invalid cwd to ERR_INVALID_PATH instead of principal errors", async () => {
    const catalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_alpha",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/group-alpha",
      }),
    ]);
    const result = await evaluateS01AuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/group-alpha/../escape",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_alpha",
    });
    expect(result).toMatchObject({ ok: false, code: "ERR_INVALID_PATH", failClosed: true });
  });

  it("rejects forged and expired principals", async () => {
    const catalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_alpha",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/group-alpha",
      }),
    ]);
    const forged = await evaluateS01AuthorizedToolCwd({
      catalog,
      principal: { ...principal, userId: "usr-forged" },
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_alpha",
    });
    expect(forged).toMatchObject({ ok: false, code: "ERR_PRINCIPAL_REQUIRED" });

    const expired = await evaluateS01AuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW + S01_PRINCIPAL_MAX_AGE_MS + 1,
      targetResourceId: "wsr_alpha",
    });
    expect(expired).toMatchObject({ ok: false, code: "ERR_PRINCIPAL_REQUIRED" });
  });

  it("rejects a principal whose attestation was recomputed without the issuer secret", async () => {
    const catalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_alpha",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/group-alpha",
      }),
    ]);
    const unkeyed = createHash("sha256")
      .update(S01_ATTESTATION_DOMAIN)
      .update("\0")
      .update(principal.userId)
      .update("\0")
      .update(principal.tenantId)
      .update("\0")
      .update(principal.sessionDomain)
      .update("\0")
      .update(principal.source)
      .update("\0")
      .update(principal.sessionId)
      .update("\0")
      .update(String(principal.resolvedAt))
      .digest("hex");
    const forged = await evaluateS01AuthorizedToolCwd({
      catalog,
      principal: { ...principal, attestation: unkeyed },
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_alpha",
    });
    expect(forged).toMatchObject({ ok: false, code: "ERR_PRINCIPAL_REQUIRED", failClosed: true });
  });

  it("rejects caller-injected memberships arrays and same-tenant other-owner access", async () => {
    const catalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_peer",
        tenantId: "ent-456",
        userId: "usr-999",
        locator: "/workspace/peer",
      }),
    ]);
    const injectedArray = await evaluateS01AuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/peer",
      operation: "read",
      memberships: [{ userId: "usr-123", tenantId: "ent-456" }] as never,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_peer",
    });
    expect(injectedArray).toMatchObject({
      ok: false,
      code: "ERR_TENANT_BINDING_REQUIRED",
      failClosed: true,
    });

    const lateral = await evaluateS01AuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/peer",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_peer",
    });
    expect(lateral).toMatchObject({
      ok: false,
      code: "ERR_WORKSPACE_OWNER_DENIED",
      failClosed: true,
    });
  });

  it("authorizes group and seat owners via the membership port, and denies missing membership", async () => {
    const groupCatalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_group",
        tenantId: "ent-456",
        locator: "/workspace/group-shared",
        ownerScope: { kind: "group_owned", groupId: "grp-9" },
      }),
    ]);
    const withoutGroup = createInMemoryS01MembershipPort({
      memberships: [{ userId: "usr-123", tenantId: "ent-456" }],
    });
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog: groupCatalog,
        principal,
        requestedCwd: "/workspace/group-shared",
        operation: "read",
        memberships: withoutGroup,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_group",
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_OWNER_DENIED" });

    const withGroup = createInMemoryS01MembershipPort({
      memberships: [{ userId: "usr-123", tenantId: "ent-456" }],
      groups: { "usr-123": ["grp-9"] },
    });
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog: groupCatalog,
        principal,
        requestedCwd: "/workspace/group-shared",
        operation: "read",
        memberships: withGroup,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_group",
      }),
    ).toMatchObject({ ok: true, resolvedPath: "/workspace/group-shared" });

    const seatCatalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_seat",
        tenantId: "ent-456",
        locator: "/workspace/seat",
        ownerScope: { kind: "position_owned", seatId: "seat-7", agentAssetId: "asset-seat" },
      }),
    ]);
    const withSeat = createInMemoryS01MembershipPort({
      memberships: [{ userId: "usr-123", tenantId: "ent-456" }],
      seats: { "usr-123": ["seat-7"] },
    });
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog: seatCatalog,
        principal,
        requestedCwd: "/workspace/seat",
        operation: "read",
        memberships: withSeat,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_seat",
      }),
    ).toMatchObject({ ok: true, resolvedPath: "/workspace/seat" });
  });

  it("rejects cross-tenant cwd as ERR_TENANT_MISMATCH", async () => {
    const catalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_other",
        tenantId: "ent-bbb",
        userId: "usr-999",
        locator: "/workspace/other-tenant",
      }),
    ]);
    const mismatch = await evaluateS01AuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/other-tenant",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_other",
    });
    expect(mismatch).toMatchObject({
      ok: false,
      code: "ERR_TENANT_MISMATCH",
      failClosed: true,
    });
  });

  it("rejects membership miss, retired handle, revoked binding, capability, and unavailable catalog", async () => {
    const retired = catalogWith([
      workspaceEntry({
        resourceId: "wsr_retired",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/retired",
        lifecycleState: "retired",
      }),
    ]);
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog: retired,
        principal,
        requestedCwd: "/workspace/retired",
        operation: "read",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_retired",
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED" });

    const revoked = catalogWith([
      workspaceEntry({
        resourceId: "wsr_revoked",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/revoked",
        bindingState: "retired",
      }),
    ]);
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog: revoked,
        principal,
        requestedCwd: "/workspace/revoked",
        operation: "read",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_revoked",
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED" });

    const readonlyCanonical = catalogWith([
      workspaceEntry({
        resourceId: "wsr_ro",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/ro",
        bindingState: "read_only",
      }),
    ]);
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog: readonlyCanonical,
        principal,
        requestedCwd: "/workspace/ro",
        operation: "write",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_ro",
      }),
    ).toMatchObject({ ok: false, code: "ERR_CAPABILITY_DENIED" });

    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog: readonlyCanonical,
        principal,
        requestedCwd: "/workspace/ro",
        operation: "read",
        memberships: createInMemoryS01MembershipPort({ memberships: [] }),
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_ro",
      }),
    ).toMatchObject({ ok: false, code: "ERR_TENANT_BINDING_REQUIRED" });

    const unavailable = new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog({ status: "unavailable" }).snapshot(),
    });
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog: unavailable,
        principal,
        requestedCwd: "/workspace/group-alpha",
        operation: "read",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_alpha",
      }),
    ).toMatchObject({ ok: false, code: "ERR_CATALOG_UNAVAILABLE" });
  });

  it("rejects duplicate canonical, wrong-role, missing handle, and path outside the unique root", async () => {
    const missing = await evaluateS01AuthorizedToolCwd({
      catalog: createEmptyWorkspaceCatalog(),
      principal,
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_missing",
    });
    expect(missing).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });

    const duplicate = catalogWith(
      [
        workspaceEntry({
          resourceId: "wsr_dup",
          tenantId: "ent-456",
          userId: "usr-123",
          locator: "/workspace/dup",
        }),
      ],
      [
        {
          bindingId: "wsr_dup:canonical-2",
          resourceId: "wsr_dup",
          role: "canonical",
          locator: "/workspace/dup",
          state: "active",
          contentVersion: "v2",
        },
      ],
    );
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog: duplicate,
        principal,
        requestedCwd: "/workspace/dup",
        operation: "read",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_dup",
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });

    const wrongRole = catalogWith([
      workspaceEntry({
        resourceId: "wsr_compat",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/compat",
        role: "compatibility",
      }),
    ]);
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog: wrongRole,
        principal,
        requestedCwd: "/workspace/compat",
        operation: "read",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_compat",
      }),
    ).toMatchObject({ ok: false, code: "ERR_BINDING_NOT_CANONICAL" });

    const uniqueRoot = catalogWith([
      workspaceEntry({
        resourceId: "wsr_alpha",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/group-alpha",
      }),
    ]);
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog: uniqueRoot,
        principal,
        requestedCwd: "/workspace/outside",
        operation: "read",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_alpha",
      }),
    ).toMatchObject({ ok: false, code: "ERR_PATH_OUTSIDE_WORKSPACE" });

    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog: uniqueRoot,
        principal,
        requestedCwd: "/workspace/group-alpha",
        operation: "read",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        expectedFencing: { contentVersion: "stale", bindingId: "wsr_alpha:canonical" },
        targetResourceId: "wsr_alpha",
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED" });

    expect(s01AuthorizedToolCwdErrorCodeSchema.options).toHaveLength(11);
  });

  it("rejects missing or empty targetResourceId as ERR_WORKSPACE_NOT_FOUND", async () => {
    const catalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_alpha",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/group-alpha",
      }),
    ]);
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/group-alpha",
        operation: "read",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "",
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/group-alpha",
        operation: "read",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: undefined as unknown as string,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });
  });

  it("rejects sibling-prefix path as ERR_PATH_OUTSIDE_WORKSPACE", async () => {
    const catalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_alpha",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/group-alpha",
      }),
    ]);
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/group-alpha-evil",
        operation: "read",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_alpha",
      }),
    ).toMatchObject({ ok: false, code: "ERR_PATH_OUTSIDE_WORKSPACE" });
  });

  it("rejects encoded traversal as ERR_INVALID_PATH", async () => {
    const catalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_alpha",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/group-alpha",
      }),
    ]);
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/group-alpha/%2e%2e/escape",
        operation: "read",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_alpha",
      }),
    ).toMatchObject({ ok: false, code: "ERR_INVALID_PATH" });
  });

  it("rejects symlinkFollowed as unverified invalid path", async () => {
    const catalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_alpha",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/group-alpha",
      }),
    ]);
    expect(
      await evaluateS01AuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/group-alpha",
        operation: "read",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: "wsr_alpha",
        symlinkFollowed: true,
      }),
    ).toMatchObject({
      ok: false,
      code: "ERR_INVALID_PATH",
      symlinkSafety: "denied-unverified",
    });
  });

  it("audit payload omits raw workspace path, attestation, and secrets", async () => {
    const catalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_alpha",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/group-alpha",
      }),
    ]);
    const result = await evaluateS01AuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/group-alpha",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_alpha",
    });
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result.audit);
    expect(serialized).not.toContain("/workspace");
    expect(serialized).not.toContain(principal.attestation);
    expect(serialized).not.toContain(S01_ATTESTATION_TEST_SECRET);
    expect(serialized).not.toContain(S01_SESSION_HMAC_TEST_SECRET);
  });
});

describe("S01 D5 integration, production freeze, and in-memory SLA", () => {
  it("resolves unique authorized roots across two Catalog workspaces", async () => {
    const catalog = catalogWith([
      workspaceEntry({
        resourceId: "wsr_alpha",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/group-alpha",
      }),
      workspaceEntry({
        resourceId: "wsr_beta",
        tenantId: "ent-456",
        userId: "usr-123",
        locator: "/workspace/group-beta",
      }),
    ]);
    const alpha = await evaluateS01AuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/group-alpha/notes",
      operation: "read",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_alpha",
    });
    const beta = await evaluateS01AuthorizedToolCwd({
      catalog,
      principal,
      requestedCwd: "/workspace/group-beta",
      operation: "list",
      memberships,
      attestationSecret: S01_ATTESTATION_TEST_SECRET,
      now: NOW,
      targetResourceId: "wsr_beta",
    });
    expect(alpha).toMatchObject({ ok: true, resolvedPath: "/workspace/group-alpha/notes" });
    expect(beta).toMatchObject({ ok: true, resolvedPath: "/workspace/group-beta" });
    if (alpha.ok && beta.ok) {
      expect(alpha.handle.id).toBe("wsr_alpha");
      expect(beta.handle.id).toBe("wsr_beta");
    }
  });

  it("freezes S01 production callers away from this contract", () => {
    const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
    expect(getReply).toContain("resolveEmployeeBuiltinStewardWorkspaceDir");
    expect(getReply).not.toContain("evaluateS01AuthorizedToolCwd");
    expect(getReply).not.toContain("s01-trusted-principal-handle-contract");
    const hits: string[] = [];
    const stack = [
      join(repoRoot, "src/auto-reply"),
      join(repoRoot, "src/memory"),
      join(repoRoot, "src/gateway"),
    ];
    while (stack.length > 0) {
      const dir = stack.pop();
      if (!dir) {
        continue;
      }
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist") {
          continue;
        }
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!/\.(ts|js|mjs)$/u.test(name) || name.endsWith(".d.ts")) {
          continue;
        }
        const text = readFileSync(full, "utf-8");
        if (text.includes("s01-trusted-principal-handle-contract")) {
          hits.push(full.slice(repoRoot.length + 1));
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("resolves Catalog views within P99 < 50ms on the approved adapter", async () => {
    const resources: Record<string, WorkspaceResourceRecord> = {};
    const bindings: Record<string, WorkspaceBindingRecord> = {};
    for (let index = 0; index < 40; index += 1) {
      const entry = workspaceEntry({
        resourceId: `wsr_${index}`,
        tenantId: "ent-456",
        userId: "usr-123",
        locator: `/workspace/group-${index}`,
      });
      resources[entry.resource.resourceId] = entry.resource;
      bindings[entry.binding.bindingId] = entry.binding;
    }
    const catalog = new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources,
      bindings,
    });
    const latencies: number[] = [];
    for (let index = 0; index < 200; index += 1) {
      const started = performance.now();
      await evaluateS01AuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: `/workspace/group-${index % 40}`,
        operation: "read",
        memberships,
        attestationSecret: S01_ATTESTATION_TEST_SECRET,
        now: NOW,
        targetResourceId: `wsr_${index % 40}`,
      });
      latencies.push(performance.now() - started);
    }
    latencies.sort((left, right) => left - right);
    const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? Number.POSITIVE_INFINITY;
    expect(p99).toBeLessThan(50);
  });
});
