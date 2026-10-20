import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aggregateCrossTargetCases } from "./cross-target.js";
import {
  DIAGNOSIS_REPORT_API_DEPLOYED,
  bindDiagnosisReportApiHandlers,
  dispatchDiagnosisReportApi,
} from "./report-query-api.js";
import {
  PRODUCTION_QUERY_ADMIN_CAPABILITY,
  PRODUCTION_QUERY_CURSOR_TTL_MS,
  PRODUCTION_QUERY_LOCAL_READ_CAPABILITY,
  createInMemoryProductionQueryAuditSink,
  createInMemoryProductionQueryQuota,
  type ProductionAuthContext,
  type ProductionQueryResponse,
} from "./report-query-production.js";
import { createInMemoryCompositeReportReader } from "./report-query.js";
import { buildCompositeDiagnosisReport } from "./report.js";
import type {
  DiagnosisRelation,
  DiagnosticEvidence,
  DiagnosticFinding,
  DiagnosticPrincipal,
  DiagnosticTarget,
  TrustedTenantContext,
} from "./types.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-other";
const TRUSTED_A: TrustedTenantContext = { tenantId: TENANT_A };

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

function apiDeps(
  reports: readonly unknown[],
  over: {
    quota?: ReturnType<typeof createInMemoryProductionQueryQuota>;
    now?: () => number;
  } = {},
) {
  const audit = createInMemoryProductionQueryAuditSink();
  return {
    audit,
    deps: {
      reader: createInMemoryCompositeReportReader(reports),
      audit,
      ...over,
    },
  };
}

function isResponse(body: unknown): body is ProductionQueryResponse {
  return typeof body === "object" && body !== null && "authorization" in body;
}

describe("Phase 3.5 — diagnosis report API boundary", () => {
  it("queries and gets reports through the production adapter", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z");
    const { deps } = apiDeps([report]);
    const listed = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.query",
        params: { schemaVersion: 1, mode: "report" },
        auth: authFor(TENANT_A),
      },
      deps,
    );
    expect(listed.status).toBe(200);
    expect(isResponse(listed.body) && listed.body.items[0]?.reportId).toBe(report.reportId);
    const got = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.get",
        params: { schemaVersion: 1, reportId: report.reportId },
        auth: authFor(TENANT_A),
      },
      deps,
    );
    expect(got.status).toBe(200);
    expect(isResponse(got.body) && got.body.schemaVersion).toBe(1);
    expect(isResponse(got.body) && got.body.redactionProfile).toBe("user");
    expect(isResponse(got.body) && got.body.audit.tenantId).toBe(TENANT_A);
  });

  it("rejects forged tenant hints from body, query, header, and URL", async () => {
    const { deps } = apiDeps([makeReport(TENANT_A, "2026-09-02T17:48:00.000Z")]);
    const auth = authFor(TENANT_A);
    const bodyForge = await dispatchDiagnosisReportApi(
      { method: "diagnosis.reports.query", params: { mode: "report", tenantId: TENANT_B }, auth },
      deps,
    );
    const headerForge = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.query",
        params: { mode: "report" },
        auth,
        clientTenantHints: { headerTenantId: TENANT_B },
      },
      deps,
    );
    const queryForge = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.query",
        params: { mode: "report" },
        auth,
        clientTenantHints: { queryTenantId: TENANT_B },
      },
      deps,
    );
    const urlForge = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.query",
        params: { mode: "report" },
        auth,
        clientTenantHints: { urlTenantId: TENANT_B },
      },
      deps,
    );
    for (const denied of [bodyForge, headerForge, queryForge, urlForge]) {
      expect(denied.status).toBe(403);
      expect(isResponse(denied.body) && denied.body.authorization.reason).toBe("forbidden");
      expect(isResponse(denied.body) && denied.body.items).toEqual([]);
    }
  });

  it("rejects principal mismatch and missing local capability", async () => {
    const { deps } = apiDeps([
      makeReport(TENANT_A, "2026-09-02T17:48:00.000Z"),
      makeReport(null, "2026-09-02T17:49:00.000Z"),
    ]);
    const mismatch = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.query",
        params: { mode: "report" },
        auth: { trusted: TRUSTED_A, principal: principal(TENANT_B) },
      },
      deps,
    );
    expect(mismatch.status).toBe(403);
    const localDenied = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.query",
        params: { mode: "report" },
        auth: authFor(null),
      },
      deps,
    );
    expect(localDenied.status).toBe(403);
    const localAllowed = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.query",
        params: { mode: "report", redactionProfile: "system_local" },
        auth: authFor(null, { capabilities: [PRODUCTION_QUERY_LOCAL_READ_CAPABILITY] }),
      },
      deps,
    );
    expect(localAllowed.status).toBe(200);
  });

  it("maps quota and cursor failures without leaking existence", async () => {
    const reports = [
      makeReport(TENANT_A, "2026-09-02T17:48:00.000Z"),
      makeReport(TENANT_A, "2026-09-02T17:49:00.000Z"),
      makeReport(TENANT_A, "2026-09-02T17:50:00.000Z"),
    ];
    const foreign = makeReport(TENANT_B, "2026-09-02T17:51:00.000Z", "sha256:session-b");
    const limited = apiDeps(reports, {
      quota: createInMemoryProductionQueryQuota({ tenantLimit: 1, principalLimit: 1 }),
    });
    const first = await dispatchDiagnosisReportApi(
      { method: "diagnosis.reports.query", params: { mode: "report" }, auth: authFor(TENANT_A) },
      limited.deps,
    );
    const second = await dispatchDiagnosisReportApi(
      { method: "diagnosis.reports.query", params: { mode: "report" }, auth: authFor(TENANT_A) },
      limited.deps,
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);

    const paged = apiDeps([...reports, foreign]);
    const page1 = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.query",
        params: { mode: "report", limit: 1, sort: { key: "generatedAt", direction: "desc" } },
        auth: authFor(TENANT_A),
      },
      paged.deps,
    );
    expect(isResponse(page1.body) && page1.body.nextCursor?.startsWith("pq1.")).toBe(true);
    const stolen = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.query",
        params: {
          mode: "report",
          limit: 1,
          cursor: isResponse(page1.body) ? page1.body.nextCursor : undefined,
          sort: { key: "reportId", direction: "asc" },
        },
        auth: authFor(TENANT_A),
      },
      paged.deps,
    );
    expect(stolen.status).toBe(403);
    const expired = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.query",
        params: {
          mode: "report",
          limit: 1,
          cursor: isResponse(page1.body) ? page1.body.nextCursor : undefined,
          sort: { key: "generatedAt", direction: "desc" },
        },
        auth: authFor(TENANT_A),
      },
      apiDeps(reports, { now: () => Date.now() + PRODUCTION_QUERY_CURSOR_TTL_MS + 1 }).deps,
    );
    expect(expired.status).toBe(400);
    const missing = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.get",
        params: { reportId: "cdr-missing" },
        auth: authFor(TENANT_A),
      },
      paged.deps,
    );
    const foreignGet = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.get",
        params: { reportId: foreign.reportId },
        auth: authFor(TENANT_A),
      },
      paged.deps,
    );
    expect(missing.status).toBe(403);
    expect(foreignGet.status).toBe(403);
    expect(isResponse(missing.body) && missing.body.authorization).toEqual(
      isResponse(foreignGet.body) && foreignGet.body.authorization,
    );
  });

  it("redacts evidence content and records payload-free audit", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z");
    const { deps, audit } = apiDeps([report]);
    const userPage = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.query",
        params: { mode: "report", redactionProfile: "user" },
        auth: authFor(TENANT_A),
      },
      deps,
    );
    const adminPage = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.query",
        params: { mode: "report", redactionProfile: "administrator" },
        auth: authFor(TENANT_A, { capabilities: [PRODUCTION_QUERY_ADMIN_CAPABILITY] }),
      },
      deps,
    );
    expect(isResponse(userPage.body) && userPage.body.items[0]?.evidenceRefIds).toBeUndefined();
    expect(JSON.stringify(userPage.body)).not.toContain("prompt");
    expect(JSON.stringify(adminPage.body)).not.toContain("tool-output");
    expect(JSON.stringify(audit.entries)).not.toContain("secret");
  });

  it("maps unauthenticated, unknown method, and unknown schema", async () => {
    const { deps } = apiDeps([makeReport(TENANT_A, "2026-09-02T17:48:00.000Z")]);
    const unauth = await dispatchDiagnosisReportApi(
      { method: "diagnosis.reports.query", params: { mode: "report" }, auth: null },
      deps,
    );
    expect(unauth.status).toBe(401);
    const unknownMethod = await dispatchDiagnosisReportApi(
      { method: "diagnosis.reports.delete", params: { mode: "report" }, auth: authFor(TENANT_A) },
      deps,
    );
    expect(unknownMethod.status).toBe(404);
    expect("error" in unknownMethod.body && unknownMethod.body.error.code).toBe("method_not_found");
    const unknownSchema = await dispatchDiagnosisReportApi(
      {
        method: "diagnosis.reports.query",
        params: { schemaVersion: 2, mode: "report" },
        auth: authFor(TENANT_A),
      },
      deps,
    );
    expect(unknownSchema.status).toBe(400);
    expect("error" in unknownSchema.body && unknownSchema.body.error.code).toBe(
      "unknown_schema_version",
    );
  });

  it("propagates reader failures and binds the gateway-style handler", async () => {
    const audit = createInMemoryProductionQueryAuditSink();
    const failing = {
      reader: {
        async list() {
          throw new Error("reader failed");
        },
        async get() {
          throw new Error("reader get failed");
        },
      },
      audit,
    };
    await expect(
      dispatchDiagnosisReportApi(
        { method: "diagnosis.reports.query", params: { mode: "report" }, auth: authFor(TENANT_A) },
        failing,
      ),
    ).rejects.toThrow("reader failed");
    const report = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z");
    const { deps } = apiDeps([report]);
    const handlers = bindDiagnosisReportApiHandlers(deps, () => authFor(TENANT_A));
    let captured: { ok: boolean; payload?: unknown } | undefined;
    await handlers["diagnosis.reports.query"]({
      params: { mode: "report" },
      respond: (ok, payload) => {
        captured = { ok, payload };
      },
    });
    expect(captured?.ok).toBe(true);
    expect(isResponse(captured?.payload) && captured.payload.items[0]?.reportId).toBe(
      report.reportId,
    );
  });

  it("is an unimplemented production deployment and has no write side effects", () => {
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    const body = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "report-query-api.ts"),
      "utf8",
    );
    expect(body).toContain("Live pack registration is gated by DIAGNOSIS_REPORT_API_DEPLOYED");
    expect(body).not.toContain("appendSkillInvocationEvent");
    expect(body).not.toContain("writeConfigFile");
    expect(body).not.toContain("doctorCommand");
    expect(body).not.toContain("startChannel");
    expect(body).not.toContain("--fix");
    expect(body).not.toContain("DiagnosisJournal");
    expect(body).not.toContain("GATEWAY_METHOD_PACKS");
    expect(body).not.toContain("Math.random");
  });
});
