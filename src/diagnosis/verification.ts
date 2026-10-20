/**
 * Phase 1 Verification writer.
 * Stores governanceReceiptRef only — never a parallel Governance warehouse.
 */
import {
  validateDiagnosticVerification,
  type DiagnosisCompletion,
  type DiagnosticRun,
  type DiagnosticVerification,
} from "./types.js";

export type GovernanceReceiptRef = {
  store: "evolution_governance";
  receiptId: string;
  authority: string;
};

export function createGovernanceReceiptRef(receiptId: string): GovernanceReceiptRef {
  if (!receiptId) {
    throw new Error("governanceReceiptRef.receiptId is required");
  }
  return {
    store: "evolution_governance",
    receiptId,
    authority: "Evolution Governance receipts",
  };
}

/** INCONCLUSIVE is a successful completion: no root cause ⇒ no repair metric. */
export function requireNoVerification(completion: DiagnosisCompletion): null {
  if (completion !== "INCONCLUSIVE") {
    throw new Error("requireNoVerification is only valid for INCONCLUSIVE runs");
  }
  return null;
}

/**
 * Non-INCONCLUSIVE verification is receipt-only.
 * Never copy a fixture graph.verification object.
 * INCONCLUSIVE + receipt stays null (gated in resolveReplayVerification).
 * Known 3.8 sign-off gap, not blocking: BLOCKED / TIMED_OUT + receipt still
 * emit verification. The older comment claimed CONFIRMED/PROBABLE only.
 */
export function verificationForCompletedRun(input: {
  run: Pick<DiagnosticRun, "runId" | "caseId" | "startedAt" | "completedAt" | "targets">;
  receipt: GovernanceReceiptRef;
}): DiagnosticVerification {
  const range = firstTargetTimeRange(input.run) ?? {
    from: input.run.startedAt,
    to: input.run.completedAt ?? input.run.startedAt,
  };
  return attachGovernanceReceipt(
    {
      schemaVersion: 1,
      verificationId: `ver-${input.run.runId}`,
      caseId: input.run.caseId ?? input.run.runId,
      baselineWindow: range,
      observationWindow: range,
      expectedOutcome: {
        metric: "governance_receipt",
        comparator: "present",
        value: 1,
      },
    },
    input.receipt,
  );
}

export function resolveReplayVerification(input: {
  completion: DiagnosisCompletion;
  run: Pick<DiagnosticRun, "runId" | "caseId" | "startedAt" | "completedAt" | "targets">;
  receipt?: GovernanceReceiptRef;
}): DiagnosticVerification | null {
  if (input.completion === "INCONCLUSIVE") {
    return requireNoVerification(input.completion);
  }
  if (!input.receipt) {
    return null;
  }
  return verificationForCompletedRun({ run: input.run, receipt: input.receipt });
}

function firstTargetTimeRange(
  run: Pick<DiagnosticRun, "targets">,
): { from: string; to: string } | undefined {
  for (const target of run.targets) {
    const range = target.scope.timeRange;
    if (range) {
      return range;
    }
  }
  return undefined;
}

export function attachGovernanceReceipt(
  verification: DiagnosticVerification,
  receipt: GovernanceReceiptRef,
): DiagnosticVerification {
  const measured = verification.measuredOutcome ?? {};
  return validateDiagnosticVerification({
    ...verification,
    measuredOutcome: {
      ...measured,
      store: receipt.store,
      authority: receipt.authority,
      authorityRecordId: receipt.receiptId,
    },
  });
}

export function assertNoGovernanceTimeseries(verification: DiagnosticVerification): void {
  const measured = verification.measuredOutcome ?? {};
  for (const key of Object.keys(measured)) {
    if (
      key === "baselineSeries" ||
      key === "windowTimeseries" ||
      key === "governanceState" ||
      key === "effectWindows"
    ) {
      throw new Error(`Verification must not copy Governance warehouse field ${key}`);
    }
  }
}
