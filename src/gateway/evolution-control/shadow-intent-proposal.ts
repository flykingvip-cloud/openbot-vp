import { createHash } from "node:crypto";
import {
  runtimeGovernanceMetricSet,
  skillMetricSet,
  type ConsumptionIntent,
  type StoredConsumptionCandidate,
} from "@openbot/evolution-core";
import type { ControlPlaneIntentRegistrar } from "../evolution-governance/control-plane-intent-registration.js";
import type { EvolutionControlPlane } from "./control-plane.js";

const PROPOSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function semanticCommandId(commandId: string): string {
  return commandId.trim().replace(/:\d{4}-\d{2}-\d{2}$/, "");
}

function stableId(intent: ConsumptionIntent, commandId: string): string {
  const commandKey = intent.kind === "runtime-action" ? semanticCommandId(commandId) : "install";
  const semanticIntent =
    intent.kind === "runtime-action"
      ? {
          kind: intent.kind,
          surfaceId: intent.surfaceId,
          runtimeAgentId: intent.runtimeAgentId,
          action: intent.action,
          tenantScope: intent.tenantScope,
        }
      : {
          kind: intent.kind,
          surfaceId: intent.surfaceId,
          agentId: intent.agentId,
          skillId: intent.skillId,
          operation: "install",
          tenantScope: intent.tenantScope,
        };
  return createHash("sha256")
    .update(JSON.stringify({ intent: semanticIntent, commandKey }))
    .digest("hex")
    .slice(0, 24);
}

function candidatePayload(intent: ConsumptionIntent, candidateRef: string): unknown {
  if (intent.kind === "runtime-action") {
    return {
      kind: "runtime-action",
      runtimeAgentId: intent.runtimeAgentId,
      action: intent.action,
      candidateVersion: candidateRef,
    };
  }
  return {
    skillId: intent.skillId,
    agentId: intent.agentId,
    operation: "install",
    candidateVersion: candidateRef,
    autoInstallIntent: true,
    approvalAuditRef: intent.approvalAuditRef,
  };
}

function storedCandidate(
  plane: EvolutionControlPlane,
  candidateRef: string,
): StoredConsumptionCandidate | null {
  const stored = plane.getCandidate(candidateRef);
  return stored
    ? {
        candidateRef: stored.candidateRef,
        version: stored.version,
        payloadHash: stored.payloadHash,
        payload: stored.payload,
      }
    : null;
}

function expiresAt(recordedAt: string): string {
  return new Date(Date.parse(recordedAt) + PROPOSAL_TTL_MS).toISOString();
}

/** Register a stable DISCOVERED proposal; never authorize, experiment, or Apply. */
export function createShadowIntentProposalRegistrar(
  plane: EvolutionControlPlane,
): ControlPlaneIntentRegistrar {
  return (input) => {
    const id = stableId(input.intent, input.commandId);
    const proposalId = `evo:shadow-intent:${id}`;
    const candidateRef = `cand:shadow-intent:${id}`;
    let proposal = plane.getProposal(proposalId);
    if (
      proposal?.status === "DISCOVERED" &&
      Date.parse(proposal.expiresAt) <= Date.parse(input.recordedAt)
    ) {
      proposal = plane.stageDiagnosisProposal({
        ...proposal,
        sourceEvidenceRefs: [
          ...new Set([...proposal.sourceEvidenceRefs, `shadow:${input.commandId}`]),
        ].slice(-8),
        expiresAt: expiresAt(input.recordedAt),
      });
      plane.registerCandidate(
        proposal.candidateRef,
        candidatePayload(input.intent, proposal.candidateRef),
      );
    }
    if (!proposal) {
      const metrics =
        input.intent.kind === "runtime-action" ? runtimeGovernanceMetricSet() : skillMetricSet();
      proposal = plane.registerProposal(
        {
          schemaVersion: 2,
          proposalId,
          sourceEvidenceRefs: [`shadow:${input.commandId}`],
          sourceMechanismRef: `assist-shadow:${input.intent.kind}`,
          target:
            input.intent.kind === "runtime-action"
              ? { domain: "system", componentId: input.intent.runtimeAgentId }
              : { domain: "capability", skillId: input.intent.skillId },
          candidateRef,
          surfaceId: input.intent.surfaceId,
          expectedEffects: [metrics.primary, ...metrics.guardrails],
          riskLevel: input.intent.kind === "runtime-action" ? "critical" : "high",
          confidentialityScope: input.intent.tenantScope ? "enterprise" : "platform",
          tenantScope: input.intent.tenantScope,
          grantId: `grant:pending:${id}`,
          status: "DISCOVERED",
          createdAt: input.recordedAt,
          expiresAt: expiresAt(input.recordedAt),
        },
        candidatePayload(input.intent, candidateRef),
      );
    }
    return {
      proposal,
      experiment: null,
      application: null,
      grant: null,
      storedCandidate: storedCandidate(plane, proposal.candidateRef),
      trustedTenantId: input.intent.tenantScope,
      mode: input.mode,
      killSwitch: input.killSwitch,
      now: input.recordedAt,
      rollbackAvailable: false,
      idempotencyKey: input.commandId.trim(),
      priorConsumption: null,
      intent: {
        ...input.intent,
        candidateVersion: proposal.candidateRef,
        ...(input.intent.kind === "skill-install" ? { version: proposal.candidateRef } : {}),
      },
    };
  };
}
