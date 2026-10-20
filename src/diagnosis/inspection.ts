/**
 * Phase 4 — read-only dynamic inspection.
 * In-process ticks only. Injectable clock. No resident timers or repair.
 */
import { computeMergeKey, mergeCaseRefs } from "./merge.js";
import {
  DIAGNOSTIC_SIGNAL_SUPPRESS_MS,
  DIAGNOSTIC_SIGNAL_TTL_MS,
  computeSignalFingerprint,
  computeSignalId,
  expireSignals,
  isSignalExpired,
  isSignalSuppressed,
  mergeSignals,
  suppressSignal,
  validateDiagnosticSignal,
  type DiagnosticSignal,
  type DiagnosticSignalCatalog,
  type DiagnosticSignalKind,
} from "./signal.js";
import {
  DiagnosisContractError,
  type DiagnosticCase,
  type DiagnosticEvidence,
  type DiagnosticFinding,
  type DiagnosticTarget,
  type DiagnosticVerification,
  type EvidenceRequirement,
  type TrustedTenantContext,
} from "./types.js";

export const INSPECTION_TRIGGER_KINDS = [
  "scheduled",
  "event",
  "threshold",
  "trend",
  "verification_triggered",
] as const;

export const INSPECTION_MAX_RETRIES = 2;

export type InspectionTrigger =
  | { kind: "scheduled"; everyMs: number; inspectorId?: string }
  | { kind: "event"; eventCode: string }
  | { kind: "threshold"; metricKey: string; op: "gt" | "lt"; value: number }
  | { kind: "trend"; metricKey: string; windowMs: number; minDelta: number }
  | { kind: "verification_triggered"; caseId: string };

export type InspectionMetric = {
  key: string;
  value: number;
  observedAt: string;
};

export type InspectionSnapshot = {
  tenantId: string | null;
  targets: readonly DiagnosticTarget[];
  evidences: readonly DiagnosticEvidence[];
  findings: readonly DiagnosticFinding[];
  cases: readonly DiagnosticCase[];
  verifications?: readonly DiagnosticVerification[];
  metrics?: readonly InspectionMetric[];
  unavailable?: boolean;
};

export type InspectionRunResult =
  | {
      ok: true;
      signals: DiagnosticSignal[];
      cases: DiagnosticCase[];
      idempotent: boolean;
    }
  | {
      ok: false;
      reason: "unavailable" | "tenant_mismatch" | "suppressed";
      retryCount: number;
    };

export type InspectionScheduler = {
  run(trigger: InspectionTrigger, snapshot: InspectionSnapshot): InspectionRunResult;
  tick(triggers: readonly InspectionTrigger[], snapshot: InspectionSnapshot): InspectionRunResult[];
  suppress(tenantId: string | null, fingerprint: string): DiagnosticSignal | undefined;
  listSignals(tenantId: string | null): DiagnosticSignal[];
  listCases(tenantId: string | null): DiagnosticCase[];
};

export function createInspectionScheduler(
  deps: {
    now?: () => number;
    maxRetries?: number;
    ttlMs?: number;
  } = {},
): InspectionScheduler {
  const now = deps.now ?? Date.now;
  const maxRetries = deps.maxRetries ?? INSPECTION_MAX_RETRIES;
  const ttlMs = deps.ttlMs ?? DIAGNOSTIC_SIGNAL_TTL_MS;
  const signals = new Map<string, DiagnosticSignal>();
  const cases = new Map<string, DiagnosticCase>();
  const lastScheduled = new Map<string, number>();
  const retries = new Map<string, number>();

  const catalogFor = (snapshot: InspectionSnapshot): DiagnosticSignalCatalog => ({
    trusted: { tenantId: snapshot.tenantId },
    targets: snapshot.targets,
    evidences: snapshot.evidences,
    findings: snapshot.findings,
    cases: [...snapshot.cases, ...cases.values()].filter(
      (item) => item.tenantId === snapshot.tenantId,
    ),
  });

  const run = (trigger: InspectionTrigger, snapshot: InspectionSnapshot): InspectionRunResult => {
    const retryKey = `${snapshot.tenantId ?? "local"}:${trigger.kind}`;
    if (snapshot.unavailable) {
      const retryCount = (retries.get(retryKey) ?? 0) + 1;
      retries.set(retryKey, retryCount);
      return { ok: false, reason: "unavailable", retryCount };
    }
    if (retryKey && (retries.get(retryKey) ?? 0) > maxRetries) {
      return { ok: false, reason: "unavailable", retryCount: retries.get(retryKey) ?? 0 };
    }
    let candidates: DiagnosticSignal[];
    try {
      candidates = inspectSnapshot(trigger, snapshot, now(), ttlMs);
    } catch (err) {
      if (err instanceof DiagnosisContractError && err.code === "tenant_mismatch") {
        return { ok: false, reason: "tenant_mismatch", retryCount: retries.get(retryKey) ?? 0 };
      }
      const retryCount = (retries.get(retryKey) ?? 0) + 1;
      retries.set(retryKey, retryCount);
      return { ok: false, reason: "unavailable", retryCount };
    }
    retries.delete(retryKey);
    const catalog = catalogFor(snapshot);
    const emitted: DiagnosticSignal[] = [];
    const touchedCases: DiagnosticCase[] = [];
    let idempotent = true;
    for (const candidate of candidates) {
      const existing = [...signals.values()].find(
        (row) =>
          row.tenantId === candidate.tenantId &&
          row.fingerprint === candidate.fingerprint &&
          row.status !== "merged",
      );
      if (existing && isSignalSuppressed(existing, now())) {
        return { ok: false, reason: "suppressed", retryCount: 0 };
      }
      let next = candidate;
      if (existing && !isSignalExpired(existing, now())) {
        next = mergeSignals(existing, candidate);
        idempotent = next.signalId === existing.signalId;
      } else {
        idempotent = false;
      }
      const linked = associateOrCreateCase(next, catalog.cases, now());
      next = linked.signal;
      validateDiagnosticSignal(next, {
        ...catalog,
        cases: [...catalog.cases.filter((item) => item.caseId !== linked.case.caseId), linked.case],
      });
      signals.set(next.signalId, next);
      cases.set(linked.case.caseId, linked.case);
      emitted.push(next);
      touchedCases.push(linked.case);
    }
    expireStored(now());
    return { ok: true, signals: emitted, cases: touchedCases, idempotent };
  };

  const expireStored = (nowMs: number) => {
    for (const signal of expireSignals([...signals.values()], nowMs)) {
      signals.set(signal.signalId, signal);
    }
  };

  return {
    run,
    tick(triggers, snapshot) {
      const nowMs = now();
      const due: InspectionRunResult[] = [];
      for (const trigger of triggers) {
        if (trigger.kind === "scheduled") {
          const key = trigger.inspectorId ?? "scheduled";
          const last = lastScheduled.get(key) ?? 0;
          if (nowMs - last < trigger.everyMs) {
            continue;
          }
          lastScheduled.set(key, nowMs);
        }
        due.push(run(trigger, snapshot));
      }
      return due;
    },
    suppress(tenantId, fingerprint) {
      const current = [...signals.values()].find(
        (row) => row.tenantId === tenantId && row.fingerprint === fingerprint,
      );
      if (!current) {
        return undefined;
      }
      const next = suppressSignal(current, toIso(now() + DIAGNOSTIC_SIGNAL_SUPPRESS_MS));
      signals.set(next.signalId, next);
      return next;
    },
    listSignals(tenantId) {
      expireStored(now());
      return [...signals.values()].filter((signal) => signal.tenantId === tenantId);
    },
    listCases(tenantId) {
      return [...cases.values()].filter((item) => item.tenantId === tenantId);
    },
  };
}

export function inspectSnapshot(
  trigger: InspectionTrigger,
  snapshot: InspectionSnapshot,
  nowMs: number,
  ttlMs = DIAGNOSTIC_SIGNAL_TTL_MS,
): DiagnosticSignal[] {
  assertSnapshotTenant(snapshot);
  const observedAt = toIso(nowMs);
  const expiresAt = toIso(nowMs + ttlMs);
  const windowId = String(Math.floor(nowMs / ttlMs));
  const kind = trigger.kind;
  const rows = selectMatches(trigger, snapshot);
  return rows.map((row) =>
    buildSignal({
      kind,
      snapshot,
      target: row.target,
      evidenceIds: row.evidenceIds,
      findingIds: row.findingIds,
      caseId: row.caseId,
      reasonCode: row.reasonCode,
      completion: row.completion,
      missingEvidence: row.missingEvidence,
      observedAt,
      expiresAt,
      windowId,
    }),
  );
}

export function associateOrCreateCase(
  signal: DiagnosticSignal,
  existing: readonly DiagnosticCase[],
  nowMs: number,
): { signal: DiagnosticSignal; case: DiagnosticCase } {
  const sessionKeyHash = signal.target.scope.sessionKeyHash ?? signal.target.targetId;
  const mergeKey = computeMergeKey({
    tenantId: signal.tenantId,
    sessionKeyHash,
    fingerprint: signal.fingerprint,
  });
  const found = existing.find((item) => {
    if (item.tenantId !== signal.tenantId) {
      return false;
    }
    if (signal.caseId && item.caseId === signal.caseId) {
      return true;
    }
    const itemKey = computeMergeKey({
      tenantId: item.tenantId,
      sessionKeyHash: item.targets[0]?.scope.sessionKeyHash ?? item.targets[0]?.targetId ?? "",
      fingerprint: signal.fingerprint,
    });
    return itemKey === mergeKey;
  });
  const at = signal.lastSeenAt;
  if (found) {
    const merged = mergeCaseRefs(found, {
      diagnosticRunIds: [],
      findingIds: signal.findingIds,
      relationIds: [],
      timeline: [{ at, code: "signal_associated" }],
    });
    return { signal: { ...signal, caseId: merged.caseId }, case: merged };
  }
  const created: DiagnosticCase = {
    schemaVersion: 1,
    caseId: `case:${mergeKey}`,
    tenantId: signal.tenantId,
    status: "OPEN",
    targets: [signal.target],
    diagnosticRunIds: [],
    findingIds: [...signal.findingIds],
    relationIds: [],
    timeline: [
      { at, code: "signal_opened" },
      { at: toIso(nowMs), code: "case_opened" },
    ],
  };
  return { signal: { ...signal, caseId: created.caseId }, case: created };
}

function selectMatches(
  trigger: InspectionTrigger,
  snapshot: InspectionSnapshot,
): Array<{
  target: DiagnosticTarget;
  evidenceIds: string[];
  findingIds: string[];
  caseId?: string;
  reasonCode: string;
  completion: DiagnosticSignal["completion"];
  missingEvidence?: EvidenceRequirement[];
}> {
  if (trigger.kind === "scheduled") {
    return snapshot.findings
      .filter(
        (finding) => finding.status === "open" && finding.target.tenantId === snapshot.tenantId,
      )
      .map((finding) => rowFromFinding(finding, snapshot, "inspection_scheduled"));
  }
  if (trigger.kind === "event") {
    const evidences = snapshot.evidences.filter(
      (item) =>
        item.target.tenantId === snapshot.tenantId &&
        (item.summary.eventCode === trigger.eventCode || item.summary.code === trigger.eventCode),
    );
    return evidences.map((evidence) => {
      const finding = snapshot.findings.find((item) =>
        item.evidenceIds.includes(evidence.evidenceId),
      );
      return {
        target: evidence.target,
        evidenceIds: [evidence.evidenceId],
        findingIds: finding ? [finding.findingId] : [],
        reasonCode: `event:${trigger.eventCode}`,
        completion: "CONFIRMED" as const,
      };
    });
  }
  if (trigger.kind === "threshold") {
    const hit = (snapshot.metrics ?? []).find((metric) => {
      if (metric.key !== trigger.metricKey) {
        return false;
      }
      return trigger.op === "gt" ? metric.value > trigger.value : metric.value < trigger.value;
    });
    if (!hit) {
      return [];
    }
    return [metricRow(snapshot, trigger.metricKey, `threshold:${trigger.metricKey}`)];
  }
  if (trigger.kind === "trend") {
    const series = (snapshot.metrics ?? [])
      .filter((metric) => metric.key === trigger.metricKey)
      .toSorted((a, b) => a.observedAt.localeCompare(b.observedAt));
    if (series.length < 2) {
      return [];
    }
    const first = series[0];
    const last = series[series.length - 1];
    if (!first || !last || last.value - first.value < trigger.minDelta) {
      return [];
    }
    return [metricRow(snapshot, trigger.metricKey, `trend:${trigger.metricKey}`)];
  }
  const verification = (snapshot.verifications ?? []).find(
    (item) => item.caseId === trigger.caseId,
  );
  const linked = snapshot.cases.find((item) => item.caseId === trigger.caseId);
  if (!verification || !linked || linked.tenantId !== snapshot.tenantId) {
    return [
      {
        target: snapshot.targets[0] ?? requiredTarget(snapshot),
        evidenceIds: [],
        findingIds: linked?.findingIds ?? [],
        caseId: trigger.caseId,
        reasonCode: "verification_missing",
        completion: "INCONCLUSIVE",
        missingEvidence: [
          {
            schemaVersion: 1,
            evidenceType: "event",
            source: "diagnostic_events",
            targetType: "session",
            fields: ["verification"],
            sensitivity: "internal",
            cost: "low",
            required: true,
          },
        ],
      },
    ];
  }
  if (verification.verdict === "improved") {
    return [];
  }
  const finding = snapshot.findings.find((item) => linked.findingIds.includes(item.findingId));
  return [
    {
      target: finding?.target ?? linked.targets[0] ?? requiredTarget(snapshot),
      evidenceIds: finding?.evidenceIds ?? [],
      findingIds: linked.findingIds,
      caseId: linked.caseId,
      reasonCode: `verification:${verification.verdict ?? "inconclusive"}`,
      completion: finding?.evidenceIds.length ? "CONFIRMED" : "INCONCLUSIVE",
      ...(finding?.evidenceIds.length
        ? {}
        : {
            missingEvidence: [
              {
                schemaVersion: 1,
                evidenceType: "event",
                source: "diagnostic_events",
                targetType: "session",
                fields: ["verification_outcome"],
                sensitivity: "internal",
                cost: "low",
                required: true,
              },
            ],
          }),
    },
  ];
}

function rowFromFinding(
  finding: DiagnosticFinding,
  snapshot: InspectionSnapshot,
  reasonCode: string,
): {
  target: DiagnosticTarget;
  evidenceIds: string[];
  findingIds: string[];
  reasonCode: string;
  completion: DiagnosticSignal["completion"];
  missingEvidence?: EvidenceRequirement[];
} {
  const known = finding.evidenceIds.filter((id) =>
    snapshot.evidences.some(
      (item) => item.evidenceId === id && item.target.tenantId === snapshot.tenantId,
    ),
  );
  if (known.length === 0 || finding.completion === "INCONCLUSIVE") {
    return {
      target: finding.target,
      evidenceIds: known,
      findingIds: [finding.findingId],
      reasonCode,
      completion: "INCONCLUSIVE",
      missingEvidence: finding.missingEvidence ?? [
        {
          schemaVersion: 1,
          evidenceType: "event",
          source: "diagnostic_events",
          targetType: finding.target.targetType,
          fields: ["observation"],
          sensitivity: "internal",
          cost: "low",
          required: true,
        },
      ],
    };
  }
  return {
    target: finding.target,
    evidenceIds: known,
    findingIds: [finding.findingId],
    reasonCode,
    completion: "CONFIRMED",
  };
}

function metricRow(
  snapshot: InspectionSnapshot,
  metricKey: string,
  reasonCode: string,
): {
  target: DiagnosticTarget;
  evidenceIds: string[];
  findingIds: string[];
  reasonCode: string;
  completion: DiagnosticSignal["completion"];
  missingEvidence?: EvidenceRequirement[];
} {
  const finding = snapshot.findings.find(
    (item) => item.target.tenantId === snapshot.tenantId && item.status === "open",
  );
  if (finding) {
    return rowFromFinding(finding, snapshot, reasonCode);
  }
  return {
    target: requiredTarget(snapshot),
    evidenceIds: [],
    findingIds: [],
    reasonCode: `${reasonCode}:missing_finding`,
    completion: "INCONCLUSIVE",
    missingEvidence: [
      {
        schemaVersion: 1,
        evidenceType: "metric",
        source: "agent_runtime_health",
        targetType: "agent",
        fields: [metricKey],
        sensitivity: "internal",
        cost: "low",
        required: true,
      },
    ],
  };
}

function buildSignal(input: {
  kind: DiagnosticSignalKind;
  snapshot: InspectionSnapshot;
  target: DiagnosticTarget;
  evidenceIds: string[];
  findingIds: string[];
  caseId?: string;
  reasonCode: string;
  completion: DiagnosticSignal["completion"];
  missingEvidence?: EvidenceRequirement[];
  observedAt: string;
  expiresAt: string;
  windowId: string;
}): DiagnosticSignal {
  if (input.target.tenantId !== input.snapshot.tenantId) {
    throw new DiagnosisContractError(
      "tenant_mismatch",
      "inspection must not emit a cross-tenant signal",
      "tenantId",
    );
  }
  const fingerprint = computeSignalFingerprint({
    kind: input.kind,
    tenantId: input.snapshot.tenantId,
    target: input.target,
    reasonCode: input.reasonCode,
  });
  const signal: DiagnosticSignal = {
    schemaVersion: 1,
    signalId: computeSignalId(fingerprint, input.windowId),
    kind: input.kind,
    tenantId: input.snapshot.tenantId,
    fingerprint,
    status: input.completion === "INCONCLUSIVE" ? "inconclusive" : "open",
    target: input.target,
    evidenceIds: input.evidenceIds,
    findingIds: input.findingIds,
    completion: input.completion,
    reasonCode: input.reasonCode,
    occurrenceCount: 1,
    retryCount: 0,
    observedAt: input.observedAt,
    lastSeenAt: input.observedAt,
    expiresAt: input.expiresAt,
  };
  if (input.caseId) {
    signal.caseId = input.caseId;
  }
  if (input.missingEvidence) {
    signal.missingEvidence = input.missingEvidence;
  }
  return signal;
}

function requiredTarget(snapshot: InspectionSnapshot): DiagnosticTarget {
  const target = snapshot.targets.find((item) => item.tenantId === snapshot.tenantId);
  if (!target) {
    throw new DiagnosisContractError(
      "target_ref_missing",
      "inspection requires an existing same-tenant Target",
      "targets",
    );
  }
  return target;
}

function assertSnapshotTenant(snapshot: InspectionSnapshot): void {
  const trusted: TrustedTenantContext = { tenantId: snapshot.tenantId };
  for (const target of snapshot.targets) {
    if (target.tenantId !== trusted.tenantId) {
      throw new DiagnosisContractError(
        "tenant_mismatch",
        "inspection snapshot contains a foreign target",
        "targets",
      );
    }
  }
}

function toIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}
