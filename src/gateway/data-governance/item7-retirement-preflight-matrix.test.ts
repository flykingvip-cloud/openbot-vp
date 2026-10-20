import { describe, expect, it } from "vitest";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import type { PlatformAuthStore } from "../platform-auth/store-types.js";
import {
  buildGroupWorkspaceCatalogEntry,
  buildUserOwnedWorkspaceCatalogEntry,
} from "../workspace-resolver/builders.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
} from "../workspace-resolver/catalog.js";
import {
  denyLegacyLocatorCaller,
  resolveWorkspaceLocator,
} from "../workspace-resolver/strict-locator.js";
import type {
  WorkspaceBindingRecord,
  WorkspaceResourceRecord,
} from "../workspace-resolver/types.js";
import {
  ITEM7_BLOCKED_WORKSPACE_KINDS,
  ITEM7_CALL_SITE_MATRIX,
  ITEM7_PREFLIGHT_MATRIX_DELETE_CALL_SITES,
  ITEM7_PREFLIGHT_MATRIX_LIVE_WRITE_WATCH_INDEX,
  ITEM7_PREFLIGHT_MATRIX_RETIRED_THIS_CHANGE,
  type Item7CallSiteMatrixRow,
} from "./item7-retirement-preflight-matrix.js";
import { classifyLegacyCallSiteShape } from "./item7-retirement-preflight.js";

function platformAuthStore(userId: string): PlatformAuthStore {
  return {
    users: {
      [userId]: {
        id: userId,
        email: `${userId}@example.com`,
        displayName: userId,
        status: "active",
        scopes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    memberships: {},
    enterprises: {},
    employeeProvisions: {},
  } as unknown as PlatformAuthStore;
}

function seatStore(params: {
  seatId: string;
  tenantId: string;
  currentEmployeeId: string;
}): EnterpriseSeatAssetsStore {
  return {
    version: 1,
    seats: {
      [params.seatId]: {
        seatId: params.seatId,
        tenantId: params.tenantId,
        title: params.seatId,
        status: "occupied",
        currentEmployeeId: params.currentEmployeeId,
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    bindings: {},
    accessPolicies: {},
    assetBindings: {},
    credentialBindings: {},
    handovers: {},
    offers: {},
    auditEvents: {},
    enterpriseIdentities: {},
    identityUsagePolicies: {},
    dataSourceIdentityBindings: {},
    employeeIdentityEnrollments: {},
  };
}

function catalogOf(entry: {
  resource: WorkspaceResourceRecord;
  binding: WorkspaceBindingRecord;
}): InMemoryWorkspaceResourceCatalog {
  return new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog().snapshot(),
    resources: { [entry.resource.resourceId]: entry.resource },
    bindings: { [entry.binding.bindingId]: entry.binding },
  });
}

function passAfterQuery(row: Item7CallSiteMatrixRow) {
  const tenantId = `tenant-${row.ledgerId.toLowerCase()}`;
  const userId = `user-${row.ledgerId.toLowerCase()}`;
  const cfg = { data: { mode: "managed" as const } };
  if (row.workspaceKind === "group_owned") {
    const groupId = `group-${row.ledgerId.toLowerCase()}`;
    const entry = buildGroupWorkspaceCatalogEntry({
      tenantId,
      groupId,
      workspaceRoot: `/var/workspaces/${row.ledgerId}/group`,
    });
    return {
      tenantContext: { tenantId, userId, domain: "enterprise" as const },
      tenantId,
      actor: {
        userId,
        grant: { kind: "group" as const, subjectId: groupId, purpose: `preflight-${row.ledgerId}` },
      },
      resourceId: entry.resource.resourceId,
      catalog: catalogOf(entry),
      cfg,
      membership: {
        source: "platform-auth" as const,
        groupAcl: { tenantId, groupId, memberUserIds: [userId], available: true },
      },
    };
  }
  if (row.workspaceKind === "position_owned") {
    const seatId = `seat-${row.ledgerId.toLowerCase()}`;
    const agentAssetId = `asset-${row.ledgerId.toLowerCase()}`;
    const resourceId = `ws:${tenantId}:seat:${seatId}:asset:${agentAssetId}`;
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [resourceId]: {
          resourceId,
          resourceType: "workspace",
          tenantId,
          ownerScope: { kind: "position_owned" as const, seatId, agentAssetId },
          lifecycleState: "active",
          classification: "agent.workspace",
          governanceVersion: 1,
        },
      },
      bindings: {
        [`${resourceId}:canonical`]: {
          bindingId: `${resourceId}:canonical`,
          resourceId,
          role: "canonical",
          locator: `/var/workspaces/${row.ledgerId}/seat`,
          state: "active",
          contentVersion: "v1",
        },
      },
    });
    return {
      tenantContext: { tenantId, userId, domain: "enterprise" as const },
      tenantId,
      actor: {
        userId,
        grant: { kind: "seat" as const, subjectId: seatId, purpose: `preflight-${row.ledgerId}` },
      },
      resourceId,
      agentAssetId,
      catalog,
      cfg,
      membership: {
        source: "platform-auth" as const,
        platformAuthStore: platformAuthStore(userId),
        seatStore: seatStore({ seatId, tenantId, currentEmployeeId: userId }),
      },
    };
  }
  const agentAssetId =
    row.workspaceKind === "employee_private"
      ? `steward-${row.ledgerId.toLowerCase()}`
      : `asset-${row.ledgerId.toLowerCase()}`;
  const entry = buildUserOwnedWorkspaceCatalogEntry({
    tenantId,
    userId,
    agentAssetId,
    workspaceRoot: `/var/workspaces/${row.ledgerId}/user`,
    classification:
      row.workspaceKind === "employee_private" ? "employee_private" : "agent.workspace",
  });
  return {
    tenantContext: { tenantId, userId, domain: "enterprise" as const },
    tenantId,
    actor: {
      userId,
      grant: { kind: "user" as const, subjectId: userId, purpose: `preflight-${row.ledgerId}` },
    },
    resourceId: entry.resource.resourceId,
    agentAssetId,
    catalog: catalogOf(entry),
    cfg,
  };
}

describe("Item 7 retirement preflight matrix", () => {
  it("classifies all 37 ledger sites and keeps retirement locks", () => {
    expect(ITEM7_CALL_SITE_MATRIX).toHaveLength(37);
    expect(ITEM7_PREFLIGHT_MATRIX_LIVE_WRITE_WATCH_INDEX).toBe(37);
    expect(ITEM7_PREFLIGHT_MATRIX_RETIRED_THIS_CHANGE).toBe(0);
    expect(ITEM7_PREFLIGHT_MATRIX_DELETE_CALL_SITES).toBe(false);
    expect(ITEM7_BLOCKED_WORKSPACE_KINDS).toEqual(["unknown", "system"]);
    expect(ITEM7_CALL_SITE_MATRIX.some((row) => row.workspaceKind === "group_owned")).toBe(true);
    expect(ITEM7_CALL_SITE_MATRIX.some((row) => row.workspaceKind === "position_owned")).toBe(true);
    expect(ITEM7_CALL_SITE_MATRIX.some((row) => row.workspaceKind === "employee_private")).toBe(
      true,
    );
    expect(ITEM7_CALL_SITE_MATRIX.every((row) => row.blockedKinds.includes("unknown"))).toBe(true);
  });

  it("does not reuse one user-owned fixture as pass-after evidence", () => {
    const keys = ITEM7_CALL_SITE_MATRIX.map((row) => {
      const query = passAfterQuery(row);
      return `${query.tenantId}|${query.actor?.userId}|${query.resourceId}|${query.agentAssetId ?? "none"}`;
    });
    expect(new Set(keys).size).toBe(37);
    expect(keys.some((key) => key.includes("user-elle") && key.includes("asset-alpha"))).toBe(
      false,
    );
  });

  it("proves fail-before and pass-after for each classified site without deleting it", () => {
    for (const row of ITEM7_CALL_SITE_MATRIX) {
      expect(row.requiredTenantContext).toBe(true);
      expect(row.replacementApi).toBe("resolveWorkspaceLocator");
      expect(row.rollback.restoreFromGit).toBe(true);
      expect(row.quarantine.catalogMissDeny).toBe(false);
      const failBefore = denyLegacyLocatorCaller(
        classifyLegacyCallSiteShape({
          pathId: row.pathId,
          symbol: row.symbol,
          file: row.file,
          line: row.line,
          op: row.op,
        }),
      );
      expect(failBefore.ok).toBe(false);
      if (!failBefore.ok) {
        expect(failBefore.reasonCode).toBe(row.failBeforeReason);
        expect(failBefore.liveWriteWatchIndex).toBe(37);
      }
      const passAfter = resolveWorkspaceLocator(passAfterQuery(row));
      expect(passAfter.ok, row.ledgerId).toBe(true);
    }
  });
});
