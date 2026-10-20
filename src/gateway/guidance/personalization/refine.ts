/**
 * LLM refinement boundary (P2.2): copy only.
 * Must never mutate kind, target, risk, canSkip, blockers, permissions, or lifecycle.
 */

import type { GuidanceNextAction, GuidanceSnapshot } from "../types.js";

export type GuidanceLlmCopyRefine = {
  /** Optional display label rewrite. */
  label?: string;
  /** Optional reason / clarification rewrite. */
  reason?: string;
  /** Optional optionalActions[i] copy by index — label/reason only. */
  optionalActionCopy?: Array<{ index: number; label?: string; reason?: string }>;
};

const FORBIDDEN_REFINE_KEYS = new Set([
  "kind",
  "target",
  "risk",
  "canSkip",
  "blockers",
  "degrade",
  "scope",
  "scenario",
  "currentStage",
  "entityId",
  "tenantId",
  "userId",
  "source",
  "confidence",
  "generatedAt",
  "expiresAt",
  "optionalActions",
  "lifecycleState",
  "growthStatus",
  "permission",
]);

function scrubLabel(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim().slice(0, 240);
  return trimmed || undefined;
}

/**
 * Apply LLM copy refinements. Unknown / forbidden keys are ignored.
 * Returns a shallow-cloned snapshot; structural fields are identical by value.
 */
export function applyGuidanceLlmCopyRefine(
  snapshot: GuidanceSnapshot,
  refine: GuidanceLlmCopyRefine | Record<string, unknown> | null | undefined,
): GuidanceSnapshot {
  if (!refine || typeof refine !== "object") {
    return snapshot;
  }

  // Reject attempts to smuggle structural fields via unexpected keys.
  for (const key of Object.keys(refine)) {
    if (FORBIDDEN_REFINE_KEYS.has(key)) {
      // ignore — do not throw (callers may pass model JSON); structural fields stay
      continue;
    }
  }

  const label = scrubLabel(
    typeof (refine as GuidanceLlmCopyRefine).label === "string"
      ? (refine as GuidanceLlmCopyRefine).label
      : undefined,
  );
  const reason = scrubLabel(
    typeof (refine as GuidanceLlmCopyRefine).reason === "string"
      ? (refine as GuidanceLlmCopyRefine).reason
      : undefined,
  );

  const nextAction: GuidanceNextAction = {
    ...snapshot.nextAction,
    ...(label ? { label } : {}),
    ...(reason ? { reason } : {}),
    // Freeze structural fields explicitly
    kind: snapshot.nextAction.kind,
    risk: snapshot.nextAction.risk,
    canSkip: snapshot.nextAction.canSkip,
    target: snapshot.nextAction.target,
  };

  let optionalActions = snapshot.optionalActions;
  const optionalCopy = (refine as GuidanceLlmCopyRefine).optionalActionCopy;
  if (Array.isArray(optionalCopy) && optionalCopy.length > 0) {
    optionalActions = snapshot.optionalActions.map((action, index) => {
      const patch = optionalCopy.find((item) => item.index === index);
      if (!patch) {
        return action;
      }
      return {
        ...action,
        label: scrubLabel(patch.label) ?? action.label,
        reason: scrubLabel(patch.reason) ?? action.reason,
        kind: action.kind,
        risk: action.risk,
        canSkip: action.canSkip,
        target: action.target,
      };
    });
  }

  return {
    ...snapshot,
    nextAction,
    optionalActions,
    blockers: snapshot.blockers,
    degrade: snapshot.degrade,
    scope: snapshot.scope,
    scenario: snapshot.scenario,
    currentStage: snapshot.currentStage,
    entityId: snapshot.entityId,
    tenantId: snapshot.tenantId,
    userId: snapshot.userId,
    source: snapshot.source,
    confidence: snapshot.confidence,
  };
}

/** Structural equality check for refine boundary tests. */
export function guidanceSnapshotStructuralFields(snapshot: GuidanceSnapshot): unknown {
  return {
    scope: snapshot.scope,
    scenario: snapshot.scenario,
    confidence: snapshot.confidence,
    currentStage: snapshot.currentStage,
    degrade: snapshot.degrade,
    entityId: snapshot.entityId,
    tenantId: snapshot.tenantId,
    userId: snapshot.userId,
    source: snapshot.source,
    blockers: snapshot.blockers,
    nextAction: {
      kind: snapshot.nextAction.kind,
      risk: snapshot.nextAction.risk,
      canSkip: snapshot.nextAction.canSkip,
      target: snapshot.nextAction.target,
    },
    optionalActions: snapshot.optionalActions.map((a) => ({
      kind: a.kind,
      risk: a.risk,
      canSkip: a.canSkip,
      target: a.target,
    })),
  };
}
