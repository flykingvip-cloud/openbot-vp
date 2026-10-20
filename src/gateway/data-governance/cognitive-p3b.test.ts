import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../tenant-context.js";
import {
  createFileDataGovernanceCatalogStore,
  resetCatalogStoreSingletonsForTests,
} from "./catalog-store.js";
import * as cognitiveRecommendationAuth from "./cognitive-recommendation-auth.js";
import {
  authenticateGovernanceCall,
  resolveCognitiveRecommendationAuth,
  type CognitiveRecommendationAuth,
} from "./cognitive-recommendation-auth.js";
import {
  cleanupExpiredCognitiveRecommendations,
  getCognitiveRecommendation,
  recordCognitiveRecommendation,
} from "./cognitive-recommendation.js";
import type { RecordCognitiveRecommendationParams } from "./cognitive-recommendation.js";
import { encodeUnitIntervalScore, hexToFloat64 } from "./cognitive-score.js";
import * as dataGovernanceBarrel from "./index.js";
import { getLifecycleReceipt } from "./lifecycle-receipt-store.js";
import { ownershipProofFromTenantUser } from "./ownership-proof.js";
import type { CatalogRecord, OwnershipPrincipal } from "./types.js";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p3b-"));
  tempDirs.push(dir);
  return dir;
}

function memoryV1(resourceId = "mem-1", tenantId: string | null = "t1"): CatalogRecord {
  return {
    envelope: {
      resourceId,
      resourceType: "memory",
      schemaVersion: 1,
      tenantId,
      owner: { kind: "user", userId: "u1" },
      scope: tenantId ? { kind: "tenant", tenantId } : { kind: "user", userId: "u1" },
      lifecycleState: "active",
      classification: "confidential",
      governanceVersion: 1,
      canonicalBindingId: `bind-${resourceId}`,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
      projection: { canonicalKind: "cogniweave", atomId: "a1", memoryTier: "working" },
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

async function setupMemory(stateDir: string, record: CatalogRecord = memoryV1()) {
  const catalog = createFileDataGovernanceCatalogStore({
    storePath: path.join(stateDir, "data-governance", "catalog.json"),
  });
  await catalog.put(record);
  return { catalog };
}

async function requireAuth(
  result: Promise<Awaited<ReturnType<typeof resolveCognitiveRecommendationAuth>>>,
): Promise<CognitiveRecommendationAuth> {
  const resolved = await result;
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) {
    throw new Error("expected Gateway-authenticated recommendation auth");
  }
  return resolved.auth;
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
  expect(authenticated.ok).toBe(true);
  if (!authenticated.ok) {
    throw new Error("expected TenantContext-authenticated enterprise call");
  }
  return authenticated.call;
}

async function personalCall() {
  resolveTenantContextMock.mockResolvedValue(null);
  resolveAuthoritativeMembershipMock.mockResolvedValue({ tenantId: null, userId: "u1" });
  const authenticated = await authenticateGovernanceCall({
    connect: {} as never,
    user: "u1@local.test",
  });
  expect(authenticated.ok).toBe(true);
  if (!authenticated.ok) {
    throw new Error("expected membership-authenticated personal call");
  }
  return authenticated.call;
}

async function enterpriseAuth(stateDir: string): Promise<CognitiveRecommendationAuth> {
  return requireAuth(
    resolveCognitiveRecommendationAuth({
      call: await enterpriseCall(),
      owner: { kind: "user", userId: "u1" },
      stateDir,
    }),
  );
}

async function personalAuth(stateDir: string): Promise<CognitiveRecommendationAuth> {
  return requireAuth(
    resolveCognitiveRecommendationAuth({
      call: await personalCall(),
      owner: { kind: "user", userId: "u1" },
      stateDir,
    }),
  );
}

async function baseParams(
  stateDir: string,
  catalog: ReturnType<typeof createFileDataGovernanceCatalogStore>,
  overrides: Partial<RecordCognitiveRecommendationParams> = {},
): Promise<RecordCognitiveRecommendationParams> {
  return {
    recommendationId: "rec-1",
    candidateId: "cand-1",
    sourceResourceIds: ["mem-1"],
    policyVersion: "admission-v1",
    admissionScore: 0.8,
    retrievalScore: 0.4,
    promotionScore: 0.1,
    scoreAlgorithmVersion: "cogniweave-atom-v2/scoreVersion=1",
    producerModelRef: "unknown",
    decision: "recommend_admit",
    reasonCode: "policy_pass",
    auth: await enterpriseAuth(stateDir),
    stateDir,
    catalog,
    ...overrides,
  };
}

async function expectNoReceipt(params: {
  recommendationId: string;
  tenantId: string | null;
  stateDir: string;
  owner?: OwnershipPrincipal;
}): Promise<void> {
  expect(
    await getCognitiveRecommendation({
      recommendationId: params.recommendationId,
      tenantId: params.tenantId,
      owner: params.owner ?? { kind: "user", userId: "u1" },
      stateDir: params.stateDir,
    }),
  ).toBeNull();
}

describe("P3-b shadow CognitiveRecommendationReceipt", () => {
  it("unique-create does not write Catalog or activeLifecycleOperation", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const before = (await catalog.get("mem-1"))!;
    const result = await recordCognitiveRecommendation(await baseParams(stateDir, catalog));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.created).toBe(true);
    expect(result.receipt.status).toBe("open");
    expect(result.receipt.executedBy).toEqual({ kind: "user", userId: "u1" });
    const encodedAdmit = encodeUnitIntervalScore(0.8);
    expect(encodedAdmit.ok).toBe(true);
    if (encodedAdmit.ok) {
      expect(result.receipt.scoreInputs.admissionScore).toEqual(encodedAdmit.score);
    }
    expect(Object.keys(result.receipt.scoreInputs.admissionScore)).toEqual(["ieee754Hex"]);
    const after = (await catalog.get("mem-1"))!;
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(getLifecycleReceipt({ operationId: "rec-1", stateDir })).toBeNull();
  });

  it("propose_forget and propose_purge record only and do not open P2 ops", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    for (const decision of ["propose_forget", "propose_purge"] as const) {
      const result = await recordCognitiveRecommendation(
        await baseParams(stateDir, catalog, {
          recommendationId: `rec-${decision}`,
          decision,
          reasonCode: "engine_proposal",
        }),
      );
      expect(result, decision).toMatchObject({ ok: true });
      expect((await catalog.get("mem-1"))?.envelope.activeLifecycleOperation).toBeUndefined();
      expect(getLifecycleReceipt({ operationId: `rec-${decision}`, stateDir })).toBeNull();
    }
  });

  it("rejects body, embedding, CoT, and evidence arrays before creating a receipt", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const cases = [
      { embedding: [0.1, 0.2] },
      { body: "atom body" },
      { chainOfThought: "hidden" },
      { sourceEventIds: ["evt-1"] },
      { evidenceRefs: ["ev-1"] },
      { candidate: { cot: "secret-reasoning" } },
    ];
    for (const extra of cases) {
      const recommendationId = `rec-bad-${Object.keys(extra)[0]}`;
      const denied = await recordCognitiveRecommendation({
        ...(await baseParams(stateDir, catalog, { recommendationId })),
        ...extra,
      } as RecordCognitiveRecommendationParams);
      expect(denied.ok, Object.keys(extra)[0]).toBe(false);
      if (!denied.ok) {
        expect(["forbidden_payload", "field_not_writable"]).toContain(denied.error);
      }
      await expectNoReceipt({ recommendationId, tenantId: "t1", stateDir });
    }
  });

  it("shares ieee754Hex between receipt and fingerprint; close decimals mismatch", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const a = 0.12345641;
    const b = 0.12345649;
    const encodedA = encodeUnitIntervalScore(a);
    const encodedB = encodeUnitIntervalScore(b);
    expect(encodedA.ok && encodedB.ok).toBe(true);
    if (!encodedA.ok || !encodedB.ok) {
      return;
    }
    expect(encodedA.score.ieee754Hex).not.toBe(encodedB.score.ieee754Hex);
    expect(hexToFloat64(encodedA.score.ieee754Hex)).toBe(a);
    const first = await recordCognitiveRecommendation(
      await baseParams(stateDir, catalog, { admissionScore: a }),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.receipt.scoreInputs.admissionScore.ieee754Hex).toBe(encodedA.score.ieee754Hex);
    expect(
      await recordCognitiveRecommendation(
        await baseParams(stateDir, catalog, { admissionScore: b }),
      ),
    ).toMatchObject({ ok: false, error: "idempotent_mismatch" });
    expect(
      await recordCognitiveRecommendation(
        await baseParams(stateDir, catalog, { admissionScore: a }),
      ),
    ).toMatchObject({ ok: true, created: false });
  });

  it("rejects NaN, Infinity, -0, and out-of-range scores before encode", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    for (const c of [
      { id: "rec-nan", admissionScore: Number.NaN },
      { id: "rec-inf", admissionScore: Number.POSITIVE_INFINITY },
      { id: "rec-negzero", admissionScore: -0 },
      { id: "rec-high", admissionScore: 1.1 },
    ]) {
      expect(
        await recordCognitiveRecommendation(
          await baseParams(stateDir, catalog, {
            recommendationId: c.id,
            admissionScore: c.admissionScore,
          }),
        ),
        c.id,
      ).toMatchObject({ ok: false, error: "invalid_score" });
      await expectNoReceipt({ recommendationId: c.id, tenantId: "t1", stateDir });
    }
  });

  it("rejects missing score metadata before creating a receipt", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    expect(
      await recordCognitiveRecommendation(
        await baseParams(stateDir, catalog, {
          recommendationId: "rec-meta-1",
          scoreAlgorithmVersion: "   ",
        }),
      ),
    ).toMatchObject({ ok: false, error: "invalid_score_metadata" });
    await expectNoReceipt({ recommendationId: "rec-meta-1", tenantId: "t1", stateDir });
  });

  it("isolates partitions and rejects client-forged tenant on the wire", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    expect(await recordCognitiveRecommendation(await baseParams(stateDir, catalog))).toMatchObject({
      ok: true,
    });
    const forged = await recordCognitiveRecommendation({
      ...(await baseParams(stateDir, catalog, { recommendationId: "rec-forged" })),
      tenantId: "other-tenant",
    } as RecordCognitiveRecommendationParams);
    expect(forged).toMatchObject({ ok: false, error: "field_not_writable" });
    await expectNoReceipt({ recommendationId: "rec-forged", tenantId: "t1", stateDir });
  });

  it("cleanup deletes only the receipt file and never writes Catalog", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    expect(await recordCognitiveRecommendation(await baseParams(stateDir, catalog))).toMatchObject({
      ok: true,
    });
    const owner = { kind: "user" as const, userId: "u1" };
    const future = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(
      (
        await getCognitiveRecommendation({
          recommendationId: "rec-1",
          tenantId: "t1",
          owner,
          stateDir,
          now: future,
        })
      )?.status,
    ).toBe("expired");
    expect(
      (
        await cleanupExpiredCognitiveRecommendations({
          tenantId: "t1",
          owner,
          stateDir,
          now: future,
        })
      ).deleted,
    ).toBe(1);
    await expectNoReceipt({ recommendationId: "rec-1", tenantId: "t1", stateDir });
    expect((await catalog.get("mem-1"))?.envelope.governanceVersion).toBe(1);
  });

  it("stores personal/<ownerUserId> when Catalog tenantId is null", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir, memoryV1("mem-1", null));
    const result = await recordCognitiveRecommendation(
      await baseParams(stateDir, catalog, { auth: await personalAuth(stateDir) }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.receipt.tenantId).toBeNull();
    expect(result.receipt.executedBy).toEqual({ kind: "user", userId: "u1" });
    expect(
      fs.existsSync(
        path.join(
          stateDir,
          "data-governance",
          "cognitive-recommendations",
          "personal",
          "u1",
          "rec-1.json",
        ),
      ),
    ).toBe(true);
  });

  it("denies cross-tenant same resource id and guessed foreign resources", async () => {
    const stateDir = tmpStateDir();
    const foreign = memoryV1("mem-1", "t2");
    const { catalog } = await setupMemory(stateDir, {
      ...foreign,
      envelope: {
        ...foreign.envelope,
        owner: { kind: "user", userId: "u2" },
        scope: { kind: "tenant", tenantId: "t2" },
      },
    });
    const crossTenant = await recordCognitiveRecommendation(
      await baseParams(stateDir, catalog, { recommendationId: "rec-cross" }),
    );
    expect(crossTenant).toMatchObject({ ok: false, error: "acl_denied" });
    await expectNoReceipt({ recommendationId: "rec-cross", tenantId: "t1", stateDir });
    const guessed = await recordCognitiveRecommendation(
      await baseParams(stateDir, catalog, {
        recommendationId: "rec-guess",
        sourceResourceIds: ["mem-other-tenant"],
      }),
    );
    expect(guessed).toMatchObject({ ok: false, error: "source_not_found" });
    await expectNoReceipt({ recommendationId: "rec-guess", tenantId: "t1", stateDir });
  });

  it("succeeds only when auth is resolved from a Gateway-authenticated call", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
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
      return;
    }
    const auth = await requireAuth(
      resolveCognitiveRecommendationAuth({
        call: authenticated.call,
        owner: { kind: "user", userId: "u1" },
        stateDir,
      }),
    );
    const result = await recordCognitiveRecommendation(
      await baseParams(stateDir, catalog, { auth, recommendationId: "rec-authority" }),
    );
    expect(result).toMatchObject({ ok: true, created: true });
    if (result.ok) {
      expect(result.receipt.executedBy).toEqual({ kind: "user", userId: "u1" });
      expect(result.receipt.requestedBy).toEqual({ kind: "user", userId: "u1" });
    }
  });

  it("rejects forged session DTOs, unbranded actors, and worker delegation", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    expect("createCognitiveRecommendationAuth" in dataGovernanceBarrel).toBe(false);
    expect("mintGovernanceAuthenticatedCallForTests" in dataGovernanceBarrel).toBe(false);
    expect("mintGovernanceAuthenticatedCallForTests" in cognitiveRecommendationAuth).toBe(false);
    expect("issueCognitiveRecommendationDelegation" in dataGovernanceBarrel).toBe(false);

    const forgedSession = await resolveCognitiveRecommendationAuth({
      session: { kind: "tenant-user", tenantId: "t1", userId: "u1" },
      owner: { kind: "user", userId: "u1" },
      stateDir,
    } as unknown as Parameters<typeof resolveCognitiveRecommendationAuth>[0]);
    expect(forgedSession).toMatchObject({ ok: false, error: "actor_not_authorized" });

    const forgedOperator = await resolveCognitiveRecommendationAuth({
      call: { kind: "operator", tenantId: "t1", operatorId: "op-root" } as never,
      owner: { kind: "user", userId: "u1" },
      stateDir,
    });
    expect(forgedOperator).toMatchObject({ ok: false, error: "actor_not_authorized" });

    const forgedSystem = await resolveCognitiveRecommendationAuth({
      call: { kind: "system", tenantId: "t1", systemId: "sys-root" } as never,
      owner: { kind: "user", userId: "u1" },
      stateDir,
    });
    expect(forgedSystem).toMatchObject({ ok: false, error: "actor_not_authorized" });

    const forgedWorker = await resolveCognitiveRecommendationAuth({
      call: { callerTenantId: "t1", actor: { kind: "worker", workerId: "w1" } } as never,
      owner: { kind: "user", userId: "u1" },
      stateDir,
    });
    expect(forgedWorker).toMatchObject({ ok: false, error: "actor_not_authorized" });

    const forgedGrant = await resolveCognitiveRecommendationAuth({
      call: await enterpriseCall(),
      owner: { kind: "position", seatId: "seat-forged" },
      stateDir,
    });
    expect(forgedGrant).toMatchObject({ ok: false, error: "actor_not_authorized" });

    const workerDelegation = await resolveCognitiveRecommendationAuth({
      call: await enterpriseCall(),
      owner: { kind: "user", userId: "u1" },
      stateDir,
      delegationGrantId: "grant-missing",
    } as unknown as Parameters<typeof resolveCognitiveRecommendationAuth>[0]);
    expect(workerDelegation).toMatchObject({ ok: false, error: "actor_not_authorized" });

    const unbranded = await recordCognitiveRecommendation({
      ...(await baseParams(stateDir, catalog, { recommendationId: "rec-plain" })),
      auth: {
        callerTenantId: "t1",
        actor: { kind: "operator", operatorId: "op-forged" },
        ownershipProof: ownershipProofFromTenantUser({ tenantId: "t1", userId: "u1" }),
        requestedBy: { kind: "operator", operatorId: "op-forged" },
      } as CognitiveRecommendationAuth,
    });
    expect(unbranded).toMatchObject({ ok: false, error: "actor_not_authorized" });
    await expectNoReceipt({ recommendationId: "rec-plain", tenantId: "t1", stateDir });

    const wireExecuted = await recordCognitiveRecommendation({
      ...(await baseParams(stateDir, catalog, { recommendationId: "rec-exec" })),
      executedBy: { kind: "system", systemId: "sys-root" },
    } as RecordCognitiveRecommendationParams);
    expect(wireExecuted).toMatchObject({ ok: false, error: "field_not_writable" });
    await expectNoReceipt({ recommendationId: "rec-exec", tenantId: "t1", stateDir });
  });

  it("cannot mint a branded call when NODE_ENV is unset", async () => {
    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      expect("mintGovernanceAuthenticatedCallForTests" in cognitiveRecommendationAuth).toBe(false);
      const denied = await resolveCognitiveRecommendationAuth({
        call: { callerTenantId: "t1", actor: { kind: "user", userId: "u1" } } as never,
        owner: { kind: "user", userId: "u1" },
      });
      expect(denied).toMatchObject({ ok: false, error: "actor_not_authorized" });
      expect(await authenticateGovernanceCall(null)).toMatchObject({
        ok: false,
        error: "actor_not_authorized",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previous;
      }
    }
  });

  it("does not import P2 forget or purge from the recommendation engine", () => {
    const dir = path.resolve(import.meta.dirname);
    const files = [
      "cognitive-recommendation.ts",
      "cognitive-recommendation-store.ts",
      "cognitive-recommendation-auth.ts",
      "cognitive-recommendation-registry.ts",
      "cognitive-score.ts",
    ];
    const forbidden = [
      "lifecycle-purge",
      "lifecycle-memory",
      "requestPurge",
      "resumePurge",
      "mintGovernanceAuthenticatedCallForTests",
      'from "./lifecycle-memory.js"',
      'from "./lifecycle-purge.js"',
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      for (const token of forbidden) {
        expect(source.includes(token), `${file} ${token}`).toBe(false);
      }
    }
  });
});
