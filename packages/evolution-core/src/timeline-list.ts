/**
 * Phase P0: read-only Evolution Timeline list.
 *
 * Projects a Ledger sequence, plus Application / Verification / Proposal
 * snapshots, into `EvolutionTimelineItem[]`. One change is one proposal plus
 * one target. Events without a target never become items.
 *
 * This module does not write Ledger, Proposal, Application, or Verification,
 * does not open a second fact store, and does not grant autonomy. Surfaces and
 * autonomy facts are caller-supplied snapshots. Diagnosis Proposal v1 stays the
 * live write model; when a v1 snapshot is present it is projected read-only
 * and the item is marked `proposalSchema: 1` / `legacy`.
 *
 * Contract: docs/design/openbot-evolution-perception-execution-plan-2026-09-25.md §5 Phase P0.
 */
import type { EvolutionSurface } from "./contracts.js";
import {
  digitalHumanLearnedItems,
  projectEvolutionTimelineItem,
  type EvolutionTimelineAutonomyInput,
  type EvolutionTimelineExclusionReason,
  type EvolutionTimelineItem,
  type EvolutionTimelineLedgerFact,
} from "./timeline.js";
import {
  evolutionTargetKey,
  type DiagnosisProposalV1,
  type EvolutionApplication,
  type EvolutionLedgerEvent,
  type EvolutionProposal,
  type EvolutionTarget,
  type EvolutionVerification,
} from "./types.js";

/** Public list operations. All of them are read-only projections. */
export const EVOLUTION_TIMELINE_LIST_OPERATIONS = [
  "projectEvolutionTimeline",
  "digitalHumanLearnedTimeline",
] as const;

export const EVOLUTION_TIMELINE_LIST_ACCESS = "read-only" as const;

/** Ledger row or the slimmer fact used when a fixture omits hash fields. */
export type EvolutionTimelineLedgerSource = EvolutionTimelineLedgerFact | EvolutionLedgerEvent;

/**
 * Already-read control-plane snapshots. Not a write payload.
 * Omitting `surfaces` or autonomy fails closed (nothing becomes `automatic`).
 */
export type EvolutionTimelineListInput = {
  events: readonly EvolutionTimelineLedgerSource[];
  proposals?: readonly EvolutionProposal[];
  proposalsV1?: readonly DiagnosisProposalV1[];
  applications?: readonly EvolutionApplication[];
  verifications?: readonly EvolutionVerification[];
  surfaces?: readonly EvolutionSurface[];
  autonomyBySurfaceId?: Readonly<Record<string, EvolutionTimelineAutonomyInput>>;
  platformReleaseEventIds?: readonly string[];
};

export type EvolutionTimelineListExclusion = {
  /** proposalId when present, otherwise the ledger event id. */
  key: string;
  reason: EvolutionTimelineExclusionReason;
  ledgerEventIds: readonly string[];
};

export type EvolutionTimelineListProjection = {
  items: readonly EvolutionTimelineItem[];
  exclusions: readonly EvolutionTimelineListExclusion[];
};

type TargetedFact = EvolutionTimelineLedgerFact & { target: EvolutionTarget };

/**
 * Build the timeline list. Returns new arrays and does not mutate `input`.
 */
export function projectEvolutionTimeline(
  input: EvolutionTimelineListInput,
): EvolutionTimelineListProjection {
  const facts = input.events.map(toLedgerFact);
  const groups = new Map<string, TargetedFact[]>();
  const untargeted = new Map<string, string[]>();

  for (const fact of facts) {
    if (!hasTarget(fact)) {
      const key = exclusionKey(fact);
      const ids = untargeted.get(key) ?? [];
      ids.push(fact.eventId);
      untargeted.set(key, ids);
      continue;
    }
    const key = groupKey(fact);
    const group = groups.get(key) ?? [];
    group.push(fact);
    groups.set(key, group);
  }

  const exclusions: EvolutionTimelineListExclusion[] = [...untargeted.entries()].map(
    ([key, ledgerEventIds]) => ({
      key,
      reason: "missing_target",
      ledgerEventIds,
    }),
  );

  const orderedGroups = [...groups.entries()].sort((left, right) => {
    const byTime = earliestTimestamp(left[1]).localeCompare(earliestTimestamp(right[1]));
    return byTime === 0 ? left[0].localeCompare(right[0]) : byTime;
  });

  const items: EvolutionTimelineItem[] = [];
  for (const [key, grouped] of orderedGroups) {
    const events = [...grouped].sort(compareFacts);
    const target = events[0]?.target;
    if (!target) {
      continue;
    }
    const proposalId = nonEmpty(events[0]?.proposalId) ?? "";
    const resolved = resolveGroupProposal(proposalId, target, input);
    const application = selectApplication(
      proposalId,
      events,
      input.applications ?? [],
      resolved.proposal,
      resolved.proposalV1,
    );
    const verification = selectVerification(
      events,
      input.verifications ?? [],
      application,
      resolved.proposal,
    );
    const surfaceId =
      [...events].reverse().find((event) => nonEmpty(event.surfaceId))?.surfaceId ??
      resolved.proposal?.surfaceId ??
      null;
    const surface = surfaceId
      ? (input.surfaces?.find((item) => item.surfaceId === surfaceId) ?? null)
      : null;
    const releaseId = selectPlatformRelease(events, input.platformReleaseEventIds ?? []);
    const projected = projectEvolutionTimelineItem({
      events,
      proposal: resolved.proposal,
      proposalV1: resolved.proposalV1,
      application,
      verification,
      surface,
      autonomy: surfaceId ? input.autonomyBySurfaceId?.[surfaceId] : undefined,
      platformReleaseEventId: releaseId,
    });
    if (!projected.included) {
      exclusions.push({
        key,
        reason: projected.reason,
        ledgerEventIds: events.map((event) => event.eventId),
      });
      continue;
    }
    items.push(projected.item);
  }

  return { items, exclusions };
}

/**
 * Digital-human "我学会了" collection.
 * `system` domain items stay on the full timeline and are omitted here.
 */
export function digitalHumanLearnedTimeline(
  input: EvolutionTimelineListInput,
): EvolutionTimelineItem[] {
  return digitalHumanLearnedItems(projectEvolutionTimeline(input).items);
}

function toLedgerFact(source: EvolutionTimelineLedgerSource): EvolutionTimelineLedgerFact {
  return {
    eventId: source.eventId,
    type: source.type,
    timestamp: source.timestamp,
    proposalId: source.proposalId,
    surfaceId: source.surfaceId,
    tenantScope: source.tenantScope,
    evidenceRefs: [...source.evidenceRefs],
    ...(source.target ? { target: source.target } : {}),
    ...(source.applicationId ? { applicationId: source.applicationId } : {}),
    ...(source.verificationId ? { verificationId: source.verificationId } : {}),
    ...(source.legacySource ? { legacySource: true } : {}),
  };
}

function hasTarget(fact: EvolutionTimelineLedgerFact): fact is TargetedFact {
  return fact.target != null;
}

function groupKey(fact: TargetedFact): string {
  const proposalId = nonEmpty(fact.proposalId);
  const targetKey = evolutionTargetKey(fact.target);
  return proposalId ? `${proposalId}::${targetKey}` : `event:${fact.eventId}::${targetKey}`;
}

function exclusionKey(fact: EvolutionTimelineLedgerFact): string {
  return nonEmpty(fact.proposalId) ?? nonEmpty(fact.eventId) ?? "missing-target";
}

function resolveGroupProposal(
  proposalId: string,
  target: EvolutionTarget,
  input: EvolutionTimelineListInput,
): { proposal: EvolutionProposal | null; proposalV1: DiagnosisProposalV1 | null } {
  if (!proposalId) {
    return { proposal: null, proposalV1: null };
  }
  // v1 is still the live write model. Prefer its read-only projection so the
  // item is marked legacy instead of a parallel v2 copy of the same id.
  const proposalV1 = input.proposalsV1?.find((item) => item.proposalId === proposalId) ?? null;
  if (proposalV1) {
    return { proposal: null, proposalV1 };
  }
  const targetKey = evolutionTargetKey(target);
  const proposal =
    input.proposals?.find(
      (item) => item.proposalId === proposalId && evolutionTargetKey(item.target) === targetKey,
    ) ?? null;
  return { proposal, proposalV1: null };
}

function selectApplication(
  proposalId: string,
  events: readonly EvolutionTimelineLedgerFact[],
  applications: readonly EvolutionApplication[],
  proposal: EvolutionProposal | null,
  proposalV1: DiagnosisProposalV1 | null,
): EvolutionApplication | null {
  const ordered = [...events].sort(compareFacts).reverse();
  for (const event of ordered) {
    const applicationId = nonEmpty(event.applicationId);
    if (!applicationId) {
      continue;
    }
    const found = applications.find((item) => item.applicationId === applicationId);
    if (found && (!proposalId || found.proposalId === proposalId)) {
      return found;
    }
  }
  const referenced = nonEmpty(proposal?.applicationId) ?? nonEmpty(proposalV1?.applicationRef);
  if (referenced) {
    const found = applications.find(
      (item) =>
        item.applicationId === referenced && (!proposalId || item.proposalId === proposalId),
    );
    if (found) {
      return found;
    }
  }
  if (!proposalId) {
    return null;
  }
  const matches = applications.filter((item) => item.proposalId === proposalId);
  return matches.length === 1 ? matches[0] : null;
}

function selectVerification(
  events: readonly EvolutionTimelineLedgerFact[],
  verifications: readonly EvolutionVerification[],
  application: EvolutionApplication | null,
  proposal: EvolutionProposal | null,
): EvolutionVerification | null {
  const ordered = [...events].sort(compareFacts).reverse();
  for (const event of ordered) {
    const verificationId = nonEmpty(event.verificationId);
    if (!verificationId) {
      continue;
    }
    const found = verifications.find((item) => item.verificationId === verificationId);
    if (!found) {
      continue;
    }
    if (application && found.applicationId !== application.applicationId) {
      continue;
    }
    return found;
  }
  const referenced = nonEmpty(proposal?.verificationId);
  if (referenced) {
    const found = verifications.find((item) => item.verificationId === referenced);
    if (found && (!application || found.applicationId === application.applicationId)) {
      return found;
    }
  }
  if (!application) {
    return null;
  }
  const matches = verifications.filter((item) => item.applicationId === application.applicationId);
  return matches.length === 1 ? matches[0] : null;
}

function selectPlatformRelease(
  events: readonly TargetedFact[],
  releaseIds: readonly string[],
): string | null {
  if (releaseIds.length === 0) {
    return null;
  }
  const allowed = new Set(releaseIds);
  const match = [...events]
    .reverse()
    .find((event) => allowed.has(event.eventId) && nonEmpty(event.eventId));
  return match?.eventId ?? null;
}

function earliestTimestamp(events: readonly EvolutionTimelineLedgerFact[]): string {
  return [...events].sort(compareFacts)[0]?.timestamp ?? "";
}

function compareFacts(
  left: EvolutionTimelineLedgerFact,
  right: EvolutionTimelineLedgerFact,
): number {
  const byTime = left.timestamp.localeCompare(right.timestamp);
  return byTime === 0 ? left.eventId.localeCompare(right.eventId) : byTime;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
