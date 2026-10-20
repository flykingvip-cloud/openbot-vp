import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aggregateCrossTargetCases } from "./cross-target.js";
import {
  REPORT_QUERY_LOCAL_READ_CAPABILITY,
  createInMemoryCompositeReportReader,
  getCompositeReport,
  queryCompositeReports,
} from "./report-query.js";
import { validateCompositeDiagnosisReport } from "./report-validate.js";
import { buildCompositeDiagnosisReport } from "./report.js";
import {
  DiagnosisContractError,
  type DiagnosisRelation,
  type DiagnosticEvidence,
  type DiagnosticFinding,
  type DiagnosticPrincipal,
  type DiagnosticTarget,
  type TrustedTenantContext,
} from "./types.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-other";
const TRUSTED_A: TrustedTenantContext = { tenantId: TENANT_A };
const TRUSTED_B: TrustedTenantContext = { tenantId: TENANT_B };
const TRUSTED_LOCAL: TrustedTenantContext = { tenantId: null };

function principal(
  tenantId: string | null,
  over: Partial<DiagnosticPrincipal> = {},
): DiagnosticPrincipal {
  return {
    schemaVersion: 1,
    principalId: tenantId ? `user-${tenantId}` : "system-local",
    kind: tenantId ? "user" : "system",
    tenantId,
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
  over: {
    findingId?: string;
    evidenceId?: string;
    relationId?: string;
    sessionKeyHash?: string;
  } = {},
) {
  const sessionKeyHash = over.sessionKeyHash ?? "sha256:session-a";
  const findingId = over.findingId ?? `find-${generatedAt.slice(17, 19)}`;
  const evidenceId = over.evidenceId ?? `ev-${generatedAt.slice(17, 19)}`;
  const relationId = over.relationId ?? `rel-${generatedAt.slice(17, 19)}`;
  const trusted = { tenantId };
  const diagnosis = aggregateCrossTargetCases([
    {
      runId: `run-${generatedAt}`,
      tenantId,
      sessionKeyHash,
      targets: [target(tenantId, { scope: { sessionKeyHash } })],
      findings: [
        finding(tenantId, {
          findingId,
          evidenceIds: [evidenceId],
          fingerprint: `agent_model|agent_not_started|agent:${findingId}`,
        }),
      ],
      evidences: [evidence(tenantId, { evidenceId })],
      relations: [relation({ relationId, toId: findingId, evidenceIds: [evidenceId] })],
      completion: "CONFIRMED",
    },
  ]);
  return buildCompositeDiagnosisReport(diagnosis, trusted, { generatedAt });
}

function queryRequest(
  trusted: TrustedTenantContext,
  over: Partial<Parameters<typeof queryCompositeReports>[0]> = {},
) {
  return {
    tenantId: trusted.tenantId,
    mode: "report" as const,
    requestedBy: principal(trusted.tenantId),
    trusted,
    ...(trusted.tenantId === null ? { capabilities: [REPORT_QUERY_LOCAL_READ_CAPABILITY] } : {}),
    ...over,
  };
}

async function expectCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DiagnosisContractError);
    expect((err as DiagnosisContractError).code).toBe(code);
    return;
  }
  throw new Error(`expected DiagnosisContractError ${code}`);
}

describe("Phase 3 increment 3 — report query and authorization", () => {
  it("returns validated single-tenant reports in a stable order", async () => {
    const late = makeReport(TENANT_A, "2026-09-02T17:50:00.000Z");
    const early = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z");
    const mid = makeReport(TENANT_A, "2026-09-02T17:49:00.000Z");
    const reader = createInMemoryCompositeReportReader([early, late, mid]);
    const request = queryRequest(TRUSTED_A, { sort: { key: "generatedAt", direction: "desc" } });
    const first = await queryCompositeReports(request, reader);
    const second = await queryCompositeReports(request, reader);
    expect(first.items.map((item) => item.reportId)).toEqual([
      late.reportId,
      mid.reportId,
      early.reportId,
    ]);
    expect(second.items.map((item) => item.reportId)).toEqual(
      first.items.map((item) => item.reportId),
    );
    for (const item of first.items) {
      expect(validateCompositeDiagnosisReport(item, TRUSTED_A).reportId).toBe(item.reportId);
      expect(item.tenantId).toBe(TENANT_A);
    }
  });

  it("rejects a trusted tenant mismatch", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z");
    const reader = createInMemoryCompositeReportReader([report]);
    await expectCode(
      () =>
        queryCompositeReports(
          queryRequest(TRUSTED_A, { tenantId: TENANT_B, trusted: TRUSTED_A }),
          reader,
        ),
      "tenant_mismatch",
    );
    await expectCode(
      () =>
        queryCompositeReports(
          queryRequest(TRUSTED_B, { tenantId: TENANT_A, trusted: TRUSTED_B }),
          reader,
        ),
      "tenant_mismatch",
    );
    await expectCode(
      () => queryCompositeReports(queryRequest(TRUSTED_A, { trusted: undefined as never }), reader),
      "trusted_context_required",
    );
  });

  it("does not let reportId or caseId bypass tenant checks", async () => {
    const home = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z");
    const foreign = makeReport(TENANT_B, "2026-09-02T17:49:00.000Z");
    const reader = createInMemoryCompositeReportReader([home, foreign]);
    await expectCode(
      () =>
        queryCompositeReports(
          queryRequest(TRUSTED_A, { mode: "report", reportId: foreign.reportId }),
          reader,
        ),
      "tenant_mismatch",
    );
    await expectCode(
      () =>
        queryCompositeReports(
          queryRequest(TRUSTED_A, { mode: "case", caseId: foreign.cases[0]?.caseId }),
          reader,
        ),
      "tenant_mismatch",
    );
    await expectCode(
      () =>
        getCompositeReport(
          {
            tenantId: TENANT_A,
            reportId: foreign.reportId,
            requestedBy: principal(TENANT_A),
            trusted: TRUSTED_A,
          },
          reader,
        ),
      "tenant_mismatch",
    );
  });

  it("requires an explicit local capability for tenantId=null", async () => {
    const local = makeReport(null, "2026-09-02T17:48:00.000Z");
    const reader = createInMemoryCompositeReportReader([local]);
    await expectCode(
      () =>
        queryCompositeReports(
          {
            tenantId: null,
            mode: "report",
            requestedBy: principal(null),
            trusted: TRUSTED_LOCAL,
          },
          reader,
        ),
      "local_capability_required",
    );
    const page = await queryCompositeReports(
      queryRequest(TRUSTED_LOCAL, { capabilities: [REPORT_QUERY_LOCAL_READ_CAPABILITY] }),
      reader,
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.tenantId).toBeNull();
    expect(validateCompositeDiagnosisReport(page.items[0], TRUSTED_LOCAL).reportId).toBe(
      local.reportId,
    );
  });

  it("does not return evidence payload, message body, or tool secrets", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z");
    const reader = createInMemoryCompositeReportReader([
      {
        ...report,
        evidenceRefs: report.evidenceRefs.map((item) => ({
          ...item,
          summary: { prompt: "secret", params: "token", result: "tool-output" },
        })),
      },
    ]);
    await expectCode(
      () => queryCompositeReports(queryRequest(TRUSTED_A), reader),
      "report_payload_forbidden",
    );
    const clean = await queryCompositeReports(
      queryRequest(TRUSTED_A),
      createInMemoryCompositeReportReader([report]),
    );
    const json = JSON.stringify(clean.items);
    expect(json).not.toContain("prompt");
    expect(json).not.toContain("tool-output");
    expect(json).not.toContain("messageBody");
    expect(clean.items[0]?.evidenceRefs[0]).not.toHaveProperty("summary");
  });

  it("binds cursors to tenant and query conditions", async () => {
    const reports = [
      makeReport(TENANT_A, "2026-09-02T17:48:00.000Z"),
      makeReport(TENANT_A, "2026-09-02T17:49:00.000Z"),
      makeReport(TENANT_A, "2026-09-02T17:50:00.000Z"),
    ];
    const reader = createInMemoryCompositeReportReader(reports);
    const request = queryRequest(TRUSTED_A, {
      limit: 1,
      sort: { key: "generatedAt", direction: "desc" },
    });
    const page1 = await queryCompositeReports(request, reader);
    if (!page1.nextCursor) {
      throw new Error("expected nextCursor");
    }
    const cursor = page1.nextCursor;
    const page2 = await queryCompositeReports({ ...request, cursor }, reader);
    const page2Again = await queryCompositeReports({ ...request, cursor }, reader);
    expect(page1.items).toHaveLength(1);
    expect(page2.items).toHaveLength(1);
    expect(page1.items[0]?.reportId).not.toBe(page2.items[0]?.reportId);
    expect(page2Again.items.map((item) => item.reportId)).toEqual(
      page2.items.map((item) => item.reportId),
    );
    expect(cursor.startsWith("rq1.")).toBe(true);
    expect(cursor.includes("Math.random")).toBe(false);
    await expectCode(
      () =>
        queryCompositeReports(
          queryRequest(TRUSTED_B, { cursor, capabilities: undefined }),
          createInMemoryCompositeReportReader([makeReport(TENANT_B, "2026-09-02T17:48:00.000Z")]),
        ),
      "cursor_scope_mismatch",
    );
    await expectCode(
      () =>
        queryCompositeReports(
          queryRequest(TRUSTED_A, {
            mode: "session",
            sessionKeyHash: "sha256:session-other",
            cursor,
          }),
          reader,
        ),
      "cursor_scope_mismatch",
    );
  });

  it("propagates reader failures", async () => {
    const reader = {
      async list() {
        throw new Error("reader failed");
      },
      async get() {
        throw new Error("reader get failed");
      },
    };
    await expect(queryCompositeReports(queryRequest(TRUSTED_A), reader)).rejects.toThrow(
      "reader failed",
    );
    await expect(
      getCompositeReport(
        {
          tenantId: TENANT_A,
          reportId: "cdr-missing",
          requestedBy: principal(TENANT_A),
          trusted: TRUSTED_A,
        },
        reader,
      ),
    ).rejects.toThrow("reader get failed");
  });

  it("is an in-process read-only contract with no production API", () => {
    const body = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "report-query.ts"),
      "utf8",
    );
    expect(body).not.toContain("appendSkillInvocationEvent");
    expect(body).not.toContain("writeConfigFile");
    expect(body).not.toContain("doctorCommand");
    expect(body).not.toContain("startChannel");
    expect(body).not.toContain("createServer");
    expect(body).not.toContain("WebSocket");
    expect(body).not.toContain("fetch(");
    expect(body).not.toContain("http.");
    expect(body).not.toContain("rpc");
    expect(body).not.toContain("DiagnosisJournal");
    expect(body).toContain("in-process");
    expect(body).not.toContain("Math.random");
  });

  it("gets one validated report by id", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z");
    const reader = createInMemoryCompositeReportReader([report]);
    const loaded = await getCompositeReport(
      {
        tenantId: TENANT_A,
        reportId: report.reportId,
        requestedBy: principal(TENANT_A),
        trusted: TRUSTED_A,
      },
      reader,
    );
    expect(loaded.reportId).toBe(report.reportId);
    expect(validateCompositeDiagnosisReport(loaded, TRUSTED_A).cases[0]?.sessionKeyHash).toBe(
      "sha256:session-a",
    );
    await expectCode(
      () =>
        getCompositeReport(
          {
            tenantId: TENANT_A,
            reportId: "cdr-missing",
            requestedBy: principal(TENANT_A),
            trusted: TRUSTED_A,
          },
          reader,
        ),
      "report_not_found",
    );
  });
});
