/**
 * UI-facing GuidanceSnapshot mirror for employee orchestrated CTA (P3).
 * Keep structural fields aligned with gateway `src/gateway/guidance/types.ts`.
 */

export type UiGuidanceScope = "user" | "robot" | "team";

export type UiGuidanceNextAction = {
  kind: string;
  label: string;
  reason: string;
  canSkip: boolean;
  risk: "low" | "medium" | "high";
  target?: {
    module?: string;
    tab?: string;
    focusComposer?: boolean;
    prefill?: string;
    recommendedSkillKeys?: string[];
    resumePendingTask?: boolean;
    deepLink?: string;
  };
};

export type UiGuidanceSnapshot = {
  scope: UiGuidanceScope;
  scenario: string;
  confidence: "high" | "medium" | "low";
  currentStage: string;
  nextAction: UiGuidanceNextAction;
  optionalActions: UiGuidanceNextAction[];
  blockers: Array<{
    code: string;
    kind: string;
    label: string;
    actionable: boolean;
  }>;
  degrade: "none" | "no_data" | "analysis_failed" | "permission_denied" | "provider_unavailable";
  tenantId?: string | null;
  userId?: string | null;
  entityId: string;
  source: string;
  generatedAt: number;
  contentVersion?: string;
};

/** Per-scope ack/defer keys — never share across user/robot/team. */
export function guidanceScopeAckKey(scope: UiGuidanceScope, entityId: string): string {
  return `${scope}::${entityId.trim()}`;
}

export function shouldShowOrchestratedPrimaryCta(
  snapshot: UiGuidanceSnapshot | null | undefined,
  opts?: {
    acknowledgedKeys?: ReadonlySet<string> | readonly string[];
    deferredUntilMsByKey?: ReadonlyMap<string, number> | Record<string, number>;
    nowMs?: number;
  },
): boolean {
  if (!snapshot) {
    return false;
  }
  if (snapshot.degrade !== "none") {
    return false;
  }
  if (snapshot.nextAction.kind === "none") {
    return false;
  }
  const key = guidanceScopeAckKey(snapshot.scope, snapshot.entityId);
  const ackSet =
    opts?.acknowledgedKeys instanceof Set
      ? opts.acknowledgedKeys
      : new Set(opts?.acknowledgedKeys ?? []);
  if (ackSet.has(key)) {
    return false;
  }
  const nowMs = opts?.nowMs ?? Date.now();
  let deferredUntil: number | undefined;
  if (opts?.deferredUntilMsByKey instanceof Map) {
    deferredUntil = opts.deferredUntilMsByKey.get(key);
  } else if (
    opts?.deferredUntilMsByKey &&
    Object.prototype.hasOwnProperty.call(opts.deferredUntilMsByKey, key)
  ) {
    deferredUntil = (opts.deferredUntilMsByKey as Record<string, number>)[key];
  }
  if (typeof deferredUntil === "number" && deferredUntil > nowMs) {
    return false;
  }
  return true;
}

/**
 * Pick at most one primary among candidate snapshots (deterministic scope order).
 * Does not re-implement Growth FSM — callers pass already-built snapshots.
 */
export function pickOrchestratedPrimary(
  candidates: Array<UiGuidanceSnapshot | null | undefined>,
): UiGuidanceSnapshot | null {
  const list = candidates.filter((item): item is UiGuidanceSnapshot => Boolean(item));
  const active = list.filter((item) => item.degrade === "none" && item.nextAction.kind !== "none");
  if (active.length === 0) {
    return null;
  }
  const rank = (scope: UiGuidanceScope): number =>
    scope === "robot" ? 30 : scope === "user" ? 20 : 10;
  active.sort((a, b) => {
    const byScope = rank(b.scope) - rank(a.scope);
    if (byScope !== 0) {
      return byScope;
    }
    return b.generatedAt - a.generatedAt;
  });
  return active[0] ?? null;
}

/** Competing provider flags for browser/regression proofs. */
export type CompetingGuidanceSurfaces = {
  growthPreludeVisible: boolean;
  daibaiOnboardingVisible: boolean;
  stewardSuggestionAsPrimary: boolean;
  teamStaleMissionAsPrimary: boolean;
};

/**
 * After orchestration, only the winning scope may render a primary CTA.
 * Steward / team stale tips demote to optional (never primary) when robot/user wins.
 */
export function resolveCompetingSurfaceVisibility(params: {
  primary: UiGuidanceSnapshot | null;
  showGrowthPrelude: boolean;
  showDaibaiOnboarding: boolean;
  hasStewardSuggestion: boolean;
  hasTeamStaleMission: boolean;
}): CompetingGuidanceSurfaces {
  const primary = params.primary;
  if (!primary) {
    return {
      growthPreludeVisible: params.showGrowthPrelude,
      daibaiOnboardingVisible: params.showDaibaiOnboarding,
      stewardSuggestionAsPrimary: false,
      teamStaleMissionAsPrimary: false,
    };
  }
  return {
    growthPreludeVisible: primary.scope === "robot" && params.showGrowthPrelude,
    daibaiOnboardingVisible: primary.scope === "user" && params.showDaibaiOnboarding,
    stewardSuggestionAsPrimary: false,
    teamStaleMissionAsPrimary: primary.scope === "team" && params.hasTeamStaleMission,
  };
}
