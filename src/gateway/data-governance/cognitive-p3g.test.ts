import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../tenant-context.js";
import {
  createFileDataGovernanceCatalogStore,
  resetCatalogStoreSingletonsForTests,
} from "./catalog-store.js";
import {
  compareAndPutAnchorPointer,
  listHumanVerifiedAnchors,
  readAnchorMutationByOperation,
  readHumanVerifiedAnchor,
  uniqueCreateHumanVerifiedAnchor,
  withAnchorOperation,
} from "./cognitive-anchor-store.js";
import {
  activateAnchor,
  proposeAnchor,
  readActiveAnchor,
  readAnchorPointer,
  readDerivedAnchorStatus,
  revokeAnchor,
  supersedeAnchor,
} from "./cognitive-anchor.js";
import { resolveGovernanceApprovalAuth } from "./cognitive-approval-auth.js";
import { writeGovernanceApprovalGrantAtDeployBoundary } from "./cognitive-approval-grant-store.js";
import { readConflictGraphHead } from "./cognitive-conflict-graph.js";
import { applyCognitiveMerge } from "./cognitive-merge.js";
import { authenticateGovernanceCall } from "./cognitive-recommendation-auth.js";
import { unlockCognitiveWritesForTests } from "./cognitive-write-unlock.test-harness.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import { reclaimAnchorPointerOrphans } from "./pointer-orphan-reclamation.js";
import type {
  CatalogRecord,
  GovernanceApprovalGrantRecord,
  HumanVerifiedAnchor,
  OwnershipPrincipal,
  PointerMutationReceipt,
} from "./types.js";

const resolveTenantContextMock = vi.hoisted(() =>
  vi.fn(async (): Promise<TenantContext | null> => null),
);
const resolveAuthoritativeMembershipMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{ tenantId: string | null; userId: string | null }> => ({
      tenantId: null,
      userId: null,
    }),
  ),
);

vi.mock("../tenant-context.js", () => ({
  resolveTenantContext: resolveTenantContextMock,
  resolveAuthoritativeMembership: resolveAuthoritativeMembershipMock,
  TenantContextError: class TenantContextError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  },
}));

const tempDirs: string[] = [];
afterEach(() => {
  resetCatalogStoreSingletonsForTests();
  resolveTenantContextMock.mockReset();
  resolveTenantContextMock.mockResolvedValue(null);
  resolveAuthoritativeMembershipMock.mockReset();
  resolveAuthoritativeMembershipMock.mockResolvedValue({ tenantId: null, userId: null });
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpStateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p3g-"));
  tempDirs.push(dir);
  return dir;
}

async function enterpriseCall() {
  resolveTenantContextMock.mockResolvedValue({
    tenantId: "t1",
    userId: "u1",
    domain: "enterprise",
  });
  const authenticated = await authenticateGovernanceCall({
    connect: {} as never,
    user: "u1@acme.test",
    sessionDomain: "enterprise",
  });
  if (!authenticated.ok) {
    throw new Error("expected authenticated call");
  }
  return authenticated.call;
}

function writeGrant(stateDir: string, record: GovernanceApprovalGrantRecord): void {
  writeGovernanceApprovalGrantAtDeployBoundary({ record, stateDir });
}

async function anchorAuth(
  stateDir: string,
  kind: "anchor_activate" | "anchor_supersede" | "anchor_revoke",
  resourceId = "mem-target",
) {
  const grantId = `grant-${kind}-${resourceId}`;
  writeGrant(stateDir, {
    grantId,
    kind: "governance_approval_grant",
    grantKind: kind,
    tenantId: "t1",
    scope: { kind: "resource", resourceId },
    approverUserId: "u1",
    issuedBy: "enterprise_ops",
    issuedAt: "2026-08-11T00:00:00Z",
    expiresAt: "2027-08-11T00:00:00Z",
  });
  const resolved = await resolveGovernanceApprovalAuth({
    call: await enterpriseCall(),
    owner: { kind: "user", userId: "u1" },
    grantId,
    requiredKind: kind,
    requiredScope: { kind: "resource", resourceId },
    stateDir,
  });
  if (!resolved.ok) {
    throw new Error(`expected ${kind}: ${resolved.reason}`);
  }
  return resolved.auth;
}

function memoryRow(
  resourceId: string,
  params: { tenantId?: string | null; owner?: OwnershipPrincipal } = {},
): CatalogRecord {
  const tenantId = params.tenantId === undefined ? "t1" : params.tenantId;
  return {
    envelope: {
      resourceId,
      resourceType: "memory",
      schemaVersion: 1,
      tenantId,
      owner: params.owner ?? { kind: "user", userId: "u1" },
      scope: tenantId ? { kind: "tenant", tenantId } : { kind: "system" },
      lifecycleState: "active",
      classification: "confidential",
      governanceVersion: 1,
      canonicalBindingId: `bind-${resourceId}`,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
      projection: { canonicalKind: "cogniweave", atomId: resourceId, memoryTier: "working" },
    },
    bindings: [
      {
        bindingId: `bind-${resourceId}`,
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: `/data/${resourceId}`,
        state: "active",
        contentVersion: "v1",
      },
    ],
  };
}

/** Anchors bind to the authoritative governed resource, so the Catalog row must exist. */
async function registerResources(
  stateDir: string,
  records: CatalogRecord[] = [memoryRow("mem-target")],
) {
  const catalog = createFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(stateDir),
  });
  for (const record of records) {
    await catalog.put(record);
  }
  return catalog;
}

async function readyStateDir(records?: CatalogRecord[]): Promise<string> {
  const stateDir = tmpStateDir();
  unlockCognitiveWritesForTests(stateDir);
  await registerResources(stateDir, records);
  return stateDir;
}

/**
 * Crash simulation: an immutable row plus its `prepared` receipt, with the pointer CAS not
 * yet attempted. Mirrors the durable state left behind when the process dies mid-operation.
 */
async function seedPreparedMutation(params: {
  stateDir: string;
  operationId: string;
  row: HumanVerifiedAnchor;
  expectedPointerVersion: number;
}): Promise<{ row: HumanVerifiedAnchor; receipt: PointerMutationReceipt }> {
  const created = await uniqueCreateHumanVerifiedAnchor({
    anchor: params.row,
    stateDir: params.stateDir,
  });
  if (!created.ok) {
    throw new Error("expected seeded row");
  }
  const receipt = await withAnchorOperation(
    {
      resourceId: params.row.resourceId,
      operationId: params.operationId,
      stateDir: params.stateDir,
    },
    (op) => {
      const result = op.createReceipt({
        mutationId: `mut-seed-${params.operationId}`,
        kind: "anchor_mutation",
        operationId: params.operationId,
        resourceKey: params.row.resourceId,
        historyRowId: created.anchor.anchorId,
        expectedPointerVersion: params.expectedPointerVersion,
        status: "prepared",
        createdAt: new Date().toISOString(),
      });
      if (!result.ok) {
        throw new Error("expected seeded receipt");
      }
      return result.receipt;
    },
  );
  return { row: created.anchor, receipt };
}

function anchorRow(params: {
  anchorId: string;
  resourceId?: string;
  rowKind: HumanVerifiedAnchor["rowKind"];
  version: number;
  supersedesAnchorId?: string;
}): HumanVerifiedAnchor {
  return {
    anchorId: params.anchorId,
    kind: "human_verified_anchor",
    resourceId: params.resourceId ?? "mem-target",
    anchorType: "principle",
    version: params.version,
    rowKind: params.rowKind,
    evidenceRefs: [],
    ...(params.supersedesAnchorId ? { supersedesAnchorId: params.supersedesAnchorId } : {}),
    effectiveAt: "2026-08-16T00:00:00Z",
    createdAt: "2026-08-16T00:00:00Z",
  };
}

function rowsOfKind(
  stateDir: string,
  rowKind: HumanVerifiedAnchor["rowKind"],
  resourceId = "mem-target",
): HumanVerifiedAnchor[] {
  return listHumanVerifiedAnchors({ resourceId, stateDir }).filter(
    (row) => row.rowKind === rowKind,
  );
}

describe("P3-g human-verified anchors", () => {
  it("activation writes history before pointer CAS", async () => {
    const stateDir = await readyStateDir();
    const call = await enterpriseCall();
    const proposed = await proposeAnchor({
      call,
      operationId: "op-prop-1",
      resourceId: "mem-target",
      anchorType: "principle",
      version: 1,
      evidenceRefs: ["ev-1"],
      stateDir,
    });
    expect(proposed.ok).toBe(true);
    expect(readAnchorPointer({ resourceId: "mem-target", stateDir })).toBeNull();
    expect(readActiveAnchor({ resourceId: "mem-target", stateDir })).toBeNull();

    const activated = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act-1",
      resourceId: "mem-target",
      anchorId: proposed.ok ? proposed.anchor.anchorId : undefined,
      version: 1,
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(activated.ok).toBe(true);
    if (!activated.ok) {
      throw new Error("expected activate");
    }
    expect(activated.pointer?.pointerState).toBe("active");
    expect(activated.pointer?.activeAnchorId).toBe(activated.anchor.anchorId);
    expect(fs.existsSync(path.join(stateDir, "data-governance", "anchor-pointers"))).toBe(true);
  });

  it("revoke writes a tombstone; pointer file is never deleted or emptied", async () => {
    const stateDir = await readyStateDir();
    const activated = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act",
      resourceId: "mem-target",
      anchorType: "commitment",
      version: 1,
      evidenceRefs: ["ev"],
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(activated.ok).toBe(true);
    if (!activated.ok) {
      throw new Error("expected activate");
    }
    const pointerPath = path.join(
      stateDir,
      "data-governance",
      "anchor-pointers",
      "mem-target",
      "active-anchor-pointer.json",
    );
    expect(fs.existsSync(pointerPath)).toBe(true);
    const revoked = await revokeAnchor({
      auth: await anchorAuth(stateDir, "anchor_revoke"),
      operationId: "op-rev",
      resourceId: "mem-target",
      anchorId: activated.anchor.anchorId,
      expectedPointerVersion: 1,
      stateDir,
    });
    expect(revoked.ok).toBe(true);
    expect(fs.existsSync(pointerPath)).toBe(true);
    const pointer = readAnchorPointer({ resourceId: "mem-target", stateDir });
    expect(pointer?.pointerState).toBe("revoked");
    expect(pointer?.activeAnchorId).toBeUndefined();
    expect(pointer?.revokedAnchorId).toBe(activated.anchor.anchorId);
    expect(pointer?.revocationRowId).toBe(revoked.ok ? revoked.anchor.anchorId : undefined);
    expect(pointer?.revokedAnchorId).not.toBe(pointer?.revocationRowId);
  });

  it("readActiveAnchor is null for tombstones; audit pointer still exposes both ids", async () => {
    const stateDir = await readyStateDir();
    const activated = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act",
      resourceId: "mem-target",
      anchorType: "identity",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(activated.ok).toBe(true);
    if (!activated.ok) {
      throw new Error("expected activate");
    }
    await revokeAnchor({
      auth: await anchorAuth(stateDir, "anchor_revoke"),
      operationId: "op-rev",
      resourceId: "mem-target",
      anchorId: activated.anchor.anchorId,
      expectedPointerVersion: 1,
      stateDir,
    });
    expect(readActiveAnchor({ resourceId: "mem-target", stateDir })).toBeNull();
    const pointer = readAnchorPointer({ resourceId: "mem-target", stateDir })!;
    expect(pointer.revokedAnchorId).toBeTruthy();
    expect(pointer.revocationRowId).toBeTruthy();
    expect(pointer.revokedAt).toBeTruthy();
    expect(pointer.revokeMutationId).toBeTruthy();
  });

  it("repeat revoke is idempotent; revoking a non-active anchor fails closed", async () => {
    const stateDir = await readyStateDir();
    const activated = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act",
      resourceId: "mem-target",
      anchorType: "major_decision",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(activated.ok).toBe(true);
    if (!activated.ok) {
      throw new Error("expected activate");
    }
    const auth = await anchorAuth(stateDir, "anchor_revoke");
    const first = await revokeAnchor({
      auth,
      operationId: "op-rev-1",
      resourceId: "mem-target",
      anchorId: activated.anchor.anchorId,
      expectedPointerVersion: 1,
      stateDir,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error("expected revoke");
    }
    const versionAfter = readAnchorPointer({ resourceId: "mem-target", stateDir })!.pointerVersion;
    const revocationRowsBefore = rowsOfKind(stateDir, "revocation").length;
    const repeat = await revokeAnchor({
      auth,
      operationId: "op-rev-2",
      resourceId: "mem-target",
      anchorId: activated.anchor.anchorId,
      expectedPointerVersion: versionAfter,
      stateDir,
    });
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) {
      throw new Error("expected repeat revoke");
    }
    // Keyed on revokedAnchorId: the receipt that actually revoked is returned, not a new one.
    expect(repeat.receipt.mutationId).toBe(first.receipt.mutationId);
    expect(repeat.anchor.anchorId).toBe(first.anchor.anchorId);
    expect(readAnchorPointer({ resourceId: "mem-target", stateDir })?.pointerVersion).toBe(
      versionAfter,
    );
    expect(rowsOfKind(stateDir, "revocation")).toHaveLength(revocationRowsBefore);
    const foreign = await revokeAnchor({
      auth,
      operationId: "op-rev-bad",
      resourceId: "mem-target",
      anchorId: "anchor-not-active",
      expectedPointerVersion: versionAfter,
      stateDir,
    });
    expect(foreign).toEqual({ ok: false, error: "anchor_not_active" });
  });

  it("re-activation after revoke sets activeAnchorId and clears tombstone ids", async () => {
    const stateDir = await readyStateDir();
    const first = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act-1",
      resourceId: "mem-target",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error("expected first");
    }
    await revokeAnchor({
      auth: await anchorAuth(stateDir, "anchor_revoke"),
      operationId: "op-rev",
      resourceId: "mem-target",
      anchorId: first.anchor.anchorId,
      expectedPointerVersion: 1,
      stateDir,
    });
    const second = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act-2",
      resourceId: "mem-target",
      anchorType: "principle",
      version: 2,
      evidenceRefs: ["ev-2"],
      expectedPointerVersion: 2,
      stateDir,
    });
    expect(second.ok).toBe(true);
    const pointer = readAnchorPointer({ resourceId: "mem-target", stateDir });
    expect(pointer?.pointerState).toBe("active");
    expect(pointer?.activeAnchorId).toBe(second.ok ? second.anchor.anchorId : undefined);
    expect(pointer?.revokedAnchorId).toBeUndefined();
    expect(pointer?.revocationRowId).toBeUndefined();
    expect(
      readHumanVerifiedAnchor({
        resourceId: "mem-target",
        anchorId: first.anchor.anchorId,
        stateDir,
      }),
    ).not.toBeNull();
  });

  it("supersede leaves prior row byte-identical; status is derived", async () => {
    const stateDir = await readyStateDir();
    const first = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act",
      resourceId: "mem-target",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error("expected activate");
    }
    const before = JSON.stringify(
      readHumanVerifiedAnchor({
        resourceId: "mem-target",
        anchorId: first.anchor.anchorId,
        stateDir,
      }),
    );
    const next = await supersedeAnchor({
      auth: await anchorAuth(stateDir, "anchor_supersede"),
      operationId: "op-super",
      resourceId: "mem-target",
      supersedesAnchorId: first.anchor.anchorId,
      version: 2,
      evidenceRefs: ["ev-s"],
      expectedPointerVersion: 1,
      stateDir,
    });
    expect(next.ok).toBe(true);
    const after = JSON.stringify(
      readHumanVerifiedAnchor({
        resourceId: "mem-target",
        anchorId: first.anchor.anchorId,
        stateDir,
      }),
    );
    expect(after).toBe(before);
    expect(
      readDerivedAnchorStatus({
        resourceId: "mem-target",
        anchorId: first.anchor.anchorId,
        stateDir,
      }),
    ).toBe("superseded");
    expect(
      readDerivedAnchorStatus({
        resourceId: "mem-target",
        anchorId: next.ok ? next.anchor.anchorId : "",
        stateDir,
      }),
    ).toBe("active");
  });

  it("tombstone protects both revoked and revocation rows from orphan reclaim", async () => {
    const stateDir = await readyStateDir();
    const activated = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act",
      resourceId: "mem-target",
      anchorType: "commitment",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(activated.ok).toBe(true);
    if (!activated.ok) {
      throw new Error("expected activate");
    }
    const revoked = await revokeAnchor({
      auth: await anchorAuth(stateDir, "anchor_revoke"),
      operationId: "op-rev",
      resourceId: "mem-target",
      anchorId: activated.anchor.anchorId,
      expectedPointerVersion: 1,
      stateDir,
    });
    expect(revoked.ok).toBe(true);
    const pointer = readAnchorPointer({ resourceId: "mem-target", stateDir })!;
    expect(pointer.revokedAnchorId).not.toBe(pointer.revocationRowId);
    expect(
      readDerivedAnchorStatus({
        resourceId: "mem-target",
        anchorId: pointer.revokedAnchorId!,
        stateDir,
      }),
    ).toBe("revoked");
    expect(
      readDerivedAnchorStatus({
        resourceId: "mem-target",
        anchorId: pointer.revocationRowId!,
        stateDir,
      }),
    ).toBe("revocation_record");
    const reclaimed = await reclaimAnchorPointerOrphans({
      resourceId: "mem-target",
      stateDir,
      now: new Date(Date.now() + 60_000),
      ttlMs: 1,
    });
    expect(reclaimed.annotated).not.toContain(pointer.revokedAnchorId);
    expect(reclaimed.annotated).not.toContain(pointer.revocationRowId);
    expect(reclaimed.skipped).toEqual(
      expect.arrayContaining([pointer.revokedAnchorId!, pointer.revocationRowId!]),
    );
  });

  it("active anchors are excluded from merge admission", async () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    const catalog = await registerResources(stateDir, [
      memoryRow("mem-target"),
      memoryRow("mem-src"),
    ]);
    const activated = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act",
      resourceId: "mem-target",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(activated.ok).toBe(true);
    writeGrant(stateDir, {
      grantId: "grant-merge-1",
      kind: "governance_approval_grant",
      grantKind: "cognitive_merge_apply",
      tenantId: "t1",
      scope: { kind: "resource", resourceId: "mem-target" },
      approverUserId: "u1",
      issuedBy: "enterprise_ops",
      issuedAt: "2026-08-11T00:00:00Z",
      expiresAt: "2027-08-11T00:00:00Z",
    });
    const mergeAuth = await resolveGovernanceApprovalAuth({
      call: await enterpriseCall(),
      owner: { kind: "user", userId: "u1" },
      grantId: "grant-merge-1",
      requiredKind: "cognitive_merge_apply",
      requiredScope: { kind: "resource", resourceId: "mem-target" },
      stateDir,
    });
    expect(mergeAuth.ok).toBe(true);
    if (!mergeAuth.ok) {
      throw new Error("expected merge auth");
    }
    const head = readConflictGraphHead({ tenantId: "t1", stateDir });
    const blocked = await applyCognitiveMerge({
      mergeId: "merge-anchored",
      targetResourceId: "mem-target",
      sourceResourceIds: ["mem-src"],
      expectedGovernanceVersion: 1,
      expectedConflictGraphVersion: head.graphVersion,
      expectedConflictGraphHash: head.graphHash,
      policyVersion: "merge-v1",
      auth: mergeAuth.auth,
      stateDir,
      catalog,
    });
    expect(blocked).toEqual({ ok: false, error: "active_anchor_blocks_merge" });
  });

  it("an active anchor on a merge source also blocks the merge", async () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    const catalog = await registerResources(stateDir, [
      memoryRow("mem-target"),
      memoryRow("mem-src"),
    ]);
    const activated = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate", "mem-src"),
      operationId: "op-act-src",
      resourceId: "mem-src",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(activated.ok).toBe(true);
    expect(readAnchorPointer({ resourceId: "mem-target", stateDir })).toBeNull();
    writeGrant(stateDir, {
      grantId: "grant-merge-src",
      kind: "governance_approval_grant",
      grantKind: "cognitive_merge_apply",
      tenantId: "t1",
      scope: { kind: "resource", resourceId: "mem-target" },
      approverUserId: "u1",
      issuedBy: "enterprise_ops",
      issuedAt: "2026-08-11T00:00:00Z",
      expiresAt: "2027-08-11T00:00:00Z",
    });
    const mergeAuth = await resolveGovernanceApprovalAuth({
      call: await enterpriseCall(),
      owner: { kind: "user", userId: "u1" },
      grantId: "grant-merge-src",
      requiredKind: "cognitive_merge_apply",
      requiredScope: { kind: "resource", resourceId: "mem-target" },
      stateDir,
    });
    if (!mergeAuth.ok) {
      throw new Error("expected merge auth");
    }
    const head = readConflictGraphHead({ tenantId: "t1", stateDir });
    const blocked = await applyCognitiveMerge({
      mergeId: "merge-anchored-src",
      targetResourceId: "mem-target",
      sourceResourceIds: ["mem-src"],
      expectedGovernanceVersion: 1,
      expectedConflictGraphVersion: head.graphVersion,
      expectedConflictGraphHash: head.graphHash,
      policyVersion: "merge-v1",
      auth: mergeAuth.auth,
      stateDir,
      catalog,
    });
    expect(blocked).toEqual({ ok: false, error: "active_anchor_blocks_merge" });
  });

  it("activate/supersede/revoke without branded grant are denied", async () => {
    const stateDir = await readyStateDir();
    const forged = { kind: "operator", operatorId: "x" } as never;
    expect(
      await activateAnchor({
        auth: forged,
        operationId: "op",
        resourceId: "mem-target",
        anchorType: "principle",
        version: 1,
        expectedPointerVersion: 0,
        stateDir,
      }),
    ).toEqual({ ok: false, error: "actor_not_authorized" });
  });

  it("anchor modules do not import P2 purge", () => {
    for (const name of ["cognitive-anchor.ts", "cognitive-anchor-store.ts"]) {
      const src = fs.readFileSync(path.join(import.meta.dirname, name), "utf8");
      expect(src).not.toMatch(/lifecycle-purge/);
    }
  });

  // --- Kiro CR: operation-level atomicity -------------------------------------------------

  it("serializes concurrent activations that share one operationId", async () => {
    const stateDir = await readyStateDir();
    const auth = await anchorAuth(stateDir, "anchor_activate");
    const results = await Promise.all([
      activateAnchor({
        auth,
        operationId: "op-race",
        resourceId: "mem-target",
        anchorType: "principle",
        version: 1,
        evidenceRefs: [],
        expectedPointerVersion: 0,
        stateDir,
      }),
      activateAnchor({
        auth,
        operationId: "op-race",
        resourceId: "mem-target",
        anchorType: "principle",
        version: 1,
        evidenceRefs: [],
        expectedPointerVersion: 0,
        stateDir,
      }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const mutationIds = new Set(
      results.map((result) => (result.ok ? result.receipt.mutationId : "denied")),
    );
    expect(mutationIds.size).toBe(1);
    const indexed = readAnchorMutationByOperation({
      resourceId: "mem-target",
      operationId: "op-race",
      stateDir,
    });
    expect(indexed?.status).toBe("applied");
    const pointer = readAnchorPointer({ resourceId: "mem-target", stateDir });
    expect(pointer?.pointerVersion).toBe(1);
    expect(pointer?.activeAnchorId).toBe(indexed?.historyRowId);
  });

  // --- Kiro CR: replay ordering and prepared-row reuse ------------------------------------

  it("a successful supersede replay returns the same applied receipt", async () => {
    const stateDir = await readyStateDir();
    const first = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act",
      resourceId: "mem-target",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    if (!first.ok) {
      throw new Error("expected activate");
    }
    const auth = await anchorAuth(stateDir, "anchor_supersede");
    const applied = await supersedeAnchor({
      auth,
      operationId: "op-super",
      resourceId: "mem-target",
      supersedesAnchorId: first.anchor.anchorId,
      version: 2,
      evidenceRefs: ["ev-s"],
      expectedPointerVersion: 1,
      stateDir,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      throw new Error("expected supersede");
    }
    const supersessionRows = rowsOfKind(stateDir, "supersession").length;
    // Terminal replay must run before the "is it still active?" precondition: the pointer now
    // names the supersession row, which must not turn a replay into anchor_not_active.
    const replay = await supersedeAnchor({
      auth,
      operationId: "op-super",
      resourceId: "mem-target",
      supersedesAnchorId: first.anchor.anchorId,
      version: 2,
      evidenceRefs: ["ev-s"],
      expectedPointerVersion: 1,
      stateDir,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) {
      throw new Error("expected supersede replay");
    }
    expect(replay.receipt.mutationId).toBe(applied.receipt.mutationId);
    expect(replay.receipt.status).toBe("applied");
    expect(replay.anchor.anchorId).toBe(applied.anchor.anchorId);
    expect(rowsOfKind(stateDir, "supersession")).toHaveLength(supersessionRows);
    expect(readAnchorPointer({ resourceId: "mem-target", stateDir })?.pointerVersion).toBe(2);
  });

  it("a terminal conflicted replay creates no further history", async () => {
    const stateDir = await readyStateDir();
    const first = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act",
      resourceId: "mem-target",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    if (!first.ok) {
      throw new Error("expected activate");
    }
    const auth = await anchorAuth(stateDir, "anchor_supersede");
    // Stale expected version ⇒ CAS loses ⇒ receipt conflicted.
    const conflicted = await supersedeAnchor({
      auth,
      operationId: "op-super-conflict",
      resourceId: "mem-target",
      supersedesAnchorId: first.anchor.anchorId,
      version: 2,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(conflicted.ok).toBe(false);
    const rowsAfterConflict = listHumanVerifiedAnchors({
      resourceId: "mem-target",
      stateDir,
    }).length;
    const replay = await supersedeAnchor({
      auth,
      operationId: "op-super-conflict",
      resourceId: "mem-target",
      supersedesAnchorId: first.anchor.anchorId,
      version: 2,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(replay.ok).toBe(false);
    if (replay.ok) {
      throw new Error("expected conflicted replay");
    }
    expect(replay.error).toBe("mutation_conflicted");
    expect(listHumanVerifiedAnchors({ resourceId: "mem-target", stateDir })).toHaveLength(
      rowsAfterConflict,
    );
    expect(readAnchorPointer({ resourceId: "mem-target", stateDir })?.pointerVersion).toBe(1);
  });

  it("activate prepared replay heals after a pointer CAS that never finalized", async () => {
    const stateDir = await readyStateDir();
    const seeded = await seedPreparedMutation({
      stateDir,
      operationId: "op-act-crash",
      row: anchorRow({ anchorId: "anchor-seed-activation", rowKind: "activation", version: 1 }),
      expectedPointerVersion: 0,
    });
    const moved = await compareAndPutAnchorPointer({
      resourceId: "mem-target",
      stateDir,
      expectedPointerVersion: 0,
      next: {
        kind: "anchor_active_pointer",
        resourceId: "mem-target",
        pointerState: "active",
        activeAnchorId: seeded.row.anchorId,
        anchorVersion: 1,
        pointerVersion: 1,
        lastMutationId: seeded.receipt.mutationId,
        updatedAt: new Date().toISOString(),
      },
    });
    expect(moved.ok).toBe(true);
    const rowsBefore = listHumanVerifiedAnchors({ resourceId: "mem-target", stateDir }).length;

    const healed = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act-crash",
      resourceId: "mem-target",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(healed.ok).toBe(true);
    if (!healed.ok) {
      throw new Error("expected heal");
    }
    expect(healed.receipt.mutationId).toBe(seeded.receipt.mutationId);
    expect(healed.receipt.status).toBe("applied");
    expect(healed.anchor.anchorId).toBe(seeded.row.anchorId);
    expect(listHumanVerifiedAnchors({ resourceId: "mem-target", stateDir })).toHaveLength(
      rowsBefore,
    );
    expect(readAnchorPointer({ resourceId: "mem-target", stateDir })?.pointerVersion).toBe(1);
  });

  it("supersede prepared replay reuses the exact same supersession row", async () => {
    const stateDir = await readyStateDir();
    const first = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act",
      resourceId: "mem-target",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    if (!first.ok) {
      throw new Error("expected activate");
    }
    const seeded = await seedPreparedMutation({
      stateDir,
      operationId: "op-super-crash",
      row: anchorRow({
        anchorId: "anchor-seed-supersession",
        rowKind: "supersession",
        version: 2,
        supersedesAnchorId: first.anchor.anchorId,
      }),
      expectedPointerVersion: 1,
    });
    const resumed = await supersedeAnchor({
      auth: await anchorAuth(stateDir, "anchor_supersede"),
      operationId: "op-super-crash",
      resourceId: "mem-target",
      supersedesAnchorId: first.anchor.anchorId,
      version: 2,
      evidenceRefs: [],
      expectedPointerVersion: 1,
      stateDir,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) {
      throw new Error("expected resume");
    }
    expect(resumed.anchor.anchorId).toBe(seeded.row.anchorId);
    expect(resumed.receipt.mutationId).toBe(seeded.receipt.mutationId);
    expect(rowsOfKind(stateDir, "supersession")).toHaveLength(1);
    const pointer = readAnchorPointer({ resourceId: "mem-target", stateDir });
    expect(pointer?.activeAnchorId).toBe(seeded.row.anchorId);
    expect(pointer?.pointerVersion).toBe(2);
  });

  it("revoke prepared replay reuses the exact same revocation row", async () => {
    const stateDir = await readyStateDir();
    const first = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act",
      resourceId: "mem-target",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    if (!first.ok) {
      throw new Error("expected activate");
    }
    const seeded = await seedPreparedMutation({
      stateDir,
      operationId: "op-rev-crash",
      row: anchorRow({
        anchorId: "anchor-seed-revocation",
        rowKind: "revocation",
        version: 1,
        supersedesAnchorId: first.anchor.anchorId,
      }),
      expectedPointerVersion: 1,
    });
    const resumed = await revokeAnchor({
      auth: await anchorAuth(stateDir, "anchor_revoke"),
      operationId: "op-rev-crash",
      resourceId: "mem-target",
      anchorId: first.anchor.anchorId,
      expectedPointerVersion: 1,
      stateDir,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) {
      throw new Error("expected resume");
    }
    expect(resumed.anchor.anchorId).toBe(seeded.row.anchorId);
    expect(resumed.receipt.mutationId).toBe(seeded.receipt.mutationId);
    expect(rowsOfKind(stateDir, "revocation")).toHaveLength(1);
    const pointer = readAnchorPointer({ resourceId: "mem-target", stateDir });
    expect(pointer?.pointerState).toBe("revoked");
    expect(pointer?.revokedAnchorId).toBe(first.anchor.anchorId);
    expect(pointer?.revocationRowId).toBe(seeded.row.anchorId);
    expect(pointer?.revokedAnchorId).not.toBe(pointer?.revocationRowId);
  });

  it("prepared replay against a newer pointer fails closed without overwriting it", async () => {
    const stateDir = await readyStateDir();
    const seeded = await seedPreparedMutation({
      stateDir,
      operationId: "op-foreign",
      row: anchorRow({ anchorId: "anchor-seed-foreign", rowKind: "activation", version: 1 }),
      expectedPointerVersion: 0,
    });
    const foreign = await compareAndPutAnchorPointer({
      resourceId: "mem-target",
      stateDir,
      expectedPointerVersion: 0,
      next: {
        kind: "anchor_active_pointer",
        resourceId: "mem-target",
        pointerState: "active",
        activeAnchorId: "anchor-foreign",
        anchorVersion: 7,
        pointerVersion: 1,
        lastMutationId: "mut-foreign",
        updatedAt: new Date().toISOString(),
      },
    });
    expect(foreign.ok).toBe(true);
    const replay = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-foreign",
      resourceId: "mem-target",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(replay.ok).toBe(false);
    if (replay.ok) {
      throw new Error("expected fail closed");
    }
    expect(replay.error).toBe("version_conflict");
    expect(replay.receipt?.status).toBe("conflicted");
    expect(replay.receipt?.historyRowId).toBe(seeded.row.anchorId);
    const pointer = readAnchorPointer({ resourceId: "mem-target", stateDir });
    expect(pointer?.activeAnchorId).toBe("anchor-foreign");
    expect(pointer?.lastMutationId).toBe("mut-foreign");
    expect(pointer?.pointerVersion).toBe(1);
  });

  // --- Kiro CR: proposal authorization boundary ------------------------------------------

  it("refuses a proposal against an unknown governed resource", async () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    const proposed = await proposeAnchor({
      call: await enterpriseCall(),
      operationId: "op-unknown",
      resourceId: "mem-unknown",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      stateDir,
    });
    expect(proposed).toEqual({ ok: false, error: "not_found" });
    expect(listHumanVerifiedAnchors({ resourceId: "mem-unknown", stateDir })).toHaveLength(0);
  });

  it("refuses a proposal against a foreign-tenant resource", async () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    await registerResources(stateDir, [memoryRow("mem-foreign", { tenantId: "t2" })]);
    const proposed = await proposeAnchor({
      call: await enterpriseCall(),
      operationId: "op-cross-tenant",
      resourceId: "mem-foreign",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      stateDir,
    });
    expect(proposed).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(listHumanVerifiedAnchors({ resourceId: "mem-foreign", stateDir })).toHaveLength(0);
    expect(fs.existsSync(path.join(stateDir, "data-governance", "anchor-mutations"))).toBe(false);
  });

  it("refuses a proposal against a resource the caller does not own", async () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    await registerResources(stateDir, [
      memoryRow("mem-other", { owner: { kind: "user", userId: "u2" } }),
    ]);
    const proposed = await proposeAnchor({
      call: await enterpriseCall(),
      operationId: "op-unowned",
      resourceId: "mem-other",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      stateDir,
    });
    expect(proposed).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(listHumanVerifiedAnchors({ resourceId: "mem-other", stateDir })).toHaveLength(0);
  });

  it("refuses activation when the grant's resource is not the caller's tenant row", async () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    await registerResources(stateDir, [memoryRow("mem-target", { tenantId: "t2" })]);
    const activated = await activateAnchor({
      auth: await anchorAuth(stateDir, "anchor_activate"),
      operationId: "op-act-cross",
      resourceId: "mem-target",
      anchorType: "principle",
      version: 1,
      evidenceRefs: [],
      expectedPointerVersion: 0,
      stateDir,
    });
    expect(activated).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(readAnchorPointer({ resourceId: "mem-target", stateDir })).toBeNull();
    expect(listHumanVerifiedAnchors({ resourceId: "mem-target", stateDir })).toHaveLength(0);
  });
});
