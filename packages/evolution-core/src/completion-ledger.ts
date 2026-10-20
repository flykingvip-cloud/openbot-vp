/**
 * Read-only completion ledger.
 *
 * Proposal, Experiment, Application, Verification, Recheck, and
 * promotion.completed are loaded by a server query. A caller-supplied
 * promotion.completed event is not a fact.
 * This module does not Promote, Apply, or Rollback.
 */
import type { DiagnosisRecheckResult } from "./diagnosis-recheck.js";
import {
  decideEvaluationOutcome,
  evaluationPolicyFor,
  type EvaluationDecision,
} from "./evaluation-policy.js";
import {
  decideEvolutionCompletion,
  sealServerPromotionEvents,
  type EvolutionCompletionDecision,
  type EvolutionCompletionEvidence,
  type EvolutionCompletionPromotionEvent,
  type EvolutionCompletionTarget,
} from "./evolution-completion.js";
import type { ExperimentResult } from "./types.js";

export type CompletionLedgerQuery = {
  tenantId: string;
  proposalId: string;
  experimentId: string;
  applicationId: string;
};

export type CompletionLedgerEvent = EvolutionCompletionPromotionEvent & {
  evidenceRefs?: readonly string[];
};

export type CompletionLedgerRecord =
  | {
      kind: "proposal";
      body: NonNullable<EvolutionCompletionEvidence["proposal"]>;
    }
  | {
      kind: "experiment";
      body: NonNullable<EvolutionCompletionEvidence["experiment"]>;
    }
  | {
      kind: "application";
      body: NonNullable<EvolutionCompletionEvidence["application"]>;
    }
  | {
      kind: "verification";
      proposalId: string;
      experimentId: string;
      body: NonNullable<EvolutionCompletionEvidence["verification"]>;
    }
  | {
      kind: "recheck";
      tenantId: string;
      recordedAt: string;
      body: DiagnosisRecheckResult;
    }
  | {
      kind: "event";
      event: CompletionLedgerEvent;
    };

export type CompletionLedgerRead = {
  proposal: EvolutionCompletionEvidence["proposal"];
  experiment: EvolutionCompletionEvidence["experiment"];
  application: EvolutionCompletionEvidence["application"];
  verification: EvolutionCompletionEvidence["verification"];
  recheck: DiagnosisRecheckResult | null;
  recheckRecordedAt: string | null;
  events: readonly CompletionLedgerEvent[];
  duplicate: boolean;
};

/** Read-only. There is no append. */
export type CompletionLedgerReader = {
  read(query: CompletionLedgerQuery): CompletionLedgerRead;
};

export type CompletionLedgerFile = {
  schemaVersion: 1;
  records: readonly CompletionLedgerRecord[];
};

function one<T>(rows: readonly T[]): { value: T | null; duplicate: boolean } {
  if (rows.length > 1) {
    return { value: null, duplicate: true };
  }
  return { value: rows[0] ?? null, duplicate: false };
}

function copyEvent(event: CompletionLedgerEvent): CompletionLedgerEvent {
  return {
    ...event,
    target: { ...event.target },
    evidenceRefs: event.evidenceRefs ? [...event.evidenceRefs] : undefined,
  };
}

function eventMatches(event: CompletionLedgerEvent, query: CompletionLedgerQuery): boolean {
  return (
    event.tenantScope === query.tenantId &&
    event.proposalId === query.proposalId &&
    event.experimentId === query.experimentId &&
    event.applicationId === query.applicationId
  );
}

export function createMemoryCompletionLedger(
  records: readonly CompletionLedgerRecord[],
): CompletionLedgerReader {
  const stored = records.map((record) =>
    record.kind === "event" ? { kind: "event" as const, event: copyEvent(record.event) } : record,
  );
  return {
    read(query) {
      const proposals = stored.flatMap((record) =>
        record.kind === "proposal" &&
        record.body.proposalId === query.proposalId &&
        record.body.tenantScope === query.tenantId
          ? [record.body]
          : [],
      );
      const experiments = stored.flatMap((record) =>
        record.kind === "experiment" &&
        record.body.experimentId === query.experimentId &&
        record.body.proposalId === query.proposalId &&
        record.body.tenantScope === query.tenantId
          ? [record.body]
          : [],
      );
      const applications = stored.flatMap((record) =>
        record.kind === "application" &&
        record.body.applicationId === query.applicationId &&
        record.body.proposalId === query.proposalId &&
        record.body.experimentId === query.experimentId
          ? [record.body]
          : [],
      );
      const verifications = stored.flatMap((record) =>
        record.kind === "verification" &&
        record.proposalId === query.proposalId &&
        record.experimentId === query.experimentId &&
        record.body.applicationId === query.applicationId
          ? [record.body]
          : [],
      );
      const rechecks = stored.flatMap((record) =>
        record.kind === "recheck" &&
        record.tenantId === query.tenantId &&
        record.body.verificationRef.proposalId === query.proposalId &&
        record.body.verificationRef.experimentId === query.experimentId &&
        record.body.verificationRef.applicationId === query.applicationId
          ? [record]
          : [],
      );
      const events = stored.flatMap((record) =>
        record.kind === "event" && eventMatches(record.event, query)
          ? [copyEvent(record.event)]
          : [],
      );
      const proposal = one(proposals);
      const experiment = one(experiments);
      const application = one(applications);
      const verification = one(verifications);
      const recheck = one(rechecks);
      return {
        proposal: proposal.value,
        experiment: experiment.value,
        application: application.value,
        verification: verification.value,
        recheck: recheck.value?.body ?? null,
        recheckRecordedAt: recheck.value?.recordedAt ?? null,
        events,
        duplicate:
          proposal.duplicate ||
          experiment.duplicate ||
          application.duplicate ||
          verification.duplicate ||
          recheck.duplicate,
      };
    },
  };
}

/** Map a control-plane ledger event into a completion event. Candidate comes from evidenceRefs. */
export function completionEventsFromEvolutionLedger(
  events: readonly {
    eventId: string;
    type: string;
    timestamp: string;
    proposalId: string;
    tenantScope: string | null;
    principalRef: string;
    surfaceId: string;
    target: EvolutionCompletionTarget;
    evidenceRefs?: readonly string[];
    experimentId?: string | null;
    applicationId?: string | null;
    verificationId?: string | null;
  }[],
): CompletionLedgerEvent[] {
  return events.map((event) => ({
    eventId: event.eventId,
    type: event.type,
    tenantScope: event.tenantScope,
    proposalId: event.proposalId,
    experimentId: event.experimentId ?? null,
    applicationId: event.applicationId ?? null,
    verificationId: event.verificationId ?? null,
    target: { ...event.target },
    surfaceId: event.surfaceId,
    candidateRef: event.evidenceRefs?.find((ref) => ref.startsWith("cand:")) ?? "",
    principalRef: event.principalRef,
    timestamp: event.timestamp,
    ...(event.evidenceRefs ? { evidenceRefs: [...event.evidenceRefs] } : {}),
  }));
}

function outsideQuery(read: CompletionLedgerRead, query: CompletionLedgerQuery): boolean {
  if (read.proposal && read.proposal.tenantScope !== query.tenantId) {
    return true;
  }
  if (read.proposal && read.proposal.proposalId !== query.proposalId) {
    return true;
  }
  if (
    read.experiment &&
    (read.experiment.tenantScope !== query.tenantId ||
      read.experiment.proposalId !== query.proposalId ||
      read.experiment.experimentId !== query.experimentId)
  ) {
    return true;
  }
  if (
    read.application &&
    (read.application.proposalId !== query.proposalId ||
      read.application.experimentId !== query.experimentId ||
      read.application.applicationId !== query.applicationId)
  ) {
    return true;
  }
  if (read.verification && read.verification.applicationId !== query.applicationId) {
    return true;
  }
  return read.events.some((event) => !eventMatches(event, query));
}

function promotionFromLedger(
  events: readonly CompletionLedgerEvent[],
): EvolutionCompletionPromotionEvent[] {
  return events
    .filter((event) => event.type === "promotion.completed")
    .map((event) => ({
      eventId: event.eventId,
      type: event.type,
      tenantScope: event.tenantScope,
      proposalId: event.proposalId,
      experimentId: event.experimentId,
      applicationId: event.applicationId,
      verificationId: event.verificationId,
      target: event.target,
      surfaceId: event.surfaceId,
      candidateRef: event.candidateRef,
      principalRef: event.principalRef,
      timestamp: event.timestamp,
    }));
}

function verifiedAtFromLedger(read: CompletionLedgerRead, query: CompletionLedgerQuery): string {
  const verificationEvent = read.events.find(
    (event) =>
      event.type === "verification.completed" &&
      event.verificationId === read.verification?.verificationId &&
      eventMatches(event, query),
  );
  if (verificationEvent) {
    return verificationEvent.timestamp;
  }
  return read.verification?.verifiedAt ?? "";
}

function closed(reasonCode: string): EvolutionCompletionDecision {
  return {
    applicationVerified: false,
    recheckOutcome: null,
    promotionEligible: false,
    promotionCompleted: false,
    recommendation: "fail-closed",
    reasonCode,
    userVisibleStatus: "无法确认，已停止",
  };
}

function evaluationFor(
  read: CompletionLedgerRead,
  surfaceId: string,
  authorityOk: boolean,
  guardrailDegraded: boolean,
  experimentResult: ExperimentResult,
  override: EvaluationDecision | null | undefined,
): EvaluationDecision | null {
  if (override) {
    return override;
  }
  if (!read.proposal || !read.experiment || !read.recheck) {
    return null;
  }
  const policy = evaluationPolicyFor({
    surfaceId,
    producerKind: "diagnosis-origin",
  });
  if ("ok" in policy) {
    return { action: "block", reasonCode: "unknown_surface" };
  }
  const authority: unknown = authorityOk;
  return decideEvaluationOutcome(policy, {
    experimentResult: experimentResult === "pending" ? "inconclusive" : experimentResult,
    guardrailDegraded,
    authorityOk: authority !== false,
    domainVerified: true,
    externalEffectOutcome: "verified",
    recheck: read.recheck.outcome,
    sampleSize: 20,
    confidence: 0.95,
    rollbackDrillPassed: true,
  });
}

export function decideEvolutionCompletionFromLedger(input: {
  reader: CompletionLedgerReader;
  query: CompletionLedgerQuery;
  target: EvolutionCompletionTarget;
  surfaceId: string;
  candidateVersion: string;
  authorityOk: boolean;
  guardrailDegraded: boolean;
  experimentResult?: ExperimentResult;
  evaluation?: EvaluationDecision | null;
  /** Present means the caller tried to submit promotion.completed. */
  callerPromotionEvents?: unknown;
}): EvolutionCompletionDecision {
  if (input.callerPromotionEvents !== undefined) {
    return closed("caller_promotion_rejected");
  }
  const read = input.reader.read(input.query);
  if (read.duplicate) {
    return closed("ledger_duplicate_object");
  }
  if (outsideQuery(read, input.query)) {
    return closed("ledger_query_mismatch");
  }
  const verification = read.verification
    ? { ...read.verification, verifiedAt: verifiedAtFromLedger(read, input.query) }
    : null;
  const authority: unknown = input.authorityOk;
  const guardrail: unknown = input.guardrailDegraded;
  return decideEvolutionCompletion({
    tenantId: input.query.tenantId,
    target: input.target,
    surfaceId: input.surfaceId,
    candidateVersion: input.candidateVersion,
    proposal: read.proposal,
    experiment: read.experiment,
    application: read.application,
    verification,
    recheck: read.recheck,
    recheckRecordedAt: read.recheckRecordedAt,
    evaluation: evaluationFor(
      read,
      input.surfaceId,
      input.authorityOk,
      input.guardrailDegraded,
      input.experimentResult ?? "improved",
      input.evaluation,
    ),
    promotionEvents: sealServerPromotionEvents(promotionFromLedger(read.events)),
    authorityOk: authority === true,
    guardrailDegraded: guardrail !== false,
  });
}
