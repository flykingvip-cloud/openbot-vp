/**
 * Business verification is not completeness.
 * A finished read can be complete and still unverified.
 * `passed` is emitted only when a verifier returns `passed` for a succeeded run.
 */

import type { SiteCompleteness, SiteRunStatus, SiteVerification } from "./result.js";

export type SiteBusinessVerifierInput = {
  capabilityId: string;
  version: string;
  artifactDigest: string;
  data: unknown;
  completeness: SiteCompleteness;
};

export type SiteBusinessVerifier = (input: SiteBusinessVerifierInput) => SiteVerification;

/**
 * Completeness is visible to the verifier and is not an input to this decision.
 * No verifier, or any non-succeeded status, cannot become `passed`.
 */
export function resolveRunVerification(input: {
  status: SiteRunStatus;
  completeness: SiteCompleteness;
  verifier?: SiteBusinessVerifier;
  capabilityId: string;
  version: string;
  artifactDigest: string;
  data: unknown;
}): SiteVerification {
  if (input.status !== "succeeded") {
    return input.status === "unknown" ? "not_performed" : "failed";
  }
  if (!input.verifier) {
    return "not_performed";
  }
  const judged = input.verifier({
    capabilityId: input.capabilityId,
    version: input.version,
    artifactDigest: input.artifactDigest,
    data: input.data,
    completeness: input.completeness,
  });
  if (judged === "passed") {
    return "passed";
  }
  if (judged === "failed") {
    return "failed";
  }
  return "not_performed";
}
