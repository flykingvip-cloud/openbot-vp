import {
  projectDiagnosisProposalV1,
  type DomainTargetHint,
  type EvolutionProposal,
} from "@openbot/evolution-core";
import type { EvolutionProposal as DiagnosisProposalV1 } from "../../diagnosis/evolution-proposal.js";

export function projectDiagnosisProposal(
  proposal: DiagnosisProposalV1,
  targetHint?: DomainTargetHint,
): EvolutionProposal {
  return projectDiagnosisProposalV1({ proposal, targetHint });
}

export type EvolutionProposalIndex = {
  ingestV1(proposal: DiagnosisProposalV1, targetHint?: DomainTargetHint): EvolutionProposal;
  put(proposal: EvolutionProposal): void;
  get(proposalId: string): EvolutionProposal | undefined;
  list(filter?: { tenantScope?: string | null; surfaceId?: string }): EvolutionProposal[];
};

export function createMemoryEvolutionProposalIndex(): EvolutionProposalIndex {
  const rows = new Map<string, EvolutionProposal>();
  return {
    ingestV1(proposal, targetHint) {
      const projected = projectDiagnosisProposal(proposal, targetHint);
      rows.set(projected.proposalId, projected);
      return projected;
    },
    put(proposal) {
      rows.set(proposal.proposalId, proposal);
    },
    get(proposalId) {
      return rows.get(proposalId);
    },
    list(filter) {
      return [...rows.values()].filter((row) => {
        if (filter && "tenantScope" in filter && row.tenantScope !== filter.tenantScope) {
          return false;
        }
        if (filter?.surfaceId && row.surfaceId !== filter.surfaceId) {
          return false;
        }
        return true;
      });
    },
  };
}
