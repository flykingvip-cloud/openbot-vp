import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aggregateCrossTargetCases } from "./cross-target.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED, dispatchDiagnosisReportApi } from "./report-query-api.js";
import {
  resolveDiagnosisProductionAuth,
  type DiagnosisGatewayAuthClient,
} from "./report-query-gateway.js";
import {
  COMPOSITE_REPORT_AUTHORITY_SOURCES,
  DIAGNOSIS_PRODUCTION_AUTH_MATRIX,
  DIAGNOSIS_REPORT_RELEASE_CANDIDATE,
  NON_AUTHORITATIVE_TENANT_SOURCES,
  PRODUCTION_QUOTA_MAX_CONCURRENCY,
  PRODUCTION_QUOTA_WINDOW_MS,
  assertProductionAuditRecordSafe,
  classifyProductionAuth,
  createFailClosedAuditSink,
  createInMemoryProductionAuditPersist,
  createUnavailableAuditPersist,
  createUnavailableQuotaStore,
  createWindowedProductionQuotaStore,
  evaluateDiagnosisProductionAuth,
  executeProductionIntegrationGet,
  executeProductionIntegrationQuery,
  trustedTenantFromAuth,
  wrapProductionCompositeReportReader,
} from "./report-query-production-integration.js";
import {
  PRODUCTION_QUERY_LOCAL_READ_CAPABILITY,
  type ProductionAuthContext,
  type ProductionQueryAuditRecord,
} from "./report-query-production.js";
import { createInMemoryCompositeReportReader } from "./report-query.js";
import { buildCompositeDiagnosisReport } from "./report.js";
import type {
  DiagnosisRelation,
  DiagnosticEvidence,
  DiagnosticFinding,
  DiagnosticPrincipal,
  DiagnosticTarget,
} from "./types.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-other";

function principal(
  tenantId: string | null,
  over: Partial<DiagnosticPrincipal> = {},
): DiagnosticPrincipal {
  return {
    schemaVersion: 1,
    principalId: over.principalId ?? (tenantId ? `user-${tenantId}` : "system-local"),
    kind: tenantId ? "user" : "system",
    tenantId,
    ...over,
  };
}

function authFor(
  tenantId: string | null,
  over: Partial<ProductionAuthContext> = {},
): ProductionAuthContext {
  return {
    trusted: { tenantId },
    principal: principal(tenantId),
    ...(tenantId === null ? { capabilities: [PRODUCTION_QUERY_LOCAL_READ_CAPABILITY] } : {}),
    ...over,
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
    summary: { agentStarted: false, prompt: "secret", result: "tool-output" },
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

function clientFor(
  row: (typeof DIAGNOSIS_PRODUCTION_AUTH_MATRIX)[number],
): DiagnosisGatewayAuthClient | null {
  if (row.id === "no-client") {
    return null;
  }
  const base: DiagnosisGatewayAuthClient = {
    ...(row.sessionDomain ? { sessionDomain: row.sessionDomain } : {}),
    ...(row.sessionKind ? { sessionKind: row.sessionKind } : {}),
    sessionTenantId: TENANT_B,
    connect: { tenantId: TENANT_B },
  };
  if (row.id === "missing-identity") {
    return base;
  }
  return {
    ...base,
    user: "owner-a@example.com",
    platformUserId: row.expected === "platform_admin" ? "platform-admin" : "user-a",
  };
}

function auditRecord(): ProductionQueryAuditRecord {
  return {
    principalId: "user-a",
    principalKind: "user",
    tenantId: TENANT_A,
    mode: "report",
    targetDigest: { reportId: "cdr-x" },
    resultCount: 1,
    decision: "allow",
    redactionProfile: "user",
  };
}

describe("Phase 3.7 — production integration review contracts", () => {
  it("freezes the auth matrix and never trusts client tenant hints", () => {
    expect(NON_AUTHORITATIVE_TENANT_SOURCES).toEqual(
      expect.arrayContaining([
        "url",
        "query",
        "body",
        "header",
        "sessionTenantId",
        "connect.tenantId",
        "claimedTenantId",
      ]),
    );
    for (const row of DIAGNOSIS_PRODUCTION_AUTH_MATRIX) {
      const client = clientFor(row);
      const membership =
        row.membershipStatus === "unavailable"
          ? "unavailable"
          : {
              tenantId: row.membershipTenantId,
              userId: row.expected === "unauthenticated" ? null : "user-a",
            };
      const auth = evaluateDiagnosisProductionAuth({ client, membership });
      expect({ id: row.id, class: classifyProductionAuth(auth) }).toEqual({
        id: row.id,
        class: row.expected,
      });
      if (auth && row.membershipStatus === "resolved") {
        expect(trustedTenantFromAuth(auth)).toBe(row.membershipTenantId);
        expect(auth.trusted.tenantId).not.toBe(TENANT_B);
        expect(auth.principal.tenantId).not.toBe(client?.sessionTenantId);
      }
    }
  });

  it("fail-closes when the membership store is unavailable", async () => {
    const admin: DiagnosisGatewayAuthClient = {
      user: "admin@example.com",
      platformUserId: "platform-admin",
      sessionDomain: "platform",
      sessionKind: "platform-super-admin",
      sessionTenantId: TENANT_A,
    };
    const auth = await resolveDiagnosisProductionAuth(admin, {
      resolveMembership: async () => {
        throw new Error("auth store down");
      },
    });
    expect(auth).toBeNull();
  });

  it("injects a reader that drops missing, stale, foreign, and incompatible rows", async () => {
    const current = makeReport(TENANT_A, "2026-09-02T18:00:00.000Z");
    const stale = makeReport(TENANT_A, "2026-09-01T18:00:00.000Z");
    const foreign = makeReport(TENANT_B, "2026-09-02T18:01:00.000Z", "sha256:session-b");
    const incompatible = { ...current, schemaVersion: 2, reportId: "cdr-bad" };
    const reader = wrapProductionCompositeReportReader(
      createInMemoryCompositeReportReader([current, stale, foreign, incompatible]),
      {
        trustedTenantId: TENANT_A,
        maxAgeMs: 12 * 60 * 60 * 1000,
        now: () => Date.parse("2026-09-02T20:00:00.000Z"),
      },
    );
    const listed = await reader.list({ tenantId: TENANT_A, mode: "report" });
    expect(listed).toHaveLength(1);
    expect((listed[0] as { reportId: string }).reportId).toBe(current.reportId);
    expect(await reader.get(stale.reportId)).toBeUndefined();
    expect(await reader.get("cdr-missing")).toBeUndefined();
    expect(await reader.get(foreign.reportId)).toBeUndefined();
    expect(await reader.get("cdr-bad")).toBeUndefined();

    const down = wrapProductionCompositeReportReader({
      async list() {
        throw new Error("disk failed");
      },
      async get() {
        throw new Error("disk failed");
      },
    });
    const persist = createInMemoryProductionAuditPersist();
    const denied = await executeProductionIntegrationQuery(
      { auth: authFor(TENANT_A), claim: { mode: "report" } },
      { reader: down, audit: createFailClosedAuditSink(persist) },
    );
    expect(denied.authorization).toEqual({ outcome: "deny", reason: "unavailable" });
    expect(denied.items).toHaveLength(0);
  });

  it("hides cross-tenant gets the same as missing reports", async () => {
    const local = makeReport(TENANT_A, "2026-09-02T18:02:00.000Z");
    const foreign = makeReport(TENANT_B, "2026-09-02T18:03:00.000Z", "sha256:session-b");
    const persist = createInMemoryProductionAuditPersist();
    const deps = {
      reader: wrapProductionCompositeReportReader(
        createInMemoryCompositeReportReader([local, foreign]),
      ),
      audit: createFailClosedAuditSink(persist),
    };
    const missing = await executeProductionIntegrationGet(
      { auth: authFor(TENANT_A), reportId: "cdr-missing" },
      deps,
    );
    const crossed = await executeProductionIntegrationGet(
      { auth: authFor(TENANT_A), reportId: foreign.reportId },
      deps,
    );
    expect(missing.authorization).toEqual(crossed.authorization);
    expect(missing.authorization.reason).toBe("forbidden");
    expect(missing.items).toEqual([]);
  });

  it("requires local_read for tenantId=null and still ignores claimedTenantId", async () => {
    const report = makeReport(null, "2026-09-02T18:04:00.000Z");
    const persist = createInMemoryProductionAuditPersist();
    const deps = {
      reader: wrapProductionCompositeReportReader(createInMemoryCompositeReportReader([report])),
      audit: createFailClosedAuditSink(persist),
    };
    const denied = await executeProductionIntegrationQuery(
      {
        auth: {
          trusted: { tenantId: null },
          principal: principal(null),
        },
        claim: { mode: "report", claimedTenantId: TENANT_A },
      },
      deps,
    );
    expect(denied.authorization.reason).toBe("forbidden");
    const allowed = await executeProductionIntegrationQuery(
      { auth: authFor(null), claim: { mode: "report" } },
      deps,
    );
    expect(allowed.authorization.reason).toBe("authorized");
    expect(allowed.items[0]?.tenantId).toBeNull();
  });

  it("awaits async persist before returning allow or unavailable", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T18:08:00.000Z");
    const recorded: ProductionQueryAuditRecord[] = [];
    let persistCalls = 0;
    const recordedSink = createFailClosedAuditSink({
      async persist(entry) {
        persistCalls += 1;
        await Promise.resolve();
        assertProductionAuditRecordSafe(entry);
        recorded.push(entry);
        return "recorded";
      },
    });
    const allowed = await executeProductionIntegrationQuery(
      { auth: authFor(TENANT_A), claim: { mode: "report" } },
      {
        reader: wrapProductionCompositeReportReader(createInMemoryCompositeReportReader([report])),
        audit: recordedSink,
      },
    );
    expect(persistCalls).toBe(1);
    expect(allowed.authorization.reason).toBe("authorized");
    expect(allowed.items[0]?.reportId).toBe(report.reportId);
    expect(recorded[0]?.decision).toBe("allow");
    expect(JSON.stringify(recorded[0])).not.toContain("secret");
    expect(JSON.stringify(recorded[0])).not.toContain("tool-output");
    expect(JSON.stringify(allowed.audit)).not.toMatch(/payload|prompt|model summary/);

    const unavailablePage = await dispatchDiagnosisReportApi(
      { method: "diagnosis.reports.query", params: { mode: "report" }, auth: authFor(TENANT_A) },
      {
        reader: wrapProductionCompositeReportReader(createInMemoryCompositeReportReader([report])),
        audit: createFailClosedAuditSink({
          async persist() {
            await Promise.resolve();
            return "unavailable";
          },
        }),
      },
    );
    expect(unavailablePage.status).toBe(503);
    expect(
      "authorization" in unavailablePage.body && unavailablePage.body.authorization.reason,
    ).toBe("unavailable");
    expect("items" in unavailablePage.body && unavailablePage.body.items).toEqual([]);

    const rejected = await executeProductionIntegrationQuery(
      { auth: authFor(TENANT_A), claim: { mode: "report" } },
      {
        reader: wrapProductionCompositeReportReader(createInMemoryCompositeReportReader([report])),
        audit: createFailClosedAuditSink({
          async persist() {
            await Promise.resolve();
            throw new Error("audit disk failed");
          },
        }),
      },
    );
    expect(rejected.authorization).toEqual({ outcome: "deny", reason: "unavailable" });
    expect(rejected.items).toHaveLength(0);
    expect(rejected.audit.denyReason).toBe("audit_unavailable");
  });

  it("fail-closes when audit persist is down and rejects payload-bearing audit rows", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T18:05:00.000Z");
    const denied = await executeProductionIntegrationQuery(
      { auth: authFor(TENANT_A), claim: { mode: "report" } },
      {
        reader: wrapProductionCompositeReportReader(createInMemoryCompositeReportReader([report])),
        audit: createFailClosedAuditSink(createUnavailableAuditPersist()),
      },
    );
    expect(denied.authorization).toEqual({ outcome: "deny", reason: "unavailable" });
    expect(denied.items).toHaveLength(0);
    expect(denied.audit.denyReason).toBe("audit_unavailable");
    expect(() =>
      assertProductionAuditRecordSafe({
        ...auditRecord(),
        payload: { prompt: "secret" },
      } as ProductionQueryAuditRecord),
    ).toThrow(/payload/);
  });

  it("injects windowed quota and fail-closes when the quota store is down", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T18:06:00.000Z");
    const quota = createWindowedProductionQuotaStore({
      windowMs: PRODUCTION_QUOTA_WINDOW_MS,
      tenantLimit: 1,
      principalLimit: 1,
      maxConcurrency: PRODUCTION_QUOTA_MAX_CONCURRENCY,
    });
    const persist = createInMemoryProductionAuditPersist();
    const deps = {
      reader: wrapProductionCompositeReportReader(createInMemoryCompositeReportReader([report])),
      audit: createFailClosedAuditSink(persist),
      quota,
    };
    const first = await executeProductionIntegrationQuery(
      { auth: authFor(TENANT_A), claim: { mode: "report" } },
      deps,
    );
    expect(first.authorization.reason).toBe("authorized");
    const limited = await executeProductionIntegrationQuery(
      { auth: authFor(TENANT_A), claim: { mode: "report" } },
      deps,
    );
    expect(limited.authorization.reason).toBe("rate_limited");
    const windowed = await quota.consumeWindow(TENANT_A, "user-a");
    expect(windowed).toEqual({ ok: false, reason: "rate_limited" });

    const unavailable = await executeProductionIntegrationQuery(
      { auth: authFor(TENANT_A), claim: { mode: "report" } },
      {
        reader: wrapProductionCompositeReportReader(createInMemoryCompositeReportReader([report])),
        audit: createFailClosedAuditSink(persist),
        quota: createUnavailableQuotaStore(),
      },
    );
    expect(unavailable.authorization).toEqual({ outcome: "deny", reason: "unavailable" });
    expect(unavailable.audit.denyReason).toBe("quota_unavailable");
  });

  it("maps auth, reader, audit, and quota faults through the API boundary", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T18:07:00.000Z");
    const persist = createInMemoryProductionAuditPersist();
    const unauth = await dispatchDiagnosisReportApi(
      { method: "diagnosis.reports.query", params: { mode: "report" }, auth: null },
      {
        reader: wrapProductionCompositeReportReader(createInMemoryCompositeReportReader([report])),
        audit: createFailClosedAuditSink(persist),
      },
    );
    expect(unauth.status).toBe(401);

    const auditDown = await dispatchDiagnosisReportApi(
      { method: "diagnosis.reports.query", params: { mode: "report" }, auth: authFor(TENANT_A) },
      {
        reader: wrapProductionCompositeReportReader(createInMemoryCompositeReportReader([report])),
        audit: createFailClosedAuditSink(createUnavailableAuditPersist()),
      },
    );
    expect(auditDown.status).toBe(503);

    const quotaDown = await dispatchDiagnosisReportApi(
      { method: "diagnosis.reports.query", params: { mode: "report" }, auth: authFor(TENANT_A) },
      {
        reader: wrapProductionCompositeReportReader(createInMemoryCompositeReportReader([report])),
        audit: createFailClosedAuditSink(persist),
        quota: createUnavailableQuotaStore(),
      },
    );
    expect(quotaDown.status).toBe(503);
  });

  it("keeps the release candidate undeployed and forbids parallel fact stores", () => {
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_REPORT_RELEASE_CANDIDATE.deployFlagValue).toBe(true);
    expect(DIAGNOSIS_REPORT_RELEASE_CANDIDATE.livePackRegistration).toBe(false);
    expect(DIAGNOSIS_REPORT_RELEASE_CANDIDATE.productionBuild).toBe(false);
    expect(DIAGNOSIS_REPORT_RELEASE_CANDIDATE.trafficSwitch).toBe(false);
    expect(DIAGNOSIS_REPORT_RELEASE_CANDIDATE.canary).toBe("not_authorized");
    expect(COMPOSITE_REPORT_AUTHORITY_SOURCES.every((row) => row.status === "PARTIAL")).toBe(true);
    const source = fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "report-query-production-integration.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain("createReportDatabase");
    expect(source).not.toContain("SkillHealthDB");
    expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("appendSkillInvocationEvent");
  });
});
