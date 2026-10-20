import { workingDnaMetricSet } from "@openbot/evolution-core";
import type { EvolutionProposal } from "@openbot/evolution-core";
import type { OpenBotConfig } from "../../config/config.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import { readRobotWorkingStyleOrDefault } from "../agent-growth/working-style-store.js";
import type { WorkingDnaCandidate } from "../evolution-control/adapters/working-dna.js";
import type { EvolutionControlPlane } from "../evolution-control/control-plane.js";
import { getSharedDiagnosisDelegationMachine } from "../evolution-control/delegation-service.js";
import {
  assertEvolutionGrantBinding,
  parseEvolutionGrantPurpose,
} from "../evolution-control/evolution-grant.js";
import { readEvolutionObservationAudits } from "../evolution-control/observation-audit.js";
import { getPatternCandidate } from "./store.js";

export type ProposeWorkingDnaInput = {
  commandId: string;
  tenantId: string;
  agentId: string;
  grantId: string;
  runId: string;
  evidenceRefs: string[];
  candidateId?: string;
  persistDir?: string;
  cfg: OpenBotConfig;
  plane: EvolutionControlPlane;
  expiresAt?: string;
};

export type ProposeWorkingDnaResult = {
  proposal: EvolutionProposal;
  candidateRef: string;
  skipped?: false;
};

export type ProposeWorkingDnaSkipped = {
  skipped: true;
  reason: string;
};

function deriveWorkingDnaDelta(input: {
  successRate: number | null;
}): Partial<typeof DEFAULT_WORKING_STYLE> {
  if (input.successRate !== null && input.successRate < 0.6) {
    return { riskPreference: "conservative" };
  }
  return { reportingCadence: "milestone" };
}

export async function proposeWorkingDnaFromObservation(
  input: ProposeWorkingDnaInput,
): Promise<ProposeWorkingDnaResult | ProposeWorkingDnaSkipped> {
  const machine = getSharedDiagnosisDelegationMachine(input.persistDir);
  const grant = machine.getGrant(input.grantId);
  if (!grant) {
    throw new Error("linked grant is missing");
  }
  const binding = assertEvolutionGrantBinding({
    grant,
    tenantId: input.tenantId,
    agentId: input.agentId,
  });
  if (!binding.ok) {
    throw new Error(binding.reason);
  }
  const metadata = parseEvolutionGrantPurpose(grant.purpose);
  if (!metadata) {
    throw new Error("grant is not an evolution working-dna grant");
  }

  const observations = readEvolutionObservationAudits(input.persistDir).filter(
    (row) =>
      row.runId === input.runId && row.agentId === input.agentId && row.tenantId === input.tenantId,
  );
  if (observations.length === 0) {
    return { skipped: true, reason: "no observation for runId" };
  }

  let successRate: number | null = null;
  if (input.candidateId) {
    const candidate = getPatternCandidate(input.candidateId);
    if (!candidate || candidate.agentId !== input.agentId) {
      return { skipped: true, reason: "pattern candidate not found for agent" };
    }
    if (candidate.tenantId && candidate.tenantId !== input.tenantId) {
      throw new Error("pattern candidate tenant mismatch");
    }
    successRate = candidate.contract.quality.successRate;
  }

  const proposalId = `evo:wdna:${input.runId}`;
  const candidateRef = `cand:wdna:${input.runId}`;
  const baselineStyle = await readRobotWorkingStyleOrDefault(input.cfg, input.agentId);
  const delta = deriveWorkingDnaDelta({ successRate });
  if (Object.keys(delta).length === 0) {
    return { skipped: true, reason: "no eligible working-dna delta from signal" };
  }

  const metrics = workingDnaMetricSet();
  const proposal: EvolutionProposal = {
    schemaVersion: 2,
    proposalId,
    sourceEvidenceRefs: input.evidenceRefs,
    sourceMechanismRef: `obs:${input.runId}`,
    target: { domain: "agent", agentId: input.agentId },
    candidateRef,
    expectedEffects: [metrics.primary, ...metrics.guardrails],
    riskLevel: "medium",
    surfaceId: "agent.working-dna",
    tenantScope: input.tenantId,
    confidentialityScope: "enterprise",
    status: "APPROVED_FOR_EXPERIMENT",
    grantId: input.grantId,
    createdAt: new Date().toISOString(),
    expiresAt: input.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString(),
  };

  const candidatePayload: WorkingDnaCandidate = {
    agentId: input.agentId,
    delta,
    baselineStyle,
    candidateVersion: candidateRef,
  };

  input.plane.registerProposal(proposal, candidatePayload);
  return { proposal, candidateRef };
}
