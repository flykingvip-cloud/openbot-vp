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
  issueS01TrustedPrincipal,
} from "./s01-authorized-tool-cwd.js";
import {
  evaluateS01StewardCwdShadow,
  isS01StageBStewardCwdShadowEnabled,
  runS01StewardCwdShadowIfEnabled,
  scheduleS01StewardCwdShadow,
} from "./s01-get-reply-steward-cwd-shadow.js";
import { createInMemoryS01StewardRegistryPort } from "./s01-steward-workspace-identity.js";

const tenantId = "ent-456";
const employeeOwnerId = "usr-123";
const stewardAgentId = "main";
const agentAssetId = "asset-steward-1";
const helperCwd = "/workspace/steward";
const attestationSecret = "s01-stage-b-shadow-test-secret";
const workspaceResourceId = buildWorkspaceResourceId({
  tenantId,
  scope: {
    kind: "user_owned",
    userId: employeeOwnerId,
    agentAssetId,
    proof: {
      source: "explicit_binding",
      ownerType: "user",
      ownerId: employeeOwnerId,
      agentAssetId,
    },
  },
});

const registry = createInMemoryS01StewardRegistryPort([
  { tenantId, agentId: stewardAgentId, agentAssetId },
]);

function catalogWith(
  resource: WorkspaceResourceRecord,
  binding: WorkspaceBindingRecord,
  extra?: Partial<WorkspaceResourceRecord> & { status?: "available" | "unavailable" },
): InMemoryWorkspaceResourceCatalog {
  const { status, ...resourceExtra } = extra ?? {};
  return new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog({ status: status ?? "available" }).snapshot(),
    resources: { [resource.resourceId]: { ...resource, ...resourceExtra } },
    bindings: { [binding.bindingId]: binding },
  });
}

function activeEntry(): { resource: WorkspaceResourceRecord; binding: WorkspaceBindingRecord } {
  return {
    resource: {
      resourceId: workspaceResourceId,
      resourceType: "workspace",
      tenantId,
      ownerScope: {
        kind: "user_owned",
        userId: employeeOwnerId,
        agentAssetId,
        proof: {
          source: "explicit_binding",
          ownerType: "user",
          ownerId: employeeOwnerId,
          agentAssetId,
        },
      },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
    },
    binding: {
      bindingId: `${workspaceResourceId}:canonical`,
      resourceId: workspaceResourceId,
      role: "canonical",
      locator: helperCwd,
      state: "active",
      contentVersion: "v1",
    },
  };
}

describe("S01 Stage B steward cwd shadow", () => {
  it("T10: flag off is default and does not evaluate", async () => {
    expect(isS01StageBStewardCwdShadowEnabled({})).toBe(false);
    const result = await runS01StewardCwdShadowIfEnabled({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId,
      tenantId,
      helperCwd,
      catalog: catalogWith(activeEntry().resource, activeEntry().binding),
      registry,
      env: {},
    });
    expect(result).toBeNull();
  });

  it("personal-local / non-steward records not_steward and does not guess a path", () => {
    const result = evaluateS01StewardCwdShadow({
      stewardException: false,
      employeeOwnerId,
      stewardAgentId,
      tenantId,
      helperCwd,
      catalog: catalogWith(activeEntry().resource, activeEntry().binding),
      registry,
    });
    expect(result.receipt).toBe("not_steward");
    expect(result.shadowLocatorPresent).toBe(false);
    expect(result.usedShadowPathForProduction).toBe(false);
    expect(result.productionCwdUnchanged).toBe(true);
  });

  it("missing identity or catalog fail-closes without guessing a managed path", () => {
    expect(
      evaluateS01StewardCwdShadow({
        stewardException: true,
        employeeOwnerId,
        stewardAgentId,
        tenantId: null,
        helperCwd,
        catalog: catalogWith(activeEntry().resource, activeEntry().binding),
        registry,
      }).receipt,
    ).toBe("fail_closed_missing_identity");
    expect(
      evaluateS01StewardCwdShadow({
        stewardException: true,
        employeeOwnerId,
        stewardAgentId,
        tenantId,
        helperCwd,
        registry,
      }).receipt,
    ).toBe("fail_closed_missing_catalog");
  });

  it("T11: Catalog miss is recorded; production cwd stays helper", () => {
    const result = evaluateS01StewardCwdShadow({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId,
      tenantId,
      helperCwd,
      catalog: createEmptyWorkspaceCatalog(),
      registry,
    });
    expect(result.receipt).toBe("catalog_miss");
    expect(result.identityCode).toBe("ERR_WORKSPACE_NOT_FOUND");
    expect(result.shadowLocatorPresent).toBe(false);
    expect(result.usedShadowPathForProduction).toBe(false);
    expect(result.productionCwdUnchanged).toBe(true);
  });

  it("T12: tenant mismatch / fencing stale / missing authorization receipts", () => {
    const entry = activeEntry();
    const missingAuth = evaluateS01StewardCwdShadow({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId,
      tenantId,
      helperCwd,
      catalog: catalogWith(entry.resource, entry.binding),
      registry,
    });
    expect(missingAuth.receipt).toBe("fail_closed_missing_authorization");
    expect(missingAuth.usedShadowPathForProduction).toBe(false);

    const mismatch = evaluateS01StewardCwdShadow({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId,
      tenantId,
      helperCwd,
      catalog: catalogWith({ ...entry.resource, tenantId: "ent-other" }, entry.binding),
      registry,
    });
    expect(mismatch.receipt).toBe("tenant_mismatch");
    expect(mismatch.identityCode).toBe("ERR_TENANT_MISMATCH");

    const stale = evaluateS01StewardCwdShadow({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId,
      tenantId,
      helperCwd,
      catalog: catalogWith(entry.resource, entry.binding),
      registry,
      expectedFencing: { contentVersion: "stale", bindingId: entry.binding.bindingId },
    });
    expect(stale.receipt).toBe("fencing_stale");
    expect(stale.identityCode).toBe("ERR_WORKSPACE_ARCHIVED");
  });

  it("principal or membership missing cannot record a match", () => {
    const entry = activeEntry();
    const principal = issueS01TrustedPrincipal({
      userId: employeeOwnerId,
      tenantId,
      sessionId: "sess-stage-b",
      attestationSecret,
    });
    expect(
      evaluateS01StewardCwdShadow({
        stewardException: true,
        employeeOwnerId,
        stewardAgentId,
        tenantId,
        helperCwd,
        catalog: catalogWith(entry.resource, entry.binding),
        registry,
        principal,
        attestationSecret,
      }).receipt,
    ).toBe("fail_closed_missing_authorization");
    expect(
      evaluateS01StewardCwdShadow({
        stewardException: true,
        employeeOwnerId,
        stewardAgentId,
        tenantId,
        helperCwd,
        catalog: catalogWith(entry.resource, entry.binding),
        registry,
        memberships: createInMemoryS01MembershipPort({
          memberships: [{ userId: employeeOwnerId, tenantId }],
        }),
        attestationSecret,
      }).receipt,
    ).toBe("fail_closed_missing_authorization");
  });

  it("authorized cwd deny is recorded; both successes are the only match", () => {
    const entry = activeEntry();
    const principal = issueS01TrustedPrincipal({
      userId: employeeOwnerId,
      tenantId,
      sessionId: "sess-stage-b",
      attestationSecret,
    });
    const denied = evaluateS01StewardCwdShadow({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId,
      tenantId,
      helperCwd,
      catalog: catalogWith(entry.resource, entry.binding),
      registry,
      principal,
      memberships: createInMemoryS01MembershipPort({
        memberships: [{ userId: "other-user", tenantId }],
      }),
      attestationSecret,
    });
    expect(denied.receipt).toBe("authorization_denied");
    expect(denied.cwdCode).toBe("ERR_TENANT_BINDING_REQUIRED");
    expect(denied.usedShadowPathForProduction).toBe(false);

    const match = evaluateS01StewardCwdShadow({
      stewardException: true,
      employeeOwnerId,
      stewardAgentId,
      tenantId,
      helperCwd,
      catalog: catalogWith(entry.resource, entry.binding),
      registry,
      principal,
      memberships: createInMemoryS01MembershipPort({
        memberships: [{ userId: employeeOwnerId, tenantId }],
      }),
      attestationSecret,
    });
    expect(match.receipt).toBe("identity_and_authorization_match");
    expect(match.usedShadowPathForProduction).toBe(false);
    expect(match.productionCwdUnchanged).toBe(true);
  });

  it("schedule swallows rejection without changing helper cwd", async () => {
    const helperCwdBefore = helperCwd;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      scheduleS01StewardCwdShadow(() => Promise.reject(new Error("shadow boom")));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
      expect(helperCwdBefore).toBe(helperCwd);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
