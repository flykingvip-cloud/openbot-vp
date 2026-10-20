/**
 * Read-only skill-installation preview DTO.
 * Diagnosis emits this object. Track B may map
 * `{ skillId: proposedChange.skillId, operation: "install", candidateVersion }`.
 * This module must not import gateway/evolution-control or evolution-core.
 */
import { createHash } from "node:crypto";
import {
  isParseableStructuralTargetHint,
  isPathAEvolutionPurpose,
  isProseDiagnosisEvidenceRef,
  type StructuralObservedWindow,
} from "./structural-evolution-candidate.js";

export const SKILL_INSTALLATION_CANDIDATE_SCHEMA_VERSION = 1 as const;
export const SKILL_INSTALLATION_SURFACE_ID = "capability.skill-installation" as const;
export const SKILL_SPEC_SURFACE_ID = "capability.skill-spec" as const;

export const SKILL_INSTALLATION_INTENTS = ["install_existing_skill"] as const;
export type SkillInstallationIntent = (typeof SKILL_INSTALLATION_INTENTS)[number];

export const SKILL_INSTALLATION_OPERATIONS = ["install"] as const;
export type SkillInstallationOperation = (typeof SKILL_INSTALLATION_OPERATIONS)[number];

export const SKILL_INSTALLATION_MECHANISM_BY_INTENT = {
  install_existing_skill: "diagnosis.capability.skill_installation_intent",
} as const;

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

export type SkillInstallationProposedChange = {
  field: "skillId";
  operation: SkillInstallationOperation;
  skillId: string;
};

export type SkillInstallationCandidate = {
  schemaVersion: typeof SKILL_INSTALLATION_CANDIDATE_SCHEMA_VERSION;
  mechanismRef: string;
  surfaceId: string;
  targetHint: string;
  baselineHash: string;
  candidatePayloadHash: string;
  candidateVersion: string;
  proposedChange: SkillInstallationProposedChange;
  evidenceRefs: string[];
  snapshotRef: string;
  reportRef: string;
  findingRef: string;
  structuralIntent: SkillInstallationIntent;
  observedWindow: StructuralObservedWindow;
  cooldownKey: string;
};

export type SkillInstallationPreviewFact = {
  structuralIntent: SkillInstallationIntent;
  proposedChange: SkillInstallationProposedChange;
  surfaceId: string;
  targetHint: string;
  baselineHash: string;
  observationRef: string;
  evidenceRefs: string[];
  snapshotRef: string;
  reportRef: string;
  findingRef: string;
  observedWindow: StructuralObservedWindow;
  installed: boolean;
};

export type SkillInstallationValidation =
  | { ok: true; candidate: SkillInstallationCandidate }
  | { ok: false; reason: string };

export function isSkillInstallationIntent(value: string): value is SkillInstallationIntent {
  return (SKILL_INSTALLATION_INTENTS as readonly string[]).includes(value);
}

export function isExistingSkillId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.trim());
}

export function skillInstallationBaselineHash(skillId: string, installed: boolean): string {
  return createHash("sha256")
    .update(`skill-install:${skillId.trim()}:${installed ? "1" : "0"}`)
    .digest("hex");
}

export function readSkillInstallationProposedChange(
  value: unknown,
): SkillInstallationProposedChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as { field?: unknown; operation?: unknown; skillId?: unknown; value?: unknown };
  const field = typeof raw.field === "string" ? raw.field.trim() : "";
  const operation = typeof raw.operation === "string" ? raw.operation.trim() : "";
  const skillId =
    typeof raw.skillId === "string"
      ? raw.skillId.trim()
      : typeof raw.value === "string"
        ? raw.value.trim()
        : "";
  if (field !== "skillId" || operation !== "install" || !isExistingSkillId(skillId)) {
    return null;
  }
  return { field: "skillId", operation: "install", skillId };
}

/** Track B may assign `{ skillId, operation: "install" }`. */
export function skillInstallDeltaFromProposedChange(change: SkillInstallationProposedChange): {
  skillId: string;
  operation: "install";
} {
  const parsed = readSkillInstallationProposedChange(change);
  if (!parsed) {
    throw new Error("proposed_change");
  }
  return { skillId: parsed.skillId, operation: "install" };
}

export function validateSkillInstallationCandidate(input: unknown): SkillInstallationValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "candidate_required" };
  }
  const raw = input as Record<string, unknown>;
  for (const key of FORBIDDEN_AUTHORITY_KEYS) {
    if (key in raw) {
      return { ok: false, reason: "authority_field_forbidden" };
    }
  }
  if (raw.schemaVersion !== SKILL_INSTALLATION_CANDIDATE_SCHEMA_VERSION) {
    return { ok: false, reason: "schema_version" };
  }
  const structuralIntent = typeof raw.structuralIntent === "string" ? raw.structuralIntent : "";
  if (!isSkillInstallationIntent(structuralIntent) || isPathAEvolutionPurpose(structuralIntent)) {
    return { ok: false, reason: "structural_intent" };
  }
  const proposedChange = readSkillInstallationProposedChange(raw.proposedChange);
  if (!proposedChange) {
    return { ok: false, reason: "proposed_change" };
  }
  const mechanismRef = typeof raw.mechanismRef === "string" ? raw.mechanismRef.trim() : "";
  const expected = SKILL_INSTALLATION_MECHANISM_BY_INTENT[structuralIntent];
  if (!mechanismRef || mechanismRef !== expected || mechanismRef.includes("pdr-")) {
    return { ok: false, reason: "mechanism_ref" };
  }
  const surfaceId = typeof raw.surfaceId === "string" ? raw.surfaceId.trim() : "";
  if (surfaceId !== SKILL_INSTALLATION_SURFACE_ID) {
    return { ok: false, reason: "surface_id" };
  }
  const targetHint = typeof raw.targetHint === "string" ? raw.targetHint.trim() : "";
  const baselineHash = typeof raw.baselineHash === "string" ? raw.baselineHash.trim() : "";
  const snapshotRef = typeof raw.snapshotRef === "string" ? raw.snapshotRef.trim() : "";
  const reportRef = typeof raw.reportRef === "string" ? raw.reportRef.trim() : "";
  const findingRef = typeof raw.findingRef === "string" ? raw.findingRef.trim() : "";
  if (!baselineHash || !snapshotRef || !findingRef) {
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
  const sealed = sealSkillInstallationCandidate({
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
  const payloadHash = typeof raw.candidatePayloadHash === "string" ? raw.candidatePayloadHash : "";
  const candidateVersion = typeof raw.candidateVersion === "string" ? raw.candidateVersion : "";
  if (payloadHash !== sealed.candidatePayloadHash || candidateVersion !== sealed.candidateVersion) {
    return { ok: false, reason: "payload_hash" };
  }
  return { ok: true, candidate: sealed };
}

export function buildSkillInstallationCandidate(
  fact: SkillInstallationPreviewFact,
): SkillInstallationValidation {
  if (
    !isSkillInstallationIntent(fact.structuralIntent) ||
    isPathAEvolutionPurpose(fact.structuralIntent)
  ) {
    return { ok: false, reason: "structural_intent" };
  }
  const proposedChange = readSkillInstallationProposedChange(fact.proposedChange);
  if (!proposedChange) {
    return { ok: false, reason: "proposed_change" };
  }
  if (fact.surfaceId.trim() !== SKILL_INSTALLATION_SURFACE_ID) {
    return { ok: false, reason: "surface_id" };
  }
  if (fact.installed) {
    return { ok: false, reason: "already_installed" };
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
    candidate: sealSkillInstallationCandidate({
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

function sealSkillInstallationCandidate(input: {
  structuralIntent: SkillInstallationIntent;
  proposedChange: SkillInstallationProposedChange;
  surfaceId: string;
  targetHint: string;
  baselineHash: string;
  evidenceRefs: string[];
  snapshotRef: string;
  reportRef: string;
  findingRef: string;
  observedWindow: StructuralObservedWindow;
}): SkillInstallationCandidate {
  const mechanismRef = SKILL_INSTALLATION_MECHANISM_BY_INTENT[input.structuralIntent];
  const candidatePayloadHash = hashCanonical({
    schemaVersion: SKILL_INSTALLATION_CANDIDATE_SCHEMA_VERSION,
    structuralIntent: input.structuralIntent,
    proposedChange: input.proposedChange,
    mechanismRef,
    surfaceId: input.surfaceId,
    targetHint: input.targetHint,
    baselineHash: input.baselineHash,
  });
  return {
    schemaVersion: SKILL_INSTALLATION_CANDIDATE_SCHEMA_VERSION,
    mechanismRef,
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
    cooldownKey: hashCanonical({
      intent: input.structuralIntent,
      proposedChange: input.proposedChange,
      targetHint: input.targetHint.trim(),
      surfaceId: input.surfaceId.trim(),
    }).slice(0, 24),
  };
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

function readObservedWindow(value: unknown): StructuralObservedWindow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const startedAt =
    typeof (value as { startedAt?: unknown }).startedAt === "string"
      ? (value as { startedAt: string }).startedAt.trim()
      : "";
  const endedAt =
    typeof (value as { endedAt?: unknown }).endedAt === "string"
      ? (value as { endedAt: string }).endedAt.trim()
      : "";
  if (!startedAt || !endedAt || Date.parse(startedAt) >= Date.parse(endedAt)) {
    return null;
  }
  return { startedAt, endedAt };
}
