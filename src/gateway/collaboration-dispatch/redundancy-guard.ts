import { classifyPlaceholderReply } from "./completion-contract.js";
import { classifyEchoConfirmationReply } from "./echo-confirmation-guard.js";
import {
  estimateCoverageMapOverlap,
  shouldForceNoReplyFromCoverageMap,
  type SameRoundContext,
} from "./same-round-context.js";

function normalizeForOverlap(text: string) {
  return text.replace(/\s+/g, "").toLowerCase();
}

function charOverlapRatio(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  let matched = 0;
  for (let index = 0; index < shorter.length; index += 1) {
    const slice = shorter.slice(index, index + 4);
    if (slice.length === 4 && longer.includes(slice)) {
      matched += 1;
    }
  }
  return matched / Math.max(shorter.length - 3, 1);
}

/** Lexical overlap vs prior full replies (legacy). Prefer coverage-map overlap when claims exist. */
export function estimateReplyOverlap(params: {
  candidateText: string;
  sameRoundContext?: SameRoundContext;
}) {
  if (params.sameRoundContext?.coveredClaims?.length) {
    return estimateCoverageMapOverlap(params);
  }
  const candidate = normalizeForOverlap(params.candidateText);
  if (!candidate || !params.sameRoundContext?.replies.length) {
    return 0;
  }
  let maxOverlap = 0;
  for (const reply of params.sameRoundContext.replies) {
    const prior = normalizeForOverlap(reply.text);
    if (!prior) {
      continue;
    }
    const shorter = candidate.length <= prior.length ? candidate : prior;
    const longer = candidate.length > prior.length ? candidate : prior;
    if (longer.includes(shorter) && shorter.length >= 16) {
      maxOverlap = Math.max(maxOverlap, shorter.length / Math.max(longer.length, 1));
      continue;
    }
    maxOverlap = Math.max(maxOverlap, charOverlapRatio(candidate, prior));
  }
  return maxOverlap;
}

export function shouldSuppressHighlyRedundantReply(params: {
  candidateText: string;
  contributionRole: string;
  sameRoundContext?: SameRoundContext;
  responseMode?: string;
  /** review_driven preserveConflict — challenge may speak without map conflicts. */
  preserveConflict?: boolean;
}) {
  if (classifyPlaceholderReply(params.candidateText)) {
    return true;
  }
  if (
    params.responseMode === "decision_to_executor" &&
    params.contributionRole !== "lead" &&
    params.contributionRole !== "wrap" &&
    params.contributionRole !== "executor"
  ) {
    return true;
  }
  if (
    params.contributionRole !== "lead" &&
    params.contributionRole !== "wrap" &&
    classifyEchoConfirmationReply(params.candidateText)
  ) {
    return true;
  }
  if (params.contributionRole === "lead" || params.contributionRole === "wrap") {
    return false;
  }

  // P1 coverage-map gate: overlap above threshold → NO_REPLY; challenge only with conflict.
  if (
    shouldForceNoReplyFromCoverageMap({
      candidateText: params.candidateText,
      contributionRole: params.contributionRole,
      sameRoundContext: params.sameRoundContext,
      preserveConflict: params.preserveConflict,
    })
  ) {
    return true;
  }

  // Legacy path when map has no claims yet: challenge/preserveConflict keep dissent.
  if (params.contributionRole === "challenge" || params.preserveConflict) {
    return false;
  }
  return estimateReplyOverlap(params) >= 0.55;
}
