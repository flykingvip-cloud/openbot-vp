/**
 * Diagnosis candidate preview. Zero writes: no WAL, Proposal, Candidate, or Ledger.
 * Live diagnose auto-submit is not wired here.
 */
import {
  validateSkillInstallationCandidate,
  type SkillInstallationCandidate,
} from "../../diagnosis/skill-installation-candidate.js";
import {
  validateStructuralEvolutionCandidate,
  type StructuralEvolutionCandidate,
} from "../../diagnosis/structural-evolution-candidate.js";

export type DiagnosisPreviewCandidate = StructuralEvolutionCandidate | SkillInstallationCandidate;

export type DiagnosisPreviewResult =
  | { ok: true; candidate: DiagnosisPreviewCandidate; writes: readonly [] }
  | { ok: false; reason: string; writes: readonly [] };

export function previewDiagnosisCandidate(input: unknown): DiagnosisPreviewResult {
  const validated = looksLikeSkillInstallationCandidate(input)
    ? validateSkillInstallationCandidate(input)
    : validateStructuralEvolutionCandidate(input);
  if (!validated.ok) {
    return { ok: false, reason: validated.reason, writes: [] };
  }
  return { ok: true, candidate: validated.candidate, writes: [] };
}

export function looksLikeSkillInstallationCandidate(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  const raw = input as { surfaceId?: unknown; structuralIntent?: unknown };
  return (
    raw.surfaceId === "capability.skill-installation" ||
    raw.structuralIntent === "install_existing_skill"
  );
}
