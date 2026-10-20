import type { EvolutionLedgerEvent, EvolutionProposal } from "./types.js";

export const EVOLUTION_EFFECT_PROOFS = ["none", "linked-only", "verified"] as const;
export type EvolutionEffectProof = (typeof EVOLUTION_EFFECT_PROOFS)[number];

const RECEIPT_ONLY_EVENT_TYPES = new Set([
  "application.applied",
  "application.rolled_back",
  "rollback_drill.started",
  "rollback_drill.completed",
  "rollback.started",
  "rollback.completed",
  "legacy.imported",
  "observation.excluded",
  "external_effect.recorded",
]);

export function classifyEvolutionEffectProof(
  proposal: Pick<EvolutionProposal, "status" | "legacy">,
): EvolutionEffectProof {
  if (proposal.status === "VERIFIED" || proposal.status === "PROMOTED") {
    return "verified";
  }
  if (proposal.legacy?.linkedVerificationOnly) {
    return "linked-only";
  }
  return "none";
}

export function ledgerEventIsReceiptNotProof(type: string): boolean {
  return RECEIPT_ONLY_EVENT_TYPES.has(type);
}

export function projectEvolutionLineage(input: {
  proposal: EvolutionProposal;
  events: readonly EvolutionLedgerEvent[];
}): {
  proposalId: string;
  surfaceId: string;
  status: EvolutionProposal["status"];
  effectProof: EvolutionEffectProof;
  steps: Array<{ type: string; receiptOnly: boolean; eventId: string }>;
} {
  return {
    proposalId: input.proposal.proposalId,
    surfaceId: input.proposal.surfaceId,
    status: input.proposal.status,
    effectProof: classifyEvolutionEffectProof(input.proposal),
    steps: input.events.map((event) => ({
      type: event.type,
      receiptOnly: ledgerEventIsReceiptNotProof(event.type),
      eventId: event.eventId,
    })),
  };
}
