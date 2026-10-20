import { describe, expect, it } from "vitest";
import { buildWorkspaceResourceId } from "../workspace-resolver/builders.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
} from "../workspace-resolver/catalog.js";
import type {
  WorkspaceBindingRecord,
  WorkspaceResourceRecord,
} from "../workspace-resolver/types.js";
import {
  createInMemoryS01MembershipPort,
  evaluateS01AuthorizedToolCwd,
  issueS01TrustedPrincipal,
  S01_PRINCIPAL_MAX_AGE_MS,
} from "./s01-authorized-tool-cwd.js";
import type { S01TargetIdentity } from "./s01-steward-workspace-identity.js";

const NOW = 1_725_000_000_000;
const SECRET = "s01-stage-a-attestation-test-secret";
const tenantId = "ent-456";
const userId = "usr-123";
const agentAssetId = "asset-steward-1";
const workspaceResourceId = buildWorkspaceResourceId({
  tenantId,
  scope: {
    kind: "user_owned",
    userId,
    agentAssetId,
    proof: { source: "explicit_binding", ownerType: "user", ownerId: userId, agentAssetId },
  },
});

const principal = issueS01TrustedPrincipal({
  userId,
  tenantId,
  sessionId: "sess-1",
  attestationSecret: SECRET,
  resolvedAt: NOW,
})!;

const memberships = createInMemoryS01MembershipPort({
  memberships: [{ userId, tenantId }],
});

const targetIdentity: S01TargetIdentity = {
  tenantId,
  employeeOwnerId: userId,
  agentAssetId,
  workspaceResourceId,
  expectedBindingRole: "canonical",
  expectedBindingState: "active",
  governanceVersion: 1,
  contentVersion: "v1",
  fencingToken: { contentVersion: "v1", bindingId: `${workspaceResourceId}:canonical` },
};

function entry(params?: {
  lifecycleState?: WorkspaceResourceRecord["lifecycleState"];
  bindingState?: WorkspaceBindingRecord["state"];
  role?: WorkspaceBindingRecord["role"];
  locator?: string;
}): { resource: WorkspaceResourceRecord; binding: WorkspaceBindingRecord } {
  return {
    resource: {
      resourceId: workspaceResourceId,
      resourceType: "workspace",
      tenantId,
      ownerScope: {
        kind: "user_owned",
        userId,
        agentAssetId,
        proof: { source: "explicit_binding", ownerType: "user", ownerId: userId, agentAssetId },
      },
      lifecycleState: params?.lifecycleState ?? "active",
      classification: "internal",
      governanceVersion: 1,
    },
    binding: {
      bindingId: `${workspaceResourceId}:canonical`,
      resourceId: workspaceResourceId,
      role: params?.role ?? "canonical",
      locator: params?.locator ?? "/workspace/steward",
      state: params?.bindingState ?? "active",
      contentVersion: "v1",
    },
  };
}

function catalogOf(
  resource: WorkspaceResourceRecord,
  binding: WorkspaceBindingRecord,
  status: "available" | "unavailable" = "available",
) {
  return new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog({ status }).snapshot(),
    resources: { [resource.resourceId]: resource },
    bindings: { [binding.bindingId]: binding },
  });
}

describe("evaluateS01AuthorizedToolCwd", () => {
  it("valid authorization returns the canonical path", () => {
    const { resource, binding } = entry();
    const result = evaluateS01AuthorizedToolCwd({
      catalog: catalogOf(resource, binding),
      principal,
      requestedCwd: "/workspace/steward",
      operation: "read",
      memberships,
      attestationSecret: SECRET,
      targetIdentity,
      now: NOW,
    });
    expect(result).toMatchObject({
      ok: true,
      resolvedPath: "/workspace/steward",
      resourceId: workspaceResourceId,
    });
  });

  it("no principal throws unauthorized", () => {
    const { resource, binding } = entry();
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal: null,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_PRINCIPAL_REQUIRED" });
  });

  it("catalog unreachable fail-closes", () => {
    const { resource, binding } = entry();
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding, "unavailable"),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_CATALOG_UNAVAILABLE" });
  });

  it("membership array is rejected", () => {
    const { resource, binding } = entry();
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships: [{ userId, tenantId }] as never,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_TENANT_BINDING_REQUIRED" });
  });

  it("path traversal is a security violation", () => {
    const { resource, binding } = entry();
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/steward/%2e%2e/etc",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_INVALID_PATH" });
  });

  it("absolute path outside workspace is denied", () => {
    const { resource, binding } = entry();
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/steward-evil",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_PATH_OUTSIDE_WORKSPACE" });
  });

  it("unverified symlink follow is denied", () => {
    const { resource, binding } = entry();
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
        symlinkFollowed: true,
      }),
    ).toMatchObject({
      ok: false,
      code: "ERR_INVALID_PATH",
      symlinkSafety: "denied-unverified",
    });
  });

  it("revoked authorization is archived", () => {
    const { resource, binding } = entry({ bindingState: "retired" });
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED" });
  });

  it("stale targetIdentity governanceVersion is archived without expectedFencing", () => {
    const { resource, binding } = entry();
    const catalog = catalogOf(resource, binding);
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity: { ...targetIdentity, governanceVersion: 99 },
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED", failClosed: true });
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf({ ...resource, governanceVersion: 2 }, binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED", failClosed: true });
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: true, resolvedPath: "/workspace/steward" });
  });

  it("stale targetIdentity contentVersion is archived without expectedFencing", () => {
    const { resource, binding } = entry();
    const catalog = catalogOf(resource, binding);
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity: { ...targetIdentity, contentVersion: "stale" },
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED", failClosed: true });
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, { ...binding, contentVersion: "v2" }),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED", failClosed: true });
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: true, resolvedPath: "/workspace/steward" });
  });

  it("stale targetIdentity fencingToken is archived without expectedFencing", () => {
    const { resource, binding } = entry();
    const catalog = catalogOf(resource, binding);
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity: {
          ...targetIdentity,
          fencingToken: { contentVersion: "v1", bindingId: "stale-binding" },
        },
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED", failClosed: true });
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity: {
          ...targetIdentity,
          fencingToken: {
            contentVersion: "stale",
            bindingId: `${workspaceResourceId}:canonical`,
          },
        },
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED", failClosed: true });
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog,
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: true, resolvedPath: "/workspace/steward" });
  });

  it("read_only binding is not canonical/active even for read or write", () => {
    const readOnly = entry({ bindingState: "read_only" });
    const active = entry();
    const forgedReadOnlyIdentity = {
      ...targetIdentity,
      expectedBindingState: "read_only",
    } as unknown as S01TargetIdentity;
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(readOnly.resource, readOnly.binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_BINDING_NOT_CANONICAL", failClosed: true });
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(readOnly.resource, readOnly.binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "write",
        memberships,
        attestationSecret: SECRET,
        targetIdentity: forgedReadOnlyIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_BINDING_NOT_CANONICAL", failClosed: true });
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(active.resource, active.binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity: forgedReadOnlyIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_BINDING_NOT_CANONICAL", failClosed: true });
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(active.resource, active.binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "write",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: true, resolvedPath: "/workspace/steward" });
  });

  it("does not authorize a sibling locator for the same principal", () => {
    const { resource, binding } = entry();
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/other",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_PATH_OUTSIDE_WORKSPACE" });
  });

  it("forged principal and anonymous fallback are rejected", () => {
    const { resource, binding } = entry();
    const forged = { ...principal, userId: "usr-forged" };
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal: forged,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_PRINCIPAL_REQUIRED" });
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
        personalFallback: true,
      }),
    ).toMatchObject({ ok: false, code: "ERR_PRINCIPAL_REQUIRED" });
  });

  it("allow audit does not leak requested path or attestation secret", () => {
    const { resource, binding } = entry();
    const result = evaluateS01AuthorizedToolCwd({
      catalog: catalogOf(resource, binding),
      principal,
      requestedCwd: "/workspace/steward/notes",
      operation: "read",
      memberships,
      attestationSecret: SECRET,
      targetIdentity,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const auditText = JSON.stringify(result.audit);
      expect(auditText).not.toContain("/workspace/steward/notes");
      expect(auditText).not.toContain(SECRET);
      expect(result.audit).toMatchObject({
        decision: "allowed",
        actor: userId,
        tenantId,
        resourceId: workspaceResourceId,
        sessionId: "sess-1",
      });
    }
  });

  it("covers remaining fail-closed ownership, binding, locator, and principal paths", () => {
    const { resource, binding } = entry();
    expect(
      issueS01TrustedPrincipal({ userId: "", tenantId, sessionId: "s", attestationSecret: SECRET }),
    ).toBeNull();

    const seatDeny = evaluateS01AuthorizedToolCwd({
      catalog: catalogOf(
        { ...resource, ownerScope: { kind: "position_owned", seatId: "seat-1", agentAssetId } },
        binding,
      ),
      principal,
      requestedCwd: "/workspace/steward",
      operation: "read",
      memberships,
      attestationSecret: SECRET,
      targetIdentity,
      now: NOW,
    });
    expect(seatDeny).toMatchObject({ ok: false, code: "ERR_WORKSPACE_OWNER_DENIED" });

    const seatOk = evaluateS01AuthorizedToolCwd({
      catalog: catalogOf(
        { ...resource, ownerScope: { kind: "position_owned", seatId: "seat-1", agentAssetId } },
        binding,
      ),
      principal,
      requestedCwd: "notes",
      operation: "read",
      memberships: createInMemoryS01MembershipPort({
        memberships: [{ userId, tenantId }],
        seats: { [userId]: ["seat-1"] },
      }),
      attestationSecret: SECRET,
      targetIdentity,
      now: NOW,
    });
    expect(seatOk).toMatchObject({ ok: true, resolvedPath: "/workspace/steward/notes" });

    const groupDeny = evaluateS01AuthorizedToolCwd({
      catalog: catalogOf(
        { ...resource, ownerScope: { kind: "group_owned", groupId: "grp-1" } },
        binding,
      ),
      principal,
      requestedCwd: "/workspace/steward",
      operation: "read",
      memberships,
      attestationSecret: SECRET,
      targetIdentity,
      now: NOW,
    });
    expect(groupDeny).toMatchObject({ ok: false, code: "ERR_WORKSPACE_OWNER_DENIED" });

    const groupOk = evaluateS01AuthorizedToolCwd({
      catalog: catalogOf(
        { ...resource, ownerScope: { kind: "group_owned", groupId: "grp-1" } },
        binding,
      ),
      principal,
      requestedCwd: "/workspace/steward",
      operation: "read",
      memberships: createInMemoryS01MembershipPort({
        memberships: [{ userId, tenantId }],
        groups: { [userId]: ["grp-1"] },
      }),
      attestationSecret: SECRET,
      targetIdentity,
      now: NOW,
    });
    expect(groupOk).toMatchObject({ ok: true, resolvedPath: "/workspace/steward" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(
          { ...resource, ownerScope: { kind: "unknown", reason: "empty_registry" } },
          binding,
        ),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_OWNER_DENIED" });

    const duplicate = new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources: { [resource.resourceId]: resource },
      bindings: {
        [binding.bindingId]: binding,
        [`${workspaceResourceId}:canonical-2`]: {
          ...binding,
          bindingId: `${workspaceResourceId}:canonical-2`,
        },
      },
    });
    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: duplicate,
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, { ...binding, role: "compatibility" }),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_BINDING_NOT_CANONICAL" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, { ...binding, state: "read_only" }),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_BINDING_NOT_CANONICAL" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
        expectedFencing: { contentVersion: "stale", bindingId: binding.bindingId },
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, { ...binding, locator: "/ok\0hidden" }),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_INVALID_PATH" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/%E0%A4%A",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_INVALID_PATH" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/steward\\escape",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_INVALID_PATH" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW + S01_PRINCIPAL_MAX_AGE_MS + 1,
      }),
    ).toMatchObject({ ok: false, code: "ERR_PRINCIPAL_REQUIRED" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
        personalFallback: true,
      }),
    ).toMatchObject({ ok: false, code: "ERR_PRINCIPAL_REQUIRED" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity: { ...targetIdentity, tenantId: "ent-other" },
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_TENANT_MISMATCH" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships: createInMemoryS01MembershipPort({
          memberships: [{ userId, tenantId: "ent-other" }],
        }),
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_TENANT_MISMATCH" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(
          {
            ...resource,
            ownerScope: {
              kind: "user_owned",
              userId: "usr-other",
              agentAssetId,
              proof: {
                source: "explicit_binding",
                ownerType: "user",
                ownerId: "usr-other",
                agentAssetId,
              },
            },
          },
          binding,
        ),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_OWNER_DENIED" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf(resource, binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity: { ...targetIdentity, workspaceResourceId: "" },
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf({ ...resource, tenantId: "ent-other" }, binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_TENANT_MISMATCH" });

    expect(
      evaluateS01AuthorizedToolCwd({
        catalog: catalogOf({ ...resource, lifecycleState: "retired" }, binding),
        principal,
        requestedCwd: "/workspace/steward",
        operation: "read",
        memberships,
        attestationSecret: SECRET,
        targetIdentity,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED" });
  });
});
