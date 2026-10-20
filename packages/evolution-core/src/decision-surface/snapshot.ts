/**
 * Shared snapshot helpers for the audience Decision Surfaces (employee D2,
 * enterprise D3). There is one path from server facts to D1 views and one
 * weekly window rule, so the surfaces cannot drift apart.
 * Pure. No Gateway, store, or Adapter. Claim grade: code-present.
 */
import type {
  EvolutionDecisionItem,
  EvolutionDecisionPrincipal,
  EvolutionDecisionType,
} from "./dto.js";
import {
  routeEvolutionDecisionSurface,
  type EvolutionDecisionRoute,
  type EvolutionDecisionRouteInput,
} from "./router.js";
import {
  projectEvolutionDecisionVisibility,
  type EvolutionDecisionAudienceView,
} from "./visibility.js";

/** What every snapshot fact carries. Surfaces add their own server facts. */
export type EvolutionDecisionSnapshotFact = {
  item: EvolutionDecisionItem;
  routeInput: EvolutionDecisionRouteInput;
};

/** Ids and codes only. Never Evidence. */
export type EvolutionDecisionSnapshotOmission = { decisionId: string; code: string };

export type EvolutionDecisionRoutedRoute = Extract<EvolutionDecisionRoute, { ok: true }>;

export type EvolutionDecisionSnapshotEntry<Fact extends EvolutionDecisionSnapshotFact> = {
  fact: Fact;
  route: EvolutionDecisionRoutedRoute;
  view: EvolutionDecisionAudienceView;
};

/**
 * Route and filter one snapshot through the D1 router and visibility for one
 * principal. A decision id that appears more than once in a snapshot is
 * ambiguous, so every copy is omitted. Current and prior snapshots both go
 * through here, which re-checks tenant, ownership, and confidentiality for
 * each of them.
 */
export function projectEvolutionDecisionSnapshot<
  Fact extends EvolutionDecisionSnapshotFact,
>(input: {
  facts: readonly Fact[];
  principal: EvolutionDecisionPrincipal;
}): {
  visible: EvolutionDecisionSnapshotEntry<Fact>[];
  omitted: EvolutionDecisionSnapshotOmission[];
} {
  const occurrences = new Map<string, number>();
  for (const fact of input.facts) {
    const id = fact.item.decisionId;
    occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
  }

  const omitted: EvolutionDecisionSnapshotOmission[] = [];
  const entries: { item: EvolutionDecisionItem; route: EvolutionDecisionRoute }[] = [];
  const routedById = new Map<string, { fact: Fact; route: EvolutionDecisionRoutedRoute }>();
  for (const fact of input.facts) {
    const id = fact.item.decisionId;
    if ((occurrences.get(id) ?? 0) > 1) {
      omitted.push({ decisionId: id, code: "duplicate_decision_id" });
      continue;
    }
    const route = routeEvolutionDecisionSurface(fact.routeInput);
    if (!route.ok) {
      omitted.push({ decisionId: id, code: route.code });
      continue;
    }
    routedById.set(id, { fact, route });
    entries.push({ item: fact.item, route });
  }

  const projected = projectEvolutionDecisionVisibility({ entries, principal: input.principal });
  for (const row of projected.omitted) {
    omitted.push({ decisionId: row.decisionId, code: row.code });
  }

  const visible: EvolutionDecisionSnapshotEntry<Fact>[] = [];
  for (const view of projected.visible) {
    const decisionId = view.kind === "item" ? view.item.decisionId : view.view.decisionId;
    const routed = routedById.get(decisionId);
    if (routed) {
      visible.push({ fact: routed.fact, route: routed.route, view });
    }
  }
  return { visible, omitted };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** The prior snapshot is taken one week before the current one. */
export const EVOLUTION_DECISION_WEEK_MS = 7 * DAY_MS;
/** Scheduling slack accepted around the one-week gap. */
export const EVOLUTION_DECISION_WEEK_TOLERANCE_MS = DAY_MS;

export type EvolutionDecisionWeeklyWindowRefusal =
  | "prior_snapshot_missing"
  | "snapshot_as_of_invalid"
  | "prior_not_before_current"
  | "prior_snapshot_not_weekly";

/**
 * Whether two snapshots support a week-over-week comparison. Anything else
 * fails closed; a surface must then say history is unavailable instead of
 * showing zero counts.
 */
export function checkEvolutionDecisionWeeklyWindow(input: {
  currentAsOf: string;
  priorAsOf: string | null;
}): { ok: true } | { ok: false; reason: EvolutionDecisionWeeklyWindowRefusal } {
  if (input.priorAsOf === null) {
    return { ok: false, reason: "prior_snapshot_missing" };
  }
  const currentMs = Date.parse(input.currentAsOf);
  const priorMs = Date.parse(input.priorAsOf);
  if (!Number.isFinite(currentMs) || !Number.isFinite(priorMs)) {
    return { ok: false, reason: "snapshot_as_of_invalid" };
  }
  const gapMs = currentMs - priorMs;
  if (gapMs <= 0) {
    return { ok: false, reason: "prior_not_before_current" };
  }
  if (Math.abs(gapMs - EVOLUTION_DECISION_WEEK_MS) > EVOLUTION_DECISION_WEEK_TOLERANCE_MS) {
    return { ok: false, reason: "prior_snapshot_not_weekly" };
  }
  return { ok: true };
}

/** Status of one decision in the prior and current snapshots. */
export type EvolutionDecisionStatusTransition<Status extends string> = {
  decisionId: string;
  decisionType: EvolutionDecisionType;
  /** `null`: not visible to this principal in the prior snapshot. */
  from: Status | null;
  /** `null`: not visible to this principal in the current snapshot. */
  to: Status | null;
};

type EvolutionDecisionStatusRow<Status extends string> = {
  decisionId: string;
  decisionType: EvolutionDecisionType;
  uiStatus: Status;
};

/**
 * Decisions whose status differs between the snapshots: changed and new ones
 * in current order, then the ones no longer visible in prior order.
 */
export function diffEvolutionDecisionStatusTransitions<Status extends string>(input: {
  prior: readonly EvolutionDecisionStatusRow<Status>[];
  current: readonly EvolutionDecisionStatusRow<Status>[];
}): EvolutionDecisionStatusTransition<Status>[] {
  const priorById = new Map(input.prior.map((row) => [row.decisionId, row]));
  const currentIds = new Set(input.current.map((row) => row.decisionId));
  const transitions: EvolutionDecisionStatusTransition<Status>[] = [];
  for (const row of input.current) {
    const from = priorById.get(row.decisionId)?.uiStatus ?? null;
    if (from !== row.uiStatus) {
      transitions.push({
        decisionId: row.decisionId,
        decisionType: row.decisionType,
        from,
        to: row.uiStatus,
      });
    }
  }
  for (const row of input.prior) {
    if (!currentIds.has(row.decisionId)) {
      transitions.push({
        decisionId: row.decisionId,
        decisionType: row.decisionType,
        from: row.uiStatus,
        to: null,
      });
    }
  }
  return transitions;
}
