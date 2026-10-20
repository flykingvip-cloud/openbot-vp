import { describe, expect, it } from "vitest";
import {
  classifyEvolutionEffectProof,
  ledgerEventIsReceiptNotProof,
  projectEvolutionLineage,
} from "./lineage.js";
import type { EvolutionLedgerEvent, EvolutionProposal } from "./types.js";

function proposal(over: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "evo:1",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "case",
    target: { domain: "agent", agentId: "bot-1" },
    candidateRef: "cand:1",
    surfaceId: "agent.working-dna",
    expectedEffects: [],
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    tenantScope: "tenant-a",
    grantId: "grant-1",
    status: "ACTIVE",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-06T12:00:00.000Z",
    ...over,
  };
}

describe("evolution lineage", () => {
  it("does not treat receipts or linked v1 verification as effect proof", () => {
    expect(classifyEvolutionEffectProof(proposal({ status: "VERIFIED" }))).toBe("verified");
    expect(
      classifyEvolutionEffectProof(
        proposal({
          status: "ACTIVE",
          legacy: {
            schemaVersion: 1,
            targetDomain: "agent_working_dna",
            status: "VERIFIED",
            linkedVerificationOnly: true,
          },
        }),
      ),
    ).toBe("linked-only");
    expect(ledgerEventIsReceiptNotProof("application.applied")).toBe(true);
    expect(ledgerEventIsReceiptNotProof("application.rolled_back")).toBe(true);
    expect(ledgerEventIsReceiptNotProof("rollback_drill.completed")).toBe(true);
    expect(ledgerEventIsReceiptNotProof("verification.completed")).toBe(false);
    expect(ledgerEventIsReceiptNotProof("observation.excluded")).toBe(true);
    expect(ledgerEventIsReceiptNotProof("external_effect.recorded")).toBe(true);
    const lineage = projectEvolutionLineage({
      proposal: proposal({ status: "CANARY" }),
      events: [
        { eventId: "e1", type: "application.applied" },
        { eventId: "e2", type: "verification.completed" },
      ] as EvolutionLedgerEvent[],
    });
    expect(lineage.effectProof).toBe("none");
    expect(lineage.steps[0]?.receiptOnly).toBe(true);
    expect(lineage.steps[1]?.receiptOnly).toBe(false);
  });
});
