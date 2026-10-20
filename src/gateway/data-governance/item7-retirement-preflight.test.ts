import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCHEMA_V2_ENABLED } from "../../memory/schema-v2.js";
import { buildUserOwnedWorkspaceCatalogEntry } from "../workspace-resolver/builders.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
} from "../workspace-resolver/catalog.js";
import { resolveWorkspaceLocator } from "../workspace-resolver/strict-locator.js";
import {
  evaluateItem7RetirementPreflight,
  ITEM7_PREFLIGHT_DELETE_CALL_SITES,
  ITEM7_PREFLIGHT_DEPLOY_AUTHORIZED,
  ITEM7_PREFLIGHT_EXECUTION_BLOCKED,
  ITEM7_PREFLIGHT_ITEM7,
  ITEM7_PREFLIGHT_LIVE,
  ITEM7_PREFLIGHT_LIVE_WRITE_WATCH_INDEX,
  ITEM7_PREFLIGHT_PHASE1B_UNLOCK,
  ITEM7_PREFLIGHT_PRODUCTION_CATALOG_WRITE,
  ITEM7_PREFLIGHT_RETIRED_THIS_CHANGE,
  ITEM7_PREFLIGHT_SCHEMA_V2_WRITE,
  proveItem7Quarantine,
  proveItem7Rollback,
  type Item7LiveCallSite,
} from "./item7-retirement-preflight.js";

const managedCfg = { data: { mode: "managed" as const } };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const getReplyPath = path.join(root, "src/auto-reply/reply/get-reply.ts");

function loadLiveSites(): Item7LiveCallSite[] {
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8")) as { sites: Item7LiveCallSite[] };
  return scan.sites;
}

describe("Item 7 retirement preflight", () => {
  it("keeps locks and does not authorize deletion", () => {
    const receipt = evaluateItem7RetirementPreflight();
    expect(receipt.rollbackProof).toBe(true);
    expect(receipt.quarantineProof).toBe(true);
    expect(receipt.independentRetirementReviewAccepted).toBe(true);
    expect(receipt.deleteCallSites).toBe(false);
    expect(receipt.retirementExecuted).toBe(false);
    expect(receipt.item7).toBe("not-met");
    expect(receipt.liveWriteWatchIndex).toBe(37);
    expect(receipt.retiredThisChange).toBe(0);
    expect(receipt.phase1bExecutionBlocked).toBe(true);
    expect(receipt.phase1bUnlock).toBe("not-issued");
    expect(receipt.deployAuthorized).toBe(false);
    expect(receipt.productionCatalogWrite).toBe("none");
    expect(receipt.schemaV2Write).toBe("disabled");
    expect(receipt.live).toBe("forbidden");
    expect(receipt.wiredToProductionResolver).toBe(false);
    expect(ITEM7_PREFLIGHT_ITEM7).toBe("not-met");
    expect(ITEM7_PREFLIGHT_PHASE1B_UNLOCK).toBe("not-issued");
    expect(ITEM7_PREFLIGHT_EXECUTION_BLOCKED).toBe(true);
    expect(ITEM7_PREFLIGHT_DEPLOY_AUTHORIZED).toBe(false);
    expect(ITEM7_PREFLIGHT_PRODUCTION_CATALOG_WRITE).toBe("none");
    expect(ITEM7_PREFLIGHT_SCHEMA_V2_WRITE).toBe("disabled");
    expect(SCHEMA_V2_ENABLED).toBe(false);
    expect(ITEM7_PREFLIGHT_LIVE).toBe("forbidden");
    expect(ITEM7_PREFLIGHT_DELETE_CALL_SITES).toBe(false);
    expect(ITEM7_PREFLIGHT_LIVE_WRITE_WATCH_INDEX).toBe(37);
    expect(ITEM7_PREFLIGHT_RETIRED_THIS_CHANGE).toBe(0);
  });

  it("proves rollback lifts tombstone and restores legacy without deleting sites", () => {
    const proof = proveItem7Rollback();
    expect(proof.rollbackProof).toBe(true);
    expect(proof.lifted).toBe(true);
    expect(proof.restoresLegacy).toBe(true);
    expect(proof.productionWrite).toBe(false);
    expect(proof.deletedCallSites).toBe(false);
  });

  it("proves quarantine on dual-read mismatch without catalog miss=deny", () => {
    const proof = proveItem7Quarantine();
    expect(proof.quarantineProof).toBe(true);
    expect(proof.quarantine).toBe(true);
    expect(proof.productionWrite).toBe("legacy-only");
    expect(proof.catalogMissDeny).toBe(false);
  });

  it("isolates duplicate agent slugs across tenants", () => {
    const tenantA = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "shared-slug",
      workspaceRoot: "/var/workspaces/tenant-a/shared-slug",
    });
    const tenantB = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-b",
      userId: "user-bob",
      agentAssetId: "shared-slug",
      workspaceRoot: "/var/workspaces/tenant-b/shared-slug",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [tenantA.resource.resourceId]: tenantA.resource,
        [tenantB.resource.resourceId]: tenantB.resource,
      },
      bindings: {
        [tenantA.binding.bindingId]: tenantA.binding,
        [tenantB.binding.bindingId]: tenantB.binding,
      },
    });
    const stolen = resolveWorkspaceLocator({
      tenantContext: {
        tenantId: "tenant-a",
        userId: "user-elle",
        domain: "enterprise" as const,
      },
      tenantId: "tenant-a",
      actor: {
        userId: "user-elle",
        grant: { kind: "user" as const, subjectId: "user-elle", purpose: "preflight-isolation" },
      },
      resourceId: tenantB.resource.resourceId,
      agentAssetId: "shared-slug",
      catalog,
      cfg: managedCfg,
    });
    expect(stolen).toMatchObject({ ok: false, reasonCode: "tenant_mismatch", failClosed: true });
  });

  it("denies missing TenantContext", () => {
    const entry = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "asset-alpha",
      workspaceRoot: "/var/workspaces/tenant-a/asset-alpha",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources: { [entry.resource.resourceId]: entry.resource },
      bindings: { [entry.binding.bindingId]: entry.binding },
    });
    expect(
      resolveWorkspaceLocator({
        tenantContext: null,
        tenantId: "tenant-a",
        actor: {
          userId: "user-elle",
          grant: { kind: "user" as const, subjectId: "user-elle", purpose: "preflight" },
        },
        resourceId: entry.resource.resourceId,
        agentAssetId: "asset-alpha",
        catalog,
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "missing_tenant_context", failClosed: true });
  });

  it("denies catalog missing, ambiguous, and multi-binding", () => {
    expect(
      resolveWorkspaceLocator({
        tenantContext: {
          tenantId: "tenant-a",
          userId: "user-elle",
          domain: "enterprise" as const,
        },
        tenantId: "tenant-a",
        actor: {
          userId: "user-elle",
          grant: { kind: "user" as const, subjectId: "user-elle", purpose: "preflight" },
        },
        resourceId: "ws:tenant-a:user:user-elle:asset:missing",
        agentAssetId: "missing",
        catalog: createEmptyWorkspaceCatalog(),
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "catalog_miss", failClosed: true });

    const first = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "asset-alpha",
      workspaceRoot: "/var/workspaces/a/one",
    });
    const second = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "asset-alpha",
      workspaceRoot: "/var/workspaces/a/two",
    });
    second.resource = { ...second.resource, resourceId: `${first.resource.resourceId}:dup` };
    second.binding = {
      ...second.binding,
      resourceId: second.resource.resourceId,
      bindingId: `${second.resource.resourceId}:canonical`,
    };
    const ambiguous = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: {
        [first.resource.resourceId]: first.resource,
        [second.resource.resourceId]: second.resource,
      },
      bindings: {
        [first.binding.bindingId]: first.binding,
        [second.binding.bindingId]: second.binding,
      },
    });
    expect(
      resolveWorkspaceLocator({
        tenantContext: {
          tenantId: "tenant-a",
          userId: "user-elle",
          domain: "enterprise" as const,
        },
        tenantId: "tenant-a",
        actor: {
          userId: "user-elle",
          grant: { kind: "user" as const, subjectId: "user-elle", purpose: "preflight" },
        },
        resourceId: first.resource.resourceId,
        agentAssetId: "asset-alpha",
        catalog: ambiguous,
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "catalog_ambiguous" });

    const multi = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: { [first.resource.resourceId]: first.resource },
      bindings: {
        [first.binding.bindingId]: first.binding,
        [`${first.binding.bindingId}:2`]: {
          ...first.binding,
          bindingId: `${first.binding.bindingId}:2`,
          locator: "/var/workspaces/a/other",
        },
      },
    });
    expect(
      resolveWorkspaceLocator({
        tenantContext: {
          tenantId: "tenant-a",
          userId: "user-elle",
          domain: "enterprise" as const,
        },
        tenantId: "tenant-a",
        actor: {
          userId: "user-elle",
          grant: { kind: "user" as const, subjectId: "user-elle", purpose: "preflight" },
        },
        resourceId: first.resource.resourceId,
        agentAssetId: "asset-alpha",
        catalog: multi,
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "multi_binding" });
  });

  it("does not treat the live scan as a shared user-owned pass-after fixture", () => {
    const sites = loadLiveSites();
    expect(sites.length).toBeGreaterThan(0);
    expect(ITEM7_PREFLIGHT_LIVE_WRITE_WATCH_INDEX).toBe(37);
    expect(fs.readFileSync(getReplyPath, "utf8")).toContain("resolveAgentWorkspaceDir");
    expect(fs.readFileSync(getReplyPath, "utf8")).not.toContain("resolveWorkspaceLocator(");
  });
});
