import { describe, expect, it } from "vitest";
import { aggregateCrossTargetCases } from "./cross-target.js";
import {
  createMemoryAuditAppendBackend,
  createProjectionAuthoritySource,
  resolveProductionAdapterDeps,
} from "./report-query-production-adapters.js";
import {
  DIAGNOSIS_PRODUCTION_ADAPTER_CONFIG_DEFAULTS,
  DIAGNOSIS_PRODUCTION_AUDIT_BACKEND_KIND,
  DIAGNOSIS_PRODUCTION_AUDIT_LOCATOR,
  DIAGNOSIS_PRODUCTION_QUOTA_BACKEND_KIND,
  DIAGNOSIS_PRODUCTION_REPORT_SOURCE_KIND,
  assertDiagnosisProductionConfigClosed,
  parseDiagnosisProductionAdapterConfig,
  resolveProductionAdapterDepsFromConfig,
} from "./report-query-production-config.js";
import { isWindowedProductionQuota } from "./report-query-production.js";
import { buildCompositeDiagnosisReport } from "./report.js";
import { DiagnosisContractError } from "./types.js";
import type {
  DiagnosisRelation,
  DiagnosticEvidence,
  DiagnosticFinding,
  DiagnosticTarget,
} from "./types.js";

const TENANT_A = "tenant-fixture-a";

const COMPLETE_CONFIG = {
  enabled: true,
  reportSourceBackend: { kind: DIAGNOSIS_PRODUCTION_REPORT_SOURCE_KIND },
  auditPersistBackend: {
    kind: DIAGNOSIS_PRODUCTION_AUDIT_BACKEND_KIND,
    locator: DIAGNOSIS_PRODUCTION_AUDIT_LOCATOR,
  },
  quotaBackend: { kind: DIAGNOSIS_PRODUCTION_QUOTA_BACKEND_KIND },
  readerMaxAgeMs: 3_600_000,
  quotaWindow: {
    windowMs: 30_000,
    tenantLimit: 2,
    principalLimit: 2,
    maxConcurrency: 1,
  },
};

function memoryQuotaBackend() {
  return {
    async increment() {
      return 1;
    },
    async acquireLease() {
      return true;
    },
    async releaseLease() {},
  };
}

describe("Phase 3.9 — production adapter config", () => {
  it("defaults to closed config when missing", () => {
    expect(parseDiagnosisProductionAdapterConfig()).toEqual(
      DIAGNOSIS_PRODUCTION_ADAPTER_CONFIG_DEFAULTS,
    );
    expect(parseDiagnosisProductionAdapterConfig(null)).toEqual(
      DIAGNOSIS_PRODUCTION_ADAPTER_CONFIG_DEFAULTS,
    );
    expect(parseDiagnosisProductionAdapterConfig({}).enabled).toBe(false);
    expect(() => assertDiagnosisProductionConfigClosed()).not.toThrow();
    const fallback = resolveProductionAdapterDepsFromConfig(
      parseDiagnosisProductionAdapterConfig(),
    );
    const closed = resolveProductionAdapterDeps({ enabled: false });
    expect(fallback.quota?.consume(TENANT_A, "user-a")).toEqual(
      closed.quota?.consume(TENANT_A, "user-b"),
    );
    expect(isWindowedProductionQuota(fallback.quota!)).toBe(false);
  });

  it("fail-closes on invalid, incomplete, or secret-bearing config", () => {
    expect(() => parseDiagnosisProductionAdapterConfig("open")).toThrow(DiagnosisContractError);
    expect(() => parseDiagnosisProductionAdapterConfig({ enabled: "true" })).toThrow(
      /enabled must be a boolean/,
    );
    expect(() => parseDiagnosisProductionAdapterConfig({ enabled: true })).toThrow(
      /reportSourceBackend is required/,
    );
    expect(() =>
      parseDiagnosisProductionAdapterConfig({
        enabled: true,
        reportSourceBackend: { kind: DIAGNOSIS_PRODUCTION_REPORT_SOURCE_KIND },
        auditPersistBackend: {
          kind: DIAGNOSIS_PRODUCTION_AUDIT_BACKEND_KIND,
          locator: DIAGNOSIS_PRODUCTION_AUDIT_LOCATOR,
        },
      }),
    ).toThrow(/quotaBackend is required/);
    expect(() =>
      parseDiagnosisProductionAdapterConfig({
        enabled: true,
        reportSourceBackend: { kind: "report-db" },
        auditPersistBackend: {
          kind: DIAGNOSIS_PRODUCTION_AUDIT_BACKEND_KIND,
          locator: DIAGNOSIS_PRODUCTION_AUDIT_LOCATOR,
        },
        quotaBackend: { kind: DIAGNOSIS_PRODUCTION_QUOTA_BACKEND_KIND },
      }),
    ).toThrow(/composite_diagnosis_projection_snapshot/);
    expect(() =>
      parseDiagnosisProductionAdapterConfig({
        reportSourceBackend: { kind: DIAGNOSIS_PRODUCTION_REPORT_SOURCE_KIND, url: "https://db" },
      }),
    ).toThrow(/must not include url/);
    expect(() =>
      parseDiagnosisProductionAdapterConfig({
        auditPersistBackend: {
          kind: DIAGNOSIS_PRODUCTION_AUDIT_BACKEND_KIND,
          locator: "https://audit.internal:443/sink",
        },
      }),
    ).toThrow(/production URLs/);
    expect(() =>
      parseDiagnosisProductionAdapterConfig({ quotaWindow: { tenantLimit: 0 } }),
    ).toThrow(/positive integer/);
    expect(() => parseDiagnosisProductionAdapterConfig({ readerMaxAgeMs: -1 })).toThrow(
      /positive integer/,
    );
  });

  it("accepts a complete placeholder config and wires resolveProductionAdapterDeps", async () => {
    const parsed = parseDiagnosisProductionAdapterConfig(COMPLETE_CONFIG);
    expect(parsed.enabled).toBe(true);
    expect(parsed.readerMaxAgeMs).toBe(3_600_000);
    expect(parsed.quotaWindow.maxConcurrency).toBe(1);
    expect(parsed.auditPersistBackend?.locator).toBe(DIAGNOSIS_PRODUCTION_AUDIT_LOCATOR);

    expect(() =>
      resolveProductionAdapterDepsFromConfig(parsed, {
        reportSource: createProjectionAuthoritySource([
          makeReport(TENANT_A, "2026-09-02T21:40:00.000Z"),
        ]),
        auditAppend: createMemoryAuditAppendBackend(),
      }),
    ).toThrow(/report\/audit\/quota backends are missing/);

    const now = () => Date.parse("2026-09-02T22:00:00.000Z");
    const audit = createMemoryAuditAppendBackend();
    const deps = resolveProductionAdapterDepsFromConfig(
      parsed,
      {
        reportSource: createProjectionAuthoritySource([
          makeReport(TENANT_A, "2026-09-02T21:40:00.000Z"),
          makeReport(TENANT_A, "2026-09-01T21:40:00.000Z"),
        ]),
        auditAppend: audit,
        quota: memoryQuotaBackend(),
      },
      { now, readerPolicy: { trustedTenantId: TENANT_A } },
    );
    expect(deps.quota && isWindowedProductionQuota(deps.quota)).toBe(true);
    const listed = await deps.reader.list({ tenantId: TENANT_A, mode: "report" });
    expect(listed).toHaveLength(1);
    if (!deps.quota || !isWindowedProductionQuota(deps.quota)) {
      throw new Error("expected windowed quota from enabled config");
    }
    const windowed = await deps.quota.consumeWindow(TENANT_A, "user-a");
    expect(windowed).toMatchObject({ ok: true });
    await deps.quota.releaseWindow(TENANT_A, "user-a");
    await deps.audit.record({
      principalId: "user-a",
      principalKind: "user",
      tenantId: TENANT_A,
      mode: "report",
      targetDigest: {},
      resultCount: 1,
      decision: "allow",
      redactionProfile: "user",
    });
    expect(audit.entries).toHaveLength(1);
  });
});

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

function makeReport(tenantId: string | null, generatedAt: string) {
  const suffix = generatedAt.slice(17, 19);
  const findingId = `find-${suffix}`;
  const evidenceId = `ev-${suffix}`;
  const relationId = `rel-${suffix}`;
  const scoped = { scope: { sessionKeyHash: "sha256:session-a" } };
  return buildCompositeDiagnosisReport(
    aggregateCrossTargetCases([
      {
        runId: `run-${generatedAt}`,
        tenantId,
        sessionKeyHash: "sha256:session-a",
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
    ]),
    { tenantId },
    { generatedAt },
  );
}
