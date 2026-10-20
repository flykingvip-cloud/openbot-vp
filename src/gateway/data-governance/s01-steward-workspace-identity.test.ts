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
  createInMemoryS01StewardRegistryPort,
  resolveS01StewardWorkspaceIdentity,
} from "./s01-steward-workspace-identity.js";

const tenantId = "ent-456";
const employeeOwnerId = "usr-123";
const stewardAgentId = "main";
const agentAssetId = "asset-steward-1";
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
      locator: "/workspace/steward",
      state: "active",
      contentVersion: "v1",
    },
  };
}

describe("resolveS01StewardWorkspaceIdentity", () => {
  it("valid session returns targetIdentity and locator", () => {
    const entry = activeEntry();
    const result = resolveS01StewardWorkspaceIdentity({
      tenantId,
      employeeOwnerId,
      stewardAgentId,
      registry,
      catalog: catalogWith(entry.resource, entry.binding),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.targetIdentity.workspaceResourceId).toBe(workspaceResourceId);
      expect(result.targetIdentity.agentAssetId).toBe(agentAssetId);
      expect(result.targetIdentity.expectedBindingRole).toBe("canonical");
      expect(result.targetIdentity.expectedBindingState).toBe("active");
      expect(result.targetIdentity.governanceVersion).toBe(1);
      expect(result.targetIdentity.contentVersion).toBe("v1");
      expect(result.targetIdentity.fencingToken).toEqual({
        contentVersion: "v1",
        bindingId: `${workspaceResourceId}:canonical`,
      });
      expect(result.locator).toBe("/workspace/steward");
    }
  });

  it("no handle / missing catalog resource returns not-found", () => {
    const result = resolveS01StewardWorkspaceIdentity({
      tenantId,
      employeeOwnerId,
      stewardAgentId,
      registry,
      catalog: createEmptyWorkspaceCatalog(),
    });
    expect(result).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND", failClosed: true });
  });

  it("catalog unreachable fail-closes", () => {
    const entry = activeEntry();
    const result = resolveS01StewardWorkspaceIdentity({
      tenantId,
      employeeOwnerId,
      stewardAgentId,
      registry,
      catalog: catalogWith(entry.resource, entry.binding, { status: "unavailable" }),
    });
    expect(result).toMatchObject({ ok: false, code: "ERR_CATALOG_UNAVAILABLE" });
  });

  it("registry miss or multi-value fails closed", () => {
    const entry = activeEntry();
    const miss = resolveS01StewardWorkspaceIdentity({
      tenantId,
      employeeOwnerId,
      stewardAgentId,
      registry: createInMemoryS01StewardRegistryPort([]),
      catalog: catalogWith(entry.resource, entry.binding),
    });
    expect(miss).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });
    const multi = resolveS01StewardWorkspaceIdentity({
      tenantId,
      employeeOwnerId,
      stewardAgentId,
      registry: createInMemoryS01StewardRegistryPort([
        { tenantId, agentId: stewardAgentId, agentAssetId },
        { tenantId, agentId: stewardAgentId, agentAssetId: "asset-other" },
      ]),
      catalog: catalogWith(entry.resource, entry.binding),
    });
    expect(multi).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });
  });

  it("multiple canonical bindings fail-close", () => {
    const entry = activeEntry();
    const catalog = new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources: { [entry.resource.resourceId]: entry.resource },
      bindings: {
        [entry.binding.bindingId]: entry.binding,
        [`${workspaceResourceId}:canonical-2`]: {
          ...entry.binding,
          bindingId: `${workspaceResourceId}:canonical-2`,
          locator: "/workspace/other",
        },
      },
    });
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog,
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });
  });

  it("inactive / retired handle is archived", () => {
    const entry = activeEntry();
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog: catalogWith(entry.resource, entry.binding, { lifecycleState: "retired" }),
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED" });
  });

  it("missing session context and wire identity are rejected", () => {
    const entry = activeEntry();
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId: "",
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog: catalogWith(entry.resource, entry.binding),
      }),
    ).toMatchObject({ ok: false, code: "ERR_PRINCIPAL_REQUIRED" });
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog: catalogWith(entry.resource, entry.binding),
        wireIdentity: { tenantId },
      }),
    ).toMatchObject({ ok: false, code: "ERR_PRINCIPAL_REQUIRED" });
  });

  it("catalog tenant mismatch is rejected", () => {
    const entry = activeEntry();
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog: catalogWith({ ...entry.resource, tenantId: "ent-other" }, entry.binding),
      }),
    ).toMatchObject({ ok: false, code: "ERR_TENANT_MISMATCH" });
  });

  it("stale fencing and slug-as-asset are rejected", () => {
    const entry = activeEntry();
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog: catalogWith(entry.resource, entry.binding),
        expectedFencing: { contentVersion: "stale", bindingId: entry.binding.bindingId },
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED" });
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId: "asset-steward-1",
        registry: createInMemoryS01StewardRegistryPort([
          { tenantId, agentId: "asset-steward-1", agentAssetId: "asset-steward-1" },
        ]),
        catalog: catalogWith(entry.resource, entry.binding),
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });
  });

  it("missing canonical binding and retired/read-only bindings fail closed", () => {
    const entry = activeEntry();
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog: catalogWith(entry.resource, { ...entry.binding, role: "compatibility" }),
      }),
    ).toMatchObject({ ok: false, code: "ERR_BINDING_NOT_CANONICAL" });
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog: catalogWith(entry.resource, { ...entry.binding, state: "retired" }),
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_ARCHIVED" });
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog: catalogWith(entry.resource, { ...entry.binding, state: "read_only" }),
      }),
    ).toMatchObject({ ok: false, code: "ERR_BINDING_NOT_CANONICAL" });
  });

  it("unsafe locator, owner mismatch, and object wire identity fail closed", () => {
    const entry = activeEntry();
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog: catalogWith(entry.resource, { ...entry.binding, locator: "../escape" }),
      }),
    ).toMatchObject({ ok: false, code: "ERR_INVALID_PATH" });
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog: catalogWith(entry.resource, { ...entry.binding, locator: "/ok\0hidden" }),
      }),
    ).toMatchObject({ ok: false, code: "ERR_INVALID_PATH" });
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId: "usr-other",
        stewardAgentId,
        registry: createInMemoryS01StewardRegistryPort([
          { tenantId, agentId: stewardAgentId, agentAssetId },
        ]),
        catalog: catalogWith(entry.resource, entry.binding),
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog: catalogWith(
          {
            ...entry.resource,
            ownerScope: {
              kind: "user_owned",
              userId: employeeOwnerId,
              agentAssetId: "asset-other",
              proof: {
                source: "explicit_binding",
                ownerType: "user",
                ownerId: employeeOwnerId,
                agentAssetId: "asset-other",
              },
            },
          },
          entry.binding,
        ),
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_OWNER_DENIED" });
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog: catalogWith(entry.resource, entry.binding),
        wireIdentity: { principal: { injected: true } },
      }),
    ).toMatchObject({ ok: false, code: "ERR_PRINCIPAL_REQUIRED" });
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry: {} as ReturnType<typeof createInMemoryS01StewardRegistryPort>,
        catalog: catalogWith(entry.resource, entry.binding),
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_NOT_FOUND" });
    expect(
      resolveS01StewardWorkspaceIdentity({
        tenantId,
        employeeOwnerId,
        stewardAgentId,
        registry,
        catalog: catalogWith(
          { ...entry.resource, ownerScope: { kind: "group_owned", groupId: "grp-1" } },
          entry.binding,
        ),
      }),
    ).toMatchObject({ ok: false, code: "ERR_WORKSPACE_OWNER_DENIED" });
  });
});
