import {
  type DiagnosisProposalV1,
  type DiagnosisProposalV1Domain,
  type DiagnosisProposalV1Status,
  type EvolutionProposal,
  type EvolutionProposalStatus,
  type EvolutionTarget,
} from "./types.js";

export const V1_STATUS_TO_V2: Record<DiagnosisProposalV1Status, EvolutionProposalStatus> = {
  SUGGESTED: "SUGGESTED",
  PENDING_APPROVAL: "PENDING_AUTHORITY",
  APPROVED: "APPROVED_FOR_EXPERIMENT",
  APPLIED: "ACTIVE",
  VERIFIED: "ACTIVE",
  ROLLED_BACK: "ROLLED_BACK",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
};

export type DomainTargetHint = {
  agentId?: string;
  assetId?: string;
  skillId?: string;
  groupId?: string;
  componentId?: string;
};

export function mapV1DomainToTarget(
  domain: DiagnosisProposalV1Domain,
  hint: DomainTargetHint = {},
): EvolutionTarget {
  switch (domain) {
    case "agent_working_dna":
      return { domain: "agent", agentId: hint.agentId ?? "unknown" };
    case "collaboration_capsule":
      return { domain: "knowledge", assetId: hint.assetId ?? "unknown" };
    case "skill":
      return { domain: "capability", skillId: hint.skillId ?? "unknown" };
    case "fabric_feedback":
      return { domain: "organization", groupId: hint.groupId ?? "unknown" };
    case "evolution_governance":
      return { domain: "system", componentId: hint.componentId ?? "unknown" };
  }
}

export function mapV1DomainToSurfaceId(domain: DiagnosisProposalV1Domain): string {
  switch (domain) {
    case "agent_working_dna":
      return "agent.working-dna";
    case "collaboration_capsule":
      return "knowledge.experience-capsule";
    case "skill":
      return "capability.skill-spec";
    case "fabric_feedback":
      return "organization.task-routing";
    case "evolution_governance":
      return "system.runtime-binding-governance";
  }
}

export function mapV1StatusToV2(status: DiagnosisProposalV1Status): EvolutionProposalStatus {
  return V1_STATUS_TO_V2[status];
}

export function v1VerificationIsLinkedOnly(status: DiagnosisProposalV1Status): boolean {
  return status === "VERIFIED";
}

export type ProjectDiagnosisProposalInput = {
  proposal: DiagnosisProposalV1;
  targetHint?: DomainTargetHint;
  sourceMechanismRef?: string;
};

/**
 * Read-only projection. Never writes back to the v1 store and never upgrades
 * a v1 linked verification into v2 VERIFIED.
 */
export function projectDiagnosisProposalV1(
  input: ProjectDiagnosisProposalInput,
): EvolutionProposal {
  const { proposal } = input;
  const status = mapV1StatusToV2(proposal.status);
  return {
    schemaVersion: 2,
    proposalId: proposal.proposalId,
    sourceEvidenceRefs: [...proposal.sourceEvidenceRefs],
    sourceMechanismRef:
      input.sourceMechanismRef ??
      proposal.sourceCaseId ??
      proposal.sourceMissionId ??
      proposal.sourceConversationRunId ??
      proposal.auditReceipt,
    target: mapV1DomainToTarget(proposal.targetDomain, input.targetHint),
    candidateRef: proposal.candidateRef ?? `legacy:${proposal.proposalId}`,
    surfaceId: mapV1DomainToSurfaceId(proposal.targetDomain),
    expectedEffects: [
      {
        metricId: "task_success_rate",
        improveWhen: "increase",
        minimumEffect: 0,
      },
    ],
    riskLevel: proposal.riskLevel,
    confidentialityScope: proposal.confidentialityScope,
    tenantScope: proposal.tenantScope,
    grantId: proposal.grantId,
    status,
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
    ...(proposal.applicationRef ? { applicationId: proposal.applicationRef } : {}),
    ...(proposal.verificationRef ? { verificationId: proposal.verificationRef } : {}),
    legacy: {
      schemaVersion: 1,
      targetDomain: proposal.targetDomain,
      status: proposal.status,
      ...(v1VerificationIsLinkedOnly(proposal.status) ? { linkedVerificationOnly: true } : {}),
    },
  };
}

export function assertLegacyImportDoesNotForgeVerification(projected: EvolutionProposal): void {
  if (projected.legacy?.linkedVerificationOnly && projected.status === "VERIFIED") {
    throw new Error("legacy v1 VERIFIED must not project to v2 VERIFIED");
  }
  if (projected.legacy?.status === "APPLIED" && projected.status === "VERIFIED") {
    throw new Error("legacy v1 APPLIED must not project to v2 VERIFIED");
  }
}
