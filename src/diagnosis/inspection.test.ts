import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createInspectionScheduler, inspectSnapshot } from "./inspection.js";
import {
  computeSignalFingerprint,
  expireSignals,
  mergeSignals,
  validateDiagnosticSignal,
} from "./signal.js";
import { DiagnosisContractError } from "./types.js";
import type {
  DiagnosticCase,
  DiagnosticEvidence,
  DiagnosticFinding,
  DiagnosticTarget,
  DiagnosticVerification,
  TrustedTenantContext,
} from "./types.js";

const TENANT_A = "tenant-fixture-a";
const TENANT_B = "tenant-other";
const trustedA: TrustedTenantContext = { tenantId: TENANT_A };

function target(tenantId: string | null, over: Partial<DiagnosticTarget> = {}): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: "session",
    targetId: "session-a",
    tenantId,
    authority: "session_store",
    scope: { sessionKeyHash: "sha256:session-a" },
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
    observedAt: "2026-09-03T00:00:00.000Z",
    target: target(tenantId, {
      targetType: "agent",
      targetId: "agent-a",
      authority: "agent_runner",
    }),
    summary: { eventCode: "agent_not_started", agentStarted: false },
    collection: {
      method: "event_adapter",
      completeness: "complete",
      attributionResolution: "not_applicable",
    },
    privacy: { classification: "internal", redacted: true },
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
    firstSeenAt: "2026-09-03T00:00:00.000Z",
    lastSeenAt: "2026-09-03T00:00:01.000Z",
    completion: "CONFIRMED",
    ...over,
  };
}

function snapshot(
  tenantId: string | null,
  over: Partial<Parameters<typeof inspectSnapshot>[1]> = {},
) {
  return {
    tenantId,
    targets: [target(tenantId)],
    evidences: [evidence(tenantId)],
    findings: [finding(tenantId)],
    cases: [] as DiagnosticCase[],
    ...over,
  };
}

describe("Phase 4 — DiagnosticSignal and read-only inspection", () => {
  it("validates refs, tenant, and rejects fabricated RCA", () => {
    const snap = snapshot(TENANT_A);
    const [signal] = inspectSnapshot(
      { kind: "scheduled", everyMs: 60_000 },
      snap,
      Date.parse("2026-09-03T01:00:00.000Z"),
    );
    expect(signal).toBeDefined();
    const validated = validateDiagnosticSignal(signal, {
      trusted: trustedA,
      targets: snap.targets,
      evidences: snap.evidences,
      findings: snap.findings,
      cases: [],
    });
    expect(validated.kind).toBe("scheduled");
    expect(validated.evidenceIds).toEqual(["ev-a"]);
    expect(() =>
      validateDiagnosticSignal(
        { ...signal, tenantId: TENANT_B },
        {
          trusted: trustedA,
          targets: snap.targets,
          evidences: snap.evidences,
          findings: snap.findings,
          cases: [],
        },
      ),
    ).toThrow(/tenant must match/);
    expect(() =>
      validateDiagnosticSignal(
        { ...signal, evidenceIds: ["ev-missing"], completion: "CONFIRMED" },
        {
          trusted: trustedA,
          targets: snap.targets,
          evidences: snap.evidences,
          findings: snap.findings,
          cases: [],
        },
      ),
    ).toThrow(/existing same-tenant Evidence/);
    expect(() =>
      validateDiagnosticSignal(
        { ...signal, causes: [{ fromId: "a", toId: "b" }] },
        {
          trusted: trustedA,
          targets: snap.targets,
          evidences: snap.evidences,
          findings: snap.findings,
          cases: [],
        },
      ),
    ).toThrow(DiagnosisContractError);
  });

  it("dedups and stays idempotent for the same trigger and snapshot", () => {
    let now = Date.parse("2026-09-03T01:10:00.000Z");
    const scheduler = createInspectionScheduler({ now: () => now, ttlMs: 3_600_000 });
    const snap = snapshot(TENANT_A);
    const first = scheduler.run({ kind: "scheduled", everyMs: 60_000 }, snap);
    const second = scheduler.run({ kind: "scheduled", everyMs: 60_000 }, snap);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.idempotent).toBe(true);
    expect(second.signals[0]?.signalId).toBe(first.signals[0]?.signalId);
    expect(scheduler.listSignals(TENANT_A)).toHaveLength(1);
    expect(scheduler.listSignals(TENANT_A)[0]?.occurrenceCount).toBe(2);
    const merged = mergeSignals(first.signals[0], second.signals[0]);
    expect(merged.fingerprint).toBe(first.signals[0]?.fingerprint);
  });

  it("isolates tenants and fail-closes unavailable or foreign snapshots", () => {
    const scheduler = createInspectionScheduler({
      now: () => Date.parse("2026-09-03T01:20:00.000Z"),
    });
    expect(scheduler.run({ kind: "scheduled", everyMs: 1 }, snapshot(TENANT_A)).ok).toBe(true);
    expect(scheduler.listSignals(TENANT_B)).toEqual([]);
    expect(scheduler.listCases(TENANT_B)).toEqual([]);
    const foreign = scheduler.run(
      { kind: "scheduled", everyMs: 1 },
      snapshot(TENANT_A, { targets: [target(TENANT_B)] }),
    );
    expect(foreign).toMatchObject({ ok: false, reason: "tenant_mismatch" });
    const down = scheduler.run(
      { kind: "event", eventCode: "agent_not_started" },
      snapshot(TENANT_A, { unavailable: true }),
    );
    expect(down).toMatchObject({ ok: false, reason: "unavailable", retryCount: 1 });
    expect(
      scheduler.run(
        { kind: "event", eventCode: "agent_not_started" },
        snapshot(TENANT_A, { unavailable: true }),
      ),
    ).toMatchObject({ ok: false, reason: "unavailable", retryCount: 2 });
  });

  it("expires, suppresses, and records INCONCLUSIVE missing evidence", () => {
    let now = Date.parse("2026-09-03T01:30:00.000Z");
    const scheduler = createInspectionScheduler({ now: () => now, ttlMs: 1_000 });
    const incomplete = snapshot(TENANT_A, {
      findings: [finding(TENANT_A, { evidenceIds: ["ev-gone"], completion: "INCONCLUSIVE" })],
    });
    const opened = scheduler.run({ kind: "scheduled", everyMs: 1 }, incomplete);
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.signals[0]?.completion).toBe("INCONCLUSIVE");
      expect(opened.signals[0]?.missingEvidence?.length).toBeGreaterThan(0);
      expect(opened.cases[0]?.caseId).toBe(opened.signals[0]?.caseId);
    }
    const fingerprint = opened.ok ? opened.signals[0].fingerprint : "";
    scheduler.suppress(TENANT_A, fingerprint);
    expect(scheduler.run({ kind: "scheduled", everyMs: 1 }, incomplete)).toMatchObject({
      ok: false,
      reason: "suppressed",
    });
    now += 2_000;
    const later = createInspectionScheduler({ now: () => now, ttlMs: 1_000 });
    later.run({ kind: "scheduled", everyMs: 1 }, snapshot(TENANT_A));
    const expired = expireSignals(later.listSignals(TENANT_A), now + 2_000);
    expect(expired.every((row) => row.status === "expired")).toBe(true);
  });

  it("supports event, threshold, trend, and verification-triggered inspections without timers", () => {
    let now = Date.parse("2026-09-03T01:40:00.000Z");
    const scheduler = createInspectionScheduler({ now: () => now, ttlMs: 3_600_000 });
    const verification: DiagnosticVerification = {
      schemaVersion: 1,
      verificationId: "ver-a",
      caseId: "case-open",
      baselineWindow: { from: "2026-09-03T00:00:00.000Z", to: "2026-09-03T00:10:00.000Z" },
      observationWindow: { from: "2026-09-03T00:10:00.000Z", to: "2026-09-03T00:20:00.000Z" },
      expectedOutcome: { recovered: true },
      verdict: "unchanged",
    };
    const openCase: DiagnosticCase = {
      schemaVersion: 1,
      caseId: "case-open",
      tenantId: TENANT_A,
      status: "MONITORING",
      targets: [target(TENANT_A)],
      diagnosticRunIds: [],
      findingIds: ["find-a"],
      relationIds: [],
      timeline: [{ at: "2026-09-03T00:00:00.000Z", code: "opened" }],
    };
    const snap = snapshot(TENANT_A, {
      cases: [openCase],
      verifications: [verification],
      metrics: [
        { key: "error_rate", value: 1, observedAt: "2026-09-03T01:00:00.000Z" },
        { key: "error_rate", value: 8, observedAt: "2026-09-03T01:39:00.000Z" },
      ],
    });
    expect(scheduler.run({ kind: "event", eventCode: "agent_not_started" }, snap).ok).toBe(true);
    expect(
      scheduler.run({ kind: "threshold", metricKey: "error_rate", op: "gt", value: 5 }, snap).ok,
    ).toBe(true);
    expect(
      scheduler.run(
        { kind: "trend", metricKey: "error_rate", windowMs: 3_600_000, minDelta: 3 },
        snap,
      ).ok,
    ).toBe(true);
    const verified = scheduler.run({ kind: "verification_triggered", caseId: "case-open" }, snap);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.signals[0]?.kind).toBe("verification_triggered");
      expect(verified.signals[0]?.caseId).toBe("case-open");
    }
    const ticks = scheduler.tick([{ kind: "scheduled", everyMs: 60_000, inspectorId: "p4" }], snap);
    expect(ticks).toHaveLength(1);
    now += 10_000;
    expect(
      scheduler.tick([{ kind: "scheduled", everyMs: 60_000, inspectorId: "p4" }], snap),
    ).toEqual([]);
    expect(
      computeSignalFingerprint({
        kind: "event",
        tenantId: TENANT_A,
        target: target(TENANT_A),
        reasonCode: "event:agent_not_started",
      }),
    ).toContain("event");
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "inspection.ts"),
      "utf8",
    );
    expect(source).not.toContain("setInterval");
    expect(source).not.toContain("setTimeout");
    expect(source).not.toContain("appendSkillInvocationEvent");
    expect(source).not.toContain("doctorCommand");
    expect(source).not.toContain("startChannel");
    expect(source).not.toContain("createReportDatabase");
  });
});
