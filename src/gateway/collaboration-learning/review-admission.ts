import type { GroupBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import { deliveryActorIdsEqual } from "./delivery-actor-binding.js";

/** Submission-bound review admission; membership, stop and governance checks
 * remain at the existing dispatcher/accept entries. A review role is not authority. */
export function reviewSubmissionAdmission(
  item: Pick<
    GroupBoardClaimItem,
    "status" | "claimantId" | "submissionId" | "artifactVersion" | "pendingEventRelay"
  >,
):
  | {
      allowed: true;
      purpose: "formal_review";
      submissionId: string;
      artifactVersion: string;
      reviewerIds: string[];
    }
  | { allowed: false; reason: string } {
  const relay = item.pendingEventRelay;
  if (item.status !== "submitted_for_review" || relay?.businessEvent !== "submitted_for_review") {
    return { allowed: false, reason: "review_submission_required" };
  }
  if (
    !item.submissionId ||
    relay.sourceId !== item.submissionId ||
    !item.artifactVersion ||
    relay.artifactVersion !== item.artifactVersion
  ) {
    return { allowed: false, reason: "review_submission_version_mismatch" };
  }
  const reviewerIds = [...new Set(relay.targetAgentIds.map((id) => id.trim()).filter(Boolean))];
  if (!reviewerIds.length || reviewerIds.some((id) => deliveryActorIdsEqual(id, item.claimantId))) {
    return { allowed: false, reason: "independent_reviewer_required" };
  }
  return {
    allowed: true,
    purpose: "formal_review",
    submissionId: item.submissionId,
    artifactVersion: item.artifactVersion,
    reviewerIds,
  };
}
