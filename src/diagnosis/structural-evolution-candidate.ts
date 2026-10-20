/**
 * Read-only structural evolution preview DTO.
 * Diagnosis emits this object. Gateway ingest (Track B) is the only writer
 * that may turn it into a control-plane Proposal. This module must not
 * import gateway/evolution-control or evolution-core.
 */
import { createHash } from "node:crypto";

export const STRUCTURAL_EVOLUTION_CANDIDATE_SCHEMA_VERSION = 1 as const;

export const STRUCTURAL_EVOLUTION_INTENTS = ["adjust_reporting_cadence"] as const;
export type StructuralEvolutionIntent = (typeof STRUCTURAL_EVOLUTION_INTENTS)[number];

export const STRUCTURAL_PROPOSED_CHANGE_FIELDS = ["reportingCadence"] as const;
export type StructuralProposedChangeField = (typeof STRUCTURAL_PROPOSED_CHANGE_FIELDS)[number];

export const STRUCTURAL_WORKING_DNA_SURFACE_ID = "agent.working-dna" as const;

/** Working DNA field values. Cron/prescription schedules are not valid here. */
export const STRUCTURAL_REPORTING_CADENCE_VALUES = [
  "on_completion",
  "milestone",
  "periodic",
  "on_request",
] as const;
export type StructuralReportingCadence = (typeof STRUCTURAL_REPORTING_CADENCE_VALUES)[number];

export const FORBIDDEN_CRON_REPORTING_CADENCE_VALUES = [
  "daily",
  "weekday_daily",
  "weekly",
] as const;

export type StructuralProposedChange = {
  field: "reportingCadence";
  value: StructuralReportingCadence;
};

export type StructuralWorkingStyleDelta = {
  reportingCadence: StructuralReportingCadence;
};

export const STRUCTURAL_MECHANISM_BY_INTENT = {
  adjust_reporting_cadence: "diagnosis.behavior.reporting_cadence_gap",
} as const;

export const PATH_A_EVOLUTION_PURPOSES = [
  "identity",
  "memory",
  "learn_capability",
  "review_tasks",
] as const;

const FORBIDDEN_AUTHORITY_KEYS = [
  "tenantId",
  "proposalId",
  "candidateRef",
  "grantId",
  "grantStatus",
  "grant",
  "schedule",
  "scheduleExpr",
  "normalizedSchedule",
  "wakeText",
  "applyPayload",
] as const;

const PROSE_EVIDENCE_PREFIXES = ["ev:diag:", "pdr-"] as const;

export type StructuralObservedWindow = {
  startedAt: string;
  endedAt: string;
};

export type StructuralEvolutionCandidate = {
  schemaVersion: typeof STRUCTURAL_EVOLUTION_CANDIDATE_SCHEMA_VERSION;
  mechanismRef: string;
  surfaceId: string;
  targetHint: string;
  baselineHash: string;
  candidatePayloadHash: string;
  candidateVersion: string;
  proposedChange: StructuralProposedChange;
  evidenceRefs: string[];
  snapshotRef: string;
  reportRef: string;
  findingRef: string;
  structuralIntent: StructuralEvolutionIntent;
  observedWindow: StructuralObservedWindow;
  cooldownKey: string;
};

export type StructuralPreviewFact = {
  structuralIntent: StructuralEvolutionIntent;
  proposedChange: StructuralProposedChange;
  surfaceId: string;
  targetHint: string;
  baselineHash: string;
  observationRef: string;
  evidenceRefs: string[];
  snapshotRef: string;
  reportRef: string;
  findingRef: string;
  observedWindow: StructuralObservedWindow;
};

export type StructuralCandidateValidation =
  | { ok: true; candidate: StructuralEvolutionCandidate }
  | { ok: false; reason: string };

export function isStructuralEvolutionIntent(value: string): value is StructuralEvolutionIntent {
  return (STRUCTURAL_EVOLUTION_INTENTS as readonly string[]).includes(value);
}

export function isPathAEvolutionPurpose(value: string): boolean {
  return (PATH_A_EVOLUTION_PURPOSES as readonly string[]).includes(value);
}

export function isProseDiagnosisEvidenceRef(ref: string): boolean {
  return PROSE_EVIDENCE_PREFIXES.some((prefix) => ref.startsWith(prefix));
}

export function isParseableStructuralTargetHint(hint: string): boolean {
  const value = hint.trim();
  return /^agent:[A-Za-z0-9._-]+$/.test(value) || /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

export function readStructuralProposedChange(value: unknown): StructuralProposedChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const field = readRequiredString((value as { field?: unknown }).field);
  const nextValue = readRequiredString((value as { value?: unknown }).value);
  if (field !== "reportingCadence") {
    return null;
  }
  if ((FORBIDDEN_CRON_REPORTING_CADENCE_VALUES as readonly string[]).includes(nextValue)) {
    return null;
  }
  if (!(STRUCTURAL_REPORTING_CADENCE_VALUES as readonly string[]).includes(nextValue)) {
    return null;
  }
  return { field: "reportingCadence", value: nextValue as StructuralReportingCadence };
}

/** Track B may assign `delta: { reportingCadence: proposedChange.value }`. */
export function workingStyleDeltaFromProposedChange(
  change: StructuralProposedChange,
): StructuralWorkingStyleDelta {
  const parsed = readStructuralProposedChange(change);
  if (!parsed) {
    throw new Error("proposed_change");
  }
  return { reportingCadence: parsed.value };
}

export function validateStructuralEvolutionCandidate(
  input: unknown,
): StructuralCandidateValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "candidate_required" };
  }
  const raw = input as Record<string, unknown>;
  for (const key of FORBIDDEN_AUTHORITY_KEYS) {
    if (key in raw) {
      return { ok: false, reason: "authority_field_forbidden" };
    }
  }
  if (raw.schemaVersion !== STRUCTURAL_EVOLUTION_CANDIDATE_SCHEMA_VERSION) {
    return { ok: false, reason: "schema_version" };
  }
  const structuralIntent = typeof raw.structuralIntent === "string" ? raw.structuralIntent : "";
  if (!isStructuralEvolutionIntent(structuralIntent) || isPathAEvolutionPurpose(structuralIntent)) {
    return { ok: false, reason: "structural_intent" };
  }
  const proposedChange = readStructuralProposedChange(raw.proposedChange);
  if (!proposedChange) {
    return { ok: false, reason: "proposed_change" };
  }
  const mechanismRef = readRequiredString(raw.mechanismRef);
  const expectedMechanism = STRUCTURAL_MECHANISM_BY_INTENT[structuralIntent];
  if (!mechanismRef || mechanismRef !== expectedMechanism || mechanismRef.includes("pdr-")) {
    return { ok: false, reason: "mechanism_ref" };
  }
  const surfaceId = readRequiredString(raw.surfaceId);
  if (surfaceId !== STRUCTURAL_WORKING_DNA_SURFACE_ID) {
    return { ok: false, reason: "surface_id" };
  }
  const targetHint = readRequiredString(raw.targetHint);
  const baselineHash = readRequiredString(raw.baselineHash);
  const snapshotRef = readRequiredString(raw.snapshotRef);
  const reportRef = readRequiredString(raw.reportRef);
  const findingRef = readRequiredString(raw.findingRef);
  if (!surfaceId || !baselineHash || !snapshotRef || !findingRef) {
    return { ok: false, reason: "required_field" };
  }
  if (!isParseableStructuralTargetHint(targetHint)) {
    return { ok: false, reason: "target_hint" };
  }
  if (!reportRef || reportRef.startsWith("pdr-")) {
    return { ok: false, reason: "report_ref" };
  }
  const evidenceRefs = Array.isArray(raw.evidenceRefs)
    ? raw.evidenceRefs.filter((row): row is string => typeof row === "string" && row.trim() !== "")
    : [];
  if (evidenceRefs.length === 0 || evidenceRefs.some(isProseDiagnosisEvidenceRef)) {
    return { ok: false, reason: "evidence_refs" };
  }
  const observedWindow = readObservedWindow(raw.observedWindow);
  if (!observedWindow) {
    return { ok: false, reason: "observed_window" };
  }
  const sealed = sealStructuralEvolutionCandidate({
    structuralIntent,
    proposedChange,
    surfaceId,
    targetHint,
    baselineHash,
    evidenceRefs,
    snapshotRef,
    reportRef,
    findingRef,
    observedWindow,
  });
  const payloadHash = readRequiredString(raw.candidatePayloadHash);
  const candidateVersion = readRequiredString(raw.candidateVersion);
  if (payloadHash !== sealed.candidatePayloadHash || candidateVersion !== sealed.candidateVersion) {
    return { ok: false, reason: "payload_hash" };
  }
  return { ok: true, candidate: sealed };
}

export function buildStructuralEvolutionCandidate(
  fact: StructuralPreviewFact,
): StructuralCandidateValidation {
  if (!isStructuralEvolutionIntent(fact.structuralIntent)) {
    return { ok: false, reason: "structural_intent" };
  }
  const proposedChange = readStructuralProposedChange(fact.proposedChange);
  if (!proposedChange) {
    return { ok: false, reason: "proposed_change" };
  }
  if (fact.surfaceId.trim() !== STRUCTURAL_WORKING_DNA_SURFACE_ID) {
    return { ok: false, reason: "surface_id" };
  }
  if (!fact.observationRef.trim()) {
    return { ok: false, reason: "observation_required" };
  }
  if (!fact.baselineHash.trim()) {
    return { ok: false, reason: "baseline_required" };
  }
  if (!isParseableStructuralTargetHint(fact.targetHint)) {
    return { ok: false, reason: "target_hint" };
  }
  if (!fact.reportRef.trim() || fact.reportRef.startsWith("pdr-")) {
    return { ok: false, reason: "report_ref" };
  }
  if (!fact.snapshotRef.trim() || !fact.findingRef.trim()) {
    return { ok: false, reason: "required_field" };
  }
  const evidenceRefs = uniqueRefs([fact.observationRef, ...fact.evidenceRefs]);
  if (evidenceRefs.length === 0 || evidenceRefs.some(isProseDiagnosisEvidenceRef)) {
    return { ok: false, reason: "evidence_refs" };
  }
  const observedWindow = readObservedWindow(fact.observedWindow);
  if (!observedWindow) {
    return { ok: false, reason: "observed_window" };
  }
  return {
    ok: true,
    candidate: sealStructuralEvolutionCandidate({
      structuralIntent: fact.structuralIntent,
      proposedChange,
      surfaceId: fact.surfaceId.trim(),
      targetHint: fact.targetHint.trim(),
      baselineHash: fact.baselineHash.trim(),
      evidenceRefs,
      snapshotRef: fact.snapshotRef.trim(),
      reportRef: fact.reportRef.trim(),
      findingRef: fact.findingRef.trim(),
      observedWindow,
    }),
  };
}

function sealStructuralEvolutionCandidate(input: {
  structuralIntent: StructuralEvolutionIntent;
  proposedChange: StructuralProposedChange;
  surfaceId: string;
  targetHint: string;
  baselineHash: string;
  evidenceRefs: string[];
  snapshotRef: string;
  reportRef: string;
  findingRef: string;
  observedWindow: StructuralObservedWindow;
}): StructuralEvolutionCandidate {
  const candidatePayloadHash = hashCanonical({
    schemaVersion: STRUCTURAL_EVOLUTION_CANDIDATE_SCHEMA_VERSION,
    structuralIntent: input.structuralIntent,
    proposedChange: input.proposedChange,
    mechanismRef: STRUCTURAL_MECHANISM_BY_INTENT[input.structuralIntent],
    surfaceId: input.surfaceId,
    targetHint: input.targetHint,
    baselineHash: input.baselineHash,
  });
  return {
    schemaVersion: STRUCTURAL_EVOLUTION_CANDIDATE_SCHEMA_VERSION,
    mechanismRef: STRUCTURAL_MECHANISM_BY_INTENT[input.structuralIntent],
    surfaceId: input.surfaceId,
    targetHint: input.targetHint,
    baselineHash: input.baselineHash,
    candidatePayloadHash,
    candidateVersion: candidatePayloadHash,
    proposedChange: input.proposedChange,
    evidenceRefs: uniqueRefs(input.evidenceRefs),
    snapshotRef: input.snapshotRef,
    reportRef: input.reportRef,
    findingRef: input.findingRef,
    structuralIntent: input.structuralIntent,
    observedWindow: input.observedWindow,
    cooldownKey: cooldownKeyFor({
      structuralIntent: input.structuralIntent,
      proposedChange: input.proposedChange,
      targetHint: input.targetHint,
      surfaceId: input.surfaceId,
    }),
  };
}

function cooldownKeyFor(input: {
  structuralIntent: StructuralEvolutionIntent;
  proposedChange: StructuralProposedChange;
  targetHint: string;
  surfaceId: string;
}): string {
  return hashCanonical({
    intent: input.structuralIntent,
    proposedChange: input.proposedChange,
    targetHint: input.targetHint.trim(),
    surfaceId: input.surfaceId.trim(),
  }).slice(0, 24);
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function uniqueRefs(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].toSorted();
}

function readRequiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readObservedWindow(value: unknown): StructuralObservedWindow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const startedAt = readRequiredString((value as { startedAt?: unknown }).startedAt);
  const endedAt = readRequiredString((value as { endedAt?: unknown }).endedAt);
  if (!startedAt || !endedAt || Date.parse(startedAt) >= Date.parse(endedAt)) {
    return null;
  }
  return { startedAt, endedAt };
}
