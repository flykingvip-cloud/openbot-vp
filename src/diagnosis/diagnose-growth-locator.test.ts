import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createEmptyAgentRegistryStore,
  type AgentRegistryStore,
} from "../gateway/agent-registry/types.js";
import type { PlatformAuthStore } from "../gateway/platform-auth.js";
import { buildWorkspaceResourceId } from "../gateway/workspace-resolver/builders.js";
import { InMemoryWorkspaceResourceCatalog } from "../gateway/workspace-resolver/catalog.js";
import type {
  WorkspaceBindingRecord,
  WorkspaceResourceRecord,
} from "../gateway/workspace-resolver/types.js";
import { readDiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import {
  isDiagnosisTenantAdmin,
  resolveDiagnoseGrowthActor,
  resolveGovernedDiagnoseGrowthReads,
} from "./diagnose-growth-locator.js";

const source = readFileSync(
  fileURLToPath(new URL("./diagnose-growth-locator.ts", import.meta.url)),
  "utf8",
);

const TENANT = "tenant-a";
const OWNER = "employee-9";
const ASSET = "asset-11111111-1111-4111-8111-111111111111";
const LOCATOR = "/var/openbot/tenant-a/employee-9/workspace";

function registry(agentAssetId = ASSET): AgentRegistryStore {
  const store = createEmptyAgentRegistryStore();
  store.assets[agentAssetId] = {
    agentAssetId,
    enterpriseId: TENANT,
    agentSlug: "bot-2",
    displayName: "销售助手",
    status: "active",
    legacyAgentId: "bot-2",
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
  };
  store.ownerBindings["own-1"] = {
    bindingId: "own-1",
    enterpriseId: TENANT,
    agentAssetId,
    ownerType: "membership",
    ownerId: OWNER,
    isPrimary: true,
    effectiveAt: "2026-09-19T00:00:00.000Z",
  };
  return store;
}

function catalog(locator = LOCATOR, tenantId = TENANT): InMemoryWorkspaceResourceCatalog {
  const resourceId = buildWorkspaceResourceId({
    tenantId,
    scope: {
      kind: "user_owned",
      userId: OWNER,
      agentAssetId: ASSET,
      proof: {
        source: "explicit_binding",
        ownerType: "user",
        ownerId: OWNER,
        agentAssetId: ASSET,
      },
    },
  });
  const resource: WorkspaceResourceRecord = {
    resourceId,
    resourceType: "workspace",
    tenantId,
    ownerScope: {
      kind: "user_owned",
      userId: OWNER,
      agentAssetId: ASSET,
      proof: {
        source: "explicit_binding",
        ownerType: "user",
        ownerId: OWNER,
        agentAssetId: ASSET,
      },
    },
    lifecycleState: "active",
    classification: "internal",
    governanceVersion: 1,
  };
  const binding: WorkspaceBindingRecord = {
    bindingId: "bind-1",
    resourceId,
    role: "canonical",
    locator,
    state: "active",
    contentVersion: "1",
  };
  return new InMemoryWorkspaceResourceCatalog({
    governanceVersion: 1,
    status: "available",
    resources: { [resourceId]: resource },
    bindings: { [binding.bindingId]: binding },
  });
}

describe("governed diagnose growth locator", () => {
  it("does not use the legacy workspace resolver or an agent slug as the asset id", () => {
    expect(source).not.toContain("resolveAgentWorkspaceDir");
    const reads = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: OWNER,
      locators: [{ agentId: "bot-2", sessionKey: "agent:bot-2:main" }],
      registry: registry("bot-2"),
      catalog: catalog(),
    });
    expect(reads[0]?.agentAssetId).toBe("");
    expect(reads[0]?.workspaceDir).toBeUndefined();
  });

  it("injects the catalog locator for the owner and hides it from another actor", () => {
    const owned = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: OWNER,
      locators: [{ agentId: "bot-2", sessionKey: "/tmp/client-path" }],
      registry: registry(),
      catalog: catalog(),
      scopedJobs: [
        { id: "job-owner", name: "owner-job", tenantId: TENANT, ownerId: OWNER },
        { id: "job-other", name: "other-job", tenantId: "tenant-b", ownerId: OWNER },
        { id: "job-admin", name: "admin-job", tenantId: TENANT, ownerId: "admin-1" },
      ],
    });
    expect(owned[0]?.workspaceDir).toBe(LOCATOR);
    expect(owned[0]?.agentAssetId).toBe(ASSET);
    expect(owned[0]?.targetOwnerId).toBe(OWNER);
    expect(owned[0]?.displayName).toBe("销售助手");
    expect(owned[0]?.scopedJobs?.map((job) => job.id)).toEqual(["job-owner"]);
    expect(JSON.stringify(owned)).not.toContain("/tmp/client-path");

    const admin = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: "admin-1",
      locators: [{ agentId: "bot-2", sessionKey: "agent:bot-2:main" }],
      registry: registry(),
      catalog: catalog(),
    });
    expect(admin[0]?.agentAssetId).toBe(ASSET);
    expect(admin[0]?.workspaceDir).toBeUndefined();
    expect(JSON.stringify(admin)).not.toContain(LOCATOR);
  });

  it("lets a same-tenant admin read an employee workspace without a second grant", () => {
    expect(isDiagnosisTenantAdmin({ sessionDomain: "enterprise" })).toBe(true);
    expect(isDiagnosisTenantAdmin({ sessionKind: "enterprise-admin" })).toBe(true);
    expect(isDiagnosisTenantAdmin({ sessionDomain: "employee" })).toBe(false);
    expect(isDiagnosisTenantAdmin({ sessionKind: "member" })).toBe(false);
    expect(
      resolveDiagnoseGrowthActor({
        tenantId: TENANT,
        actorUserId: "admin-1",
        sessionDomain: "employee",
      })?.tenantAdmin,
    ).toBe(false);

    const membershipStore = {
      users: {
        "admin-1": {
          id: "admin-1",
          normalizedEmail: "ceo@acme.test",
        },
      },
      memberships: {
        "mem-admin": {
          id: "mem-admin",
          userId: "admin-1",
          enterpriseId: TENANT,
          membershipRole: "enterprise-admin",
        },
        "mem-elle": {
          id: "mem-elle",
          userId: "employee-other",
          enterpriseId: TENANT,
          membershipRole: "member",
        },
      },
    } as unknown as PlatformAuthStore;
    expect(
      resolveDiagnoseGrowthActor({
        tenantId: TENANT,
        actorUserId: "admin-1",
        sessionDomain: "employee",
        store: membershipStore,
      }),
    ).toEqual({ tenantId: TENANT, actorUserId: "admin-1", tenantAdmin: true });
    expect(
      resolveDiagnoseGrowthActor({
        actorUserId: "admin-1",
        sessionDomain: "employee",
        store: membershipStore,
      }),
    ).toEqual({ tenantId: TENANT, actorUserId: "admin-1", tenantAdmin: true });
    expect(
      resolveDiagnoseGrowthActor({
        tenantId: TENANT,
        actorUserId: "employee-other",
        sessionDomain: "employee",
        store: membershipStore,
      }),
    ).toEqual({ tenantId: TENANT, actorUserId: "employee-other", tenantAdmin: false });
    expect(
      resolveDiagnoseGrowthActor({
        actorUserId: "ceo@acme.test",
        sessionDomain: "employee",
        store: membershipStore,
      }),
    ).toEqual({ tenantId: TENANT, actorUserId: "admin-1", tenantAdmin: true });

    const admin = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: "admin-1",
      locators: [{ agentId: "bot-2", sessionKey: "agent:bot-2:main" }],
      registry: registry(),
      catalog: catalog(),
      tenantAdmin: true,
    });
    expect(admin[0]?.workspaceDir).toBe(LOCATOR);
    expect(admin[0]?.targetOwnerId).toBe(OWNER);

    const otherTenant = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: "admin-1",
      locators: [{ agentId: "bot-2", sessionKey: "agent:bot-2:main" }],
      registry: registry(),
      catalog: catalog(LOCATOR, "tenant-b"),
      tenantAdmin: true,
    });
    expect(otherTenant[0]?.workspaceDir).toBeUndefined();
    expect(JSON.stringify(otherTenant)).not.toContain(LOCATOR);
  });

  it("places an unplaced catalog identity onto the robot-own write root", async () => {
    const fs = await import("node:fs");
    const stateDir = path.join(os.tmpdir(), `diag-place-${Date.now()}`);
    const placed = path.join(
      stateDir,
      "tenants",
      TENANT,
      "users",
      OWNER,
      "OpenBot",
      "agents",
      "bot-2",
      "workspace",
    );
    fs.mkdirSync(placed, { recursive: true });
    fs.writeFileSync(path.join(placed, "IDENTITY.md"), "name: 销售助手\n");
    const admin = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: "admin-1",
      locators: [{ agentId: "bot-2", sessionKey: "agent:bot-2:main" }],
      registry: registry(),
      catalog: catalog(`unplaced://classified/ws:${TENANT}:user:${OWNER}:asset:${ASSET}`),
      tenantAdmin: true,
      stateDir,
    });
    expect(admin[0]?.workspaceDir).toBe(placed);

    const stranger = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: "employee-other",
      locators: [{ agentId: "bot-2", sessionKey: "agent:bot-2:main" }],
      registry: registry(),
      catalog: catalog(`unplaced://classified/ws:${TENANT}:user:${OWNER}:asset:${ASSET}`),
      stateDir,
    });
    expect(stranger[0]?.workspaceDir).toBeUndefined();
    expect(JSON.stringify(stranger)).not.toContain(placed);
  });

  it("rejects a locator that traverses and a workspace symlink", async () => {
    const traversed = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: OWNER,
      locators: [{ agentId: "bot-2", sessionKey: "agent:bot-2:main" }],
      registry: registry(),
      catalog: catalog("/tmp/diag/../../etc"),
    });
    expect(traversed[0]?.workspaceDir).toBeUndefined();

    const dir = path.join(os.tmpdir(), `diag-link-${Date.now()}`);
    const real = path.join(dir, "real");
    const link = path.join(dir, "link");
    const fs = await import("node:fs");
    fs.mkdirSync(real, { recursive: true });
    fs.writeFileSync(path.join(real, "IDENTITY.md"), "secret-identity-body");
    fs.symlinkSync(real, link);
    const assessed = await readDiagnoseGrowthAssessment({
      agentId: "bot-2",
      sessionKey: "agent:bot-2:main",
      windowMs: 1_000,
      workspaceDir: link,
    });
    expect(assessed.identity.readable).toBe(false);
    expect(JSON.stringify(assessed)).not.toContain("secret-identity-body");
  });

  it("does not treat the coordinator asset as the collaboration group workspace", () => {
    const groupId = "grp-sales";
    const resourceId = buildWorkspaceResourceId({
      tenantId: TENANT,
      scope: { kind: "group_owned", groupId },
    });
    const groupCatalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [resourceId]: {
          resourceId,
          resourceType: "workspace",
          tenantId: TENANT,
          ownerScope: { kind: "group_owned", groupId },
          lifecycleState: "active",
          classification: "internal",
          governanceVersion: 1,
        },
      },
      bindings: {
        "bind-g": {
          bindingId: "bind-g",
          resourceId,
          role: "canonical",
          locator: "/var/openbot/groups/grp-sales",
          state: "active",
          contentVersion: "1",
        },
      },
    });
    const denied = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: OWNER,
      locators: [{ agentId: "main", sessionKey: `agent:main:space:${groupId}` }],
      registry: registry(),
      catalog: groupCatalog,
    });
    expect(denied[0]?.displayName).toBe("协作小组 grp-sales");
    expect(denied[0]?.agentAssetId).toBe("");
    expect(denied[0]?.workspaceDir).toBeUndefined();

    const admin = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: "admin-1",
      locators: [{ agentId: "main", sessionKey: `agent:main:space:${groupId}` }],
      registry: registry(),
      catalog: groupCatalog,
      tenantAdmin: true,
    });
    expect(admin[0]?.workspaceDir).toBe("/var/openbot/groups/grp-sales");
    expect(admin[0]?.agentAssetId).toBe("");

    const allowed = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: OWNER,
      locators: [{ agentId: "main", sessionKey: `agent:main:space:${groupId}` }],
      registry: registry(),
      catalog: groupCatalog,
      groupAclById: {
        [groupId]: {
          tenantId: TENANT,
          groupId,
          memberUserIds: [OWNER],
          available: true,
        },
      },
    });
    expect(allowed[0]?.workspaceDir).toBe("/var/openbot/groups/grp-sales");
    expect(allowed[0]?.agentAssetId).toBe("");
  });
});

describe("Track D M1 locator_failed codes", () => {
  const groupId = "grp-daniel-hhd";

  function groupCatalog(
    opts: {
      locator?: string | null;
      bindings?: Array<{ bindingId: string; locator: string }>;
      includeResource?: boolean;
    } = {},
  ) {
    const resourceId = buildWorkspaceResourceId({
      tenantId: TENANT,
      scope: { kind: "group_owned", groupId },
    });
    const includeResource = opts.includeResource !== false;
    const resources: Record<string, WorkspaceResourceRecord> = {};
    if (includeResource) {
      resources[resourceId] = {
        resourceId,
        resourceType: "workspace",
        tenantId: TENANT,
        ownerScope: { kind: "group_owned", groupId },
        lifecycleState: "active",
        classification: "internal",
        governanceVersion: 1,
      };
    }
    const bindings: Record<string, WorkspaceBindingRecord> = {};
    if (opts.bindings) {
      for (const row of opts.bindings) {
        bindings[row.bindingId] = {
          bindingId: row.bindingId,
          resourceId,
          role: "canonical",
          locator: row.locator,
          state: "active",
          contentVersion: "1",
        };
      }
    } else if (opts.locator) {
      bindings["bind-g"] = {
        bindingId: "bind-g",
        resourceId,
        role: "canonical",
        locator: opts.locator,
        state: "active",
        contentVersion: "1",
      };
    }
    return new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources,
      bindings,
    });
  }

  it("catalog_miss sets locator_failed", () => {
    const reads = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: OWNER,
      locators: [{ agentId: "main", sessionKey: `agent:main:space:${groupId}` }],
      registry: registry(),
      catalog: groupCatalog({ includeResource: false }),
      tenantAdmin: true,
    });
    expect(reads[0]?.locatorStatus).toBe("locator_failed");
    expect(reads[0]?.locatorFailureCode).toBe("catalog_miss");
    expect(reads[0]?.workspaceDir).toBeUndefined();
  });

  it("canonical_missing sets locator_failed", () => {
    const reads = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: "admin-1",
      locators: [{ agentId: "main", sessionKey: `agent:main:space:${groupId}` }],
      registry: registry(),
      catalog: groupCatalog({ bindings: [] }),
      tenantAdmin: true,
    });
    expect(reads[0]?.locatorStatus).toBe("locator_failed");
    expect(reads[0]?.locatorFailureCode).toBe("canonical_missing");
    expect(reads[0]?.workspaceDir).toBeUndefined();
  });

  it("canonical_ambiguous sets locator_failed", () => {
    const reads = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: "admin-1",
      locators: [{ agentId: "main", sessionKey: `agent:main:space:${groupId}` }],
      registry: registry(),
      catalog: groupCatalog({
        bindings: [
          { bindingId: "b1", locator: "/var/openbot/groups/a" },
          { bindingId: "b2", locator: "/var/openbot/groups/b" },
        ],
      }),
      tenantAdmin: true,
    });
    expect(reads[0]?.locatorStatus).toBe("locator_failed");
    expect(reads[0]?.locatorFailureCode).toBe("canonical_ambiguous");
  });

  it("acl_denied sets locator_failed for non-member", () => {
    const reads = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: OWNER,
      locators: [{ agentId: "main", sessionKey: `agent:main:space:${groupId}` }],
      registry: registry(),
      catalog: groupCatalog({ locator: "/var/openbot/groups/grp-sales" }),
      groupAclById: {
        [groupId]: {
          tenantId: TENANT,
          groupId,
          memberUserIds: ["someone-else"],
          available: true,
        },
      },
    });
    expect(reads[0]?.locatorStatus).toBe("locator_failed");
    expect(reads[0]?.locatorFailureCode).toBe("acl_denied");
  });

  it("admin_ok sets located with empty agentAssetId", () => {
    const reads = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: "admin-1",
      locators: [{ agentId: "main", sessionKey: `agent:main:space:${groupId}` }],
      registry: registry(),
      catalog: groupCatalog({ locator: "/var/openbot/groups/grp-sales" }),
      tenantAdmin: true,
    });
    expect(reads[0]?.locatorStatus).toBe("located");
    expect(reads[0]?.workspaceDir).toBe("/var/openbot/groups/grp-sales");
    expect(reads[0]?.agentAssetId).toBe("");
  });

  it("member_acl_ok sets located", () => {
    const reads = resolveGovernedDiagnoseGrowthReads({
      tenantId: TENANT,
      actorUserId: OWNER,
      locators: [{ agentId: "main", sessionKey: `agent:main:space:${groupId}` }],
      registry: registry(),
      catalog: groupCatalog({ locator: "/var/openbot/groups/grp-sales" }),
      groupAclById: {
        [groupId]: {
          tenantId: TENANT,
          groupId,
          memberUserIds: [OWNER],
          available: true,
        },
      },
    });
    expect(reads[0]?.locatorStatus).toBe("located");
    expect(reads[0]?.workspaceDir).toBe("/var/openbot/groups/grp-sales");
    expect(reads[0]?.agentAssetId).toBe("");
  });
});
