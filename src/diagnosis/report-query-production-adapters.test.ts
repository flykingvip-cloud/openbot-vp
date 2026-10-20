import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aggregateCrossTargetCases } from "./cross-target.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED, dispatchDiagnosisReportApi } from "./report-query-api.js";
import {
  DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED,
  PRODUCTION_ADAPTER_STORAGE,
  assertProductionAdaptersUndeployed,
  classifyProductionReaderRow,
  createMemoryAuditAppendBackend,
  createProductionAuditPersistSink,
  createProductionCompositeReportReader,
  createProductionQuotaStore,
  createProjectionAuthoritySource,
  createRejectingAuditAppendBackend,
  createUnavailableAuditAppendBackend,
  createUnavailableQuotaBackend,
  createUnavailableReportSource,
  resolveProductionAdapterDeps,
} from "./report-query-production-adapters.js";
import { createFailClosedAuditSink } from "./report-query-production-integration.js";
import {
  PRODUCTION_QUERY_LOCAL_READ_CAPABILITY,
  executeProductionReportQuery,
  type ProductionAuthContext,
  type ProductionQueryAuditRecord,
} from "./report-query-production.js";
import { buildCompositeDiagnosisReport } from "./report.js";
import { DiagnosisContractError } from "./types.js";
import type {
  DiagnosisRelation,
  DiagnosticEvidence,
  DiagnosticFinding,
  DiagnosticPrincipal,
  DiagnosticTarget,
} from "./types.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-other";

function principal(tenantId: string | null, principalId?: string): DiagnosticPrincipal {
  return {
    schemaVersion: 1,
    principalId: principalId ?? (tenantId ? `user-${tenantId}` : "system-local"),
    kind: tenantId ? "user" : "system",
    tenantId,
  };
}

function target(tenantId: string | null, over: Partial<DiagnosticTarget> = {}): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: "session",
    targetId: "session-x",
    tenantId,
    authority: "session_store",
    scope: { sessionKeyHash: "sha256:session-a" },
    ...over,
  };
}

function finding(
  tenantId: string | null,
  over: Partial<DiagnosticFinding> = {},
): DiagnosticFinding {
  return {
    schemaVersion: 1,
    findingId: "find-a",
    code: "agent_not_started",
    title: "agent_not_started",
    target: target(tenantId, {
      targetType: "agent",
      targetId: "agent-a",
      authority: "agent_runner",
    }),
    status: "open",
    severity: "P2",
    primaryDomain: "agent_model",
    observationIds: ["obs-a"],
    assessmentIds: ["as-a"],
    attributionIds: ["at-a"],
    hypothesisIds: ["hy-a"],
    evidenceIds: ["ev-a"],
    confidence: { evidence: 0.9, assessment: 0.8, rootCause: 0.7, impact: 0.4 },
    fingerprint: "agent_model|agent_not_started|agent:agent-a",
    firstSeenAt: "2026-09-01T10:00:00.000Z",
    lastSeenAt: "2026-09-01T10:00:01.000Z",
    completion: "CONFIRMED",
    ...over,
  };
}

function evidence(
  tenantId: string | null,
  over: Partial<DiagnosticEvidence> = {},
): DiagnosticEvidence {
  return {
    schemaVersion: 1,
    evidenceId: "ev-a",
    evidenceType: "event",
    source: "agent_runner",
    authority: "agent runner / Plugin Hooks",
    authorityRecordId: "agent-run-a",
    observedAt: "2026-09-01T10:00:00.000Z",
    target: target(tenantId, {
      targetType: "agent",
      targetId: "agent-a",
      authority: "agent_runner",
    }),
    summary: { agentStarted: false },
    collection: {
      method: "event_adapter",
      completeness: "complete",
      attributionResolution: "not_applicable",
    },
    privacy: { classification: "internal", redacted: true },
    ...over,
  };
}

function relation(over: Partial<DiagnosisRelation> = {}): DiagnosisRelation {
  return {
    schemaVersion: 1,
    relationId: "rel-a",
    fromId: "obs-a",
    toId: "find-a",
    relation: "causes",
    derivation: "EVIDENCE_DERIVED",
    state: "accepted",
    confidence: 0.8,
    evidenceIds: ["ev-a"],
    ...over,
  };
}

function makeReport(
  tenantId: string | null,
  generatedAt: string,
  sessionKeyHash = "sha256:session-a",
) {
  const suffix = generatedAt.slice(17, 19);
  const findingId = `find-${suffix}`;
  const evidenceId = `ev-${suffix}`;
  const relationId = `rel-${suffix}`;
  const scoped = { scope: { sessionKeyHash } };
  const diagnosis = aggregateCrossTargetCases([
    {
      runId: `run-${generatedAt}`,
      tenantId,
      sessionKeyHash,
      targets: [target(tenantId, scoped)],
      findings: [
        finding(tenantId, {
          findingId,
          evidenceIds: [evidenceId],
          fingerprint: `agent_model|agent_not_started|agent:${findingId}`,
          target: target(tenantId, {
            targetType: "agent",
            targetId: "agent-a",
            authority: "agent_runner",
            ...scoped,
          }),
        }),
      ],
      evidences: [
        evidence(tenantId, {
          evidenceId,
          target: target(tenantId, {
            targetType: "agent",
            targetId: "agent-a",
            authority: "agent_runner",
            ...scoped,
          }),
        }),
      ],
      relations: [relation({ relationId, toId: findingId, evidenceIds: [evidenceId] })],
      completion: "CONFIRMED",
    },
  ]);
  return buildCompositeDiagnosisReport(diagnosis, { tenantId }, { generatedAt });
}

function auditEntry() {
  return {
    principalId: "user-a",
    principalKind: "user" as const,
    tenantId: TENANT_A,
    mode: "report" as const,
    targetDigest: { reportId: "cdr-x" },
    resultCount: 1,
    decision: "allow" as const,
    redactionProfile: "user" as const,
  };
}

describe("Phase 3.8 — production adapters (default off)", () => {
  it("reads current projections and drops empty, stale, foreign, incompatible, and payload rows", async () => {
    const current = makeReport(TENANT_A, "2026-09-02T21:00:00.000Z");
    const stale = makeReport(TENANT_A, "2026-09-01T21:00:00.000Z");
    const foreign = makeReport(TENANT_B, "2026-09-02T21:01:00.000Z", "sha256:session-b");
    const incompatible = { ...current, schemaVersion: 2, reportId: "cdr-bad" };
    const payloadRow = { ...current, reportId: "cdr-payload", prompt: "secret" };
    const policy = {
      trustedTenantId: TENANT_A,
      maxAgeMs: 12 * 60 * 60 * 1000,
      now: () => Date.parse("2026-09-02T22:00:00.000Z"),
    };
    const reader = createProductionCompositeReportReader(
      createProjectionAuthoritySource([current, stale, foreign, incompatible, payloadRow]),
      policy,
    );
    const listed = await reader.list({ tenantId: TENANT_A, mode: "report" });
    expect(listed).toHaveLength(1);
    expect((listed[0] as { reportId: string }).reportId).toBe(current.reportId);
    expect(JSON.stringify(listed)).not.toContain("secret");
    expect(await reader.get(stale.reportId)).toBeUndefined();
    expect(await reader.get("cdr-missing")).toBeUndefined();
    expect(await reader.get(foreign.reportId)).toBeUndefined();
    expect(await reader.get("cdr-bad")).toBeUndefined();
    expect(await reader.get("cdr-payload")).toBeUndefined();
    expect(classifyProductionReaderRow(null)).toBe("missing");
    expect(classifyProductionReaderRow(incompatible, policy)).toBe("schema_incompatible");
    expect(classifyProductionReaderRow(foreign, policy)).toBe("tenant_mismatch");
    expect(classifyProductionReaderRow(stale, policy)).toBe("stale");
    expect(classifyProductionReaderRow(payloadRow, policy)).toBe("schema_incompatible");
  });

  it("converts projection-store failures to unavailable", async () => {
    const reader = createProductionCompositeReportReader(createUnavailableReportSource(), {
      trustedTenantId: TENANT_A,
    });
    await expect(reader.list({ tenantId: TENANT_A, mode: "report" })).rejects.toMatchObject({
      code: "reader_unavailable",
    });
    await expect(reader.get("cdr-x")).rejects.toMatchObject({ code: "reader_unavailable" });
  });

  it("persists safe audit rows and fail-closes on unavailable, reject, and payload", async () => {
    const memory = createMemoryAuditAppendBackend();
    const persist = createProductionAuditPersistSink(memory);
    const recorded = await persist.persist(auditEntry());
    expect(recorded).toBe("recorded");
    expect(memory.entries).toHaveLength(1);
    expect(JSON.stringify(memory.entries[0])).not.toMatch(/payload|prompt|tool-output|secret/);

    await expect(
      persist.persist({
        ...auditEntry(),
        payload: { prompt: "secret" },
      } as unknown as ProductionQueryAuditRecord),
    ).rejects.toBeInstanceOf(DiagnosisContractError);

    expect(
      await createProductionAuditPersistSink(createUnavailableAuditAppendBackend()).persist(
        auditEntry(),
      ),
    ).toBe("unavailable");
    expect(
      await createProductionAuditPersistSink(createRejectingAuditAppendBackend()).persist(
        auditEntry(),
      ),
    ).toBe("unavailable");
  });

  it("enforces tenant, principal, concurrency, and unavailable quota", async () => {
    const quota = createProductionQuotaStore({
      window: { windowMs: 60_000, tenantLimit: 2, principalLimit: 1, maxConcurrency: 1 },
    });
    expect(quota.consume(TENANT_A, "user-a")).toEqual({ tenantUsed: 1, principalUsed: 1 });
    expect(quota.consume(TENANT_A, "user-a")).toBe("rate_limited");
    expect(quota.consume(TENANT_A, "user-b")).toEqual({ tenantUsed: 2, principalUsed: 1 });
    expect(quota.consume(TENANT_A, "user-c")).toBe("rate_limited");

    const concurrent = createProductionQuotaStore({
      window: { windowMs: 60_000, tenantLimit: 8, principalLimit: 8, maxConcurrency: 1 },
    });
    const first = await concurrent.consumeWindow(TENANT_A, "user-a");
    expect(first).toMatchObject({ ok: true, inflight: 1 });
    expect(await concurrent.consumeWindow(TENANT_A, "user-b")).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    await concurrent.releaseWindow(TENANT_A, "user-a");
    expect(await concurrent.consumeWindow(TENANT_A, "user-b")).toMatchObject({ ok: true });

    const down = createProductionQuotaStore({ backend: createUnavailableQuotaBackend() });
    expect(() => down.consume(TENANT_A, "user-a")).toThrow(/unavailable/);
    expect(await down.consumeWindow(TENANT_A, "user-a")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("opens the adapter gate and rejects enabled wiring without backends", () => {
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(() => assertProductionAdaptersUndeployed()).not.toThrow();
    const fallback = resolveProductionAdapterDeps({ enabled: false });
    expect(fallback.quota?.consume(TENANT_A, "user-a")).toEqual({
      tenantUsed: 1,
      principalUsed: 1,
    });
    expect(() => resolveProductionAdapterDeps({ enabled: true })).toThrow(
      /report\/audit backends are missing/,
    );
    const report = makeReport(TENANT_A, "2026-09-02T21:10:00.000Z");
    const wired = resolveProductionAdapterDeps({
      enabled: true,
      backends: {
        reportSource: createProjectionAuthoritySource([report]),
        auditAppend: createMemoryAuditAppendBackend(),
      },
      readerPolicy: { trustedTenantId: TENANT_A },
    });
    expect(wired.reader).toBeDefined();
    expect(PRODUCTION_ADAPTER_STORAGE.reader.not).toContain("Report DB");
    expect(PRODUCTION_ADAPTER_STORAGE.rollback.keepDeployFlagFalse).toBe(true);
    expect(principal(null).kind).toBe("system");
    expect(PRODUCTION_QUERY_LOCAL_READ_CAPABILITY).toBe("diagnosis.local_read");

    const source = fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "report-query-production-adapters.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain("GATEWAY_METHOD_PACKS");
    expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
    expect(source).toContain("DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED = true");
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("createReportDatabase");
    expect(source).not.toContain("appendSkillInvocationEvent");
  });

  it("calls the quota backend from the query path and releases leases", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T21:20:00.000Z");
    const spy = spyQuotaBackend();
    const quota = createProductionQuotaStore({
      window: { windowMs: 60_000, tenantLimit: 8, principalLimit: 8, maxConcurrency: 2 },
      backend: spy,
    });
    const allowed = await executeProductionReportQuery(
      { auth: authFor(TENANT_A), claim: { mode: "report" } },
      {
        reader: createProductionCompositeReportReader(createProjectionAuthoritySource([report]), {
          trustedTenantId: TENANT_A,
        }),
        audit: createFailClosedAuditSink(
          createProductionAuditPersistSink(createMemoryAuditAppendBackend()),
        ),
        quota,
      },
    );
    expect(allowed.authorization.reason).toBe("authorized");
    expect(spy.calls.acquireLease).toBe(1);
    expect(spy.calls.increment).toBe(1);
    expect(spy.calls.releaseLease).toBe(1);

    let listed = 0;
    const blocked = await executeProductionReportQuery(
      { auth: authFor(TENANT_A), claim: { mode: "report" } },
      {
        reader: {
          async list() {
            listed += 1;
            return [report];
          },
          async get() {
            listed += 1;
            return report;
          },
        },
        audit: createFailClosedAuditSink(
          createProductionAuditPersistSink(createMemoryAuditAppendBackend()),
        ),
        quota: createProductionQuotaStore({ backend: createUnavailableQuotaBackend() }),
      },
    );
    expect(blocked.authorization).toEqual({ outcome: "deny", reason: "unavailable" });
    expect(listed).toBe(0);
    const mapped = await dispatchDiagnosisReportApi(
      { method: "diagnosis.reports.query", params: { mode: "report" }, auth: authFor(TENANT_A) },
      {
        reader: createProductionCompositeReportReader(createProjectionAuthoritySource([report]), {
          trustedTenantId: TENANT_A,
        }),
        audit: createFailClosedAuditSink(
          createProductionAuditPersistSink(createMemoryAuditAppendBackend()),
        ),
        quota: createProductionQuotaStore({ backend: createUnavailableQuotaBackend() }),
      },
    );
    expect(mapped.status).toBe(503);
  });

  it("releases the quota lease after reader success, reader failure, and audit failure", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T21:21:00.000Z");
    const successSpy = spyQuotaBackend();
    await executeProductionReportQuery(
      { auth: authFor(TENANT_A), claim: { mode: "report" } },
      {
        reader: createProductionCompositeReportReader(createProjectionAuthoritySource([report]), {
          trustedTenantId: TENANT_A,
        }),
        audit: createFailClosedAuditSink(
          createProductionAuditPersistSink(createMemoryAuditAppendBackend()),
        ),
        quota: createProductionQuotaStore({ backend: successSpy }),
      },
    );
    expect(successSpy.calls.releaseLease).toBe(1);

    const readerFailSpy = spyQuotaBackend();
    const readerDenied = await executeProductionReportQuery(
      { auth: authFor(TENANT_A), claim: { mode: "report" } },
      {
        reader: createProductionCompositeReportReader(createUnavailableReportSource(), {
          trustedTenantId: TENANT_A,
        }),
        audit: createFailClosedAuditSink(
          createProductionAuditPersistSink(createMemoryAuditAppendBackend()),
        ),
        quota: createProductionQuotaStore({ backend: readerFailSpy }),
      },
    );
    expect(readerDenied.authorization.reason).toBe("unavailable");
    expect(readerFailSpy.calls.acquireLease).toBe(1);
    expect(readerFailSpy.calls.releaseLease).toBe(1);

    const auditFailSpy = spyQuotaBackend();
    const auditDenied = await executeProductionReportQuery(
      { auth: authFor(TENANT_A), claim: { mode: "report" } },
      {
        reader: createProductionCompositeReportReader(createProjectionAuthoritySource([report]), {
          trustedTenantId: TENANT_A,
        }),
        audit: createFailClosedAuditSink(
          createProductionAuditPersistSink(createUnavailableAuditAppendBackend()),
        ),
        quota: createProductionQuotaStore({ backend: auditFailSpy }),
      },
    );
    expect(auditDenied.authorization.reason).toBe("unavailable");
    expect(auditFailSpy.calls.releaseLease).toBe(1);
  });

  it("enforces tenant, principal, window, and concurrency limits on the query path", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T21:22:00.000Z");
    const depsFor = (quota: ReturnType<typeof createProductionQuotaStore>) => ({
      reader: createProductionCompositeReportReader(createProjectionAuthoritySource([report]), {
        trustedTenantId: TENANT_A,
      }),
      audit: createFailClosedAuditSink(
        createProductionAuditPersistSink(createMemoryAuditAppendBackend()),
      ),
      quota,
    });
    const tenantQuota = createProductionQuotaStore({
      window: { windowMs: 60_000, tenantLimit: 1, principalLimit: 8, maxConcurrency: 4 },
    });
    expect(
      (
        await executeProductionReportQuery(
          { auth: authFor(TENANT_A), claim: { mode: "report" } },
          depsFor(tenantQuota),
        )
      ).authorization.reason,
    ).toBe("authorized");
    expect(
      (
        await executeProductionReportQuery(
          { auth: authFor(TENANT_A), claim: { mode: "report" } },
          depsFor(tenantQuota),
        )
      ).authorization.reason,
    ).toBe("rate_limited");

    let now = Date.parse("2026-09-02T21:00:00.000Z");
    const windowQuota = createProductionQuotaStore({
      window: { windowMs: 60_000, tenantLimit: 1, principalLimit: 1, maxConcurrency: 4 },
      now: () => now,
    });
    expect(
      (
        await executeProductionReportQuery(
          { auth: authFor(TENANT_A), claim: { mode: "report" } },
          depsFor(windowQuota),
        )
      ).authorization.reason,
    ).toBe("authorized");
    now += 60_000;
    expect(
      (
        await executeProductionReportQuery(
          { auth: authFor(TENANT_A), claim: { mode: "report" } },
          depsFor(windowQuota),
        )
      ).authorization.reason,
    ).toBe("authorized");

    let unlockList: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      unlockList = resolve;
    });
    let acquired!: () => void;
    const acquiredP = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const concurrentSpy = {
      calls: { acquireLease: 0, increment: 0, releaseLease: 0 },
      async acquireLease() {
        this.calls.acquireLease += 1;
        acquired();
        return true as const;
      },
      async increment() {
        this.calls.increment += 1;
        return this.calls.increment;
      },
      async releaseLease() {
        this.calls.releaseLease += 1;
      },
    };
    const concurrentQuota = createProductionQuotaStore({
      window: { windowMs: 60_000, tenantLimit: 8, principalLimit: 8, maxConcurrency: 1 },
      backend: concurrentSpy,
    });
    const held = executeProductionReportQuery(
      { auth: authFor(TENANT_A), claim: { mode: "report" } },
      {
        reader: {
          async list() {
            await gate;
            return [report];
          },
          async get() {
            return report;
          },
        },
        audit: createFailClosedAuditSink(
          createProductionAuditPersistSink(createMemoryAuditAppendBackend()),
        ),
        quota: concurrentQuota,
      },
    );
    await acquiredP;
    const overlapping = await executeProductionReportQuery(
      { auth: authFor(TENANT_A, "user-b"), claim: { mode: "report" } },
      {
        reader: createProductionCompositeReportReader(createProjectionAuthoritySource([report]), {
          trustedTenantId: TENANT_A,
        }),
        audit: createFailClosedAuditSink(
          createProductionAuditPersistSink(createMemoryAuditAppendBackend()),
        ),
        quota: concurrentQuota,
      },
    );
    expect(overlapping.authorization.reason).toBe("rate_limited");
    unlockList?.();
    expect((await held).authorization.reason).toBe("authorized");
  });
});

function authFor(tenantId: string | null, principalId?: string): ProductionAuthContext {
  return {
    trusted: { tenantId },
    principal: principal(tenantId, principalId),
    ...(tenantId === null ? { capabilities: [PRODUCTION_QUERY_LOCAL_READ_CAPABILITY] } : {}),
  };
}

function spyQuotaBackend() {
  const calls = { acquireLease: 0, increment: 0, releaseLease: 0 };
  return {
    calls,
    async acquireLease() {
      calls.acquireLease += 1;
      return true as const;
    },
    async increment() {
      calls.increment += 1;
      return calls.increment;
    },
    async releaseLease() {
      calls.releaseLease += 1;
    },
  };
}
