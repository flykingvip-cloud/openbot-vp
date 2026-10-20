/**
 * Run completion helpers.
 * INCONCLUSIVE is a successful stop: status=completed + completion=INCONCLUSIVE.
 */
import {
  validateDiagnosticRun,
  type DiagnosisCompletion,
  type DiagnosticRun,
  type EvidenceRequirement,
  type TrustedTenantContext,
} from "./types.js";

export function markRunCompleted(
  run: DiagnosticRun,
  completion: DiagnosisCompletion,
  trusted: TrustedTenantContext,
  extras: {
    missingEvidence?: readonly EvidenceRequirement[];
    blockReason?: string;
    budgetSnapshot?: DiagnosticRun["budgetSnapshot"];
    completedAt?: string;
  } = {},
): DiagnosticRun {
  const missingEvidence = extras.missingEvidence ?? run.missingEvidence;
  return validateDiagnosticRun(
    {
      ...run,
      status: "completed",
      completion,
      missingEvidence,
      ...(extras.blockReason ? { blockReason: extras.blockReason } : {}),
      ...(extras.budgetSnapshot ? { budgetSnapshot: extras.budgetSnapshot } : {}),
      completedAt: extras.completedAt ?? run.completedAt ?? run.startedAt,
    },
    trusted,
  );
}

export function markInconclusive(
  run: DiagnosticRun,
  trusted: TrustedTenantContext,
  missingEvidence: readonly EvidenceRequirement[],
  completedAt?: string,
): DiagnosticRun {
  return markRunCompleted(run, "INCONCLUSIVE", trusted, { missingEvidence, completedAt });
}
