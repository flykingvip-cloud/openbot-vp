/**
 * Site run result. Empty success, partial budget, and unknown are different.
 * Unknown is not an ordinary failure and must not be retried as one.
 * P1 does not start a repair from any of these outcomes.
 */

export type SiteRunStatus = "succeeded" | "failed" | "unknown";
export type SiteVerification = "passed" | "failed" | "not_performed";
export type SiteCompleteness = "complete" | "partial";

/** `not_ordinary` is reserved for unknown. It is not a failure retry. */
export type SiteRetryHint = "none" | "after_reauth" | "not_ordinary";

export type SiteRunError = {
  code: string;
  message: string;
  retry: SiteRetryHint;
  /** Known failure. Unknown results keep this false. */
  ordinaryFailure: boolean;
};

export type SiteRunResult = {
  runId: string;
  capabilityId: string;
  version: string;
  status: SiteRunStatus;
  verification: SiteVerification;
  data: unknown;
  completeness: SiteCompleteness;
  error?: SiteRunError;
  evidenceRef: string;
  durationMs: number;
  repair: "none";
};

export type SiteEvidence = {
  evidenceRef: string;
  runId: string;
  capabilityId: string;
  version: string;
  artifactDigest: string;
  status: SiteRunStatus;
  verification: SiteVerification;
  completeness: SiteCompleteness;
};

export function isEmptyData(data: unknown): boolean {
  if (Array.isArray(data)) {
    return data.length === 0;
  }
  if (!data || typeof data !== "object") {
    return false;
  }
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.items)) {
    return record.items.length === 0;
  }
  if (Array.isArray(record.orders)) {
    return record.orders.length === 0;
  }
  if (Array.isArray(record.notes)) {
    return record.notes.length === 0;
  }
  if (Array.isArray(record.bulletins)) {
    return record.bulletins.length === 0;
  }
  if (Array.isArray(record.messages)) {
    return record.messages.length === 0;
  }
  return false;
}

/**
 * A finished read that legitimately matched nothing. Not a partial and not a failure.
 * Verification is independent: an unverified empty read is still an empty success.
 * A verifier rejection is not.
 */
export function isEmptySuccess(result: SiteRunResult): boolean {
  return (
    result.status === "succeeded" &&
    result.completeness === "complete" &&
    result.verification !== "failed" &&
    result.repair === "none" &&
    !result.error &&
    isEmptyData(result.data)
  );
}

/** True only for a known failure. Unknown returns false. */
export function isOrdinaryFailure(result: SiteRunResult): boolean {
  return result.status === "failed" && result.error?.ordinaryFailure === true;
}
