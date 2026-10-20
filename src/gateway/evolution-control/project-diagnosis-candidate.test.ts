import type { EvolutionExperiment, EvolutionProposal } from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import {
  attachDiagnosisEvolutionProjection,
  overlayDiagnosisReportLiveStatus,
  projectDiagnosisCandidateStatus,
  type DiagnosisCandidateStatusReadPorts,
} from "./project-diagnosis-candidate.js";
import { createMemoryDiagnosisSubmitPorts } from "./submit-diagnosis-candidate.js";

const TENANT = "tenant-a";
const VERSION = "a".repeat(64);
const PROPOSAL_ID = "evo:diag:preview-1";

function proposal(over: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: PROPOSAL_ID,
    sourceEvidenceRefs: ["evidence:task-result-1"],
    sourceMechanismRef: "diagnosis.behavior.reporting_cadence_gap",
    target: { domain: "agent", agentId: "bot-2" },
    candidateRef: VERSION,
    surfaceId: "agent.working-dna",
    expectedEffects: [],
    riskLevel: "low",
    confidentialityScope: "enterprise",
    tenantScope: TENANT,
    grantId: "grant-1",
    status: "APPROVED_FOR_EXPERIMENT",
    createdAt: "2026-09-19T12:00:00.000Z",
    expiresAt: "2026-09-26T12:00:00.000Z",
    ...over,
  };
}

function statusPorts(
  seed: EvolutionProposal = proposal(),
  experiments: Map<string, EvolutionExperiment> = new Map(),
): DiagnosisCandidateStatusReadPorts {
  const submit = createMemoryDiagnosisSubmitPorts({
    proposals: [seed],
    wals: [
      {
        commandId: "cmd-1",
        proposalId: seed.proposalId,
        candidateRef: seed.candidateRef,
        surfaceId: seed.surfaceId,
        contentHash: seed.candidateRef,
        tenantScope: TENANT,
        targetKey: "agent:bot-2",
        mechanism: seed.sourceMechanismRef,
        candidateVersion: VERSION,
        grantId: "grant-1",
        state: "committed",
        ledgerEventIds: ["evt-1"],
      },
    ],
  });
  return {
    listProposals: () => submit.listProposals(),
    getProposal: (id) => submit.getProposal(id),
    listWals: () => submit.listWals(),
    getExperiment: (id) => experiments.get(id),
  };
}

describe("projectDiagnosisCandidateStatus", () => {
  it("reads live proposal status and keeps submission ref free of status", () => {
    const ports = statusPorts();
    const projected = projectDiagnosisCandidateStatus({
      tenantId: TENANT,
      candidateVersion: VERSION,
      ports,
    });
    expect(projected.found).toBe(true);
    expect(projected.liveStatus).toBe(ports.getProposal(PROPOSAL_ID)?.status);
    expect(projected.canRequestExperiment).toBe(true);
    expect(projected.requestExperimentHint).toBe("申请开实验");
    expect(projected.submissionRef).toEqual({
      schemaVersion: 1,
      commandId: "cmd-1",
      proposalId: PROPOSAL_ID,
      candidateRef: VERSION,
      surfaceId: "agent.working-dna",
      contentHash: VERSION,
    });
    expect(JSON.stringify(projected.submissionRef)).not.toContain('"status"');
  });

  it("follows a later getProposal status change instead of a copied receipt field", () => {
    const ports = statusPorts();
    const first = projectDiagnosisCandidateStatus({
      tenantId: TENANT,
      candidateVersion: VERSION,
      ports,
    });
    expect(first.liveStatus).toBe("APPROVED_FOR_EXPERIMENT");
    ports.getProposal(PROPOSAL_ID)!.status = "EXPERIMENTING";
    ports.getProposal(PROPOSAL_ID)!.experimentId = "exp-1";
    const second = projectDiagnosisCandidateStatus({
      tenantId: TENANT,
      candidateVersion: VERSION,
      ports,
    });
    expect(second.liveStatus).toBe("EXPERIMENTING");
    expect(second.liveStatus).toBe(ports.getProposal(PROPOSAL_ID)?.status);
    expect(second.canRequestExperiment).toBe(false);
    expect(second.submissionRef).toEqual(first.submissionRef);
  });

  it("hides cross-tenant proposals", () => {
    expect(
      projectDiagnosisCandidateStatus({
        tenantId: "tenant-b",
        candidateVersion: VERSION,
        ports: statusPorts(),
      }),
    ).toMatchObject({ found: false, liveStatus: null, submissionRef: null });
  });

  it("overlays report text with live status and 申请开实验 without writing Apply", () => {
    const ports = statusPorts();
    const preview = `版本：${VERSION}\n状态：preview only · 未提交 · 需确认后提交统一控制面`;
    const overlaid = overlayDiagnosisReportLiveStatus(preview, [
      projectDiagnosisCandidateStatus({
        tenantId: TENANT,
        candidateVersion: VERSION,
        ports,
      }),
    ]);
    expect(overlaid).toContain("状态：APPROVED_FOR_EXPERIMENT · 申请开实验");
    expect(overlaid).not.toContain("需确认后提交统一控制面");
    expect(JSON.stringify(ports)).not.toMatch(/startExperiment|applyWorkingDna/);
  });

  it("attaches projections onto a diagnose payload from professional report candidates", () => {
    const ports = statusPorts();
    const assembled = attachDiagnosisEvolutionProjection({
      tenantId: TENANT,
      ports,
      payload: {
        reportText: `版本：${VERSION}\n状态：preview only · 未提交 · 需确认后提交统一控制面`,
        professionalReport: {
          producer: {
            structuralCandidates: [{ candidateVersion: VERSION }],
            skillInstallationCandidates: [],
          },
        },
      },
    });
    expect(assembled.reportText).toContain("申请开实验");
    expect(assembled.evolutionProjections).toEqual([
      expect.objectContaining({
        found: true,
        liveStatus: "APPROVED_FOR_EXPERIMENT",
        canRequestExperiment: true,
        promotionEligible: false,
      }),
    ]);
  });

  it("does not render VERIFIED as evolution completed", () => {
    const ports = statusPorts(proposal({ status: "VERIFIED" }));
    const preview = `版本：${VERSION}\n状态：preview only · 未提交 · 需确认后提交统一控制面`;
    const overlaid = overlayDiagnosisReportLiveStatus(preview, [
      projectDiagnosisCandidateStatus({
        tenantId: TENANT,
        candidateVersion: VERSION,
        ports,
      }),
    ]);
    expect(overlaid).toContain("无法确认，已停止");
    expect(overlaid).not.toContain("进化完成");
    expect(overlaid).not.toContain("状态：VERIFIED");
  });
});
