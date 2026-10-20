import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateTemporalDecayMultiplier } from "../../memory/temporal-decay.js";
import type { TenantContext } from "../tenant-context.js";
import {
  createFileDataGovernanceCatalogStore,
  resetCatalogStoreSingletonsForTests,
} from "./catalog-store.js";
import {
  authenticateGovernanceCall,
  resolveCognitiveRecommendationAuth,
  type CognitiveRecommendationAuth,
} from "./cognitive-recommendation-auth.js";
import type { RetrievalPolicyEvaluator } from "./cognitive-retrieval-policy.js";
import { decideConstrainedRetrieval } from "./cognitive-retrieval.js";
import { updateCognitiveGovernance } from "./cognitive-update.js";
import { unlockCognitiveWritesForTests } from "./cognitive-write-unlock.test-harness.js";
import type {
  ActiveLifecycleOperation,
  CatalogRecord,
  CognitiveTier,
  LongRunningLifecycleCommand,
  RetrievalGovernance,
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p3c-"));
  tempDirs.push(dir);
  return dir;
}

const passPolicies: RetrievalPolicyEvaluator = {
  evaluate(policyId) {
    return policyId === "freshness-v1" || policyId === "applicability-v1" ? "allow" : "unknown";
  },
};

function decideWithPolicies(
  params: Parameters<typeof decideConstrainedRetrieval>[0],
  evaluator?: RetrievalPolicyEvaluator,
) {
  getRetrievalPolicyEvaluatorMock.mockReturnValue(evaluator);
  return decideConstrainedRetrieval(params);
}

function governance(overrides: Partial<RetrievalGovernance> = {}): RetrievalGovernance {
  return {
    eligibility: "eligible",
    basePriority: 0.5,
    freshnessPolicyId: "freshness-v1",
    applicabilityPolicyId: "applicability-v1",
    ...overrides,
  };
}

function memoryV1(
  resourceId = "mem-1",
  overrides: Partial<CatalogRecord["envelope"]> = {},
): CatalogRecord {
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
      projection: { canonicalKind: "cogniweave", atomId: "a1", memoryTier: "working" },
      ...overrides,
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

function unlock(stateDir: string): void {
  unlockCognitiveWritesForTests(stateDir);
}

async function setupMemory(stateDir: string, record: CatalogRecord = memoryV1()) {
  const catalog = createFileDataGovernanceCatalogStore({
    storePath: path.join(stateDir, "data-governance", "catalog.json"),
  });
  await catalog.put(record);
  return { catalog };
}

async function attachGovernance(
  stateDir: string,
  catalog: ReturnType<typeof createFileDataGovernanceCatalogStore>,
  retrieval: Partial<RetrievalGovernance> = {},
  extra?: { resourceId?: string; cognitiveTier?: CognitiveTier },
): Promise<void> {
  unlock(stateDir);
  const resourceId = extra?.resourceId ?? "mem-1";
  const current = (await catalog.get(resourceId))!;
  const result = await updateCognitiveGovernance({
    resourceId,
    expectedGovernanceVersion: current.envelope.governanceVersion,
    actor: { kind: "operator", operatorId: "op-1" },
    mutationId: `mut-${resourceId}-${current.envelope.governanceVersion + 1}`,
    patch: {
      cognitiveTier: extra?.cognitiveTier ?? "C4",
      preservationPriority: "standard",
      retrievalPatch: governance(retrieval),
    },
    stateDir,
    catalog,
  });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
}

async function userAuth(stateDir: string): Promise<CognitiveRecommendationAuth> {
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
  expect(authenticated.ok).toBe(true);
  if (!authenticated.ok) {
    throw new Error("expected TenantContext-authenticated call");
  }
  const resolved = await resolveCognitiveRecommendationAuth({
    call: authenticated.call,
    owner: { kind: "user", userId: "u1" },
    stateDir,
  });
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) {
    throw new Error("expected branded recommendation auth");
  }
  return resolved.auth;
}

describe("P3-c constrained retrieval decision", () => {
  it("returns a decision whose rankedScore ignores admission and promotion", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    await attachGovernance(stateDir, catalog);
    const auth = await userAuth(stateDir);
    const allowed = await decideWithPolicies(
      {
        resourceId: "mem-1",
        mode: "default_recall",
        retrievalScore: 0.8,
        decayMultiplier: 1,
        auth,
        stateDir,
        catalog,
      },
      passPolicies,
    );
    expect(allowed).toMatchObject({
      outcome: "allow",
      mode: "default_recall",
      resourceId: "mem-1",
      rankedScore: 0.4,
    });
    if (allowed.outcome === "allow") {
      expect(allowed.reasons.sourceSupport).toBe("present");
      expect(allowed.reasons.scope).toBe("tenant:t1");
    }
    const substituted = await decideConstrainedRetrieval({
      resourceId: "mem-1",
      mode: "default_recall",
      retrievalScore: 0.8,
      auth,
      stateDir,
      catalog,
      admissionScore: 0.99,
      promotionScore: 0.01,
    } as Parameters<typeof decideConstrainedRetrieval>[0] & {
      admissionScore: number;
      promotionScore: number;
    });
    expect(substituted).toMatchObject({ outcome: "deny", code: "invalid_score" });
  });

  it("does not let high CognitiveTier or projection.memoryTier bypass classification or ACL", async () => {
    const stateDir = tmpStateDir();
    const restricted = memoryV1("mem-1", {
      classification: "restricted",
      projection: { canonicalKind: "cogniweave", atomId: "a1", memoryTier: "long_term" },
    });
    const { catalog } = await setupMemory(stateDir, restricted);
    await attachGovernance(stateDir, catalog, {}, { cognitiveTier: "C4" });
    const auth = await userAuth(stateDir);
    expect(
      await decideConstrainedRetrieval({
        resourceId: "mem-1",
        mode: "explicit_retrieval",
        retrievalScore: 1,
        auth,
        stateDir,
        catalog,
      }),
    ).toMatchObject({ outcome: "deny", code: "classification_denied" });

    await catalog.put(
      memoryV1("mem-2", {
        tenantId: "t2",
        owner: { kind: "user", userId: "u2" },
        scope: { kind: "tenant", tenantId: "t2" },
        projection: { canonicalKind: "cogniweave", atomId: "a2", memoryTier: "long_term" },
      }),
    );
    await attachGovernance(stateDir, catalog, {}, { resourceId: "mem-2", cognitiveTier: "C4" });
    expect(
      await decideConstrainedRetrieval({
        resourceId: "mem-2",
        mode: "audit_retrieval",
        retrievalScore: 1,
        auth,
        stateDir,
        catalog,
      }),
    ).toMatchObject({ outcome: "deny", code: "acl_denied" });
  });

  it("uses L1 decay only for ranking and never deletes or writes Catalog", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    await attachGovernance(stateDir, catalog);
    const before = JSON.stringify(await catalog.get("mem-1"));
    const auth = await userAuth(stateDir);
    const decay = calculateTemporalDecayMultiplier({ ageInDays: 30, halfLifeDays: 30 });
    const aged = await decideWithPolicies(
      {
        resourceId: "mem-1",
        mode: "default_recall",
        retrievalScore: 0.8,
        ageInDays: 30,
        halfLifeDays: 30,
        auth,
        stateDir,
        catalog,
      },
      passPolicies,
    );
    const fresh = await decideWithPolicies(
      {
        resourceId: "mem-1",
        mode: "default_recall",
        retrievalScore: 0.8,
        decayMultiplier: 1,
        auth,
        stateDir,
        catalog,
      },
      passPolicies,
    );
    expect(aged.outcome).toBe("allow");
    expect(fresh.outcome).toBe("allow");
    if (aged.outcome === "allow" && fresh.outcome === "allow") {
      expect(aged.rankedScore).toBeCloseTo(0.8 * decay * 0.5, 10);
      expect(fresh.rankedScore).toBe(0.4);
      expect(aged.rankedScore).toBeLessThan(fresh.rankedScore);
    }
    expect(JSON.stringify(await catalog.get("mem-1"))).toBe(before);
    expect(fs.existsSync(path.join(stateDir, "data-governance", "catalog.json"))).toBe(true);
  });

  it("keeps eligibility=retired out of default_recall and still applies ACL/legal in explicit/audit", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    await attachGovernance(stateDir, catalog, { eligibility: "retired" });
    const auth = await userAuth(stateDir);
    expect(
      await decideConstrainedRetrieval({
        resourceId: "mem-1",
        mode: "default_recall",
        retrievalScore: 0.8,
        auth,
        stateDir,
        catalog,
      }),
    ).toMatchObject({ outcome: "deny", code: "eligibility_retired" });
    expect(
      await decideWithPolicies(
        {
          resourceId: "mem-1",
          mode: "explicit_retrieval",
          retrievalScore: 0.8,
          auth,
          stateDir,
          catalog,
        },
        passPolicies,
      ),
    ).toMatchObject({ outcome: "allow", rankedScore: 0.4 });

    const current = (await catalog.get("mem-1"))!;
    await catalog.put({
      ...current,
      envelope: {
        ...current.envelope,
        legalHold: {
          holdId: "hold-1",
          reason: "dsar",
          appliedBy: { kind: "user", userId: "u1" },
          appliedAt: "2026-08-11T00:00:00Z",
        },
      },
    });
    expect(
      await decideConstrainedRetrieval({
        resourceId: "mem-1",
        mode: "explicit_retrieval",
        retrievalScore: 0.8,
        auth,
        stateDir,
        catalog,
      }),
    ).toMatchObject({ outcome: "deny", code: "legal_hold" });
    expect(
      await decideConstrainedRetrieval({
        resourceId: "mem-1",
        mode: "audit_retrieval",
        retrievalScore: 0.8,
        auth,
        stateDir,
        catalog,
      }),
    ).toMatchObject({ outcome: "deny", code: "legal_hold" });
  });

  it("denies missing governance, missing evaluator, unknown policy, and invalid scores", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const auth = await userAuth(stateDir);
    expect(
      await decideConstrainedRetrieval({
        resourceId: "mem-1",
        mode: "default_recall",
        retrievalScore: 0.8,
        auth,
        stateDir,
        catalog,
      }),
    ).toMatchObject({ outcome: "deny", code: "retrieval_governance_missing" });
    expect(
      await decideConstrainedRetrieval({
        resourceId: "mem-1",
        mode: "explicit_retrieval",
        retrievalScore: 0.8,
        auth,
        stateDir,
        catalog,
      }),
    ).toMatchObject({ outcome: "deny", code: "retrieval_governance_missing" });

    await attachGovernance(stateDir, catalog);
    expect(
      await decideConstrainedRetrieval({
        resourceId: "mem-1",
        mode: "default_recall",
        retrievalScore: 0.8,
        auth,
        stateDir,
        catalog,
      }),
    ).toMatchObject({ outcome: "deny", code: "policy_evaluator_missing" });
    expect(
      await decideWithPolicies(
        {
          resourceId: "mem-1",
          mode: "default_recall",
          retrievalScore: 0.8,
          auth,
          stateDir,
          catalog,
        },
        { evaluate: () => "unknown" },
      ),
    ).toMatchObject({ outcome: "deny", code: "unknown_policy_id" });
    expect(
      await decideWithPolicies(
        {
          resourceId: "mem-1",
          mode: "default_recall",
          retrievalScore: Number.NaN,
          auth,
          stateDir,
          catalog,
        },
        passPolicies,
      ),
    ).toMatchObject({ outcome: "deny", code: "invalid_score" });
  });

  it("denies hard lifecycle states in every mode and archived only in default_recall", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(
      stateDir,
      memoryV1("mem-purged", { lifecycleState: "purged" }),
    );
    await catalog.put(memoryV1("mem-archived", { lifecycleState: "archived" }));
    await attachGovernance(stateDir, catalog, {}, { resourceId: "mem-archived" });
    const auth = await userAuth(stateDir);
    expect(
      await decideConstrainedRetrieval({
        resourceId: "mem-purged",
        mode: "audit_retrieval",
        retrievalScore: 0.8,
        auth,
        stateDir,
        catalog,
      }),
    ).toMatchObject({ outcome: "deny", code: "lifecycle_denied" });
    expect(
      await decideConstrainedRetrieval({
        resourceId: "mem-archived",
        mode: "default_recall",
        retrievalScore: 0.8,
        auth,
        stateDir,
        catalog,
      }),
    ).toMatchObject({ outcome: "deny", code: "lifecycle_denied" });
    expect(
      await decideWithPolicies(
        {
          resourceId: "mem-archived",
          mode: "explicit_retrieval",
          retrievalScore: 0.8,
          auth,
          stateDir,
          catalog,
        },
        passPolicies,
      ),
    ).toMatchObject({ outcome: "allow" });
  });

  it("denies eligibility=blocked in every mode and rejects worker-shaped auth", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    await attachGovernance(stateDir, catalog, { eligibility: "blocked" });
    const auth = await userAuth(stateDir);
    expect(
      await decideConstrainedRetrieval({
        resourceId: "mem-1",
        mode: "audit_retrieval",
        retrievalScore: 0.8,
        auth,
        stateDir,
        catalog,
      }),
    ).toMatchObject({ outcome: "deny", code: "eligibility_blocked" });
    expect(
      await decideConstrainedRetrieval({
        resourceId: "mem-1",
        mode: "default_recall",
        retrievalScore: 0.8,
        auth: {
          callerTenantId: "t1",
          actor: { kind: "worker", workerId: "w1" },
          ownershipProof: auth.ownershipProof,
          requestedBy: { kind: "user", userId: "u1" },
        } as CognitiveRecommendationAuth,
        stateDir,
        catalog,
      }),
    ).toMatchObject({ outcome: "deny", code: "acl_denied" });
  });

  it("ignores a caller-forged policyEvaluator and keeps unknown vs deny distinct", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    await attachGovernance(stateDir, catalog);
    const auth = await userAuth(stateDir);
    const forgedAllow = {
      resourceId: "mem-1",
      mode: "default_recall" as const,
      retrievalScore: 0.8,
      auth,
      stateDir,
      catalog,
      policyEvaluator: { evaluate: () => "allow" as const },
    };
    expect(await decideConstrainedRetrieval(forgedAllow as never)).toMatchObject({
      outcome: "deny",
      code: "invalid_score",
    });
    expect(
      await decideWithPolicies(
        {
          resourceId: "mem-1",
          mode: "default_recall",
          retrievalScore: 0.8,
          auth,
          stateDir,
          catalog,
        },
        { evaluate: () => "deny" },
      ),
    ).toMatchObject({ outcome: "deny", code: "legal_policy_denied" });
    expect(
      await decideWithPolicies(
        {
          resourceId: "mem-1",
          mode: "default_recall",
          retrievalScore: 0.8,
          auth,
          stateDir,
          catalog,
        },
        { evaluate: () => "unknown" },
      ),
    ).toMatchObject({ outcome: "deny", code: "unknown_policy_id" });
  });

  it("denies retrieval while lifecycleState is active and a lifecycle operation is in flight", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    await attachGovernance(stateDir, catalog);
    const auth = await userAuth(stateDir);
    const commands: LongRunningLifecycleCommand[] = [
      "forget",
      "requestPurge",
      "archive",
      "restore",
    ];
    for (const command of commands) {
      const current = (await catalog.get("mem-1"))!;
      const activeLifecycleOperation: ActiveLifecycleOperation = {
        operationId: `op-${command}`,
        command,
        receiptId: `rcpt-${command}`,
        previousLifecycleState: "active",
        startedAt: "2026-08-11T00:00:00Z",
      };
      await catalog.put({
        ...current,
        envelope: {
          ...current.envelope,
          lifecycleState: "active",
          activeLifecycleOperation,
        },
      });
      const inflight = (await catalog.get("mem-1"))!;
      expect(inflight.envelope.lifecycleState).toBe("active");
      expect(inflight.envelope.activeLifecycleOperation?.command).toBe(command);
      expect(
        await decideWithPolicies(
          {
            resourceId: "mem-1",
            mode: "default_recall",
            retrievalScore: 0.8,
            auth,
            stateDir,
            catalog,
          },
          passPolicies,
        ),
      ).toMatchObject({ outcome: "deny", code: "lifecycle_denied" });
      expect(
        await decideWithPolicies(
          {
            resourceId: "mem-1",
            mode: "explicit_retrieval",
            retrievalScore: 0.8,
            auth,
            stateDir,
            catalog,
          },
          passPolicies,
        ),
      ).toMatchObject({ outcome: "deny", code: "lifecycle_denied" });
      expect(
        await decideWithPolicies(
          {
            resourceId: "mem-1",
            mode: "audit_retrieval",
            retrievalScore: 0.8,
            auth,
            stateDir,
            catalog,
          },
          passPolicies,
        ),
      ).toMatchObject({ outcome: "deny", code: "lifecycle_denied" });
    }
  });

  it("does not import P2 forget or purge or worker delegation", () => {
    const dir = path.resolve(import.meta.dirname);
    const command = fs.readFileSync(path.join(dir, "cognitive-retrieval.ts"), "utf8");
    const policy = fs.readFileSync(path.join(dir, "cognitive-retrieval-policy.ts"), "utf8");
    for (const token of [
      "lifecycle-purge",
      "lifecycle-memory",
      "requestPurge",
      "resumePurge",
      "delegationGrantId",
      "mintGovernanceAuthenticatedCallForTests",
      "issueCognitiveRecommendationDelegation",
      "policyEvaluator",
      "installRetrievalPolicyEvaluatorForTests",
      "decideConstrainedRetrievalForTests",
    ]) {
      expect(command.includes(token), token).toBe(false);
    }
    for (const token of [
      "installRetrievalPolicyEvaluatorForTests",
      "installedEvaluator",
      "decideConstrainedRetrievalForTests",
    ]) {
      expect(policy.includes(token), token).toBe(false);
    }
  });
});
