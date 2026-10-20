import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aggregateCrossTargetCases } from "./cross-target.js";
import {
  PRODUCTION_QUERY_ADMIN_CAPABILITY,
  PRODUCTION_QUERY_CURSOR_TTL_MS,
  PRODUCTION_QUERY_LOCAL_READ_CAPABILITY,
  PRODUCTION_QUERY_PUBLIC_DENY_REASON,
  createInMemoryProductionQueryAuditSink,
  createInMemoryProductionQueryQuota,
  createProductionReportQueryAdapter,
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
const TRUSTED_B: TrustedTenantContext = { tenantId: TENANT_B };
const TRUSTED_LOCAL: TrustedTenantContext = { tenantId: null };

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

function adapterWith(
  reports: readonly unknown[],
  over: { quota?: ReturnType<typeof createInMemoryProductionQueryQuota>; now?: () => number } = {},
) {
  const audit = createInMemoryProductionQueryAuditSink();
  const adapter = createProductionReportQueryAdapter({
    reader: createInMemoryCompositeReportReader(reports),
    audit,
    ...over,
  });
  return { adapter, audit };
}

describe("Phase 3 increment 4 — production query adapter contract", () => {
  it("rejects a client-forged tenantId and never trusts the claim", async () => {
    const home = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z");
    const { adapter, audit } = adapterWith([home]);
    const denied = await adapter.query({
      auth: { trusted: TRUSTED_A, principal: principal(TENANT_A) },
      claim: { claimedTenantId: TENANT_B, mode: "report" },
    });
    expect(denied.authorization).toEqual({
      outcome: "deny",
      reason: PRODUCTION_QUERY_PUBLIC_DENY_REASON,
    });
    expect(denied.items).toEqual([]);
    expect(audit.entries.at(-1)?.denyReason).toBe("client_tenant_forged");
  });

  it("rejects a principal that does not match the trusted tenant", async () => {
    const { adapter } = adapterWith([makeReport(TENANT_A, "2026-09-02T17:48:00.000Z")]);
    const denied = await adapter.query({
      auth: { trusted: TRUSTED_A, principal: principal(TENANT_B) },
      claim: { mode: "report" },
    });
    expect(denied.authorization.reason).toBe(PRODUCTION_QUERY_PUBLIC_DENY_REASON);
    expect(denied.items).toEqual([]);
    expect(denied.audit.denyReason).toBe("principal_mismatch");
  });

  it("hides report, case, and session existence on unauthorized lookups", async () => {
    const home = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z", "sha256:session-a");
    const foreign = makeReport(TENANT_B, "2026-09-02T17:49:00.000Z", "sha256:session-b");
    const { adapter } = adapterWith([home, foreign]);
    const auth = { trusted: TRUSTED_A, principal: principal(TENANT_A) };
    const byForeignReport = await adapter.get({ auth, reportId: foreign.reportId });
    const byMissingReport = await adapter.get({ auth, reportId: "cdr-does-not-exist" });
    const byForeignCase = await adapter.query({
      auth,
      claim: { mode: "case", caseId: foreign.cases[0]?.caseId },
    });
    const byForeignSession = await adapter.query({
      auth,
      claim: { mode: "session", sessionKeyHash: "sha256:session-b" },
    });
    for (const denied of [byForeignReport, byMissingReport, byForeignCase, byForeignSession]) {
      expect(denied.authorization).toEqual({
        outcome: "deny",
        reason: PRODUCTION_QUERY_PUBLIC_DENY_REASON,
      });
      expect(denied.items).toEqual([]);
      expect(denied.nextCursor).toBeNull();
    }
    expect(byForeignReport.authorization).toEqual(byMissingReport.authorization);
  });

  it("requires an explicit local capability for system/local tenantId=null", async () => {
    const local = makeReport(null, "2026-09-02T17:48:00.000Z");
    const { adapter } = adapterWith([local]);
    const denied = await adapter.query({
      auth: { trusted: TRUSTED_LOCAL, principal: principal(null) },
      claim: { mode: "report" },
    });
    expect(denied.authorization.reason).toBe(PRODUCTION_QUERY_PUBLIC_DENY_REASON);
    expect(denied.audit.denyReason).toBe("local_capability_required");
    const allowed = await adapter.query({
      auth: {
        trusted: TRUSTED_LOCAL,
        principal: principal(null),
        capabilities: [PRODUCTION_QUERY_LOCAL_READ_CAPABILITY],
      },
      claim: { mode: "report", redactionProfile: "system_local" },
    });
    expect(allowed.authorization.outcome).toBe("allow");
    expect(allowed.items).toHaveLength(1);
    expect(allowed.redactionProfile).toBe("system_local");
  });

  it("records audit metadata without sensitive payloads", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z");
    const { adapter, audit } = adapterWith([report]);
    await adapter.query({
      auth: { trusted: TRUSTED_A, principal: principal(TENANT_A) },
      claim: { mode: "report" },
    });
    const json = JSON.stringify(audit.entries);
    expect(audit.entries[0]?.principalId).toBe(`user-${TENANT_A}`);
    expect(audit.entries[0]?.tenantId).toBe(TENANT_A);
    expect(audit.entries[0]?.resultCount).toBe(1);
    expect(json).not.toContain("prompt");
    expect(json).not.toContain("tool-output");
    expect(json).not.toContain("messageBody");
    expect(json).not.toContain("secret");
    expect(audit.entries[0]).not.toHaveProperty("summary");
    expect(audit.entries[0]).not.toHaveProperty("evidenceRefs");
  });

  it("redacts Evidence content for every profile", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z");
    const { adapter } = adapterWith([report]);
    const userPage = await adapter.query({
      auth: { trusted: TRUSTED_A, principal: principal(TENANT_A) },
      claim: { mode: "report", redactionProfile: "user" },
    });
    const adminPage = await adapter.query({
      auth: {
        trusted: TRUSTED_A,
        principal: principal(TENANT_A),
        capabilities: [PRODUCTION_QUERY_ADMIN_CAPABILITY],
      },
      claim: { mode: "report", redactionProfile: "administrator" },
    });
    expect(userPage.items[0]?.evidenceRefIds).toBeUndefined();
    expect(userPage.items[0]?.cases[0]).not.toHaveProperty("sessionKeyHash");
    expect(userPage.items[0]?.findings[0]).not.toHaveProperty("code");
    expect(userPage.items[0]?.confidence).not.toHaveProperty("meanEvidence");
    expect(adminPage.items[0]?.evidenceRefIds).toEqual([report.evidenceRefs[0]?.evidenceId]);
    const json = JSON.stringify([userPage.items, adminPage.items]);
    expect(json).not.toContain("prompt");
    expect(json).not.toContain("tool-output");
    expect(json).not.toContain('"evidenceRefs"');
    expect(json).not.toContain("summary");
  });

  it("rejects cursors reused across tenant, principal, query, or sort", async () => {
    const reports = [
      makeReport(TENANT_A, "2026-09-02T17:48:00.000Z"),
      makeReport(TENANT_A, "2026-09-02T17:49:00.000Z"),
      makeReport(TENANT_A, "2026-09-02T17:50:00.000Z"),
    ];
    const { adapter } = adapterWith(reports);
    const page1 = await adapter.query({
      auth: { trusted: TRUSTED_A, principal: principal(TENANT_A) },
      claim: { mode: "report", limit: 1, sort: { key: "generatedAt", direction: "desc" } },
    });
    expect(page1.nextCursor?.startsWith("pq1.")).toBe(true);
    const stolenByOtherTenant = await adapter.query({
      auth: { trusted: TRUSTED_B, principal: principal(TENANT_B) },
      claim: {
        mode: "report",
        limit: 1,
        cursor: page1.nextCursor ?? undefined,
        sort: { key: "generatedAt", direction: "desc" },
      },
    });
    const stolenByOtherPrincipal = await adapter.query({
      auth: {
        trusted: TRUSTED_A,
        principal: principal(TENANT_A, { principalId: "user-other" }),
      },
      claim: {
        mode: "report",
        limit: 1,
        cursor: page1.nextCursor ?? undefined,
        sort: { key: "generatedAt", direction: "desc" },
      },
    });
    const stolenBySort = await adapter.query({
      auth: { trusted: TRUSTED_A, principal: principal(TENANT_A) },
      claim: {
        mode: "report",
        limit: 1,
        cursor: page1.nextCursor ?? undefined,
        sort: { key: "reportId", direction: "asc" },
      },
    });
    for (const denied of [stolenByOtherTenant, stolenByOtherPrincipal, stolenBySort]) {
      expect(denied.authorization.outcome).toBe("deny");
      expect(denied.items).toEqual([]);
    }
    const expired = await createProductionReportQueryAdapter({
      reader: createInMemoryCompositeReportReader(reports),
      audit: createInMemoryProductionQueryAuditSink(),
      now: () => Date.now() + PRODUCTION_QUERY_CURSOR_TTL_MS + 1,
    }).query({
      auth: { trusted: TRUSTED_A, principal: principal(TENANT_A) },
      claim: {
        mode: "report",
        limit: 1,
        cursor: page1.nextCursor ?? undefined,
        sort: { key: "generatedAt", direction: "desc" },
      },
    });
    expect(expired.authorization.reason).toBe("cursor_expired");
  });

  it("propagates reader failures", async () => {
    const audit = createInMemoryProductionQueryAuditSink();
    const adapter = createProductionReportQueryAdapter({
      reader: {
        async list() {
          throw new Error("reader failed");
        },
        async get() {
          throw new Error("reader get failed");
        },
      },
      audit,
    });
    await expect(
      adapter.query({
        auth: { trusted: TRUSTED_A, principal: principal(TENANT_A) },
        claim: { mode: "report" },
      }),
    ).rejects.toThrow("reader failed");
    await expect(
      adapter.get({
        auth: { trusted: TRUSTED_A, principal: principal(TENANT_A) },
        reportId: "cdr-any",
      }),
    ).rejects.toThrow("reader get failed");
  });

  it("is a read-only reference adapter with no production API", () => {
    const body = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "report-query-production.ts"),
      "utf8",
    );
    expect(body).toContain("Reference adapter");
    expect(body).not.toContain("appendSkillInvocationEvent");
    expect(body).not.toContain("writeConfigFile");
    expect(body).not.toContain("doctorCommand");
    expect(body).not.toContain("startChannel");
    expect(body).not.toContain("createServer");
    expect(body).not.toContain("WebSocket");
    expect(body).not.toContain("fetch(");
    expect(body).not.toContain("http.");
    expect(body).not.toContain("DiagnosisJournal");
    expect(body).not.toContain("Math.random");
  });

  it("serves a validated single-tenant page and enforces quota", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z");
    const { adapter } = adapterWith([report], {
      quota: createInMemoryProductionQueryQuota({ tenantLimit: 1, principalLimit: 1 }),
    });
    const allowed = await adapter.query({
      auth: { trusted: TRUSTED_A, principal: principal(TENANT_A) },
      claim: { mode: "report" },
    });
    expect(allowed.authorization.outcome).toBe("allow");
    expect(allowed.items[0]?.reportId).toBe(report.reportId);
    const limited = await adapter.query({
      auth: { trusted: TRUSTED_A, principal: principal(TENANT_A) },
      claim: { mode: "report" },
    });
    expect(limited.authorization.reason).toBe("rate_limited");
    expect(limited.items).toEqual([]);
  });
});
