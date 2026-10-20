/**
 * Human acceptance enables a candidate. Acceptance is not verification.
 * A failed record, or a record whose params were used to generate the draft,
 * cannot move the capability to approved.
 */

import { SAR_DENIAL_CODE, sarDeny, type SarDenial } from "./codes.js";
import { draftToSiteRecord, type DraftAcceptance, type PrivatePlanDraft } from "./draft-store.js";
import type { SiteCapabilityRecord } from "./runtime.js";
import { validationBlocksVerifiedCallable, type ValidationRecord } from "./validation-record.js";

export function decideAcceptance(input: {
  draft: PrivatePlanDraft;
  validation: ValidationRecord;
  reviewer: string;
  acceptedAt: string;
}): { ok: true; acceptance: DraftAcceptance; record: SiteCapabilityRecord } | SarDenial {
  const reviewer = input.reviewer.trim();
  if (!reviewer) {
    return sarDeny(SAR_DENIAL_CODE.policyDenied, "human acceptance requires a reviewer");
  }
  if (
    input.validation.capabilityId !== input.draft.capabilityId ||
    input.validation.version !== input.draft.version ||
    input.validation.artifactDigest !== input.draft.artifactDigest
  ) {
    return sarDeny(
      SAR_DENIAL_CODE.invalidManifest,
      "validation record does not match this candidate version",
    );
  }
  if (input.validation.verdict !== "passed" || validationBlocksVerifiedCallable(input.validation)) {
    return sarDeny(
      SAR_DENIAL_CODE.policyDenied,
      input.validation.independentReviewEvidence
        ? "independent review evidence does not make a failed or unknown run verified callable"
        : "human acceptance cannot mark a failed validation as verified",
    );
  }
  if (input.validation.runStatus !== "succeeded" || input.validation.runVerification === "failed") {
    return sarDeny(
      SAR_DENIAL_CODE.policyDenied,
      "failed, unknown, or rejected business results cannot become verified callable",
    );
  }
  if (input.validation.participatedInDraftGeneration) {
    return sarDeny(
      SAR_DENIAL_CODE.policyDenied,
      "human acceptance requires a passed held-out validation record",
    );
  }
  if (
    !input.validation.reviewer.trim() ||
    !input.validation.reviewedAt.trim() ||
    !input.validation.reason.trim()
  ) {
    return sarDeny(
      SAR_DENIAL_CODE.policyDenied,
      "validation record is missing reviewer, time, or reason",
    );
  }
  const approved: PrivatePlanDraft = {
    ...input.draft,
    lifecycle: "approved",
    enabled: true,
    published: false,
  };
  const acceptance: DraftAcceptance = {
    draftId: input.draft.draftId,
    capabilityId: input.draft.capabilityId,
    version: input.draft.version,
    artifactDigest: input.draft.artifactDigest,
    lifecycle: "approved",
    enabled: true,
    published: false,
    validationRecordId: input.validation.recordId,
    reviewer,
    acceptedAt: input.acceptedAt,
  };
  return {
    ok: true,
    acceptance,
    record: draftToSiteRecord(approved, "passed"),
  };
}
