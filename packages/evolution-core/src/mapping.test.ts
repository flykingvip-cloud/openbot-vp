import { describe, expect, it } from "vitest";
import {
  assertLegacyImportDoesNotForgeVerification,
  mapV1StatusToV2,
  projectDiagnosisProposalV1,
} from "./mapping.js";
import type { DiagnosisProposalV1 } from "./types.js";

function v1(over: Partial<DiagnosisProposalV1> = {}): DiagnosisProposalV1 {
  return {
    schemaVersion: 1,
    proposalId: "evo:fixture",
    sourceFindingIds: ["f-1"],
    sourceEvidenceRefs: ["ev-a"],
    tenantScope: "tenant-a",
    targetDomain: "agent_working_dna",
    proposedChange: { summary: "tune working DNA" },
    expectedEffect: "raise task success",
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    status: "SUGGESTED",
    approvalRequired: true,
    approverScope: "enterprise",
    grantId: "grant-1",
    createdAt: "2026-09-06T00:00:00.000Z",
    expiresAt: "2026-09-06T01:00:00.000Z",
    auditReceipt: "aud:evo:fixture",
    candidateRef: "cand:evo:fixture",
    ...over,
  };
}

describe("v1 to v2 proposal projection", () => {
  it("maps v1 domains onto v2 targets without writing back", () => {
    const projected = projectDiagnosisProposalV1({
      proposal: v1(),
      targetHint: { agentId: "dna-bot" },
    });
    expect(projected.schemaVersion).toBe(2);
    expect(projected.target).toEqual({ domain: "agent", agentId: "dna-bot" });
    expect(projected.surfaceId).toBe("agent.working-dna");
    expect(projected.legacy?.schemaVersion).toBe(1);
    expect(projected.legacy?.targetDomain).toBe("agent_working_dna");
  });

  it("maps APPROVED to APPROVED_FOR_EXPERIMENT, not application", () => {
    expect(mapV1StatusToV2("APPROVED")).toBe("APPROVED_FOR_EXPERIMENT");
    expect(mapV1StatusToV2("APPLIED")).toBe("ACTIVE");
  });

  it("never upgrades v1 linked VERIFIED into v2 VERIFIED", () => {
    const projected = projectDiagnosisProposalV1({
      proposal: v1({ status: "VERIFIED", verificationRef: "ver:cmd" }),
    });
    expect(projected.status).toBe("ACTIVE");
    expect(projected.legacy?.linkedVerificationOnly).toBe(true);
    expect(() => assertLegacyImportDoesNotForgeVerification(projected)).not.toThrow();
  });

  it("never upgrades v1 APPLIED into v2 VERIFIED", () => {
    const projected = projectDiagnosisProposalV1({
      proposal: v1({ status: "APPLIED", applicationRef: "app:cmd" }),
    });
    expect(projected.status).toBe("ACTIVE");
    expect(projected.status).not.toBe("VERIFIED");
  });
});
