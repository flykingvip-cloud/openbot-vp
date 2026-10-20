/**
 * Thin validation record. This is a structured log, not a scoring platform.
 * There is no rule language, weight, or automatic grade beyond equality
 * with a supplied test-site ground truth, or a human verdict copied after
 * the run, its evidence, and its artifact are checked together.
 *
 * A failed or unknown run cannot become promotable just because
 * `humanVerdict` is `passed`. An exception stores independent review
 * evidence and stays non-promotable.
 */

import { SAR_DENIAL_CODE, sarDeny, type SarDenial } from "./codes.js";
import { sameParams } from "./draft-store.js";
import type {
  SiteCompleteness,
  SiteEvidence,
  SiteRunResult,
  SiteRunStatus,
  SiteVerification,
} from "./result.js";

export type ValidationBasis =
  | { kind: "test_site_ground_truth"; expected: unknown }
  | { kind: "human"; statement: string };

export type ValidationVerdict = "passed" | "failed";

/**
 * Audit trail for a human pass that the run itself does not support.
 * Distinct from `humanVerdict`: the evidence ref cannot be the run's evidence.
 */
export type IndependentReviewEvidence = {
  evidenceRef: string;
  statement: string;
  artifactDigest: string;
};

export type ValidationRecord = {
  recordId: string;
  capabilityId: string;
  version: string;
  artifactDigest: string;
  input: Record<string, string>;
  participatedInDraftGeneration: boolean;
  basis: ValidationBasis;
  runId: string;
  evidenceRef: string;
  output: unknown;
  completeness: SiteCompleteness;
  verdict: ValidationVerdict;
  reviewer: string;
  reviewedAt: string;
  reason: string;
  /** Copied from the run. Absent only on records written before this gate. */
  runStatus?: SiteRunStatus;
  /** Copied from the run. `failed` cannot be promoted. */
  runVerification?: SiteVerification;
  /**
   * True only when this record may move a draft to verified-callable.
   * Absent is not a pass. Assess always sets it.
   */
  promotable?: boolean;
  independentReviewEvidence?: IndependentReviewEvidence;
};

export function validationBlocksVerifiedCallable(record: ValidationRecord): boolean {
  if (record.promotable === false) {
    return true;
  }
  if (record.runStatus === "failed" || record.runStatus === "unknown") {
    return true;
  }
  if (record.runVerification === "failed") {
    return true;
  }
  if (record.independentReviewEvidence) {
    return true;
  }
  return record.promotable !== true || record.runStatus !== "succeeded";
}

export class ThinValidationRunner {
  private readonly records = new Map<string, ValidationRecord>();

  constructor(private readonly mintId: () => string) {}

  get(recordId: string): ValidationRecord | undefined {
    const found = this.records.get(recordId);
    return found ? copyRecord(found) : undefined;
  }

  list(): ValidationRecord[] {
    return [...this.records.values()].map(copyRecord);
  }

  /** Restore records from durable storage. Overwrites same recordId. */
  hydrate(records: readonly ValidationRecord[]): void {
    for (const record of records) {
      this.records.set(record.recordId, copyRecord(record));
    }
  }

  /**
   * Store one structured record for a run that already happened.
   * Human verdicts are copied only after linkage checks. They are not rescored.
   */
  assess(input: {
    capabilityId: string;
    version: string;
    artifactDigest: string;
    args: Readonly<Record<string, string>>;
    generationParams: Readonly<Record<string, string>>;
    run: SiteRunResult;
    evidence: SiteEvidence;
    reviewer: string;
    reviewedAt: string;
    basis: ValidationBasis;
    humanVerdict?: ValidationVerdict;
    humanReason?: string;
    independentReviewEvidence?: IndependentReviewEvidence;
  }): { ok: true; record: ValidationRecord } | SarDenial {
    const reviewer = input.reviewer.trim();
    if (!reviewer) {
      return sarDeny(SAR_DENIAL_CODE.policyDenied, "validation requires a reviewer");
    }
    if (!input.reviewedAt.trim()) {
      return sarDeny(SAR_DENIAL_CODE.policyDenied, "validation requires a review time");
    }
    if (input.run.capabilityId !== input.capabilityId || input.run.version !== input.version) {
      return sarDeny(
        SAR_DENIAL_CODE.invalidManifest,
        "validation run does not match the candidate",
      );
    }
    const linked = linkageDenial(input);
    if (linked) {
      return linked;
    }
    const participatedInDraftGeneration = sameParams(input.args, input.generationParams);
    const judged = judge(input);
    if (!judged.ok) {
      return judged;
    }
    const record: ValidationRecord = {
      recordId: this.mintId(),
      capabilityId: input.capabilityId,
      version: input.version,
      artifactDigest: input.artifactDigest,
      input: { ...input.args },
      participatedInDraftGeneration,
      basis: input.basis.kind === "human" ? { ...input.basis } : { ...input.basis },
      runId: input.run.runId,
      evidenceRef: input.run.evidenceRef,
      output: input.run.data,
      completeness: input.run.completeness,
      verdict: judged.verdict,
      reviewer,
      reviewedAt: input.reviewedAt,
      reason: judged.reason,
      runStatus: input.run.status,
      runVerification: input.run.verification,
      promotable: judged.promotable,
      ...(judged.independentReviewEvidence
        ? { independentReviewEvidence: judged.independentReviewEvidence }
        : {}),
    };
    this.records.set(record.recordId, record);
    return { ok: true, record: copyRecord(record) };
  }
}

function copyRecord(record: ValidationRecord): ValidationRecord {
  return {
    ...record,
    input: { ...record.input },
    basis: record.basis.kind === "human" ? { ...record.basis } : { ...record.basis },
    ...(record.independentReviewEvidence
      ? { independentReviewEvidence: { ...record.independentReviewEvidence } }
      : {}),
  };
}

function linkageDenial(input: {
  capabilityId: string;
  version: string;
  artifactDigest: string;
  run: SiteRunResult;
  evidence: SiteEvidence;
}): SarDenial | null {
  if (!input.artifactDigest.trim()) {
    return sarDeny(SAR_DENIAL_CODE.invalidManifest, "validation requires an artifact digest");
  }
  if (!input.run.runId.trim() || !input.run.evidenceRef.trim()) {
    return sarDeny(SAR_DENIAL_CODE.policyDenied, "validation requires run evidence");
  }
  const evidence = input.evidence;
  if (
    evidence.evidenceRef !== input.run.evidenceRef ||
    evidence.runId !== input.run.runId ||
    evidence.capabilityId !== input.capabilityId ||
    evidence.version !== input.version ||
    evidence.artifactDigest !== input.artifactDigest ||
    evidence.status !== input.run.status ||
    evidence.verification !== input.run.verification ||
    evidence.completeness !== input.run.completeness
  ) {
    return sarDeny(
      SAR_DENIAL_CODE.invalidManifest,
      "validation evidence is not linked to this run and artifact",
    );
  }
  return null;
}

function runCanBePromoted(run: SiteRunResult): boolean {
  return run.status === "succeeded" && !run.error && run.verification !== "failed";
}

function judge(input: {
  artifactDigest: string;
  run: SiteRunResult;
  basis: ValidationBasis;
  humanVerdict?: ValidationVerdict;
  humanReason?: string;
  independentReviewEvidence?: IndependentReviewEvidence;
}):
  | {
      ok: true;
      verdict: ValidationVerdict;
      reason: string;
      promotable: boolean;
      independentReviewEvidence?: IndependentReviewEvidence;
    }
  | SarDenial {
  if (input.basis.kind === "human") {
    return judgeHuman(input);
  }
  if (input.run.status !== "succeeded" || input.run.error) {
    return {
      ok: true,
      verdict: "failed",
      promotable: false,
      reason: `run did not succeed: ${input.run.error?.code ?? input.run.status}`,
    };
  }
  if (input.run.verification === "failed") {
    return {
      ok: true,
      verdict: "failed",
      promotable: false,
      reason: "business verification failed",
    };
  }
  if (JSON.stringify(input.run.data) === JSON.stringify(input.basis.expected)) {
    return {
      ok: true,
      verdict: "passed",
      promotable: true,
      reason: "output matched test-site ground truth",
    };
  }
  return {
    ok: true,
    verdict: "failed",
    promotable: false,
    reason: "output did not match test-site ground truth",
  };
}

function judgeHuman(input: {
  artifactDigest: string;
  run: SiteRunResult;
  basis: ValidationBasis;
  humanVerdict?: ValidationVerdict;
  humanReason?: string;
  independentReviewEvidence?: IndependentReviewEvidence;
}):
  | {
      ok: true;
      verdict: ValidationVerdict;
      reason: string;
      promotable: boolean;
      independentReviewEvidence?: IndependentReviewEvidence;
    }
  | SarDenial {
  if (input.basis.kind !== "human") {
    return sarDeny(SAR_DENIAL_CODE.policyDenied, "human verification needs a statement");
  }
  const statement = input.basis.statement.trim();
  if (!statement) {
    return sarDeny(SAR_DENIAL_CODE.policyDenied, "human verification needs a statement");
  }
  if (input.humanVerdict !== "passed" && input.humanVerdict !== "failed") {
    return sarDeny(SAR_DENIAL_CODE.policyDenied, "human verification needs an explicit verdict");
  }
  const humanReason = input.humanReason?.trim() ?? "";
  if (!humanReason) {
    return sarDeny(SAR_DENIAL_CODE.policyDenied, "human verification needs a reason");
  }
  if (input.humanVerdict === "passed" && !runCanBePromoted(input.run)) {
    const review = parseIndependentReview(
      input.independentReviewEvidence,
      input.artifactDigest,
      input.run.evidenceRef,
    );
    if (!review.ok) {
      return review;
    }
    return {
      ok: true,
      verdict: "passed",
      promotable: false,
      reason: humanReason,
      independentReviewEvidence: review.evidence,
    };
  }
  return {
    ok: true,
    verdict: input.humanVerdict,
    promotable: input.humanVerdict === "passed" && runCanBePromoted(input.run),
    reason: humanReason,
  };
}

function parseIndependentReview(
  review: IndependentReviewEvidence | undefined,
  artifactDigest: string,
  runEvidenceRef: string,
): { ok: true; evidence: IndependentReviewEvidence } | SarDenial {
  const evidenceRef = review?.evidenceRef.trim() ?? "";
  const statement = review?.statement.trim() ?? "";
  const digest = review?.artifactDigest.trim() ?? "";
  if (!evidenceRef || !statement || !digest) {
    return sarDeny(
      SAR_DENIAL_CODE.policyDenied,
      "failed or unknown runs cannot be marked passed without independent review evidence",
    );
  }
  if (evidenceRef === runEvidenceRef) {
    return sarDeny(
      SAR_DENIAL_CODE.policyDenied,
      "independent review evidence must be distinct from the run evidence",
    );
  }
  if (digest !== artifactDigest) {
    return sarDeny(
      SAR_DENIAL_CODE.invalidManifest,
      "independent review evidence does not match the artifact",
    );
  }
  return { ok: true, evidence: { evidenceRef, statement, artifactDigest: digest } };
}
