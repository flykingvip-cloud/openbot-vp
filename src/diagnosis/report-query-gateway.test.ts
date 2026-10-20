import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GatewayRequestHandler } from "../gateway/server-methods/types.js";
import { aggregateCrossTargetCases } from "./cross-target.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-api.js";
import {
  createDefaultDiagnosisReportApiDeps,
  createDiagnosisReportGatewayHandlers,
  resolveDiagnosisProductionAuth,
  type DiagnosisGatewayAuthClient,
} from "./report-query-gateway.js";
import {
  PRODUCTION_QUERY_ADMIN_CAPABILITY,
  PRODUCTION_QUERY_CURSOR_TTL_MS,
  PRODUCTION_QUERY_LOCAL_READ_CAPABILITY,
  createInMemoryProductionQueryAuditSink,
  createInMemoryProductionQueryQuota,
  type ProductionQueryResponse,
} from "./report-query-production.js";
import { createInMemoryCompositeReportReader } from "./report-query.js";
import { buildCompositeDiagnosisReport } from "./report.js";
import type {
  DiagnosisRelation,
  DiagnosticEvidence,
  DiagnosticFinding,
  DiagnosticTarget,
} from "./types.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-other";

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

function enterpriseClient(
  over: Partial<DiagnosisGatewayAuthClient> = {},
): DiagnosisGatewayAuthClient {
  return {
    user: "owner-a@example.com",
    platformUserId: "user-a",
    sessionDomain: "enterprise",
    sessionKind: "member",
    ...over,
  };
}

function handlersFor(
  reports: readonly unknown[],
  over: {
    quota?: ReturnType<typeof createInMemoryProductionQueryQuota>;
    now?: () => number;
    membershipTenantId?: string | null;
  } = {},
) {
  const audit = createInMemoryProductionQueryAuditSink();
  const handlers = createDiagnosisReportGatewayHandlers(
    {
      reader: createInMemoryCompositeReportReader(reports),
      audit,
      ...(over.quota ? { quota: over.quota } : {}),
      ...(over.now ? { now: over.now } : {}),
    },
    {
      resolveMembership: async () => ({
        tenantId: over.membershipTenantId === undefined ? TENANT_A : over.membershipTenantId,
        userId: "user-a",
      }),
    },
  );
  return { handlers, audit };
}

async function invoke(
  handler: GatewayRequestHandler | undefined,
  params: Record<string, unknown>,
  client: DiagnosisGatewayAuthClient | null,
) {
  if (!handler) {
    throw new Error("missing diagnosis report handler");
  }
  let captured:
    | { ok: boolean; payload?: unknown; error?: { code: string; message: string } }
    | undefined;
  await handler({
    req: { type: "req", id: "test", method: "diagnosis.reports.query" } as never,
    params,
    client: client as never,
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      captured = {
        ok,
        payload,
        ...(error ? { error: { code: error.code, message: error.message } } : {}),
      };
    },
    context: {} as never,
  });
  return captured;
}

function isResponse(body: unknown): body is ProductionQueryResponse {
  return typeof body === "object" && body !== null && "authorization" in body;
}

describe("Phase 3.6 — diagnosis report gateway wiring", () => {
  it("exposes query/get/diagnose handlers when the report API gate is open", () => {
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    const handlers = createDiagnosisReportGatewayHandlers();
    expect(Object.keys(handlers)).toEqual([
      "diagnosis.reports.query",
      "diagnosis.reports.get",
      "diagnosis.diagnose",
      "diagnosis.action.dispatch",
      "diagnosis.schedule.apply",
      "diagnosis.self-evolution.confirm",
    ]);
    expect(handlers["diagnosis.reports.delete"]).toBeUndefined();
  });

  it("builds trusted tenant from membership and ignores spoofed client tenant hints", async () => {
    const spoofed = enterpriseClient({
      sessionTenantId: TENANT_B,
      connect: { tenantId: TENANT_B },
    });
    const auth = await resolveDiagnosisProductionAuth(spoofed, {
      resolveMembership: async () => ({ tenantId: TENANT_A, userId: "user-a" }),
    });
    expect(auth?.trusted.tenantId).toBe(TENANT_A);
    expect(auth?.principal.tenantId).toBe(TENANT_A);
    expect(auth?.principal.principalId).toBe("user-a");
  });

  it("denies unresolved membership when sessionDomain is missing", async () => {
    const unresolved = {
      user: "owner-a@example.com",
      platformUserId: "user-a",
    };
    const auth = await resolveDiagnosisProductionAuth(unresolved, {
      resolveMembership: async () => ({ tenantId: null, userId: null }),
    });
    expect(auth).toBeNull();
    expect(auth?.capabilities ?? []).not.toContain(PRODUCTION_QUERY_LOCAL_READ_CAPABILITY);

    const denied = await invoke(
      createDiagnosisReportGatewayHandlers(
        {
          ...createDefaultDiagnosisReportApiDeps(),
          reader: createInMemoryCompositeReportReader([
            makeReport(null, "2026-09-02T17:50:00.000Z"),
          ]),
        },
        { resolveMembership: async () => ({ tenantId: null, userId: null }) },
      )["diagnosis.reports.query"],
      { mode: "report" },
      unresolved,
    );
    expect(denied?.ok).toBe(false);
    expect(denied?.error?.code).toBe("401");
  });

  it("keeps explicit platform-admin local read without a sessionDomain", async () => {
    const admin = {
      user: "admin@example.com",
      platformUserId: "platform-admin",
      sessionKind: "platform-super-admin",
    };
    const auth = await resolveDiagnosisProductionAuth(admin, {
      resolveMembership: async () => ({ tenantId: null, userId: "platform-admin" }),
    });
    expect(auth?.trusted.tenantId).toBeNull();
    expect(auth?.capabilities).toEqual(
      expect.arrayContaining([
        PRODUCTION_QUERY_LOCAL_READ_CAPABILITY,
        PRODUCTION_QUERY_ADMIN_CAPABILITY,
      ]),
    );
  });

  it("does not derive trusted tenant from request params", async () => {
    const auth = await resolveDiagnosisProductionAuth(enterpriseClient(), {
      resolveMembership: async (client) => {
        expect(client && "tenantId" in client).toBe(false);
        return { tenantId: TENANT_A, userId: "user-a" };
      },
    });
    expect(auth?.trusted.tenantId).toBe(TENANT_A);
  });

  it("queries and gets through gateway handlers", async () => {
    const report = makeReport(TENANT_A, "2026-09-02T17:48:00.000Z");
    const { handlers } = handlersFor([report]);
    const listed = await invoke(
      handlers["diagnosis.reports.query"],
      { schemaVersion: 1, mode: "report" },
      enterpriseClient(),
    );
    expect(listed?.ok).toBe(true);
    expect(isResponse(listed?.payload) && listed.payload.items[0]?.reportId).toBe(report.reportId);
    const got = await invoke(
      handlers["diagnosis.reports.get"],
      { schemaVersion: 1, reportId: report.reportId },
      enterpriseClient(),
    );
    expect(got?.ok).toBe(true);
    expect(isResponse(got?.payload) && got.payload.schemaVersion).toBe(1);
  });

  it("maps 401/403/429/400 and hides existence", async () => {
    const reports = [
      makeReport(TENANT_A, "2026-09-02T17:48:00.000Z"),
      makeReport(TENANT_A, "2026-09-02T17:49:00.000Z"),
    ];
    const foreign = makeReport(TENANT_B, "2026-09-02T17:51:00.000Z", "sha256:session-b");
    const unauth = await invoke(
      createDiagnosisReportGatewayHandlers(createDefaultDiagnosisReportApiDeps(), {
        resolveMembership: async () => ({ tenantId: TENANT_A, userId: "user-a" }),
      })["diagnosis.reports.query"],
      { mode: "report" },
      null,
    );
    expect(unauth?.ok).toBe(false);
    expect(unauth?.error?.code).toBe("401");

    const spoofed = await invoke(
      handlersFor(reports).handlers["diagnosis.reports.query"],
      { mode: "report", tenantId: TENANT_B },
      enterpriseClient({ sessionTenantId: TENANT_B }),
    );
    expect(spoofed?.ok).toBe(false);
    expect(spoofed?.error?.code).toBe("403");

    const localDenied = await invoke(
      handlersFor(reports, { membershipTenantId: null }).handlers["diagnosis.reports.query"],
      { mode: "report" },
      enterpriseClient({ sessionDomain: "enterprise" }),
    );
    expect(localDenied?.ok).toBe(false);
    expect(localDenied?.error?.code).toBe("403");

    const localAllowed = await invoke(
      handlersFor([makeReport(null, "2026-09-02T17:50:00.000Z")], {
        membershipTenantId: null,
      }).handlers["diagnosis.reports.query"],
      { mode: "report", redactionProfile: "system_local" },
      { user: "local-op", platformUserId: "system-local", sessionDomain: "platform" },
    );
    expect(localAllowed?.ok).toBe(true);

    const limited = handlersFor(reports, {
      quota: createInMemoryProductionQueryQuota({ tenantLimit: 1, principalLimit: 1 }),
    });
    await invoke(
      limited.handlers["diagnosis.reports.query"],
      { mode: "report" },
      enterpriseClient(),
    );
    const rateLimited = await invoke(
      limited.handlers["diagnosis.reports.query"],
      { mode: "report" },
      enterpriseClient(),
    );
    expect(rateLimited?.error?.code).toBe("429");

    const paged = handlersFor(reports);
    const page1 = await invoke(
      paged.handlers["diagnosis.reports.query"],
      { mode: "report", limit: 1, sort: { key: "generatedAt", direction: "desc" } },
      enterpriseClient(),
    );
    const expired = await invoke(
      handlersFor(reports, { now: () => Date.now() + PRODUCTION_QUERY_CURSOR_TTL_MS + 1 }).handlers[
        "diagnosis.reports.query"
      ],
      {
        mode: "report",
        limit: 1,
        cursor: isResponse(page1?.payload) ? page1.payload.nextCursor : undefined,
        sort: { key: "generatedAt", direction: "desc" },
      },
      enterpriseClient(),
    );
    expect(expired?.error?.code).toBe("400");

    const unknownSchema = await invoke(
      handlersFor(reports).handlers["diagnosis.reports.query"],
      { schemaVersion: 2, mode: "report" },
      enterpriseClient(),
    );
    expect(unknownSchema?.error?.code).toBe("unknown_schema_version");

    const missing = await invoke(
      handlersFor([...reports, foreign]).handlers["diagnosis.reports.get"],
      { reportId: "cdr-missing" },
      enterpriseClient(),
    );
    const foreignGet = await invoke(
      handlersFor([...reports, foreign]).handlers["diagnosis.reports.get"],
      { reportId: foreign.reportId },
      enterpriseClient(),
    );
    expect(missing?.error?.code).toBe("403");
    expect(foreignGet?.error?.code).toBe("403");
    expect(isResponse(missing?.payload) && missing.payload.authorization).toEqual(
      isResponse(foreignGet?.payload) && foreignGet.payload.authorization,
    );
  });

  it("is not a production deployment and has no write side effects", () => {
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    const gateway = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "report-query-gateway.ts"),
      "utf8",
    );
    expect(gateway).not.toContain("appendSkillInvocationEvent");
    expect(gateway).not.toContain("writeConfigFile");
    expect(gateway).not.toContain("doctorCommand");
    expect(gateway).not.toContain("startChannel");
    expect(gateway).not.toContain("--fix");
    expect(gateway).not.toContain("DiagnosisJournal");
    expect(gateway).not.toContain("Math.random");
    expect(gateway).toContain("resolveAuthoritativeMembership");
  });
});
