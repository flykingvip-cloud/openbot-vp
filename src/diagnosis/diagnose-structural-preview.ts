/**
 * A1 Preview: build StructuralPreviewFact from trusted observation +
 * baseline + real report/finding/evidence/snapshot. Diagnosis never submits.
 */
import {
  buildSkillInstallationCandidate,
  SKILL_INSTALLATION_SURFACE_ID,
  type SkillInstallationPreviewFact,
  type SkillInstallationProposedChange,
} from "./skill-installation-candidate.js";
import {
  buildStructuralEvolutionCandidate,
  isProseDiagnosisEvidenceRef,
  readStructuralProposedChange,
  STRUCTURAL_WORKING_DNA_SURFACE_ID,
  type StructuralObservedWindow,
  type StructuralPreviewFact,
  type StructuralProposedChange,
  type StructuralReportingCadence,
} from "./structural-evolution-candidate.js";

export const STRUCTURAL_PREVIEW_OBSERVATION_KINDS = [
  "task_result",
  "operational_metric",
  "pattern_observation",
] as const;
export type StructuralPreviewObservationKind =
  (typeof STRUCTURAL_PREVIEW_OBSERVATION_KINDS)[number];

export type TrustedStructuralObservation = {
  kind: StructuralPreviewObservationKind;
  observationRef: string;
  proposedChange: StructuralProposedChange;
};

export type TrustedStructuralBaseline = {
  baselineHash: string;
  reportingCadence: StructuralReportingCadence;
};

export type StructuralPreviewTrustInput = {
  observation: TrustedStructuralObservation;
  baseline: TrustedStructuralBaseline;
  reportRef: string;
  findingRef: string;
  evidenceRefs: string[];
  snapshotRef: string;
  targetHint: string;
  observedWindow: StructuralObservedWindow;
  surfaceId?: string;
};

export function isStructuralPreviewObservationKind(
  value: string,
): value is StructuralPreviewObservationKind {
  return (STRUCTURAL_PREVIEW_OBSERVATION_KINDS as readonly string[]).includes(value);
}

/**
 * Returns a preview fact only when observation, baseline, and real
 * report/finding/evidence/snapshot all validate. Returns null on any gap
 * or when proposedChange matches the current baseline (no structural delta).
 */
export function buildStructuralPreviewFact(
  input: StructuralPreviewTrustInput,
): StructuralPreviewFact | null {
  if (!isStructuralPreviewObservationKind(input.observation.kind)) {
    return null;
  }
  const observationRef = input.observation.observationRef.trim();
  if (!observationRef || isProseDiagnosisEvidenceRef(observationRef)) {
    return null;
  }
  const baselineHash = input.baseline.baselineHash.trim();
  if (!baselineHash) {
    return null;
  }
  const proposedChange = readStructuralProposedChange(input.observation.proposedChange);
  if (!proposedChange) {
    return null;
  }
  if (proposedChange.value === input.baseline.reportingCadence) {
    return null;
  }
  const evidenceRefs = uniqueRefs([observationRef, ...input.evidenceRefs]);
  const fact: StructuralPreviewFact = {
    structuralIntent: "adjust_reporting_cadence",
    proposedChange,
    surfaceId: input.surfaceId?.trim() || STRUCTURAL_WORKING_DNA_SURFACE_ID,
    targetHint: input.targetHint,
    baselineHash,
    observationRef,
    evidenceRefs,
    snapshotRef: input.snapshotRef,
    reportRef: input.reportRef,
    findingRef: input.findingRef,
    observedWindow: input.observedWindow,
  };
  const built = buildStructuralEvolutionCandidate(fact);
  return built.ok ? fact : null;
}

function uniqueRefs(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export const SKILL_INSTALLATION_PREVIEW_OBSERVATION_KINDS = ["explicit_install_intent"] as const;
export type SkillInstallationPreviewObservationKind =
  (typeof SKILL_INSTALLATION_PREVIEW_OBSERVATION_KINDS)[number];

export type TrustedSkillInstallationObservation = {
  kind: SkillInstallationPreviewObservationKind;
  observationRef: string;
  proposedChange: SkillInstallationProposedChange;
};

export type TrustedSkillInstallationBaseline = {
  baselineHash: string;
  skillId: string;
  installed: boolean;
};

export type SkillInstallationPreviewTrustInput = {
  observation: TrustedSkillInstallationObservation;
  baseline: TrustedSkillInstallationBaseline;
  reportRef: string;
  findingRef: string;
  evidenceRefs: string[];
  snapshotRef: string;
  targetHint: string;
  observedWindow: StructuralObservedWindow;
  surfaceId?: string;
};

export function buildSkillInstallationPreviewFact(
  input: SkillInstallationPreviewTrustInput,
): SkillInstallationPreviewFact | null {
  if (input.observation.kind !== "explicit_install_intent") {
    return null;
  }
  const observationRef = input.observation.observationRef.trim();
  if (!observationRef || isProseDiagnosisEvidenceRef(observationRef)) {
    return null;
  }
  if (!input.baseline.baselineHash.trim()) {
    return null;
  }
  if (input.baseline.installed) {
    return null;
  }
  const proposedChange = input.observation.proposedChange;
  if (proposedChange.skillId.trim() !== input.baseline.skillId.trim()) {
    return null;
  }
  const fact: SkillInstallationPreviewFact = {
    structuralIntent: "install_existing_skill",
    proposedChange,
    surfaceId: input.surfaceId?.trim() || SKILL_INSTALLATION_SURFACE_ID,
    targetHint: input.targetHint,
    baselineHash: input.baseline.baselineHash.trim(),
    observationRef,
    evidenceRefs: uniqueRefs([observationRef, ...input.evidenceRefs]),
    snapshotRef: input.snapshotRef,
    reportRef: input.reportRef,
    findingRef: input.findingRef,
    observedWindow: input.observedWindow,
    installed: input.baseline.installed,
  };
  const built = buildSkillInstallationCandidate(fact);
  return built.ok ? fact : null;
}
