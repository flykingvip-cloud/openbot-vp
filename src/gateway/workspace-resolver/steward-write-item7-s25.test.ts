import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildUserOwnedWorkspaceCatalogEntry, buildWorkspaceResourceId } from "./builders.js";
import { InMemoryWorkspaceResourceCatalog } from "./catalog.js";
import { resolveEmployeeStewardWritableWorkspaceDir } from "./steward-write.js";
import { resolveWorkspaceLocator, resolveWorkspaceTargetBinding } from "./strict-locator.js";
import type { WorkspaceBindingRecord } from "./types.js";

// Item 7 retirement batch 22 (S25): retire the steward TARGET host helper at
// steward-write.ts:153 and read the D1e target binding from the Catalog SoT via
// the controlled resolveWorkspaceTargetBinding. Not wired to production; item 7
// stays not-met; no production Catalog write, no schema v2, no LIVE.

const managedCfg = { data: { mode: "managed" as const } };
const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "steward-write.ts"),
  "utf8",
);
const lines = source.split("\n");

const TENANT = "tenant-a";
const USER = "user-elle";
const AGENT_ASSET = "steward:builtin";
const GRANT = { kind: "user" as const, subjectId: USER, purpose: "item7-batch22-s25" };
const TENANT_CONTEXT = { tenantId: TENANT, userId: USER, domain: "enterprise" as const };

function stewardResourceId(tenantId = TENANT, userId = USER): string {
  return buildWorkspaceResourceId({
    tenantId,
    scope: {
      kind: "user_owned",
      userId,
      agentAssetId: AGENT_ASSET,
      proof: {
        source: "explicit_binding",
        ownerType: "user",
        ownerId: userId,
        agentAssetId: AGENT_ASSET,
      },
    },
  });
}

function targetBinding(rid: string, locator: string, suffix = "target"): WorkspaceBindingRecord {
  return {
    bindingId: `${rid}:${suffix}`,
    resourceId: rid,
    role: "compatibility",
    state: "read_only",
    locator,
    contentVersion: "v1",
  };
}

/** Honest SoT: canonical/active source + compatibility/read_only D1e target, same resource. */
function seedSourceAndTarget(params: {
  sourceRoot: string;
  targetRoot: string;
  tenantId?: string;
  userId?: string;
  duplicateTarget?: boolean;
  omitSource?: boolean;
}): InMemoryWorkspaceResourceCatalog {
  const tenantId = params.tenantId ?? TENANT;
  const userId = params.userId ?? USER;
  const rid = stewardResourceId(tenantId, userId);
  const entry = buildUserOwnedWorkspaceCatalogEntry({
    tenantId,
    userId,
    agentAssetId: AGENT_ASSET,
    workspaceRoot: params.sourceRoot,
  });
  const bindings: Record<string, WorkspaceBindingRecord> = {
    [`${rid}:target`]: targetBinding(rid, params.targetRoot),
  };
  if (!params.omitSource) {
    bindings[entry.binding.bindingId] = entry.binding;
  }
  if (params.duplicateTarget) {
    bindings[`${rid}:target-2`] = targetBinding(rid, `${params.targetRoot}-2`, "target-2");
  }
  return new InMemoryWorkspaceResourceCatalog({
    governanceVersion: 1,
    status: "available",
    resources: { [entry.resource.resourceId]: entry.resource },
    bindings,
  });
}

describe("Item 7 batch 22 S25 steward target binding resolution", () => {
  it("retires the target host helper in favour of resolveWorkspaceTargetBinding", () => {
    // S25 target site reads the SoT target binding, no host path builder. Anchor on the site
    // content instead of an absolute line index: batch 24 removed two now-unused cutover imports
    // and moved the pilot out, shifting these sites upward. The invariant is the site, not the line.
    const targetRootSite = lines.find((line) => line.includes("const targetRoot ="));
    expect(targetRootSite).toBeDefined();
    expect(targetRootSite).toContain("resolveWorkspaceTargetBinding");
    expect(targetRootSite).not.toContain("resolveEmployeeStewardTargetWorkspaceDir");
    // Neighbouring S24 source site keeps its identity (SoT canonical locator).
    const sourceRootSite = lines.find((line) => line.includes("const sourceRoot ="));
    expect(sourceRootSite).toContain("resolveWorkspaceLocator"); // S24 source (accepted)
    // S26/S27 retired in batch 24: the pilot moved to provision-steward-cutover.ts and
    // steward-write.ts no longer calls the host-path resolvers.
    expect(source).not.toContain("export function runEmployeeStewardCutoverPilot");
    expect(source).not.toContain("resolveEmployeeStewardSourceWorkspaceDir(userId");
    expect(source).not.toContain("resolveEmployeeStewardTargetWorkspaceDir({");
    expect(source).not.toContain("process.cwd(");
  });

  it("resolves source (canonical) and target (compatibility) distinctly from one SoT", () => {
    const catalog = seedSourceAndTarget({
      sourceRoot: "/legacy-source",
      targetRoot: "/d1e-target",
    });
    const rid = stewardResourceId();
    const src = resolveWorkspaceLocator({
      tenantContext: TENANT_CONTEXT,
      tenantId: TENANT,
      actor: { userId: USER, grant: GRANT },
      resourceId: rid,
      agentAssetId: AGENT_ASSET,
      catalog,
      cfg: managedCfg,
    });
    const tgt = resolveWorkspaceTargetBinding({
      tenantContext: TENANT_CONTEXT,
      tenantId: TENANT,
      actor: { userId: USER, grant: GRANT },
      resourceId: rid,
      agentAssetId: AGENT_ASSET,
      catalog,
      cfg: managedCfg,
    });
    expect(src.ok).toBe(true);
    expect(tgt.ok).toBe(true);
    if (!src.ok || !tgt.ok) {
      return;
    }
    expect(src.handle.locator).toBe("/legacy-source");
    expect(tgt.handle.locator).toBe("/d1e-target");
    expect(tgt.handle.locator).not.toBe(src.handle.locator);
    expect(tgt.handle.bindingId).not.toBe(src.handle.bindingId);
  });

  it("fail-closes when the target binding is missing and never falls back to source", () => {
    const entry = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: TENANT,
      userId: USER,
      agentAssetId: AGENT_ASSET,
      workspaceRoot: "/legacy-source",
    });
    const catalog = new InMemoryWorkspaceResourceCatalog({
      governanceVersion: 1,
      status: "available",
      resources: { [entry.resource.resourceId]: entry.resource },
      bindings: { [entry.binding.bindingId]: entry.binding },
    });
    const tgt = resolveWorkspaceTargetBinding({
      tenantContext: TENANT_CONTEXT,
      tenantId: TENANT,
      actor: { userId: USER, grant: GRANT },
      resourceId: stewardResourceId(),
      agentAssetId: AGENT_ASSET,
      catalog,
      cfg: managedCfg,
    });
    expect(tgt).toMatchObject({ ok: false, reasonCode: "catalog_miss", failClosed: true });
    // The writable resolver fails closed with no host fallback and no target path synthesis.
    const writable = resolveEmployeeStewardWritableWorkspaceDir({
      tenantId: TENANT,
      userId: USER,
      cfg: managedCfg,
      catalog,
      grant: GRANT,
    });
    expect(writable).toMatchObject({ ok: false, reason: "catalog_record_required" });
    expect("cwd" in writable).toBe(false);
  });

  it("fail-closes ambiguous when more than one target binding exists", () => {
    const catalog = seedSourceAndTarget({
      sourceRoot: "/legacy-source",
      targetRoot: "/d1e-target",
      duplicateTarget: true,
    });
    expect(
      resolveWorkspaceTargetBinding({
        tenantContext: TENANT_CONTEXT,
        tenantId: TENANT,
        actor: { userId: USER, grant: GRANT },
        resourceId: stewardResourceId(),
        agentAssetId: AGENT_ASSET,
        catalog,
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "multi_binding", failClosed: true });
  });

  it("fail-closes on cross-tenant target access", () => {
    const catalog = seedSourceAndTarget({
      sourceRoot: "/legacy-source",
      targetRoot: "/d1e-target",
    });
    expect(
      resolveWorkspaceTargetBinding({
        tenantContext: { tenantId: "tenant-b", userId: USER, domain: "enterprise" },
        tenantId: "tenant-b",
        actor: { userId: USER, grant: GRANT },
        resourceId: stewardResourceId(),
        agentAssetId: AGENT_ASSET,
        catalog,
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "tenant_mismatch", failClosed: true });
  });

  it("fail-closes when the actor grant is missing or does not match ownership", () => {
    const catalog = seedSourceAndTarget({
      sourceRoot: "/legacy-source",
      targetRoot: "/d1e-target",
    });
    expect(
      resolveWorkspaceTargetBinding({
        tenantContext: TENANT_CONTEXT,
        tenantId: TENANT,
        actor: { userId: USER },
        resourceId: stewardResourceId(),
        agentAssetId: AGENT_ASSET,
        catalog,
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "missing_grant", failClosed: true });
    expect(
      resolveWorkspaceTargetBinding({
        tenantContext: TENANT_CONTEXT,
        tenantId: TENANT,
        actor: { userId: USER, grant: { kind: "user", subjectId: "someone-else", purpose: "x" } },
        resourceId: stewardResourceId(),
        agentAssetId: AGENT_ASSET,
        catalog,
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "auth_failure", failClosed: true });
  });

  it("fail-closes overall when the canonical source binding is missing", () => {
    const rid = stewardResourceId();
    const catalog = seedSourceAndTarget({
      sourceRoot: "/unused",
      targetRoot: "/d1e-target",
      omitSource: true,
    });
    expect(
      resolveWorkspaceLocator({
        tenantContext: TENANT_CONTEXT,
        tenantId: TENANT,
        actor: { userId: USER, grant: GRANT },
        resourceId: rid,
        agentAssetId: AGENT_ASSET,
        catalog,
        cfg: managedCfg,
      }),
    ).toMatchObject({ ok: false, reasonCode: "catalog_miss" });
    expect(
      resolveEmployeeStewardWritableWorkspaceDir({
        tenantId: TENANT,
        userId: USER,
        cfg: managedCfg,
        catalog,
        grant: GRANT,
      }),
    ).toMatchObject({ ok: false, reason: "catalog_record_required" });
  });

  it("keeps Item 7 controlled-retirement locks in the fail-closed payload", () => {
    expect(resolveWorkspaceTargetBinding({ cfg: managedCfg })).toMatchObject({
      ok: false,
      reasonCode: "missing_tenant_context",
      failClosed: true,
      item7: "not-met",
      live: "forbidden",
      productionCatalogWrite: "none",
      schemaV2Write: "disabled",
      phase1bExecutionBlocked: true,
      phase1bUnlock: "not-issued",
      deployAuthorized: false,
    });
  });
});
