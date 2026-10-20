/**
 * Read-only Evolution Timeline projection (Phase 0 contract).
 *
 * Authority stays on Proposal / Experiment / Application / Verification /
 * Recheck / Ledger and the Diagnosis Report. This module does not write those
 * stores and does not add a state machine. Automatic execution is decided only
 * by `evaluateSurfaceAutonomy`.
 *
 * Diagnosis Proposal v1 remains the live write model. v2 is the projection and
 * query norm. Every item records `proposalSchema` and `legacy`.
 *
 * Contract: docs/design/openbot-evolution-perception-execution-plan-2026-09-25.md §3–§4.
 * Ledger-sequence list projection (Phase P0) lives in `timeline-list.ts` and only calls this module.
 * Phase P1 digest, pending, automatic, and Da Bai query binding live in `perception.ts`.
 * Phase P2 observation queue, trigger catalog, and delivery tiers live in `perception-p2.ts`.
 */
import { evaluateSurfaceAutonomy, type SurfaceAutonomyPolicy } from "./autonomy.js";
import type { EvolutionSurface } from "./contracts.js";
import { projectDiagnosisProposalV1 } from "./mapping.js";
import {
  evolutionTargetKey,
  type ApplicationScope,
  type DiagnosisProposalV1,
  type EvolutionApplication,
  type EvolutionConfidentialityScope,
  type EvolutionDomain,
  type EvolutionLedgerEventType,
  type EvolutionProposal,
  type EvolutionTarget,
  type EvolutionVerification,
  type VerificationOutcome,
} from "./types.js";

export const EVOLUTION_TIMELINE_ITEM_SCHEMA_VERSION = 1 as const;

/** §3 eight user-visible fields. Fact ids and schema marks sit beside them. */
export const EVOLUTION_TIMELINE_ITEM_FIELDS = [
  "changeObject",
  "beforeAfter",
  "reason",
  "executionMode",
  "evidence",
  "result",
  "impactScope",
  "reversible",
] as const;
export type EvolutionTimelineItemField = (typeof EVOLUTION_TIMELINE_ITEM_FIELDS)[number];

export const EVOLUTION_TIMELINE_BUCKETS = [
  "automatic",
  "user_approved",
  "pending",
  "observing",
  "rolled_back",
] as const;
export type EvolutionTimelineBucket = (typeof EVOLUTION_TIMELINE_BUCKETS)[number];

export const EVOLUTION_TIMELINE_EXECUTION_MODES = [
  "automatic",
  "user_confirmed",
  "admin_approved",
  "platform_release",
  "unknown",
] as const;
export type EvolutionTimelineExecutionMode = (typeof EVOLUTION_TIMELINE_EXECUTION_MODES)[number];

export const EVOLUTION_TIMELINE_RESULTS = [
  "verified_effective",
  "observing",
  "ineffective",
  "rolled_back",
  "pending",
  "unspecified",
] as const;
export type EvolutionTimelineResult = (typeof EVOLUTION_TIMELINE_RESULTS)[number];

export const EVOLUTION_TIMELINE_RESULT_LABELS: Record<EvolutionTimelineResult, string> = {
  verified_effective: "已验证有效",
  observing: "观察中",
  ineffective: "无效",
  rolled_back: "已回滚",
  pending: "待决定",
  unspecified: "未指定",
};

export const EVOLUTION_TIMELINE_COMPLETENESS = ["complete", "partial", "empty"] as const;
export type EvolutionTimelineCompleteness = (typeof EVOLUTION_TIMELINE_COMPLETENESS)[number];

export const EVOLUTION_DOMAIN_DISPLAY_NAMES: Record<EvolutionDomain, string> = {
  agent: "数字人",
  knowledge: "知识",
  capability: "能力",
  organization: "组织",
  system: "平台",
};

export const EVOLUTION_IMPACT_LABELS = {
  personal: "本人",
  enterprise: "企业",
  platform: "平台",
} as const;

/** Minimum Da Bai intents from the frozen plan §4. Names are contract ids, not a live tool. */
export const EVOLUTION_TIMELINE_INTENTS = [
  "learned_this_week",
  "diff_from_last_week",
  "automatic",
  "user_approved",
  "observing",
  "rolled_back",
  "platform_upgrades_this_week",
] as const;
export type EvolutionTimelineIntent = (typeof EVOLUTION_TIMELINE_INTENTS)[number];

export type EvolutionTimelineAudience = "digital_human" | "platform";

export type EvolutionTimelineFactIds = {
  ledgerEventId: string;
  proposalId: string | null;
  applicationId: string | null;
  verificationId: string | null;
};

export type EvolutionTimelineChangeObject = {
  target: EvolutionTarget;
  surfaceId: string;
  domain: EvolutionDomain;
  domainDisplayName: string;
};

export type EvolutionTimelineBeforeAfter = {
  versionBefore: string | null;
  versionAfter: string | null;
  /** `unavailable` when either version is missing. Not a model-written story. */
  summary: string;
};

export type EvolutionTimelineReason = {
  status: "specified" | "unspecified";
  sourceEvidenceRefs: readonly string[];
  sourceMechanismRef: string | null;
  caseId: string | null;
  findingIds: readonly string[];
};

export type EvolutionTimelineEvidence = {
  evidenceRefs: readonly string[];
  reportId: string | null;
  verificationId: string | null;
};

export type EvolutionTimelineImpactScope = {
  confidentialityScope: EvolutionConfidentialityScope | null;
  tenantScope: string | null;
  label: "本人" | "企业" | "平台" | "unspecified";
};

/**
 * One user-visible change. Read-only. `audience === "platform"` (domain `system`)
 * must not enter the digital-human "我学会了" set.
 */
export type EvolutionTimelineItem = {
  schemaVersion: typeof EVOLUTION_TIMELINE_ITEM_SCHEMA_VERSION;
  /** 1 = Diagnosis live write (or its legacy mark). 2 = native v2 query norm. */
  proposalSchema: 1 | 2;
  legacy: boolean;
  factIds: EvolutionTimelineFactIds;
  /** Separates platform (`system`) from digital-human domains. */
  audience: EvolutionTimelineAudience;
  changeObject: EvolutionTimelineChangeObject;
  beforeAfter: EvolutionTimelineBeforeAfter;
  reason: EvolutionTimelineReason;
  executionMode: EvolutionTimelineExecutionMode;
  evidence: EvolutionTimelineEvidence;
  result: EvolutionTimelineResult;
  /**
   * Exclusive weekly bucket. Precedence: rolled_back > pending > observing >
   * user_approved > automatic. A change has at most one.
   */
  bucket: EvolutionTimelineBucket | null;
  impactScope: EvolutionTimelineImpactScope;
  reversible: boolean;
  /** `partial` when the version pair is missing. The item may still be listed. */
  completeness: "complete" | "partial";
};

export type EvolutionTimelineLedgerFact = {
  eventId: string;
  type: EvolutionLedgerEventType;
  timestamp: string;
  proposalId: string;
  surfaceId: string;
  tenantScope: string | null;
  evidenceRefs: readonly string[];
  target?: EvolutionTarget;
  applicationId?: string;
  verificationId?: string;
  legacySource?: boolean;
};

export type EvolutionTimelineAutonomyInput = {
  policy?: SurfaceAutonomyPolicy;
  killSwitch?: boolean;
  now?: string;
  requestedScope?: ApplicationScope;
  expandScope?: boolean;
};

/**
 * Caller-supplied facts already read from the control plane.
 * This input is not a write payload.
 */
export type EvolutionTimelineProjectionInput = {
  events: readonly EvolutionTimelineLedgerFact[];
  proposal?: EvolutionProposal | null;
  proposalV1?: DiagnosisProposalV1 | null;
  application?: EvolutionApplication | null;
  verification?: EvolutionVerification | null;
  surface?: EvolutionSurface | null;
  autonomy?: EvolutionTimelineAutonomyInput;
  caseId?: string | null;
  findingIds?: readonly string[];
  reportId?: string | null;
  /**
   * Existing ledger event id for a platform release.
   * Honored only when that id is present in `events`.
   */
  platformReleaseEventId?: string | null;
};

export type EvolutionTimelineExclusionReason = "missing_target" | "missing_fact_id";

export type EvolutionTimelineProjectionResult =
  | { included: true; item: EvolutionTimelineItem }
  | { included: false; reason: EvolutionTimelineExclusionReason };

export type EvolutionTimelineQuery = {
  tenantScope: string;
  agentId?: string;
  window: { from: string; to: string };
  intent: EvolutionTimelineIntent;
};

export type EvolutionTimelineBucketCounts = Record<EvolutionTimelineBucket, number>;

/** §4 structured answer. Empty windows use `completeness: "empty"` and invent nothing. */
export type EvolutionTimelineQueryResult = {
  items: readonly EvolutionTimelineItem[];
  bucketCounts: EvolutionTimelineBucketCounts;
  platformItems: readonly EvolutionTimelineItem[];
  unresolvedIntents: readonly string[];
  completeness: EvolutionTimelineCompleteness;
};

export type EvolutionTimelineQueryDenial = {
  denied: true;
  reason: "permission_denied";
};

export function evolutionTimelineAudience(domain: EvolutionDomain): EvolutionTimelineAudience {
  return domain === "system" ? "platform" : "digital_human";
}

export function evolutionTimelineResultLabel(result: EvolutionTimelineResult): string {
  return EVOLUTION_TIMELINE_RESULT_LABELS[result];
}

export function emptyEvolutionTimelineBucketCounts(): EvolutionTimelineBucketCounts {
  return {
    automatic: 0,
    user_approved: 0,
    pending: 0,
    observing: 0,
    rolled_back: 0,
  };
}

export function countEvolutionTimelineBuckets(
  items: readonly EvolutionTimelineItem[],
): EvolutionTimelineBucketCounts {
  const counts = emptyEvolutionTimelineBucketCounts();
  for (const item of items) {
    if (item.bucket) {
      counts[item.bucket] += 1;
    }
  }
  return counts;
}

/** Fail-closed empty window. Not a model-authored list. */
export function emptyEvolutionTimelineQueryResult(): EvolutionTimelineQueryResult {
  return {
    items: [],
    bucketCounts: emptyEvolutionTimelineBucketCounts(),
    platformItems: [],
    unresolvedIntents: [],
    completeness: "empty",
  };
}

/** Fail-closed permission denial. Not a fallback list. */
export function denyEvolutionTimelineQuery(): EvolutionTimelineQueryDenial {
  return { denied: true, reason: "permission_denied" };
}

/**
 * Shapes already-projected items into the §4 answer.
 * Does not read Ledger and does not apply anything.
 */
export function assembleEvolutionTimelineQueryResult(
  items: readonly EvolutionTimelineItem[],
  unresolvedIntents: readonly string[] = [],
): EvolutionTimelineQueryResult {
  if (items.length === 0) {
    return emptyEvolutionTimelineQueryResult();
  }
  return {
    items: [...items],
    bucketCounts: countEvolutionTimelineBuckets(items),
    platformItems: items.filter((item) => item.audience === "platform"),
    unresolvedIntents: [...unresolvedIntents],
    completeness: items.some((item) => item.completeness === "partial") ? "partial" : "complete",
  };
}

/** Digital-human "我学会了" set. `system` domain items are excluded. */
export function digitalHumanLearnedItems(
  items: readonly EvolutionTimelineItem[],
): EvolutionTimelineItem[] {
  return items.filter((item) => item.audience === "digital_human");
}

export function projectEvolutionTimelineItem(
  input: EvolutionTimelineProjectionInput,
): EvolutionTimelineProjectionResult {
  const ordered = [...input.events].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
  const targeted = ordered.filter(
    (event): event is EvolutionTimelineLedgerFact & { target: EvolutionTarget } =>
      event.target != null,
  );
  if (targeted.length === 0) {
    return { included: false, reason: "missing_target" };
  }
  const targetKeys = new Set(targeted.map((event) => evolutionTargetKey(event.target)));
  if (targetKeys.size !== 1) {
    return { included: false, reason: "missing_target" };
  }

  const resolved = resolveProposal(input, ordered);
  const executionMode = resolveExecutionMode(input, ordered, resolved.proposal);
  const bucket = resolveBucket(input, ordered, resolved.proposal, executionMode);
  const anchor = anchorEvent(ordered, bucket);
  if (!anchor?.target || anchor.eventId.trim().length === 0) {
    return { included: false, reason: "missing_fact_id" };
  }

  const applicationId = firstId(
    input.application?.applicationId,
    ...ordered.map((event) => event.applicationId),
  );
  const verificationId = firstId(
    input.verification?.verificationId,
    ...ordered.map((event) => event.verificationId),
  );
  const proposalId = firstId(resolved.proposal?.proposalId, anchor.proposalId);
  const versionBefore = nonEmpty(input.application?.targetVersionBefore);
  const versionAfter = nonEmpty(input.application?.targetVersionAfter);
  const hasVersionPair = versionBefore != null && versionAfter != null;
  const sourceEvidenceRefs = uniqueStrings(resolved.proposal?.sourceEvidenceRefs ?? []);
  const findingIds = uniqueStrings([
    ...(input.findingIds ?? []),
    ...(input.proposalV1?.sourceFindingIds ?? []),
  ]);
  const evidenceRefs = uniqueStrings(ordered.flatMap((event) => event.evidenceRefs));
  const confidentialityScope = resolved.proposal?.confidentialityScope ?? null;

  const item: EvolutionTimelineItem = {
    schemaVersion: EVOLUTION_TIMELINE_ITEM_SCHEMA_VERSION,
    proposalSchema: resolved.proposalSchema,
    legacy: resolved.legacy,
    factIds: {
      ledgerEventId: anchor.eventId,
      proposalId,
      applicationId,
      verificationId,
    },
    audience: evolutionTimelineAudience(anchor.target.domain),
    changeObject: {
      target: anchor.target,
      surfaceId: anchor.surfaceId,
      domain: anchor.target.domain,
      domainDisplayName: EVOLUTION_DOMAIN_DISPLAY_NAMES[anchor.target.domain],
    },
    beforeAfter: {
      versionBefore,
      versionAfter,
      summary: hasVersionPair ? `${versionBefore} → ${versionAfter}` : "unavailable",
    },
    reason: {
      status: sourceEvidenceRefs.length > 0 ? "specified" : "unspecified",
      sourceEvidenceRefs,
      sourceMechanismRef: nonEmpty(resolved.proposal?.sourceMechanismRef),
      caseId: input.caseId ?? input.proposalV1?.sourceCaseId ?? null,
      findingIds,
    },
    executionMode,
    evidence: {
      evidenceRefs,
      reportId: input.reportId ?? input.proposalV1?.sourceReportRef ?? null,
      verificationId,
    },
    result: resolveResult(input, ordered, resolved.proposal),
    bucket,
    impactScope: {
      confidentialityScope,
      tenantScope: resolved.proposal?.tenantScope ?? anchor.tenantScope,
      label: impactLabel(confidentialityScope),
    },
    reversible: isReversible(input, ordered),
    completeness: hasVersionPair ? "complete" : "partial",
  };
  return { included: true, item };
}

type ResolvedProposal = {
  proposal: EvolutionProposal | null;
  proposalSchema: 1 | 2;
  legacy: boolean;
};

function resolveProposal(
  input: EvolutionTimelineProjectionInput,
  ordered: readonly EvolutionTimelineLedgerFact[],
): ResolvedProposal {
  const legacyEvent = ordered.some(
    (event) => event.legacySource === true || event.type === "legacy.imported",
  );
  if (input.proposal) {
    const legacy = Boolean(input.proposal.legacy) || legacyEvent;
    return { proposal: input.proposal, proposalSchema: legacy ? 1 : 2, legacy };
  }
  if (input.proposalV1) {
    return {
      proposal: projectDiagnosisProposalV1({ proposal: input.proposalV1 }),
      proposalSchema: 1,
      legacy: true,
    };
  }
  return { proposal: null, proposalSchema: legacyEvent ? 1 : 2, legacy: legacyEvent };
}

function resolveExecutionMode(
  input: EvolutionTimelineProjectionInput,
  ordered: readonly EvolutionTimelineLedgerFact[],
  proposal: EvolutionProposal | null,
): EvolutionTimelineExecutionMode {
  if (ordered.some((event) => event.type === "application.approved")) {
    if (proposal?.confidentialityScope === "personal") {
      return "user_confirmed";
    }
    if (
      proposal?.confidentialityScope === "enterprise" ||
      proposal?.confidentialityScope === "platform"
    ) {
      return "admin_approved";
    }
    return "unknown";
  }
  const authorized = ordered.some((event) => event.type === "proposal.authorized");
  if (authorized && autonomyAllowsAutomatic(input)) {
    return "automatic";
  }
  const releaseId = nonEmpty(input.platformReleaseEventId);
  if (releaseId && ordered.some((event) => event.eventId === releaseId)) {
    return "platform_release";
  }
  return "unknown";
}

function autonomyAllowsAutomatic(input: EvolutionTimelineProjectionInput): boolean {
  return evaluateSurfaceAutonomy({
    surface: input.surface ?? null,
    policy: input.autonomy?.policy,
    killSwitch: input.autonomy?.killSwitch,
    now: input.autonomy?.now,
    requestedScope: input.autonomy?.requestedScope,
    expandScope: input.autonomy?.expandScope,
  }).ok;
}

/**
 * Exclusive bucket. rolled_back beats a verified result. pending beats observing.
 * In-flight or neutral/inconclusive changes stay in observing, so they are not
 * also counted as automatic or user_approved.
 */
function resolveBucket(
  input: EvolutionTimelineProjectionInput,
  ordered: readonly EvolutionTimelineLedgerFact[],
  proposal: EvolutionProposal | null,
  executionMode: EvolutionTimelineExecutionMode,
): EvolutionTimelineBucket | null {
  if (hasRollbackCompleted(ordered)) {
    return "rolled_back";
  }
  if (isAwaitingDecision(ordered, proposal, input.proposalV1)) {
    return "pending";
  }
  if (isObserving(input, ordered)) {
    return "observing";
  }
  if (isUserApproved(ordered)) {
    return "user_approved";
  }
  if (executionMode === "automatic") {
    return "automatic";
  }
  return null;
}

/** True only for a final rollback, not a superseded rollback-drill receipt. */
function hasFinalRollbackResult(
  input: EvolutionTimelineProjectionInput,
  ordered: readonly EvolutionTimelineLedgerFact[],
): boolean {
  if (hasRollbackCompleted(ordered)) {
    return true;
  }
  if (input.application?.status === "rolled_back") {
    return true;
  }
  const lastRollbackAt = [...ordered]
    .filter((event) => event.type === "application.rolled_back")
    .map((event) => event.timestamp)
    .sort()
    .at(-1);
  if (!lastRollbackAt) {
    return false;
  }
  const superseded = ordered.some(
    (event) =>
      (event.type === "application.applied" ||
        event.type === "verification.completed" ||
        event.type === "promotion.completed") &&
      event.timestamp > lastRollbackAt,
  );
  return !superseded;
}

function resolveResult(
  input: EvolutionTimelineProjectionInput,
  ordered: readonly EvolutionTimelineLedgerFact[],
  proposal: EvolutionProposal | null,
): EvolutionTimelineResult {
  // Drill emits application.rolled_back as a receipt. A later canary re-apply
  // + verification must win so soft/observe Promote can surface verified_effective.
  if (hasFinalRollbackResult(input, ordered)) {
    return "rolled_back";
  }
  if (isAwaitingDecision(ordered, proposal, input.proposalV1)) {
    return "pending";
  }
  const outcome = completedVerificationOutcome(ordered, input.verification);
  if (outcome === "improved") {
    return "verified_effective";
  }
  if (outcome === "regressed") {
    return "ineffective";
  }
  if (outcome === "neutral" || outcome === "inconclusive") {
    return "observing";
  }
  if (isAppliedOrHeld(input, ordered)) {
    return "observing";
  }
  return "unspecified";
}

function hasRollbackCompleted(ordered: readonly EvolutionTimelineLedgerFact[]): boolean {
  return ordered.some((event) => event.type === "rollback.completed");
}

function isAwaitingDecision(
  ordered: readonly EvolutionTimelineLedgerFact[],
  proposal: EvolutionProposal | null,
  proposalV1: DiagnosisProposalV1 | null | undefined,
): boolean {
  const progressed = ordered.some(
    (event) =>
      event.type === "application.approved" ||
      event.type === "application.applied" ||
      event.type === "proposal.authorized" ||
      event.type === "proposal.rejected" ||
      event.type === "rollback.completed" ||
      event.type === "application.rolled_back",
  );
  if (progressed) {
    return false;
  }
  return (
    proposal?.status === "PENDING_AUTHORITY" ||
    proposal?.legacy?.status === "PENDING_APPROVAL" ||
    proposalV1?.status === "PENDING_APPROVAL" ||
    ordered.some((event) => event.type === "application.approval_pending")
  );
}

function isObserving(
  input: EvolutionTimelineProjectionInput,
  ordered: readonly EvolutionTimelineLedgerFact[],
): boolean {
  if (!isAppliedOrHeld(input, ordered)) {
    return false;
  }
  const outcome = completedVerificationOutcome(ordered, input.verification);
  return outcome !== "improved" && outcome !== "regressed";
}

function isAppliedOrHeld(
  input: EvolutionTimelineProjectionInput,
  ordered: readonly EvolutionTimelineLedgerFact[],
): boolean {
  return (
    ordered.some(
      (event) => event.type === "application.applied" || event.type === "experiment.held",
    ) || input.application?.status === "applied"
  );
}

function isUserApproved(ordered: readonly EvolutionTimelineLedgerFact[]): boolean {
  const approval = ordered.find((event) => event.type === "application.approved");
  const applied = ordered.find((event) => event.type === "application.applied");
  if (!approval || !applied) {
    return false;
  }
  return approval.timestamp <= applied.timestamp;
}

function completedVerificationOutcome(
  ordered: readonly EvolutionTimelineLedgerFact[],
  verification: EvolutionVerification | null | undefined,
): VerificationOutcome | null {
  if (!verification) {
    return null;
  }
  if (!ordered.some((event) => event.type === "verification.completed")) {
    return null;
  }
  return verification.outcome;
}

function anchorEvent(
  ordered: readonly EvolutionTimelineLedgerFact[],
  bucket: EvolutionTimelineBucket | null,
): EvolutionTimelineLedgerFact | null {
  const preferred: readonly EvolutionLedgerEventType[] =
    bucket === "rolled_back"
      ? ["rollback.completed", "application.rolled_back"]
      : bucket === "pending"
        ? ["application.approval_pending", "proposal.created"]
        : bucket === "observing"
          ? ["application.applied", "experiment.held"]
          : bucket === "user_approved"
            ? ["application.approved", "application.applied"]
            : bucket === "automatic"
              ? ["proposal.authorized", "verification.completed"]
              : [];
  for (const type of preferred) {
    const match = [...ordered]
      .reverse()
      .find((event) => event.type === type && event.target && event.eventId.trim().length > 0);
    if (match) {
      return match;
    }
  }
  return (
    [...ordered].reverse().find((event) => event.target && event.eventId.trim().length > 0) ?? null
  );
}

function isReversible(
  input: EvolutionTimelineProjectionInput,
  ordered: readonly EvolutionTimelineLedgerFact[],
): boolean {
  const surface = input.surface;
  if (!surface?.allowedOperations.includes("rollback")) {
    return false;
  }
  const hasStrategy = (surface.rollbackStrategy ?? "").trim().length > 0;
  const hasReference =
    nonEmpty(input.application?.rollbackRef) != null ||
    nonEmpty(input.application?.rollbackDrillId) != null ||
    ordered.some(
      (event) =>
        event.type === "rollback.completed" ||
        event.type === "rollback_drill.completed" ||
        event.type === "application.rolled_back",
    );
  return hasReference || hasStrategy;
}

function impactLabel(
  scope: EvolutionConfidentialityScope | null,
): EvolutionTimelineImpactScope["label"] {
  if (scope === "personal" || scope === "enterprise" || scope === "platform") {
    return EVOLUTION_IMPACT_LABELS[scope];
  }
  return "unspecified";
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstId(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const id = nonEmpty(value);
    if (id) {
      return id;
    }
  }
  return null;
}
