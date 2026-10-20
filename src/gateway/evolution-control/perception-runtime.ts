/**
 * Runtime wiring for the evolution perception projections.
 *
 * Reads the existing control plane and calls `@openbot/evolution-core`
 * projections. It does not append Ledger events, Apply, open a receipt
 * store, or evaluate a new autonomy grant. Autonomy policy is forwarded
 * only when the caller-supplied snapshot already carries it; the live
 * plane snapshot omits it, so automatic classification stays fail-closed.
 *
 * Claim grade of this module: runtime-enabled. Not production-proven.
 * Contract: docs/design/openbot-evolution-perception-execution-plan-2026-09-25.md §1, §4.
 */
import {
  digitalHumanLearnedTimeline,
  measureEvolutionTriggerCatalog,
  projectAutomaticActions,
  projectEvolutionDelivery,
  projectEvolutionTimeline,
  projectObservationQueue,
  projectPendingDecisions,
  projectWeeklyEvolutionDigest,
  queryEvolutionPerception,
  renderEvolutionNarration,
  assertLearnedNarrationHasFactId,
  classifyEvolutionTriggerSightings,
  EvolutionNarrationGuardError,
  EVOLUTION_TIMELINE_INTENTS,
  isEvolutionTimelineIntent,
  denyEvolutionTimelineQuery,
  emptyEvolutionTimelineQueryResult,
  type EvolutionApplication,
  type EvolutionNarration,
  type EvolutionProposal,
  type EvolutionTimelineIntent,
  type EvolutionTimelineItem,
  type EvolutionTimelineListInput,
  type EvolutionTimelineQueryDenial,
  type EvolutionTimelineQueryResult,
  type EvolutionTriggerSighting,
  type EvolutionVerification,
} from "@openbot/evolution-core";
import { ensureEvolutionControlPlaneStarted } from "./bootstrap.js";
import type { EvolutionControlPlane } from "./control-plane.js";
import { listRegisteredEvolutionSurfaces } from "./surface-registry.js";

export const EVOLUTION_PERCEPTION_RUNTIME_ACCESS = "read-only" as const;

export const EVOLUTION_PERCEPTION_PROJECT_OPERATIONS = [
  "timeline",
  "digest",
  "pending",
  "automatic",
  "observation",
  "delivery",
  "triggers",
  "trigger_catalog",
] as const;
export type EvolutionPerceptionProjectOperation =
  (typeof EVOLUTION_PERCEPTION_PROJECT_OPERATIONS)[number];

export type EvolutionPerceptionWindow = { from: string; to: string };

export type EvolutionPerceptionPlane = Pick<
  EvolutionControlPlane,
  "listProposals" | "listApplications" | "getVerification"
> & {
  ledger: Pick<EvolutionControlPlane["ledger"], "list">;
};

type SnapshotReader = () => EvolutionTimelineListInput;

let snapshotForTests: SnapshotReader | undefined;

/** Vitest hook. Production leaves this unset and reads the live plane. */
export function setEvolutionPerceptionSnapshotForTests(read?: SnapshotReader): void {
  snapshotForTests = read;
}

/**
 * Copy already-stored control-plane rows. Does not append, and does not
 * attach an autonomy policy.
 */
export function snapshotEvolutionPerceptionFromPlane(
  plane: EvolutionPerceptionPlane,
): EvolutionTimelineListInput {
  const events = plane.ledger.list().map(copyLedgerEvent);
  const proposals = plane.listProposals().map(copyProposal);
  const applications = plane.listApplications().map(copyApplication);
  const verificationIds = new Set<string>();
  for (const event of events) {
    if (event.verificationId) {
      verificationIds.add(event.verificationId);
    }
  }
  for (const proposal of proposals) {
    if (proposal.verificationId) {
      verificationIds.add(proposal.verificationId);
    }
  }
  const verifications: EvolutionVerification[] = [];
  for (const verificationId of verificationIds) {
    const verification = plane.getVerification(verificationId);
    if (verification) {
      verifications.push({ ...verification, evidenceRefs: [...verification.evidenceRefs] });
    }
  }
  return {
    events,
    proposals,
    applications,
    verifications,
    surfaces: [...listRegisteredEvolutionSurfaces()],
  };
}

export function readEvolutionPerceptionSnapshot(): EvolutionTimelineListInput {
  if (snapshotForTests) {
    return snapshotForTests();
  }
  return snapshotEvolutionPerceptionFromPlane(ensureEvolutionControlPlaneStarted());
}

/** Keep one tenant. Other tenants and blank scopes are dropped. */
export function scopeEvolutionPerceptionSnapshot(
  input: EvolutionTimelineListInput,
  tenantScope: string,
): EvolutionTimelineListInput {
  const events = input.events
    .filter((event) => event.tenantScope === tenantScope)
    .map(copyLedgerEvent);
  const proposals = (input.proposals ?? [])
    .filter((proposal) => proposal.tenantScope === tenantScope)
    .map(copyProposal);
  const proposalsV1 = (input.proposalsV1 ?? []).filter(
    (proposal) => proposal.tenantScope === tenantScope,
  );
  const proposalIds = new Set(proposals.map((proposal) => proposal.proposalId));
  const eventApplicationIds = new Set(
    events.flatMap((event) => (event.applicationId ? [event.applicationId] : [])),
  );
  const applications = (input.applications ?? [])
    .filter(
      (application) =>
        proposalIds.has(application.proposalId) ||
        eventApplicationIds.has(application.applicationId),
    )
    .map(copyApplication);
  const verificationIds = new Set<string>();
  for (const event of events) {
    if (event.verificationId) {
      verificationIds.add(event.verificationId);
    }
  }
  for (const proposal of proposals) {
    if (proposal.verificationId) {
      verificationIds.add(proposal.verificationId);
    }
  }
  const verifications = (input.verifications ?? [])
    .filter((verification) => verificationIds.has(verification.verificationId))
    .map((verification) => ({
      ...verification,
      evidenceRefs: [...verification.evidenceRefs],
      guardrailResults: verification.guardrailResults.map((row) => ({ ...row })),
    }));
  return {
    events,
    proposals,
    proposalsV1: proposalsV1.map((proposal) => ({
      ...proposal,
      sourceFindingIds: [...proposal.sourceFindingIds],
      sourceEvidenceRefs: [...proposal.sourceEvidenceRefs],
    })),
    applications,
    verifications,
    surfaces: input.surfaces ? [...input.surfaces] : undefined,
    ...(input.autonomyBySurfaceId ? { autonomyBySurfaceId: input.autonomyBySurfaceId } : {}),
    ...(input.platformReleaseEventIds
      ? { platformReleaseEventIds: [...input.platformReleaseEventIds] }
      : {}),
  };
}

export type EvolutionPerceptionNarrationGuard = "missing_fact_id" | "system_domain";

export type EvolutionPerceptionQueryResponse = {
  access: typeof EVOLUTION_PERCEPTION_RUNTIME_ACCESS;
  operation: "query";
  persisted: false;
  tenantScope: string | null;
  intent: string;
  denial: EvolutionTimelineQueryDenial | null;
  result: EvolutionTimelineQueryResult | null;
  narration: EvolutionNarration | null;
  narrationGuard: EvolutionPerceptionNarrationGuard | null;
};

export function publishEvolutionNarration(
  result: EvolutionTimelineQueryResult,
  intent: EvolutionTimelineIntent,
):
  | { narration: EvolutionNarration; narrationGuard: null }
  | { narration: null; narrationGuard: EvolutionPerceptionNarrationGuard } {
  try {
    const narration = renderEvolutionNarration(result, intent);
    for (const sentence of narration.learned) {
      assertLearnedNarrationHasFactId(sentence, result.items);
    }
    for (const sentence of [...narration.platform, ...narration.other, ...narration.learned]) {
      if (/学会了/.test(sentence) && !sentenceMentionsFact(sentence, result)) {
        throw new EvolutionNarrationGuardError(
          "missing_fact_id",
          "learned narration cannot be emitted without an item fact id",
        );
      }
    }
    return { narration, narrationGuard: null };
  } catch (error) {
    if (error instanceof EvolutionNarrationGuardError) {
      return { narration: null, narrationGuard: error.code };
    }
    throw error;
  }
}

export function runEvolutionPerceptionQuery(input: {
  snapshot: EvolutionTimelineListInput;
  tenantScope: string | null;
  claimedTenantScope?: string;
  agentId?: string;
  window?: EvolutionPerceptionWindow;
  intent: string;
}): EvolutionPerceptionQueryResponse {
  const intent = input.intent.trim();
  const denied =
    !input.tenantScope ||
    (input.claimedTenantScope !== undefined && input.claimedTenantScope !== input.tenantScope);
  if (denied || !input.tenantScope) {
    return {
      access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
      operation: "query",
      persisted: false,
      tenantScope: input.tenantScope,
      intent,
      denial: denyEvolutionTimelineQuery(),
      result: null,
      narration: null,
      narrationGuard: null,
    };
  }
  if (!input.window) {
    return {
      access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
      operation: "query",
      persisted: false,
      tenantScope: input.tenantScope,
      intent,
      denial: null,
      result: emptyEvolutionTimelineQueryResult(),
      narration: null,
      narrationGuard: null,
    };
  }
  const scoped = scopeEvolutionPerceptionSnapshot(input.snapshot, input.tenantScope);
  const queried = queryEvolutionPerception(scoped, {
    tenantScope: input.tenantScope,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    window: input.window,
    intent,
    permitted: true,
  });
  if ("denied" in queried) {
    return {
      access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
      operation: "query",
      persisted: false,
      tenantScope: input.tenantScope,
      intent,
      denial: queried,
      result: null,
      narration: null,
      narrationGuard: null,
    };
  }
  const published = isEvolutionTimelineIntent(intent)
    ? publishEvolutionNarration(queried, intent)
    : { narration: null, narrationGuard: null as EvolutionPerceptionNarrationGuard | null };
  return {
    access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
    operation: "query",
    persisted: false,
    tenantScope: input.tenantScope,
    intent,
    denial: null,
    result: queried,
    narration: published.narration,
    narrationGuard: published.narrationGuard,
  };
}

export function isEvolutionPerceptionProjectOperation(
  value: string,
): value is EvolutionPerceptionProjectOperation {
  return (EVOLUTION_PERCEPTION_PROJECT_OPERATIONS as readonly string[]).includes(value);
}

export function runEvolutionPerceptionProject(input: {
  snapshot: EvolutionTimelineListInput;
  tenantScope: string | null;
  claimedTenantScope?: string;
  agentId?: string;
  window?: EvolutionPerceptionWindow;
  operation: string;
  sightings?: readonly EvolutionTriggerSighting[];
}):
  | { denied: true; denial: EvolutionTimelineQueryDenial }
  | {
      denied: false;
      operation: EvolutionPerceptionProjectOperation;
      persisted: false;
      projection: unknown;
    }
  | { denied: false; unknownOperation: true } {
  if (
    !input.tenantScope ||
    (input.claimedTenantScope !== undefined && input.claimedTenantScope !== input.tenantScope)
  ) {
    return { denied: true, denial: denyEvolutionTimelineQuery() };
  }
  if (!isEvolutionPerceptionProjectOperation(input.operation)) {
    return { denied: false, unknownOperation: true };
  }
  const scoped = scopeEvolutionPerceptionSnapshot(input.snapshot, input.tenantScope);
  const scope = {
    tenantScope: input.tenantScope,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.window ? { window: input.window } : {}),
  };
  return {
    denied: false,
    operation: input.operation,
    persisted: false,
    projection: projectOperation(input.operation, scoped, scope, input),
  };
}

function projectOperation(
  operation: EvolutionPerceptionProjectOperation,
  scoped: EvolutionTimelineListInput,
  scope: {
    tenantScope: string;
    agentId?: string;
    window?: EvolutionPerceptionWindow;
  },
  input: { sightings?: readonly EvolutionTriggerSighting[] },
): unknown {
  if (operation === "timeline") {
    const projected = projectEvolutionTimeline(scoped);
    const learned = digitalHumanLearnedTimeline(scoped);
    if (!scope.window) {
      return {
        access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
        items: projected.items,
        exclusions: projected.exclusions,
        learnedItems: learned,
      };
    }
    const inWindow = new Set(windowItems(scoped, scope).map((item) => item.factIds.ledgerEventId));
    return {
      access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
      items: projected.items.filter((item) => inWindow.has(item.factIds.ledgerEventId)),
      exclusions: projected.exclusions,
      learnedItems: learned.filter((item) => inWindow.has(item.factIds.ledgerEventId)),
    };
  }
  if (operation === "digest") {
    if (!scope.window) {
      return { access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS, completeness: "empty", items: [] };
    }
    return projectWeeklyEvolutionDigest(scoped, {
      window: scope.window,
      tenantScope: scope.tenantScope,
      ...(scope.agentId ? { agentId: scope.agentId } : {}),
    });
  }
  if (operation === "pending") {
    return projectPendingDecisions(scoped, scope);
  }
  if (operation === "automatic") {
    return {
      access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
      actions: projectAutomaticActions(scoped, scope),
    };
  }
  if (operation === "observation") {
    return projectObservationQueue(scoped, scope);
  }
  if (operation === "delivery") {
    const items = scope.window ? windowItems(scoped, scope) : [];
    return {
      receiptStore: false,
      ...projectEvolutionDelivery(items),
      access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
    };
  }
  if (operation === "triggers") {
    const sightings = (input.sightings ?? []).filter(
      (sighting) => sighting.tenantScope === scope.tenantScope,
    );
    return {
      source: "caller_sightings",
      persisted: false,
      ...classifyEvolutionTriggerSightings(sightings),
      access: EVOLUTION_PERCEPTION_RUNTIME_ACCESS,
    };
  }
  return measureEvolutionTriggerCatalog();
}

function windowItems(
  scoped: EvolutionTimelineListInput,
  scope: { tenantScope: string; agentId?: string; window?: EvolutionPerceptionWindow },
): EvolutionTimelineItem[] {
  if (!scope.window) {
    return [];
  }
  return [
    ...projectWeeklyEvolutionDigest(scoped, {
      window: scope.window,
      tenantScope: scope.tenantScope,
      ...(scope.agentId ? { agentId: scope.agentId } : {}),
    }).items,
  ];
}

function sentenceMentionsFact(sentence: string, result: EvolutionTimelineQueryResult): boolean {
  const items = [...result.items, ...result.platformItems];
  return items.some((item) => {
    const id = item.factIds.ledgerEventId.trim();
    return id.length > 0 && sentence.includes(id);
  });
}

function copyLedgerEvent(
  event: EvolutionTimelineListInput["events"][number],
): EvolutionTimelineListInput["events"][number] {
  return {
    ...event,
    evidenceRefs: [...event.evidenceRefs],
    ...(event.target ? { target: copyTarget(event.target) } : {}),
  };
}

function copyTarget(target: NonNullable<EvolutionTimelineListInput["events"][number]["target"]>) {
  switch (target.domain) {
    case "agent":
      return { domain: "agent" as const, agentId: target.agentId };
    case "knowledge":
      return { domain: "knowledge" as const, assetId: target.assetId };
    case "capability":
      return { domain: "capability" as const, skillId: target.skillId };
    case "organization":
      return { domain: "organization" as const, groupId: target.groupId };
    case "system":
      return { domain: "system" as const, componentId: target.componentId };
  }
}

function copyProposal(proposal: EvolutionProposal): EvolutionProposal {
  return {
    ...proposal,
    sourceEvidenceRefs: [...proposal.sourceEvidenceRefs],
    expectedEffects: proposal.expectedEffects.map((effect) => ({ ...effect })),
    target: { ...proposal.target },
    ...(proposal.legacy ? { legacy: { ...proposal.legacy } } : {}),
  };
}

function copyApplication(application: EvolutionApplication): EvolutionApplication {
  return { ...application };
}

export const EVOLUTION_PERCEPTION_QUERY_INTENTS = EVOLUTION_TIMELINE_INTENTS;
