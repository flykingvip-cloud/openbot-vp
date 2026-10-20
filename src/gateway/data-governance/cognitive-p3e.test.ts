import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../tenant-context.js";
import {
  createFileDataGovernanceCatalogStore,
  resetCatalogStoreSingletonsForTests,
} from "./catalog-store.js";
import { resolveGovernanceApprovalAuth } from "./cognitive-approval-auth.js";
import { writeGovernanceApprovalGrantAtDeployBoundary } from "./cognitive-approval-grant-store.js";
import { recordOpenConflictEdge, resolveConflictEdge } from "./cognitive-conflict-edges.js";
import {
  installCognitiveTakeoverFenceHookForTests,
  runConflictGraphTakeover,
} from "./cognitive-conflict-graph-takeover.js";
import {
  MERGE_RESERVATION_LEASE_MS,
  acquireMergeReservation,
  beginConflictGraphTakeover,
  isMergeReservationHolder,
  markReservationDerivedCreated,
  readConflictGraphHead,
  releaseMergeReservation,
} from "./cognitive-conflict-graph.js";
import { evaluateCognitiveThresholds } from "./cognitive-evaluator.js";
import { loadThresholdContract } from "./cognitive-evaluator.js";
import { reportCognitiveHealth } from "./cognitive-health.js";
import { installCognitiveMergeFaultHookForTests } from "./cognitive-merge-fault-slot.js";
import { mergeProtectedCompareAndPut } from "./cognitive-merge-fencing.js";
import { getCognitiveMergeReceipt } from "./cognitive-merge-receipt-store.js";
import { reclaimMergeOrphans } from "./cognitive-merge-reclaim.js";
import { recoverCognitiveMerge } from "./cognitive-merge-recovery.js";
import { applyCognitiveMerge } from "./cognitive-merge.js";
import {
  authenticateGovernanceCall,
  resolveCognitiveRecommendationAuth,
} from "./cognitive-recommendation-auth.js";
import type { RetrievalPolicyEvaluator } from "./cognitive-retrieval-policy.js";
import { decideConstrainedRetrieval } from "./cognitive-retrieval.js";
import { unlockCognitiveWritesForTests } from "./cognitive-write-unlock.test-harness.js";
import type { CatalogRecord, GovernanceApprovalGrantRecord } from "./types.js";

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
const getRetrievalPolicyEvaluatorMock = vi.hoisted(() =>
  vi.fn((): RetrievalPolicyEvaluator | undefined => undefined),
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

vi.mock("./cognitive-retrieval-policy.js", () => ({
  getRetrievalPolicyEvaluator: getRetrievalPolicyEvaluatorMock,
}));

const tempDirs: string[] = [];
afterEach(() => {
  installCognitiveMergeFaultHookForTests(undefined);
  installCognitiveTakeoverFenceHookForTests(undefined);
  resetCatalogStoreSingletonsForTests();
  getRetrievalPolicyEvaluatorMock.mockReset();
  getRetrievalPolicyEvaluatorMock.mockReturnValue(undefined);
  resolveTenantContextMock.mockReset();
  resolveTenantContextMock.mockResolvedValue(null);
  resolveAuthoritativeMembershipMock.mockReset();
  resolveAuthoritativeMembershipMock.mockResolvedValue({ tenantId: null, userId: null });
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpStateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p3e-"));
  tempDirs.push(dir);
  return dir;
}

function memoryRow(resourceId: string, patch?: Partial<CatalogRecord["envelope"]>): CatalogRecord {
  return {
    envelope: {
      resourceId,
      resourceType: "memory",
      schemaVersion: 1,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      lifecycleState: "active",
      classification: "confidential",
      governanceVersion: 1,
      canonicalBindingId: `bind-${resourceId}`,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
      projection: { canonicalKind: "cogniweave", atomId: resourceId, memoryTier: "working" },
      ...patch,
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

async function mergeAuth(stateDir: string, targetResourceId = "mem-target") {
  writeGrant(stateDir, {
    grantId: "grant-merge-1",
    kind: "governance_approval_grant",
    grantKind: "cognitive_merge_apply",
    tenantId: "t1",
    scope: { kind: "resource", resourceId: targetResourceId },
    approverUserId: "u1",
    issuedBy: "enterprise_ops",
    issuedAt: "2026-08-11T00:00:00Z",
    expiresAt: "2027-08-11T00:00:00Z",
  });
  const resolved = await resolveGovernanceApprovalAuth({
    call: await enterpriseCall(),
    owner: { kind: "user", userId: "u1" },
    grantId: "grant-merge-1",
    requiredKind: "cognitive_merge_apply",
    requiredScope: { kind: "resource", resourceId: targetResourceId },
    stateDir,
  });
  if (!resolved.ok) {
    throw new Error(`expected merge auth: ${resolved.reason}`);
  }
  return resolved.auth;
}

async function resolveAuth(stateDir: string, left: string, right: string, policy = "prec-v1") {
  writeGrant(stateDir, {
    grantId: "grant-resolve-1",
    kind: "governance_approval_grant",
    grantKind: "conflict_precedence_resolve",
    tenantId: "t1",
    scope: {
      kind: "conflict_edge_pair",
      leftResourceId: left,
      rightResourceId: right,
      precedencePolicyId: policy,
    },
    approverUserId: "u1",
    issuedBy: "tenant_admin",
    issuedAt: "2026-08-11T00:00:00Z",
    expiresAt: "2027-08-11T00:00:00Z",
  });
  const resolved = await resolveGovernanceApprovalAuth({
    call: await enterpriseCall(),
    owner: { kind: "user", userId: "u1" },
    grantId: "grant-resolve-1",
    requiredKind: "conflict_precedence_resolve",
    requiredScope: {
      kind: "conflict_edge_pair",
      leftResourceId: left,
      rightResourceId: right,
      precedencePolicyId: policy,
    },
    stateDir,
  });
  if (!resolved.ok) {
    throw new Error(`expected resolve auth: ${resolved.reason}`);
  }
  return resolved.auth;
}

async function setupCatalog(stateDir: string) {
  unlockCognitiveWritesForTests(stateDir);
  const catalog = createFileDataGovernanceCatalogStore({
    storePath: path.join(stateDir, "data-governance", "catalog.json"),
  });
  await catalog.put(memoryRow("mem-target"));
  await catalog.put(memoryRow("mem-src"));
  return catalog;
}

function graphMeta(stateDir: string) {
  const head = readConflictGraphHead({ tenantId: "t1", stateDir });
  return {
    expectedConflictGraphVersion: head.graphVersion,
    expectedConflictGraphHash: head.graphHash,
  };
}

/** Bypass Catalog write gates so R7 can see foreign/empty terminal refs. */
function patchCatalogEnvelope(
  stateDir: string,
  resourceId: string,
  patch: Record<string, unknown>,
): void {
  const catalogPath = path.join(stateDir, "data-governance", "catalog.json");
  const file = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as {
    records: Record<string, { envelope: Record<string, unknown> }>;
  };
  const row = file.records[resourceId];
  if (!row) {
    throw new Error(`missing catalog row ${resourceId}`);
  }
  row.envelope = { ...row.envelope, schemaVersion: 2, ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete row.envelope[key];
    }
  }
  fs.writeFileSync(catalogPath, `${JSON.stringify(file, null, 2)}\n`);
}

async function applyHappy(
  stateDir: string,
  catalog: ReturnType<typeof createFileDataGovernanceCatalogStore>,
) {
  return applyCognitiveMerge({
    mergeId: "merge-1",
    targetResourceId: "mem-target",
    sourceResourceIds: ["mem-src"],
    expectedGovernanceVersion: (await catalog.get("mem-target"))!.envelope.governanceVersion,
    ...graphMeta(stateDir),
    policyVersion: "merge-v1",
    auth: await mergeAuth(stateDir),
    stateDir,
    catalog,
  });
}

describe("P3-e merge / conflict / health / evaluator", () => {
  it("blocks merge on any open conflict kind and proceeds after pair+policy resolve", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    for (const kind of ["policy", "fact", "temporal", "scope"] as const) {
      const recorded = await recordOpenConflictEdge({
        tenantId: "t1",
        stateDir,
        leftResourceId: "mem-target",
        rightResourceId: "mem-src",
        conflictKind: kind,
        evaluatorId: "eval-1",
      });
      expect(recorded.ok).toBe(true);
      const blocked = await applyCognitiveMerge({
        mergeId: `merge-block-${kind}`,
        targetResourceId: "mem-target",
        sourceResourceIds: ["mem-src"],
        expectedGovernanceVersion: (await catalog.get("mem-target"))!.envelope.governanceVersion,
        ...graphMeta(stateDir),
        policyVersion: "merge-v1",
        auth: await mergeAuth(stateDir),
        stateDir,
        catalog,
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) {
        expect(blocked.error).toBe("conflict_open_blocks_merge");
      }
      const auth = await resolveAuth(stateDir, "mem-target", "mem-src");
      const resolved = await resolveConflictEdge({
        tenantId: "t1",
        stateDir,
        leftResourceId: "mem-target",
        rightResourceId: "mem-src",
        conflictKind: kind,
        auth,
      });
      expect(resolved.ok).toBe(true);
    }
    const applied = await applyHappy(stateDir, catalog);
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      throw new Error("expected apply");
    }
    expect(applied.receipt.preservedSourceLinkIds).toEqual(["mem-src"]);
    expect(applied.derived.envelope.projection).toEqual({
      derivedRole: "merge_consolidation",
      mergeReceiptId: "merge-1",
    });
    expect(applied.target.envelope.lastMergeReceiptId).toBe("merge-1");
    expect(applied.target.envelope.mergedDerivedMemoryResourceId).toBe(
      applied.derived.envelope.resourceId,
    );
    expect(applied.target.envelope.projection?.derivedRole).toBeUndefined();
  });

  it("edge writer fails closed while a reservation is held, including after lease expiry", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S4" });
    const crashed = await applyHappy(stateDir, catalog);
    expect(crashed.ok).toBe(false);
    const live = await recordOpenConflictEdge({
      tenantId: "t1",
      stateDir,
      leftResourceId: "mem-target",
      rightResourceId: "mem-src",
      conflictKind: "fact",
      evaluatorId: "eval-1",
    });
    expect(live).toEqual({ ok: false, conflict: "conflict_graph_reserved" });
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
    const expiredWrite = await recordOpenConflictEdge({
      tenantId: "t1",
      stateDir,
      leftResourceId: "mem-target",
      rightResourceId: "mem-src",
      conflictKind: "fact",
      evaluatorId: "eval-1",
      now: expiredNow,
    });
    expect(expiredWrite).toEqual({ ok: false, conflict: "conflict_graph_reserved" });
    const takeover = await runConflictGraphTakeover({
      tenantId: "t1",
      stateDir,
      catalog,
      now: expiredNow,
    });
    expect(takeover.ok).toBe(true);
    const after = await recordOpenConflictEdge({
      tenantId: "t1",
      stateDir,
      leftResourceId: "mem-target",
      rightResourceId: "mem-src",
      conflictKind: "fact",
      evaluatorId: "eval-1",
      now: expiredNow,
    });
    expect(after.ok).toBe(true);
  });

  it("fences a stale holder after takeover and rejects stale token or stale epoch", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S4" });
    await applyHappy(stateDir, catalog);
    const before = (await catalog.get("mem-target"))!;
    const staleToken = before.envelope.lastAcceptedFencingToken ?? 0;
    const staleEpoch = before.envelope.lastAcceptedConflictGraphEpoch ?? 0;
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
    const takeover = await runConflictGraphTakeover({
      tenantId: "t1",
      stateDir,
      catalog,
      now: expiredNow,
    });
    expect(takeover.ok).toBe(true);
    const current = (await catalog.get("mem-target"))!;
    const stale = await mergeProtectedCompareAndPut({
      catalog,
      resourceId: "mem-target",
      expectedGovernanceVersion: current.envelope.governanceVersion,
      fencingToken: staleToken,
      conflictGraphEpoch: staleEpoch,
      mergeId: "merge-1",
      mutate: (row) => row,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(["fenced_stale_token", "fenced_stale_graph_epoch"]).toContain(stale.conflict);
    }
    const epochOnly = await mergeProtectedCompareAndPut({
      catalog,
      resourceId: "mem-target",
      expectedGovernanceVersion: current.envelope.governanceVersion,
      fencingToken: current.envelope.lastAcceptedFencingToken ?? 0,
      conflictGraphEpoch: staleEpoch,
      mergeId: "merge-1",
      mutate: (row) => row,
    });
    expect(epochOnly.ok).toBe(false);
    if (!epochOnly.ok) {
      expect(epochOnly.conflict).toBe("fenced_stale_graph_epoch");
    }
  });

  it("keeps derived memory non-retrievable until S8 and treats pending_finalization as blocked", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    getRetrievalPolicyEvaluatorMock.mockReturnValue({
      evaluate: () => "allow",
    });
    installCognitiveMergeFaultHookForTests({ crashAfter: "S5" });
    const mid = await applyHappy(stateDir, catalog);
    expect(mid.ok).toBe(false);
    const derivedId = getCognitiveMergeReceipt({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir,
    })?.derivedMemoryResourceId;
    expect(derivedId).toBeTruthy();
    const call = await enterpriseCall();
    const recAuth = await resolveCognitiveRecommendationAuth({
      call,
      owner: { kind: "user", userId: "u1" },
      stateDir,
    });
    if (!recAuth.ok) {
      throw new Error("expected retrieval auth");
    }
    const denied = await decideConstrainedRetrieval({
      resourceId: derivedId!,
      mode: "default_recall",
      retrievalScore: 0.9,
      auth: recAuth.auth,
      stateDir,
      catalog,
    });
    expect(denied.outcome).toBe("deny");
    if (denied.outcome === "deny") {
      expect(denied.code).toBe("pending_finalization");
    }
    installCognitiveMergeFaultHookForTests(undefined);
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
    const recovered = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir,
      catalog,
      now: expiredNow,
    });
    expect(recovered.ok).toBe(true);
    const allowed = await decideConstrainedRetrieval({
      resourceId: derivedId!,
      mode: "default_recall",
      retrievalScore: 0.9,
      auth: recAuth.auth,
      stateDir,
      catalog,
    });
    expect(allowed.outcome).toBe("allow");
  });

  it("CR6 interleave: S7 crash → takeover → new conflict → recovery publishes and keeps the edge", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S7" });
    const crashed = await applyHappy(stateDir, catalog);
    expect(crashed.ok).toBe(false);
    const receipt = getCognitiveMergeReceipt({ mergeId: "merge-1", tenantId: "t1", stateDir })!;
    expect(receipt.status).toBe("applied");
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
    expect(
      (
        await runConflictGraphTakeover({
          tenantId: "t1",
          stateDir,
          catalog,
          now: expiredNow,
        })
      ).ok,
    ).toBe(true);
    const edge = await recordOpenConflictEdge({
      tenantId: "t1",
      stateDir,
      leftResourceId: "mem-target",
      rightResourceId: "mem-src",
      conflictKind: "temporal",
      evaluatorId: "eval-1",
      now: expiredNow,
    });
    expect(edge.ok).toBe(true);
    installCognitiveMergeFaultHookForTests({ forceAbandonPostCommit: true });
    await expect(
      recoverCognitiveMerge({ mergeId: "merge-1", tenantId: "t1", stateDir, catalog }),
    ).rejects.toThrow(/post_commit_abandon_forbidden/);
    installCognitiveMergeFaultHookForTests(undefined);
    const recovered = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir,
      catalog,
    });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) {
      throw new Error("expected recovery");
    }
    expect(recovered.classification).toBe("post_commit");
    expect(recovered.receipt.status).toBe("applied");
    const derived = await catalog.get(receipt.derivedMemoryResourceId!);
    expect(derived?.envelope.mergeFinalizationState).toBe("finalized");
    const target = await catalog.get("mem-target");
    expect(target?.envelope.lastMergeReceiptId).toBe("merge-1");
    const health = await reportCognitiveHealth({ tenantId: "t1", stateDir, catalog });
    const post = health.indicators.find((item) => item.indicator === "postCommitConflict");
    expect(post?.count).toBeGreaterThan(0);
    if (edge.ok) {
      expect(
        (await import("./cognitive-conflict-graph.js")).readConflictEdge({
          edgeId: edge.edge.edgeId,
          tenantId: "t1",
          stateDir,
        })?.status,
      ).toBe("open");
    }
  });

  it("S5c clears only the attach marker; forged ActorRef cannot approve", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    const forged = await applyCognitiveMerge({
      mergeId: "merge-forged",
      targetResourceId: "mem-target",
      sourceResourceIds: ["mem-src"],
      expectedGovernanceVersion: 1,
      ...graphMeta(stateDir),
      policyVersion: "merge-v1",
      auth: { kind: "operator", operatorId: "op-1" } as never,
      stateDir,
      catalog,
    });
    expect(forged).toEqual({ ok: false, error: "actor_not_authorized" });

    installCognitiveMergeFaultHookForTests({ failStep: "S5" });
    const failed = await applyHappy(stateDir, catalog);
    expect(failed.ok).toBe(false);
    const target = await catalog.get("mem-target");
    expect(target?.envelope.activeCognitiveMergeOp ?? null).toBeNull();
    expect(target?.envelope.lastMergeReceiptId).toBeUndefined();
    expect(target?.envelope.lifecycleState).toBe("active");
  });

  it("reclamation skips needs_recovery and live leases; health is read-only", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S4" });
    await applyHappy(stateDir, catalog);
    const receipt = getCognitiveMergeReceipt({ mergeId: "merge-1", tenantId: "t1", stateDir })!;
    expect(receipt.status).toBe("needs_recovery");
    const before = await catalog.list("memory");
    const result = await reclaimMergeOrphans({ tenantId: "t1", stateDir, catalog });
    expect(result.skipped).toContain("merge-1");
    expect(await catalog.list("memory")).toHaveLength(before.length);
    const health = await reportCognitiveHealth({ tenantId: "t1", stateDir, catalog });
    expect(health.kind).toBe("cognitive_health_report");
    expect(health.indicators.some((item) => item.indicator === "retiredInRecall")).toBe(true);
  });

  it("evaluator refuses unset fixtures and uses must_not_merge as falseMergeRate denominator", async () => {
    const live = loadThresholdContract(
      path.join(process.cwd(), ".kiro/specs/data-governance-v2-p3/evaluation-thresholds-p3e.json"),
    );
    const unset = {
      ...live,
      fixturePinStatus: "unset" as const,
      fixtures: Object.fromEntries(
        Object.entries(live.fixtures).map(([key, fixture]) => [
          key,
          { ...fixture, pinStatus: "unset" as const, sha256: null },
        ]),
      ),
    };
    expect(evaluateCognitiveThresholds({ contract: unset })).toEqual({
      ok: false,
      error: "fixture_pin_unset",
    });
    const dir = tmpStateDir();
    const fixture = path.join(dir, "neg.jsonl");
    fs.writeFileSync(fixture, "x\n");
    const digest = (await import("node:crypto"))
      .createHash("sha256")
      .update(fs.readFileSync(fixture))
      .digest("hex");
    const pinned = {
      ...unset,
      fixturePinStatus: "pinned" as const,
      fixtures: {
        mergeConflictNegative: { path: fixture, pinStatus: "pinned" as const, sha256: digest },
        mergeEquivPositive: { path: fixture, pinStatus: "pinned" as const, sha256: digest },
        conflictMustDetect: { path: fixture, pinStatus: "pinned" as const, sha256: digest },
        retiredRecallViolations: { path: fixture, pinStatus: "pinned" as const, sha256: digest },
        promotionShadowNegative: { path: fixture, pinStatus: "pinned" as const, sha256: digest },
      },
      minSampleSize: {
        falseMergeRate: 2,
        missedConflictRate: 2,
        falsePromotionRate: 2,
        retiredInDefaultRecallMax: 1,
      },
    };
    const rows = {
      mergeConflictNegative: [
        { label: "must_not_merge", applied: false },
        { label: "must_not_merge", applied: false },
        { label: "should_merge", applied: true },
      ],
      conflictMustDetect: [
        { label: "must_detect", detected: true },
        { label: "must_detect", detected: true },
      ],
      promotionShadowNegative: [
        { label: "must_not_promote", promoted: false },
        { label: "must_not_promote", promoted: false },
      ],
      retiredRecallViolations: [{ label: "retired", recalledRetired: false }],
      mergeEquivPositive: [
        { label: "should_merge", applied: true },
        { label: "should_merge", applied: true },
      ],
    };
    const result = evaluateCognitiveThresholds({ contract: pinned, repoRoot: dir, rows });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metrics.falseMergeRate.value).toBe(0);
    }
  });

  it("takeover mid-flight stays fencing and is resumable", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S4" });
    await applyHappy(stateDir, catalog);
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
    const begun = await beginConflictGraphTakeover({
      tenantId: "t1",
      stateDir,
      now: expiredNow,
    });
    expect(begun.ok).toBe(true);
    if (begun.ok) {
      expect(begun.reservation.state).toBe("fencing");
    }
    const blocked = await recordOpenConflictEdge({
      tenantId: "t1",
      stateDir,
      leftResourceId: "mem-target",
      rightResourceId: "mem-src",
      conflictKind: "scope",
      evaluatorId: "eval-1",
      now: expiredNow,
    });
    expect(blocked).toEqual({ ok: false, conflict: "conflict_graph_reserved" });
    const resumed = await runConflictGraphTakeover({
      tenantId: "t1",
      stateDir,
      catalog,
      now: expiredNow,
    });
    expect(resumed.ok).toBe(true);
    expect(readConflictGraphHead({ tenantId: "t1", stateDir }).reservation).toBeNull();
  });

  it("rejects branded merge auth minted for a different target in the same tenant", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    await catalog.put(memoryRow("mem-other"));
    const authForA = await mergeAuth(stateDir, "mem-target");
    const reused = await applyCognitiveMerge({
      mergeId: "merge-auth-reuse",
      targetResourceId: "mem-other",
      sourceResourceIds: ["mem-src"],
      expectedGovernanceVersion: (await catalog.get("mem-other"))!.envelope.governanceVersion,
      ...graphMeta(stateDir),
      policyVersion: "merge-v1",
      auth: authForA,
      stateDir,
      catalog,
    });
    expect(reused).toEqual({ ok: false, error: "actor_not_authorized" });
    expect(
      getCognitiveMergeReceipt({ mergeId: "merge-auth-reuse", tenantId: "t1", stateDir }),
    ).toBeNull();
    expect(readConflictGraphHead({ tenantId: "t1", stateDir }).reservation).toBeNull();
  });

  it("rejects fictional, cross-tenant, non-memory, and blocked-lifecycle sources before receipt", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    await catalog.put(
      memoryRow("mem-foreign", {
        tenantId: "t2",
        scope: { kind: "tenant", tenantId: "t2" },
      }),
    );
    const knowledge = memoryRow("know-src");
    await catalog.put({
      ...knowledge,
      envelope: {
        ...knowledge.envelope,
        resourceType: "knowledge",
        projection: { contentClass: "doc", kbId: "kb-1", docId: "know-src" },
      },
    });
    await catalog.put(
      memoryRow("mem-purged", {
        lifecycleState: "purged",
      }),
    );
    await catalog.put(
      memoryRow("mem-hold", {
        legalHold: {
          holdId: "hold-src",
          reason: "dsar",
          appliedBy: { kind: "user", userId: "u1" },
          appliedAt: "2026-08-11T00:00:00Z",
        },
      }),
    );
    await catalog.put(
      memoryRow("mem-op", {
        activeLifecycleOperation: {
          operationId: "op-1",
          command: "archive",
          receiptId: "rcpt-1",
          previousLifecycleState: "active",
          startedAt: "2026-08-11T00:00:00Z",
        },
      }),
    );
    await catalog.put(
      memoryRow("mem-other-owner", {
        owner: { kind: "user", userId: "u2" },
      }),
    );

    const cases: Array<{
      mergeId: string;
      source: string;
      error:
        | "not_found"
        | "actor_not_authorized"
        | "command_denied_for_type"
        | "lifecycle_blocks_write"
        | "active_operation_blocks_write";
    }> = [
      { mergeId: "merge-ghost", source: "mem-ghost", error: "not_found" },
      { mergeId: "merge-xtenant", source: "mem-foreign", error: "actor_not_authorized" },
      { mergeId: "merge-type", source: "know-src", error: "command_denied_for_type" },
      { mergeId: "merge-purged", source: "mem-purged", error: "lifecycle_blocks_write" },
      { mergeId: "merge-hold", source: "mem-hold", error: "actor_not_authorized" },
      { mergeId: "merge-op", source: "mem-op", error: "active_operation_blocks_write" },
      { mergeId: "merge-owner", source: "mem-other-owner", error: "actor_not_authorized" },
    ];
    for (const item of cases) {
      const denied = await applyCognitiveMerge({
        mergeId: item.mergeId,
        targetResourceId: "mem-target",
        sourceResourceIds: [item.source],
        expectedGovernanceVersion: (await catalog.get("mem-target"))!.envelope.governanceVersion,
        ...graphMeta(stateDir),
        policyVersion: "merge-v1",
        auth: await mergeAuth(stateDir),
        stateDir,
        catalog,
      });
      expect(denied).toEqual({ ok: false, error: item.error });
      expect(
        getCognitiveMergeReceipt({ mergeId: item.mergeId, tenantId: "t1", stateDir }),
      ).toBeNull();
    }
    expect(readConflictGraphHead({ tenantId: "t1", stateDir }).reservation).toBeNull();
  });

  it("keeps takeover in fencing when T3 hits persistent version conflict, not-found churn, or fence failure", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S4" });
    await applyHappy(stateDir, catalog);
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);

    const injections = [
      {
        name: "version_conflict",
        hook: () =>
          installCognitiveTakeoverFenceHookForTests(({ resourceId }) =>
            resourceId === "mem-target" ? { conflict: "version_conflict" } : "proceed",
          ),
      },
      {
        name: "not_found_churn",
        hook: () =>
          installCognitiveTakeoverFenceHookForTests(({ resourceId, attempt }) => {
            if (resourceId !== "mem-target") {
              return "proceed";
            }
            return attempt === 1 ? { conflict: "version_conflict" } : { vanish: true };
          }),
      },
      {
        name: "fence_failure",
        hook: () =>
          installCognitiveTakeoverFenceHookForTests(({ resourceId }) =>
            resourceId === "mem-target" ? { conflict: "fenced_stale_token" } : "proceed",
          ),
      },
    ] as const;

    for (const item of injections) {
      item.hook();
      const failed = await runConflictGraphTakeover({
        tenantId: "t1",
        stateDir,
        catalog,
        now: expiredNow,
      });
      expect(failed).toEqual({ ok: false, conflict: "participant_fence_failed" });
      const head = readConflictGraphHead({ tenantId: "t1", stateDir });
      expect(head.reservation?.state).toBe("fencing");
      const blocked = await recordOpenConflictEdge({
        tenantId: "t1",
        stateDir,
        leftResourceId: "mem-target",
        rightResourceId: "mem-src",
        conflictKind: "fact",
        evaluatorId: "eval-1",
        now: expiredNow,
      });
      expect(blocked).toEqual({ ok: false, conflict: "conflict_graph_reserved" });
    }

    installCognitiveTakeoverFenceHookForTests(undefined);
    const resumed = await runConflictGraphTakeover({
      tenantId: "t1",
      stateDir,
      catalog,
      now: expiredNow,
    });
    expect(resumed.ok).toBe(true);
    expect(readConflictGraphHead({ tenantId: "t1", stateDir }).reservation).toBeNull();
  });

  it("recovery cannot impersonate a live holder; only T1–T4 after expiry", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    let concurrent: Awaited<ReturnType<typeof recoverCognitiveMerge>> | undefined;
    installCognitiveMergeFaultHookForTests({
      crashAfter: "S5",
      beforeStep: async (step) => {
        if (step === "S5" && !concurrent) {
          concurrent = await recoverCognitiveMerge({
            mergeId: "merge-1",
            tenantId: "t1",
            stateDir,
            catalog,
          });
        }
      },
    });
    const crashed = await applyHappy(stateDir, catalog);
    expect(crashed.ok).toBe(false);
    expect(concurrent).toMatchObject({ ok: false, error: "conflict_graph_reserved" });
    const forged = await releaseMergeReservation({
      tenantId: "t1",
      stateDir,
      holder: {
        reservationId: "forged",
        mergeId: "merge-1",
        fencingToken:
          readConflictGraphHead({ tenantId: "t1", stateDir }).reservation?.fencingToken ?? 0,
      } as never,
    });
    expect(forged).toEqual({ ok: false, conflict: "not_holder" });
    expect(isMergeReservationHolder({ mergeId: "merge-1" })).toBe(false);
    const liveRecover = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir,
      catalog,
    });
    expect(liveRecover).toMatchObject({ ok: false, error: "conflict_graph_reserved" });
    expect(readConflictGraphHead({ tenantId: "t1", stateDir }).reservation?.mergeId).toBe(
      "merge-1",
    );
    installCognitiveMergeFaultHookForTests(undefined);
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
    const recovered = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir,
      catalog,
      now: expiredNow,
    });
    expect(recovered.ok).toBe(true);
  });

  it("T3 fail-closes missing target/source and post-S3 derived; pre-S3 derived may skip", async () => {
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);

    const missingTarget = tmpStateDir();
    const catalogTarget = await setupCatalog(missingTarget);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S4" });
    await applyHappy(missingTarget, catalogTarget);
    await catalogTarget.remove("mem-target");
    const targetFail = await runConflictGraphTakeover({
      tenantId: "t1",
      stateDir: missingTarget,
      catalog: catalogTarget,
      now: expiredNow,
    });
    expect(targetFail).toEqual({ ok: false, conflict: "participant_fence_failed" });
    expect(
      readConflictGraphHead({ tenantId: "t1", stateDir: missingTarget }).reservation?.state,
    ).toBe("fencing");

    const missingSource = tmpStateDir();
    const catalogSource = await setupCatalog(missingSource);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S4" });
    await applyHappy(missingSource, catalogSource);
    await catalogSource.remove("mem-src");
    const sourceFail = await runConflictGraphTakeover({
      tenantId: "t1",
      stateDir: missingSource,
      catalog: catalogSource,
      now: expiredNow,
    });
    expect(sourceFail).toEqual({ ok: false, conflict: "participant_fence_failed" });
    expect(
      readConflictGraphHead({ tenantId: "t1", stateDir: missingSource }).reservation?.state,
    ).toBe("fencing");

    const missingDerivedAfter = tmpStateDir();
    const catalogAfter = await setupCatalog(missingDerivedAfter);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S4" });
    await applyHappy(missingDerivedAfter, catalogAfter);
    const derivedId = getCognitiveMergeReceipt({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: missingDerivedAfter,
    })?.derivedMemoryResourceId;
    expect(derivedId).toBeTruthy();
    expect(
      getCognitiveMergeReceipt({
        mergeId: "merge-1",
        tenantId: "t1",
        stateDir: missingDerivedAfter,
      })?.derivedCreated,
    ).toBe(true);
    await catalogAfter.remove(derivedId!);
    const afterFail = await runConflictGraphTakeover({
      tenantId: "t1",
      stateDir: missingDerivedAfter,
      catalog: catalogAfter,
      now: expiredNow,
    });
    expect(afterFail).toEqual({ ok: false, conflict: "participant_fence_failed" });
    expect(
      readConflictGraphHead({ tenantId: "t1", stateDir: missingDerivedAfter }).reservation?.state,
    ).toBe("fencing");

    const missingDerivedBefore = tmpStateDir();
    const catalogBefore = await setupCatalog(missingDerivedBefore);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S2" });
    await applyHappy(missingDerivedBefore, catalogBefore);
    const beforeReceipt = getCognitiveMergeReceipt({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: missingDerivedBefore,
    });
    expect(beforeReceipt?.derivedCreated).toBe(false);
    expect(beforeReceipt?.protocolPhase).toBe("S2");
    expect(await catalogBefore.get(`mem-merge-merge-1`)).toBeNull();
    const beforeOk = await runConflictGraphTakeover({
      tenantId: "t1",
      stateDir: missingDerivedBefore,
      catalog: catalogBefore,
      now: expiredNow,
    });
    expect(beforeOk.ok).toBe(true);
    expect(
      readConflictGraphHead({ tenantId: "t1", stateDir: missingDerivedBefore }).reservation,
    ).toBeNull();
  });

  it("expired or fencing holder cannot release and skip T3", async () => {
    const stateDir = tmpStateDir();
    await setupCatalog(stateDir);
    const acquired = await acquireMergeReservation({
      tenantId: "t1",
      stateDir,
      mergeId: "merge-holder",
      targetResourceId: "mem-target",
      sourceResourceIds: ["mem-src"],
      derivedMemoryResourceId: "mem-merge-holder",
    });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) {
      throw new Error("expected reservation");
    }
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
    const expiredRelease = await releaseMergeReservation({
      tenantId: "t1",
      stateDir,
      holder: acquired.holder,
      now: expiredNow,
    });
    expect(expiredRelease).toEqual({ ok: false, conflict: "lease_expired" });
    expect(readConflictGraphHead({ tenantId: "t1", stateDir }).reservation?.state).toBe("held");
    const begun = await beginConflictGraphTakeover({
      tenantId: "t1",
      stateDir,
      now: expiredNow,
    });
    expect(begun.ok).toBe(true);
    const fencingRelease = await releaseMergeReservation({
      tenantId: "t1",
      stateDir,
      holder: acquired.holder,
      now: expiredNow,
    });
    expect(fencingRelease).toEqual({ ok: false, conflict: "fencing" });
    expect(readConflictGraphHead({ tenantId: "t1", stateDir }).reservation?.state).toBe("fencing");
  });

  it("R7 does not mark applied or publish derived when the target CAS fails", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S7" });
    const crashed = await applyHappy(stateDir, catalog);
    expect(crashed.ok).toBe(false);
    const receipt = getCognitiveMergeReceipt({ mergeId: "merge-1", tenantId: "t1", stateDir })!;
    expect(receipt.status).toBe("applied");
    const derivedId = receipt.derivedMemoryResourceId!;
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
    expect(
      (
        await runConflictGraphTakeover({
          tenantId: "t1",
          stateDir,
          catalog,
          now: expiredNow,
        })
      ).ok,
    ).toBe(true);
    installCognitiveMergeFaultHookForTests({ failPostCommitTargetCas: true });
    const failed = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir,
      catalog,
      now: expiredNow,
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toBe("version_conflict");
      expect(failed.receipt?.status).toBe("applied");
    }
    expect((await catalog.get(derivedId))?.envelope.mergeFinalizationState).toBe(
      "pending_finalization",
    );
    installCognitiveMergeFaultHookForTests(undefined);
    const recovered = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir,
      catalog,
      now: expiredNow,
    });
    expect(recovered.ok).toBe(true);
    expect((await catalog.get(derivedId))?.envelope.mergeFinalizationState).toBe("finalized");
  });

  it("S9 release failure returns needs_recovery and leaves the reservation for takeover", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    let now = new Date();
    const clock = () => now;
    installCognitiveMergeFaultHookForTests({
      beforeStep: (step) => {
        if (step === "S9") {
          now = new Date(now.getTime() + MERGE_RESERVATION_LEASE_MS + 1_000);
        }
      },
    });
    const applied = await applyCognitiveMerge({
      mergeId: "merge-1",
      targetResourceId: "mem-target",
      sourceResourceIds: ["mem-src"],
      expectedGovernanceVersion: (await catalog.get("mem-target"))!.envelope.governanceVersion,
      ...graphMeta(stateDir),
      policyVersion: "merge-v1",
      auth: await mergeAuth(stateDir),
      stateDir,
      catalog,
      clock,
    });
    expect(applied.ok).toBe(false);
    if (!applied.ok) {
      expect(applied.error).toBe("needs_recovery");
      expect(applied.receipt?.status).toBe("applied");
    }
    expect((await catalog.get("mem-target"))?.envelope.lastMergeReceiptId).toBe("merge-1");
    expect(readConflictGraphHead({ tenantId: "t1", stateDir }).reservation?.mergeId).toBe(
      "merge-1",
    );
  });

  it("marker failure stops derived create and does not persist derivedCreated", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    let now = new Date();
    const clock = () => now;
    installCognitiveMergeFaultHookForTests({
      beforeStep: (step) => {
        if (step === "S3") {
          now = new Date(now.getTime() + MERGE_RESERVATION_LEASE_MS + 1_000);
        }
      },
    });
    const failed = await applyCognitiveMerge({
      mergeId: "merge-1",
      targetResourceId: "mem-target",
      sourceResourceIds: ["mem-src"],
      expectedGovernanceVersion: (await catalog.get("mem-target"))!.envelope.governanceVersion,
      ...graphMeta(stateDir),
      policyVersion: "merge-v1",
      auth: await mergeAuth(stateDir),
      stateDir,
      catalog,
      clock,
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toBe("conflict_graph_reserved");
    }
    const receipt = getCognitiveMergeReceipt({ mergeId: "merge-1", tenantId: "t1", stateDir })!;
    expect(receipt.derivedCreated).toBe(false);
    expect(await catalog.get(receipt.derivedMemoryResourceId!)).toBeNull();
    expect(
      readConflictGraphHead({ tenantId: "t1", stateDir }).reservation?.derivedCreated,
    ).not.toBe(true);
  });

  it("markReservationDerivedCreated re-checks expiry inside the CAS mutate", async () => {
    const stateDir = tmpStateDir();
    await setupCatalog(stateDir);
    const acquired = await acquireMergeReservation({
      tenantId: "t1",
      stateDir,
      mergeId: "merge-mark",
      targetResourceId: "mem-target",
      sourceResourceIds: ["mem-src"],
      derivedMemoryResourceId: "mem-merge-mark",
    });
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) {
      throw new Error("expected reservation");
    }
    let samples = 0;
    const clock = () => {
      samples += 1;
      return samples === 1 ? new Date() : new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
    };
    const marked = await markReservationDerivedCreated({
      tenantId: "t1",
      stateDir,
      holder: acquired.holder,
      clock,
    });
    expect(marked).toEqual({ ok: false, conflict: "lease_expired" });
    expect(
      readConflictGraphHead({ tenantId: "t1", stateDir }).reservation?.derivedCreated,
    ).not.toBe(true);
  });

  it("R7 classifies terminal refs as match, empty, or conflict and blocks foreign/partial", async () => {
    async function recoverAfterS7(stateDir: string) {
      const catalog = await setupCatalog(stateDir);
      installCognitiveMergeFaultHookForTests({ crashAfter: "S7" });
      await applyHappy(stateDir, catalog);
      const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
      expect(
        (
          await runConflictGraphTakeover({
            tenantId: "t1",
            stateDir,
            catalog,
            now: expiredNow,
          })
        ).ok,
      ).toBe(true);
      return { catalog, expiredNow };
    }

    const matchDir = tmpStateDir();
    const match = await recoverAfterS7(matchDir);
    const matched = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: matchDir,
      catalog: match.catalog,
      now: match.expiredNow,
    });
    expect(matched.ok).toBe(true);
    const matchReceipt = getCognitiveMergeReceipt({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: matchDir,
    })!;
    expect(
      (await match.catalog.get(matchReceipt.derivedMemoryResourceId!))?.envelope
        .mergeFinalizationState,
    ).toBe("finalized");

    const emptyDir = tmpStateDir();
    const empty = await recoverAfterS7(emptyDir);
    patchCatalogEnvelope(emptyDir, "mem-target", {
      lastMergeReceiptId: null,
      mergedDerivedMemoryResourceId: null,
    });
    const emptied = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: emptyDir,
      catalog: empty.catalog,
      now: empty.expiredNow,
    });
    expect(emptied.ok).toBe(true);
    expect((await empty.catalog.get("mem-target"))?.envelope.lastMergeReceiptId).toBe("merge-1");

    const foreignDir = tmpStateDir();
    const foreign = await recoverAfterS7(foreignDir);
    patchCatalogEnvelope(foreignDir, "mem-target", {
      lastMergeReceiptId: "other-merge",
      mergedDerivedMemoryResourceId: "mem-other-derived",
    });
    const blocked = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: foreignDir,
      catalog: foreign.catalog,
      now: foreign.expiredNow,
    });
    expect(blocked).toMatchObject({ ok: false, error: "terminal_ref_conflict" });
    const foreignReceipt = getCognitiveMergeReceipt({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: foreignDir,
    })!;
    expect(
      (await foreign.catalog.get(foreignReceipt.derivedMemoryResourceId!))?.envelope
        .mergeFinalizationState,
    ).toBe("pending_finalization");
    expect((await foreign.catalog.get("mem-target"))?.envelope.lastMergeReceiptId).toBe(
      "other-merge",
    );

    const partialDir = tmpStateDir();
    const partial = await recoverAfterS7(partialDir);
    patchCatalogEnvelope(partialDir, "mem-target", {
      mergedDerivedMemoryResourceId: null,
    });
    const partialBlocked = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: partialDir,
      catalog: partial.catalog,
      now: partial.expiredNow,
    });
    expect(partialBlocked).toMatchObject({ ok: false, error: "terminal_ref_conflict" });
    expect((await partial.catalog.get("mem-target"))?.envelope.lastMergeReceiptId).toBe("merge-1");
    expect(
      (await partial.catalog.get("mem-target"))?.envelope.mergedDerivedMemoryResourceId,
    ).toBeUndefined();
  });

  it("R7 does not succeed when the receipt is applied but the derived product is missing", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S7" });
    await applyHappy(stateDir, catalog);
    const receipt = getCognitiveMergeReceipt({ mergeId: "merge-1", tenantId: "t1", stateDir })!;
    const derivedId = receipt.derivedMemoryResourceId!;
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
    expect(
      (
        await runConflictGraphTakeover({
          tenantId: "t1",
          stateDir,
          catalog,
          now: expiredNow,
        })
      ).ok,
    ).toBe(true);
    await catalog.remove(derivedId);
    const failed = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir,
      catalog,
      now: expiredNow,
    });
    expect(failed).toMatchObject({ ok: false, error: "needs_recovery" });
    expect(failed.receipt?.status).toBe("applied");
    expect(await catalog.get(derivedId)).toBeNull();
  });

  it("pre-commit recovery fail-closes when claim or publish CAS is refused", async () => {
    const claimDir = tmpStateDir();
    const claimCatalog = await setupCatalog(claimDir);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S4" });
    await applyHappy(claimDir, claimCatalog);
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
    installCognitiveMergeFaultHookForTests({ failRecoveryProtectedCas: "claim" });
    const claimFailed = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: claimDir,
      catalog: claimCatalog,
      now: expiredNow,
    });
    expect(claimFailed).toMatchObject({ ok: false, error: "needs_recovery" });
    expect((await claimCatalog.get("mem-target"))?.envelope.activeCognitiveMergeOp?.mergeId).toBe(
      "merge-1",
    );

    const publishDir = tmpStateDir();
    const publishCatalog = await setupCatalog(publishDir);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S4" });
    await applyHappy(publishDir, publishCatalog);
    installCognitiveMergeFaultHookForTests({ failRecoveryProtectedCas: "publish" });
    const publishFailed = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: publishDir,
      catalog: publishCatalog,
      now: expiredNow,
    });
    expect(publishFailed).toMatchObject({ ok: false, error: "needs_recovery" });
    expect(publishFailed.receipt?.status).toBe("applied");
    const publishDerivedId = getCognitiveMergeReceipt({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: publishDir,
    })!.derivedMemoryResourceId!;
    expect((await publishCatalog.get(publishDerivedId))?.envelope.mergeFinalizationState).toBe(
      "pending_finalization",
    );
  });

  it("recovery success requires release; a failed S9 leaves reservation for takeover", async () => {
    const postDir = tmpStateDir();
    const postCatalog = await setupCatalog(postDir);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S7" });
    await applyHappy(postDir, postCatalog);
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
    expect(
      (
        await runConflictGraphTakeover({
          tenantId: "t1",
          stateDir: postDir,
          catalog: postCatalog,
          now: expiredNow,
        })
      ).ok,
    ).toBe(true);
    installCognitiveMergeFaultHookForTests({ failRecoveryRelease: true });
    const postFailed = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: postDir,
      catalog: postCatalog,
      now: expiredNow,
    });
    expect(postFailed).toMatchObject({ ok: false, error: "needs_recovery" });
    expect(postFailed.receipt?.status).toBe("applied");
    const postDerivedId = getCognitiveMergeReceipt({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: postDir,
    })!.derivedMemoryResourceId!;
    expect((await postCatalog.get(postDerivedId))?.envelope.mergeFinalizationState).toBe(
      "finalized",
    );
    expect(readConflictGraphHead({ tenantId: "t1", stateDir: postDir }).reservation?.mergeId).toBe(
      "recover-merge-1",
    );

    const preDir = tmpStateDir();
    const preCatalog = await setupCatalog(preDir);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S4" });
    await applyHappy(preDir, preCatalog);
    installCognitiveMergeFaultHookForTests({ failRecoveryRelease: true });
    const preFailed = await recoverCognitiveMerge({
      mergeId: "merge-1",
      tenantId: "t1",
      stateDir: preDir,
      catalog: preCatalog,
      now: expiredNow,
    });
    expect(preFailed).toMatchObject({ ok: false, error: "needs_recovery" });
    expect(preFailed.receipt?.status).toBe("applied");
    expect((await preCatalog.get("mem-target"))?.envelope.lastMergeReceiptId).toBe("merge-1");
    expect(readConflictGraphHead({ tenantId: "t1", stateDir: preDir }).reservation?.mergeId).toBe(
      "recover-merge-1",
    );
  });

  it("S3 persists derivedCreated before unique-create so a crash cannot skip T3", async () => {
    const stateDir = tmpStateDir();
    const catalog = await setupCatalog(stateDir);
    installCognitiveMergeFaultHookForTests({ crashAfter: "S3_intent" });
    await applyHappy(stateDir, catalog);
    const receipt = getCognitiveMergeReceipt({ mergeId: "merge-1", tenantId: "t1", stateDir })!;
    expect(receipt.derivedCreated).toBe(true);
    expect(receipt.protocolPhase).toBe("S3");
    expect(await catalog.get(receipt.derivedMemoryResourceId!)).toBeNull();
    expect(readConflictGraphHead({ tenantId: "t1", stateDir }).reservation?.derivedCreated).toBe(
      true,
    );
    const expiredNow = new Date(Date.now() + MERGE_RESERVATION_LEASE_MS + 1_000);
    const takeover = await runConflictGraphTakeover({
      tenantId: "t1",
      stateDir,
      catalog,
      now: expiredNow,
    });
    expect(takeover).toEqual({ ok: false, conflict: "participant_fence_failed" });
    expect(readConflictGraphHead({ tenantId: "t1", stateDir }).reservation?.state).toBe("fencing");
  });

  it("merge modules do not import P2 purge", () => {
    const files = [
      "cognitive-merge.ts",
      "cognitive-merge-recovery.ts",
      "cognitive-merge-reclaim.ts",
      "cognitive-merge-fencing.ts",
      "cognitive-conflict-graph.ts",
      "cognitive-conflict-edges.ts",
      "cognitive-health.ts",
      "cognitive-evaluator.ts",
    ];
    for (const name of files) {
      const src = fs.readFileSync(path.join(import.meta.dirname, name), "utf8");
      expect(src).not.toMatch(/lifecycle-purge/);
    }
  });
});
