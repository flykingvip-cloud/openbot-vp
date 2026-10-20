/**
 * A3: read live diagnosis-candidate status from control-plane ports.
 * Does not call Gateway RPC, startExperiment, or Apply.
 * EvolutionSubmissionRef stays an immutable identity — no status copy.
 */
import {
  assertEvolutionSubmissionRef,
  type DiagnosisIngestWalRecord,
  type EvolutionExperiment,
  type EvolutionProposal,
  type EvolutionSubmissionRef,
} from "@openbot/evolution-core";
import type { ProfessionalDiagnosisReport } from "../../diagnosis/diagnose-report-text.js";
import { ensureEvolutionControlPlaneStarted } from "./bootstrap.js";
import { resolveDiagnosisCandidateConfirmDeps } from "./confirm-diagnosis-candidate.js";
import {
  lookupDiagnosisM1Closure,
  projectDiagnosisM1Closure,
  type DiagnosisM1Closure,
} from "./diagnosis-m1-status.js";

export const DIAGNOSIS_REQUEST_EXPERIMENT_HINT = "申请开实验" as const;
const PREVIEW_STATUS_LINE = "状态：preview only · 未提交 · 需确认后提交统一控制面";

export type DiagnosisCandidateStatusReadPorts = {
  listProposals(): EvolutionProposal[];
  getProposal(proposalId: string): EvolutionProposal | undefined;
  listWals(): DiagnosisIngestWalRecord[];
  getExperiment(experimentId: string): EvolutionExperiment | undefined;
};

export type DiagnosisCandidateLiveProjection = {
  candidateVersion: string;
  found: boolean;
  liveStatus: string | null;
  experimentId: string | null;
  canRequestExperiment: boolean;
  requestExperimentHint: typeof DIAGNOSIS_REQUEST_EXPERIMENT_HINT;
  submissionRef: EvolutionSubmissionRef | null;
  applicationVerified: boolean;
  diagnosisRecheckOutcome: DiagnosisM1Closure["diagnosisRecheckOutcome"];
  promotionEligible: boolean;
  promotionStatus: DiagnosisM1Closure["promotionStatus"] | null;
  userVisibleStatus: string | null;
};

let statusPortsOverride: DiagnosisCandidateStatusReadPorts | undefined;

export function setDiagnosisCandidateStatusPortsForTests(
  ports?: DiagnosisCandidateStatusReadPorts,
): void {
  statusPortsOverride = ports;
}

export function resolveDiagnosisCandidateStatusPorts(): DiagnosisCandidateStatusReadPorts {
  if (statusPortsOverride) {
    return statusPortsOverride;
  }
  const submit = resolveDiagnosisCandidateConfirmDeps().ports;
  const plane = ensureEvolutionControlPlaneStarted();
  return {
    listProposals() {
      const rows = new Map<string, EvolutionProposal>();
      for (const row of [...submit.listProposals(), ...plane.listProposals()]) {
        rows.set(row.proposalId, row);
      }
      return [...rows.values()];
    },
    getProposal(proposalId) {
      return submit.getProposal(proposalId) ?? plane.getProposal(proposalId);
    },
    listWals() {
      return submit.listWals();
    },
    getExperiment(experimentId) {
      return plane.getExperiment(experimentId);
    },
  };
}

export function projectDiagnosisCandidateStatus(input: {
  tenantId: string;
  candidateVersion: string;
  ports: DiagnosisCandidateStatusReadPorts;
}): DiagnosisCandidateLiveProjection {
  const candidateVersion = input.candidateVersion.trim();
  const empty = missingProjection(candidateVersion);
  if (!candidateVersion || !input.tenantId.trim()) {
    return empty;
  }
  const wal = input.ports
    .listWals()
    .find(
      (row) => row.candidateVersion === candidateVersion || row.candidateRef === candidateVersion,
    );
  const fromWal = wal ? input.ports.getProposal(wal.proposalId) : undefined;
  const listed = fromWal
    ? undefined
    : input.ports.listProposals().find((row) => row.candidateRef === candidateVersion);
  const located = fromWal ?? listed;
  if (!located || located.tenantScope !== input.tenantId) {
    return empty;
  }
  const live = input.ports.getProposal(located.proposalId) ?? located;
  if (live.tenantScope !== input.tenantId) {
    return empty;
  }
  const experiment = live.experimentId ? input.ports.getExperiment(live.experimentId) : undefined;
  let stored: DiagnosisM1Closure | null = null;
  let receiptUnreadable = false;
  try {
    stored = lookupDiagnosisM1Closure({
      tenantId: input.tenantId,
      proposalId: live.proposalId,
    });
  } catch {
    receiptUnreadable = true;
  }
  const closure =
    stored ??
    (live.status === "VERIFIED" || live.status === "PROMOTED" || receiptUnreadable
      ? projectDiagnosisM1Closure({
          applicationVerified: false,
          diagnosisRecheckOutcome: null,
          sotReadable: false,
          completionEvidence: {
            tenantId: input.tenantId,
            target: live.target,
            surfaceId: live.surfaceId,
            candidateVersion,
            proposal: live,
            experiment: null,
            application: null,
            verification: null,
            recheck: null,
            recheckRecordedAt: null,
            evaluation: {
              action: "block",
              reasonCode: receiptUnreadable ? "receipt_unreadable" : "recheck_required",
            },
            authorityOk: false,
            guardrailDegraded: false,
          },
        })
      : null);
  return {
    candidateVersion,
    found: true,
    liveStatus: live.status,
    experimentId: experiment?.experimentId ?? live.experimentId ?? null,
    canRequestExperiment: live.status === "APPROVED_FOR_EXPERIMENT" && !live.experimentId,
    requestExperimentHint: DIAGNOSIS_REQUEST_EXPERIMENT_HINT,
    submissionRef: wal ? submissionRefFromWal(wal) : null,
    applicationVerified: closure?.applicationVerified ?? false,
    diagnosisRecheckOutcome: closure?.diagnosisRecheckOutcome ?? null,
    promotionEligible: closure?.promotionEligible ?? false,
    promotionStatus: closure?.promotionStatus ?? null,
    userVisibleStatus: closure?.userVisibleStatus ?? null,
  };
}

export function overlayDiagnosisReportLiveStatus(
  reportText: string,
  projections: readonly DiagnosisCandidateLiveProjection[],
): string {
  let text = reportText;
  for (const row of projections) {
    if (!row.found || !row.liveStatus) {
      continue;
    }
    const versionLine = `版本：${row.candidateVersion}`;
    const statusLabel = row.userVisibleStatus ?? row.liveStatus;
    const liveLine = row.canRequestExperiment
      ? `状态：${statusLabel} · ${row.requestExperimentHint}`
      : row.experimentId
        ? `状态：${statusLabel} · 实验 ${row.experimentId}`
        : `状态：${statusLabel}`;
    text = text.replace(`${versionLine}\n${PREVIEW_STATUS_LINE}`, `${versionLine}\n${liveLine}`);
  }
  return text;
}

export function attachDiagnosisEvolutionProjection(input: {
  tenantId: string;
  payload: Record<string, unknown>;
  ports: DiagnosisCandidateStatusReadPorts;
}): Record<string, unknown> {
  const versions = candidateVersionsFromPayload(input.payload);
  const projections = versions.map((candidateVersion) =>
    projectDiagnosisCandidateStatus({
      tenantId: input.tenantId,
      candidateVersion,
      ports: input.ports,
    }),
  );
  const reportText =
    typeof input.payload.reportText === "string"
      ? overlayDiagnosisReportLiveStatus(input.payload.reportText, projections)
      : input.payload.reportText;
  return {
    ...input.payload,
    reportText,
    evolutionProjections: projections,
  };
}

function candidateVersionsFromPayload(payload: Record<string, unknown>): string[] {
  const report = payload.professionalReport as ProfessionalDiagnosisReport | undefined;
  const producer = report?.producer;
  if (!producer) {
    return [];
  }
  return [
    ...(producer.structuralCandidates ?? []).map((row) => row.candidateVersion),
    ...(producer.skillInstallationCandidates ?? []).map((row) => row.candidateVersion),
  ].filter((value) => value.trim() !== "");
}

function submissionRefFromWal(wal: DiagnosisIngestWalRecord): EvolutionSubmissionRef {
  return assertEvolutionSubmissionRef({
    schemaVersion: 1,
    commandId: wal.commandId,
    proposalId: wal.proposalId,
    candidateRef: wal.candidateRef,
    surfaceId: wal.surfaceId,
    contentHash: wal.contentHash,
  });
}

function missingProjection(candidateVersion: string): DiagnosisCandidateLiveProjection {
  return {
    candidateVersion,
    found: false,
    liveStatus: null,
    experimentId: null,
    canRequestExperiment: false,
    requestExperimentHint: DIAGNOSIS_REQUEST_EXPERIMENT_HINT,
    submissionRef: null,
    applicationVerified: false,
    diagnosisRecheckOutcome: null,
    promotionEligible: false,
    promotionStatus: null,
    userVisibleStatus: null,
  };
}
