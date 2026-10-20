/**
 * The only evolution-completion judge.
 *
 * Callers pass already recorded facts. This module does not Promote, Apply,
 * or Rollback, and it does not write a ledger event.
 */
import type { DiagnosisRecheckOutcome, DiagnosisRecheckResult } from "./diagnosis-recheck.js";
import type { EvaluationDecision } from "./evaluation-policy.js";

/** The only application status that can enter the completion contract. */
export const EVOLUTION_COMPLETION_APPLIED_STATUSES = ["applied"] as const;

export type EvolutionCompletionTarget = {
  domain: string;
  agentId?: string;
  componentId?: string;
  skillId?: string;
  assetId?: string;
  groupId?: string;
};

const SERVER_LEDGER = Symbol("server-completion-ledger");

/** Promotion events produced by a server ledger query. Callers cannot construct this. */
export type ServerQueriedPromotionEvents = {
  readonly source: typeof SERVER_LEDGER;
  readonly events: readonly EvolutionCompletionPromotionEvent[];
};

export function emptyServerPromotionEvents(): ServerQueriedPromotionEvents {
  return Object.freeze({
    source: SERVER_LEDGER,
    events: Object.freeze([]),
  });
}

export function sealServerPromotionEvents(
  events: readonly EvolutionCompletionPromotionEvent[],
): ServerQueriedPromotionEvents {
  return Object.freeze({
    source: SERVER_LEDGER,
    events: Object.freeze([...events]),
  });
}

export function isServerQueriedPromotionEvents(
  value: unknown,
): value is ServerQueriedPromotionEvents {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { source?: unknown }).source === SERVER_LEDGER &&
    Array.isArray((value as { events?: unknown }).events)
  );
}

export type EvolutionCompletionPromotionEvent = {
  eventId: string;
  type: string;
  tenantScope: string | null;
  proposalId: string;
  experimentId: string | null;
  applicationId: string | null;
  verificationId: string | null;
  target: EvolutionCompletionTarget;
  surfaceId: string;
  candidateRef: string;
  principalRef: string;
  timestamp: string;
};

export type EvolutionCompletionEvidence = {
  tenantId: string;
  target: EvolutionCompletionTarget;
  surfaceId: string;
  candidateVersion: string;
  proposal: {
    proposalId: string;
    status: string;
    tenantScope: string | null;
    surfaceId: string;
    candidateRef: string;
    target: EvolutionCompletionTarget;
  } | null;
  experiment: {
    experimentId: string;
    proposalId: string;
    surfaceId: string;
    tenantScope: string | null;
    candidateRef: string;
  } | null;
  application: {
    applicationId: string;
    proposalId: string;
    experimentId: string;
    status: string;
  } | null;
  verification: {
    verificationId: string;
    applicationId: string;
    outcome: string;
    verifiedAt: string;
  } | null;
  recheck: DiagnosisRecheckResult | null;
  recheckRecordedAt: string | null;
  evaluation: EvaluationDecision | null;
  promotionEvents: ServerQueriedPromotionEvents;
  authorityOk: boolean;
  guardrailDegraded: boolean;
};

export type EvolutionCompletionRecommendation =
  | "promote"
  | "hold"
  | "rollback"
  | "observe"
  | "fail-closed";

export type EvolutionCompletionDecision = {
  applicationVerified: boolean;
  recheckOutcome: DiagnosisRecheckOutcome | null;
  promotionEligible: boolean;
  promotionCompleted: boolean;
  recommendation: EvolutionCompletionRecommendation;
  reasonCode: string;
  userVisibleStatus: string;
};

const COMPLETED_LABEL = "已完成进化";

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function sameTarget(left: EvolutionCompletionTarget, right: EvolutionCompletionTarget): boolean {
  return (
    left.domain === right.domain &&
    (left.agentId ?? "") === (right.agentId ?? "") &&
    (left.componentId ?? "") === (right.componentId ?? "") &&
    (left.skillId ?? "") === (right.skillId ?? "") &&
    (left.assetId ?? "") === (right.assetId ?? "") &&
    (left.groupId ?? "") === (right.groupId ?? "")
  );
}

function candidateMatches(candidateRef: string, candidateVersion: string): boolean {
  const version = candidateVersion.trim();
  const ref = candidateRef.trim();
  if (!version || !ref) {
    return false;
  }
  if (ref === version || ref.endsWith(version)) {
    return true;
  }
  const suffix = ref.startsWith("cand:diag:") ? ref.slice("cand:diag:".length) : ref;
  return suffix.length >= 16 && version.startsWith(suffix);
}

function applicationVerified(evidence: EvolutionCompletionEvidence): boolean {
  const proposal = evidence.proposal;
  const application = evidence.application;
  const verification = evidence.verification;
  // PROMOTED supersedes VERIFIED; verification facts remain true after promote.
  return (
    proposal != null &&
    application != null &&
    verification != null &&
    (proposal.status === "VERIFIED" || proposal.status === "PROMOTED") &&
    verification.applicationId === application.applicationId &&
    (verification.outcome === "improved" || verification.outcome === "verified")
  );
}

function recommendationOf(
  evaluation: EvaluationDecision | null,
): EvolutionCompletionRecommendation {
  if (!evaluation || evaluation.action === "block") {
    return "fail-closed";
  }
  return evaluation.action;
}

function chainFailure(evidence: EvolutionCompletionEvidence): string | null {
  const proposal = evidence.proposal;
  const experiment = evidence.experiment;
  const application = evidence.application;
  if (!proposal || !experiment || !application) {
    return "missing_binding";
  }
  if (
    proposal.tenantScope !== evidence.tenantId ||
    experiment.tenantScope !== evidence.tenantId ||
    !sameTarget(proposal.target, evidence.target) ||
    proposal.surfaceId !== evidence.surfaceId ||
    experiment.surfaceId !== evidence.surfaceId ||
    !candidateMatches(proposal.candidateRef, evidence.candidateVersion) ||
    !candidateMatches(experiment.candidateRef, evidence.candidateVersion) ||
    experiment.proposalId !== proposal.proposalId ||
    application.proposalId !== proposal.proposalId ||
    application.experimentId !== experiment.experimentId
  ) {
    return "binding_mismatch";
  }
  const appliedStatuses: readonly string[] = EVOLUTION_COMPLETION_APPLIED_STATUSES;
  if (!appliedStatuses.includes(application.status.trim())) {
    return "application_not_applied";
  }
  const verification = evidence.verification;
  if (!verification || verification.applicationId !== application.applicationId) {
    return "verification_unbound";
  }
  const recheck = evidence.recheck;
  if (!recheck) {
    return "recheck_required";
  }
  const ref = recheck.verificationRef;
  if (
    !sameTarget(recheck.target, evidence.target) ||
    ref.proposalId !== proposal.proposalId ||
    ref.experimentId !== experiment.experimentId ||
    ref.applicationId !== application.applicationId ||
    ref.verificationId !== verification.verificationId
  ) {
    return "recheck_unbound";
  }
  return null;
}

function ownPromotionEvents(
  evidence: EvolutionCompletionEvidence,
): EvolutionCompletionPromotionEvent[] {
  const proposalId = evidence.proposal?.proposalId;
  if (!proposalId || !isServerQueriedPromotionEvents(evidence.promotionEvents)) {
    return [];
  }
  return evidence.promotionEvents.events.filter(
    (event) => event.type === "promotion.completed" && event.proposalId === proposalId,
  );
}

function eventBound(
  event: EvolutionCompletionPromotionEvent,
  evidence: EvolutionCompletionEvidence,
): boolean {
  const proposal = evidence.proposal;
  const experiment = evidence.experiment;
  const application = evidence.application;
  const verification = evidence.verification;
  if (!proposal || !experiment || !application || !verification) {
    return false;
  }
  return (
    text(event.eventId) !== "" &&
    text(event.principalRef) !== "" &&
    text(event.timestamp) !== "" &&
    event.tenantScope === evidence.tenantId &&
    event.proposalId === proposal.proposalId &&
    event.experimentId === experiment.experimentId &&
    event.applicationId === application.applicationId &&
    event.verificationId === verification.verificationId &&
    sameTarget(event.target, evidence.target) &&
    event.surfaceId === evidence.surfaceId &&
    candidateMatches(event.candidateRef, evidence.candidateVersion) &&
    candidateMatches(proposal.candidateRef, evidence.candidateVersion)
  );
}

function laterThan(eventTime: string, prior: string | null | undefined): boolean {
  const event = text(eventTime);
  const before = text(prior);
  if (!event || !before) {
    return false;
  }
  return event > before;
}

function promotionEventFailure(
  evidence: EvolutionCompletionEvidence,
  events: readonly EvolutionCompletionPromotionEvent[],
): "promotion_event_conflict" | "promotion_event_unbound" | "promotion_event_early" | null {
  if (events.length === 0) {
    return null;
  }
  const ids = new Set(events.map((event) => event.eventId));
  if (events.length > 1 || ids.size !== events.length) {
    return "promotion_event_conflict";
  }
  const event = events[0];
  if (!event || !eventBound(event, evidence)) {
    return "promotion_event_unbound";
  }
  if (
    !laterThan(event.timestamp, evidence.verification?.verifiedAt) ||
    !laterThan(event.timestamp, evidence.recheckRecordedAt)
  ) {
    return "promotion_event_early";
  }
  return null;
}

function visibleStatus(input: {
  promotionCompleted: boolean;
  promotionEligible: boolean;
  applicationVerified: boolean;
  recommendation: EvolutionCompletionRecommendation;
}): string {
  if (input.promotionCompleted) {
    return COMPLETED_LABEL;
  }
  if (input.recommendation === "fail-closed") {
    return "无法确认，已停止";
  }
  if (input.recommendation === "promote" && input.promotionEligible) {
    return "可进入晋升门禁，进化未完成";
  }
  if (input.recommendation === "promote") {
    return "无法确认，已停止";
  }
  if (input.recommendation === "hold" && input.applicationVerified) {
    return "已验证，进化未完成";
  }
  if (input.recommendation === "hold") {
    return "保持现状";
  }
  if (input.recommendation === "rollback") {
    return "建议回滚";
  }
  if (input.recommendation === "observe") {
    return "继续观察";
  }
  return "无法确认，已停止";
}

function decide(input: {
  verified: boolean;
  recheckOutcome: DiagnosisRecheckOutcome | null;
  recommendation: EvolutionCompletionRecommendation;
  reasonCode: string;
  promotionEligible?: boolean;
  promotionCompleted?: boolean;
}): EvolutionCompletionDecision {
  const promotionEligible = input.promotionEligible === true;
  const promotionCompleted = input.promotionCompleted === true;
  const userVisibleStatus = visibleStatus({
    promotionCompleted,
    promotionEligible,
    applicationVerified: input.verified,
    recommendation: input.recommendation,
  });
  if (!promotionCompleted && userVisibleStatus.includes(COMPLETED_LABEL)) {
    throw new Error("completion text without a completed decision");
  }
  return {
    applicationVerified: input.verified,
    recheckOutcome: input.recheckOutcome,
    promotionEligible,
    promotionCompleted,
    recommendation: input.recommendation,
    reasonCode: input.reasonCode,
    userVisibleStatus,
  };
}

/**
 * Decide whether an evolution closure is eligible or completed.
 * A missing promotion event can still be eligible. A conflicting, duplicate,
 * unbound, or early event fail-closes.
 */
export function decideEvolutionCompletion(
  evidence: EvolutionCompletionEvidence,
): EvolutionCompletionDecision {
  if (!isServerQueriedPromotionEvents(evidence.promotionEvents)) {
    return decide({
      verified: applicationVerified(evidence),
      recheckOutcome: evidence.recheck?.outcome ?? null,
      recommendation: "fail-closed",
      reasonCode: "caller_promotion_rejected",
    });
  }
  const verified = applicationVerified(evidence);
  const recheckOutcome = evidence.recheck?.outcome ?? null;
  const evaluation = evidence.evaluation;
  const failure = chainFailure(evidence);
  if (failure) {
    return decide({
      verified,
      recheckOutcome,
      recommendation: "fail-closed",
      reasonCode: failure,
    });
  }
  const events = ownPromotionEvents(evidence);
  const eventFailure = promotionEventFailure(evidence, events);
  if (eventFailure) {
    return decide({
      verified,
      recheckOutcome,
      recommendation: "fail-closed",
      reasonCode: eventFailure,
    });
  }
  const recommendation = recommendationOf(evaluation);
  if (recommendation !== "promote" || recheckOutcome !== "RESOLVED" || !verified) {
    const reasonCode =
      recommendation === "promote" && !verified
        ? "application_unverified"
        : (evaluation?.reasonCode ?? "missing_evaluation");
    return decide({
      verified,
      recheckOutcome,
      recommendation: recommendation === "promote" && !verified ? "fail-closed" : recommendation,
      reasonCode,
    });
  }
  const authority: unknown = evidence.authorityOk;
  const guardrail: unknown = evidence.guardrailDegraded;
  if (authority !== true) {
    return decide({
      verified,
      recheckOutcome,
      recommendation: "fail-closed",
      reasonCode: "authority_required",
    });
  }
  if (guardrail !== false) {
    return decide({
      verified,
      recheckOutcome,
      recommendation: "fail-closed",
      reasonCode: "guardrail_degraded",
    });
  }
  const completed = events.length === 1;
  return decide({
    verified,
    recheckOutcome,
    recommendation: "promote",
    reasonCode: completed ? "completion_accepted" : "promote_gate",
    promotionEligible: true,
    promotionCompleted: completed,
  });
}
