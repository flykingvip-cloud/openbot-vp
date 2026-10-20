import type { Review } from "@openbot/collaboration-core";
import type { GateResult } from "../contracts/runtime-coordinator.js";

export function canPublishDeliverable(params: {
  deliverableId: string;
  reviews: Review[];
}): GateResult {
  const deliverableReviews = params.reviews.filter(
    (review) => review.deliverableId === params.deliverableId,
  );
  const pendingReviews = deliverableReviews.filter(
    (review) => review.status === "requested" || review.status === "submitted",
  );

  if (pendingReviews.length > 0) {
    return {
      allowed: false,
      reason: "pending_reviews",
      details: {
        pendingCount: pendingReviews.length,
        pendingReviewIds: pendingReviews.map((review) => review.reviewId),
      },
    };
  }

  const completedReviews = deliverableReviews.filter(
    (review) => review.status === "acknowledged" || review.status === "resolved",
  );

  return {
    allowed: true,
    reason: "reviews_complete",
    details: {
      reviewCount: completedReviews.length,
    },
  };
}
