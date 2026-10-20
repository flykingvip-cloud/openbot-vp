/**
 * C6 read-only projection of an A10 M1 closure.
 *
 * Application verification, recheck, evaluation, eligibility, and promotion
 * completion are separate facts. This module does not Promote, Apply, or
 * append promotion.completed. An A9/M1 event stays a shadow observation.
 */
import { classifyA9M1Event, type A9M1Event } from "./a9-m1-observation.js";
import {
  decideEvolutionCompletionFromLedger,
  type CompletionLedgerReader,
} from "./completion-ledger.js";
import type { DiagnosisRecheckOutcome, DiagnosisRecheckResult } from "./diagnosis-recheck.js";
import {
  decideEvaluationOutcome,
  evaluationPolicyFor,
  type EvaluationDecision,
} from "./evaluation-policy.js";
import type { ExternalEffectOutcome } from "./external-effect.js";
import type { ExperimentResult } from "./types.js";

export type C6ObservationWindow = {
  startedAt: string | null;
  endedAt: string | null;
  sampleCount: number;
};

export type C6TargetRef = {
  domain: string;
  agentId?: string;
  componentId?: string;
  skillId?: string;
};

/** One recorded ledger fact. A type string alone cannot complete promotion. */
export type C6LedgerEvent = {
  eventId: string;
  type: string;
  tenantScope: string | null;
  proposalId: string;
  experimentId: string | null;
  applicationId: string | null;
  verificationId: string | null;
  target: C6TargetRef;
  surfaceId: string;
  candidateRef: string;
  principalRef: string;
  timestamp: string;
};

export type C6M1AuditInput = {
  tenantId: string;
  target: C6TargetRef;
  surfaceId: string;
  candidateVersion: string;
  commandId: string;
  observationWindow: C6ObservationWindow;
  proposal: {
    proposalId: string;
    status: string;
    tenantScope: string | null;
    surfaceId: string;
    candidateRef: string;
    target: C6TargetRef;
  };
  experiment: {
    experimentId: string;
    proposalId: string;
    surfaceId: string;
    tenantScope: string | null;
    candidateRef: string;
    result: ExperimentResult;
  };
  application: {
    applicationId: string;
    proposalId: string;
    experimentId: string;
    status: string;
  };
  verification: {
    verificationId: string;
    applicationId: string;
    outcome: string;
    verifiedAt?: string;
  } | null;
  recheck: DiagnosisRecheckResult | null;
  recheckRecordedAt?: string | null;
  ledgerEvents: readonly C6LedgerEvent[];
  /** Server ledger. promotion.completed in ledgerEvents is not a completion fact. */
  ledger: CompletionLedgerReader;
  sampleSize: number;
  confidence: number | null;
  rollbackDrillPassed: boolean;
  guardrailDegraded?: boolean;
  authorityOk?: boolean;
  domainVerified?: boolean;
  externalEffectOutcome?: ExternalEffectOutcome | null;
  /** Ignored as authorization. Present only so a forged caller cannot flip them. */
  executedConsumer?: unknown;
  directMutatorsRetired?: unknown;
  e52SwitchAllowed?: unknown;
  cutoverReady?: unknown;
  a9Event?: A9M1Event | null;
};

export type C6PromotionProjection = {
  applicationVerified: boolean;
  recheckOutcome: DiagnosisRecheckOutcome | null;
  evaluationDecision: EvaluationDecision;
  promotionEligible: boolean;
  promotionCompleted: boolean;
  userVisibleStatus: string;
  alignmentOk: boolean;
  mismatches: readonly string[];
  shadowObservationOnly: boolean;
  isE52CutoverReceipt: false;
  executedConsumer: false;
  directMutatorsRetired: false;
  e52SwitchAllowed: false;
  /** A manual M1 Apply is not runtime or skill-auto single-track. */
  singleTrack: false;
};

function sameTarget(left: C6TargetRef, right: C6TargetRef): boolean {
  return (
    left.domain === right.domain &&
    (left.agentId ?? "") === (right.agentId ?? "") &&
    (left.componentId ?? "") === (right.componentId ?? "") &&
    (left.skillId ?? "") === (right.skillId ?? "")
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

function windowOpen(window: C6ObservationWindow): boolean {
  return (
    window.sampleCount > 0 &&
    typeof window.startedAt === "string" &&
    window.startedAt.trim() !== "" &&
    typeof window.endedAt === "string" &&
    window.endedAt.trim() !== "" &&
    window.startedAt <= window.endedAt
  );
}

export function auditC6M1Binding(input: C6M1AuditInput): {
  ok: boolean;
  mismatches: string[];
} {
  const mismatches: string[] = [];
  if (
    input.proposal.tenantScope !== input.tenantId ||
    input.experiment.tenantScope !== input.tenantId
  ) {
    mismatches.push("tenant");
  }
  if (!sameTarget(input.proposal.target, input.target)) {
    mismatches.push("target");
  }
  if (
    input.proposal.surfaceId !== input.surfaceId ||
    input.experiment.surfaceId !== input.surfaceId
  ) {
    mismatches.push("surface");
  }
  if (
    !candidateMatches(input.proposal.candidateRef, input.candidateVersion) ||
    !candidateMatches(input.experiment.candidateRef, input.candidateVersion)
  ) {
    mismatches.push("candidate");
  }
  if (input.commandId.trim() === "") {
    mismatches.push("commandId");
  }
  if (
    input.verification &&
    !input.verification.verificationId.endsWith(input.commandId) &&
    input.verification.verificationId !== `ver:${input.commandId}`
  ) {
    mismatches.push("commandId");
  }
  if (!windowOpen(input.observationWindow)) {
    mismatches.push("observationWindow");
  }
  if (input.experiment.proposalId !== input.proposal.proposalId) {
    mismatches.push("proposal");
  }
  if (
    input.application.proposalId !== input.proposal.proposalId ||
    input.application.experimentId !== input.experiment.experimentId
  ) {
    mismatches.push("application");
  }
  const recheck = input.recheck;
  if (recheck) {
    if (!sameTarget(recheck.target, input.target)) {
      mismatches.push("recheckTarget");
    }
    const ref = recheck.verificationRef;
    if (
      ref.proposalId !== input.proposal.proposalId ||
      ref.experimentId !== input.experiment.experimentId ||
      ref.applicationId !== input.application.applicationId ||
      (input.verification && ref.verificationId !== input.verification.verificationId)
    ) {
      mismatches.push("recheckBinding");
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * Project promotion facts from an already-recorded M1 closure.
 * Completion comes only from decideEvolutionCompletion.
 * Forged cutover and execution fields cannot change the result.
 */
export function projectC6M1Status(input: C6M1AuditInput): C6PromotionProjection {
  const alignment = auditC6M1Binding(input);
  const recheckOutcome = input.recheck?.outcome ?? null;
  const policy = evaluationPolicyFor({
    surfaceId: input.surfaceId,
    producerKind: "diagnosis-origin",
  });
  let evaluationDecision: EvaluationDecision;
  if (!alignment.ok) {
    const reason = alignment.mismatches.includes("observationWindow")
      ? "observation_window_empty"
      : "binding_mismatch";
    evaluationDecision = { action: "block", reasonCode: reason };
  } else if ("ok" in policy) {
    evaluationDecision = { action: "block", reasonCode: "unknown_surface" };
  } else {
    const authorityForPolicy: unknown = input.authorityOk;
    const domainVerified: unknown = input.domainVerified;
    evaluationDecision = decideEvaluationOutcome(policy, {
      experimentResult:
        input.experiment.result === "pending" ? "inconclusive" : input.experiment.result,
      guardrailDegraded: input.guardrailDegraded === true,
      authorityOk: authorityForPolicy !== false,
      domainVerified: domainVerified !== false,
      externalEffectOutcome: input.externalEffectOutcome ?? "verified",
      recheck: recheckOutcome,
      sampleSize: input.sampleSize,
      confidence: input.confidence,
      rollbackDrillPassed: input.rollbackDrillPassed,
    });
  }
  const authority: unknown = input.authorityOk;
  const guardrail: unknown = input.guardrailDegraded;
  const decision = decideEvolutionCompletionFromLedger({
    reader: input.ledger,
    query: {
      tenantId: input.tenantId,
      proposalId: input.proposal.proposalId,
      experimentId: input.experiment.experimentId,
      applicationId: input.application.applicationId,
    },
    target: input.target,
    surfaceId: input.surfaceId,
    candidateVersion: input.candidateVersion,
    authorityOk: authority === true,
    guardrailDegraded: guardrail !== false,
    experimentResult: input.experiment.result,
    evaluation: evaluationDecision,
  });
  if (alignment.ok && decision.reasonCode === "promotion_event_conflict") {
    evaluationDecision = { action: "block", reasonCode: "promotion_event_conflict" };
  }
  const a9 = input.a9Event ? classifyA9M1Event(input.a9Event) : null;
  return {
    applicationVerified: decision.applicationVerified,
    recheckOutcome: decision.recheckOutcome,
    evaluationDecision,
    promotionEligible: decision.promotionEligible,
    promotionCompleted: decision.promotionCompleted,
    userVisibleStatus: decision.userVisibleStatus,
    alignmentOk: alignment.ok,
    mismatches: alignment.mismatches,
    shadowObservationOnly: a9 == null || a9.accepted,
    isE52CutoverReceipt: false,
    executedConsumer: false,
    directMutatorsRetired: false,
    e52SwitchAllowed: false,
    singleTrack: false,
  };
}
