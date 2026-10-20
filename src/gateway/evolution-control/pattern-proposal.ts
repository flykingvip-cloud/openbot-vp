import { skillMetricSet } from "@openbot/evolution-core";
import type { PatternCandidate } from "../pattern-detection/types.js";
import { ensureEvolutionControlPlaneStarted } from "./bootstrap.js";

const HEX16 = /^[0-9a-f]{16}$/;

export function registerNamedPatternCandidateProposal(candidate: PatternCandidate): void {
  const named = [
    ...new Set(
      candidate.contract.toolsRequired
        .map((name) => name.trim())
        .filter((name) => name && !HEX16.test(name)),
    ),
  ];
  if (named.length === 0) {
    return;
  }
  const plane = ensureEvolutionControlPlaneStarted();
  const proposalId = `evo:pattern:${candidate.candidateId}`;
  if (plane.getProposal(proposalId)) {
    return;
  }
  const now = new Date();
  plane.registerProposal(
    {
      schemaVersion: 2,
      proposalId,
      sourceEvidenceRefs: candidate.sampleIds.slice(0, 8),
      sourceMechanismRef: "pattern-detection",
      target: { domain: "capability", skillId: candidate.candidateId },
      candidateRef: `cand:pattern:${candidate.candidateId}`,
      surfaceId: "capability.skill-spec",
      expectedEffects: [skillMetricSet().primary],
      riskLevel: "low",
      confidentialityScope: "enterprise",
      tenantScope: candidate.tenantId,
      grantId: "grant:pattern-observe",
      status: "DISCOVERED",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      skillId: candidate.candidateId,
      toolsRequired: named,
      operation: "observe",
    },
  );
}
