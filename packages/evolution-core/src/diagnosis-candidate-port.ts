/**
 * Type-only ingest port. Track A owns StructuralEvolutionCandidate and
 * SkillInstallationCandidate under src/diagnosis.
 *
 * Do not copy those DTOs here. Gateway type-imports the live modules.
 * Preview SHAs c7d7aa54f2 and bb97b44ce6 are not frozen DTOs and must not be consumed.
 */
import type { EvolutionSubmissionRef } from "./evaluation-refs.js";

export const REJECTED_STRUCTURAL_CANDIDATE_PREVIEW_SHAS = ["c7d7aa54f2", "bb97b44ce6"] as const;

export const STRUCTURAL_CANDIDATE_A0_COMMIT_SHA =
  "a4368cfade4e16dd80df0b4a4c843ed338b834c3" as const;
export const STRUCTURAL_CANDIDATE_CONSUMED_FROM_ORIGIN_MAIN =
  "3a01fe0963bee9fb8438e018011785c05348d675" as const;
export const SKILL_INSTALLATION_CANDIDATE_A1_COMMIT_SHA =
  "07b73ad3e23923612f52a9bb6bd2af9ba11d35a6" as const;
export const SKILL_INSTALLATION_CANDIDATE_CONSUMED_FROM_PR = 1204 as const;

export const STRUCTURAL_CANDIDATE_OWNERSHIP = {
  track: "A",
  module: "src/diagnosis/structural-evolution-candidate.ts",
  a0CommitSha: STRUCTURAL_CANDIDATE_A0_COMMIT_SHA,
  consumedFromOriginMain: STRUCTURAL_CANDIDATE_CONSUMED_FROM_ORIGIN_MAIN,
  waitingFor: null,
  rejectedPreviewShas: REJECTED_STRUCTURAL_CANDIDATE_PREVIEW_SHAS,
  schemaVersion: 1,
  dtoExportPath: "src/diagnosis/structural-evolution-candidate.ts",
  growthAssessmentSnapshot: {
    reader: "src/diagnosis/diagnose-growth-snapshot.ts#readGrowthAssessmentSnapshot",
    validator: "src/diagnosis/diagnose-growth-snapshot.ts#validateGrowthAssessmentSnapshot",
  },
} as const;

export const SKILL_INSTALLATION_CANDIDATE_OWNERSHIP = {
  track: "A",
  module: "src/diagnosis/skill-installation-candidate.ts",
  a1CommitSha: SKILL_INSTALLATION_CANDIDATE_A1_COMMIT_SHA,
  consumedFromPr: SKILL_INSTALLATION_CANDIDATE_CONSUMED_FROM_PR,
  consumedFromOriginMain: null,
  waitingFor: null,
  rejectedPreviewShas: REJECTED_STRUCTURAL_CANDIDATE_PREVIEW_SHAS,
  schemaVersion: 1,
  dtoExportPath: "src/diagnosis/skill-installation-candidate.ts",
} as const;

export type StructuralCandidateOwnership = typeof STRUCTURAL_CANDIDATE_OWNERSHIP;
export type SkillInstallationCandidateOwnership = typeof SKILL_INSTALLATION_CANDIDATE_OWNERSHIP;

export type TrustedEvolutionSubmitContext = {
  tenantId: string;
  principalRef: string;
  agentId: string;
  confirmedByUser: boolean;
};

/** Public E1 submit. Does not accept grantActive, targetKnown, or claimedTenantId. */
export type DiagnosisCandidateSubmitInput<TCandidate> = {
  commandId: string;
  candidate: TCandidate;
  trustedContext: TrustedEvolutionSubmitContext;
  grantId: string;
};

/**
 * Gateway-owned submit contract. Implementation lives in
 * src/gateway/evolution-control/submit-diagnosis-candidate.ts.
 */
export type DiagnosisCandidateIngestPort<TCandidate = never> = {
  submit(input: DiagnosisCandidateSubmitInput<TCandidate>): Promise<EvolutionSubmissionRef>;
};

export function structuralCandidateDtoReady(): true {
  return true;
}

export function skillInstallationCandidateDtoReady(): true {
  return true;
}
