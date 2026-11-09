/**
 * Optional compatible diagnosis beside supplementWindow.reason.
 * Does not change budget rules or invent deferred execution queues.
 */

export type SupplementFirstRejectReason =
  | "primary_not_completed"
  | "primary_budget_closed"
  | "explicit_multi"
  | "supplement_disabled"
  | "single_owner_without_edges"
  | "no_conclusion"
  | "other";

export type SupplementStructuralGateValues = {
  primaryCompleted: boolean;
  primaryBudgetClosed: boolean;
  /** Settled primary deadline may preserve already invited member turns only. */
  invitedContinuation?: boolean;
  primaryMode: string;
  supplementEnabled: boolean;
  responseMode: string;
  edgeTargetCount: number;
  supplementStructurallyAllowed: boolean;
};

export type SupplementEdgeDiagnosis = {
  toAgentId: string;
  kind: string;
  /** True only when a supplement dispatch was accepted this round. */
  dispatched: boolean;
  /**
   * When not dispatched: prefer "not_dispatched_this_round" over "deferred"
   * unless a durable defer queue exists (phase 1: it does not).
   */
  rejectReason?: string;
};

export type FormalTaskEstablishDiagnosis = {
  attempted: boolean;
  status?: string;
  taskId?: string | null;
  reason?: string;
  /** Authoritative user-visible receipt (not diagnosis-only). */
  userMessage?: string;
  stagesSummary?: string;
};

export type SupplementDenialDiagnosis = {
  runSha?: string;
  roundId: string;
  policyVersion?: string;
  effectivePolicyHash?: string;
  structuralGate: SupplementStructuralGateValues;
  firstRejectReason: SupplementFirstRejectReason;
  /** Structure gate refused vs passed but no conclusion/invite. */
  structureOutcome: "rejected" | "passed_without_window" | "opened";
  edges: SupplementEdgeDiagnosis[];
  formalTask?: FormalTaskEstablishDiagnosis;
  userVisibleSummary?: string;
};

/**
 * Evaluate firstRejectReason in the real structural order used by round-runtime.
 */
export function resolveSupplementFirstRejectReason(
  gate: SupplementStructuralGateValues,
): SupplementFirstRejectReason | null {
  if (!gate.primaryCompleted) {
    return "primary_not_completed";
  }
  if (gate.primaryBudgetClosed && !gate.invitedContinuation) {
    return "primary_budget_closed";
  }
  if (gate.primaryMode === "explicit_multi") {
    return "explicit_multi";
  }
  if (!gate.supplementEnabled) {
    return "supplement_disabled";
  }
  if (gate.responseMode === "single_owner" && gate.edgeTargetCount === 0) {
    return "single_owner_without_edges";
  }
  return null;
}

export function buildSupplementDenialDiagnosis(params: {
  roundId: string;
  runSha?: string;
  policyVersion?: string;
  effectivePolicyHash?: string;
  structuralGate: SupplementStructuralGateValues;
  windowOpened: boolean;
  windowReason?: string;
  edges?: SupplementEdgeDiagnosis[];
  formalTask?: FormalTaskEstablishDiagnosis;
}): SupplementDenialDiagnosis {
  const first =
    resolveSupplementFirstRejectReason(params.structuralGate) ??
    (params.windowOpened
      ? null
      : params.windowReason === "no_conclusion"
        ? ("no_conclusion" as const)
        : ("other" as const));
  const structureOutcome: SupplementDenialDiagnosis["structureOutcome"] = params.windowOpened
    ? "opened"
    : params.structuralGate.supplementStructurallyAllowed
      ? "passed_without_window"
      : "rejected";
  const userVisibleSummary =
    first === "primary_budget_closed"
      ? "本轮补充未派发"
      : structureOutcome === "rejected"
        ? "本轮补充未派发"
        : structureOutcome === "passed_without_window"
          ? "本轮补充窗未打开"
          : undefined;
  return {
    ...(params.runSha ? { runSha: params.runSha } : {}),
    roundId: params.roundId,
    ...(params.policyVersion ? { policyVersion: params.policyVersion } : {}),
    ...(params.effectivePolicyHash ? { effectivePolicyHash: params.effectivePolicyHash } : {}),
    structuralGate: params.structuralGate,
    firstRejectReason: first ?? "other",
    structureOutcome,
    edges: (params.edges ?? []).map((edge) => ({
      ...edge,
      // Phase 1: no durable defer queue — never imply future execution.
      rejectReason: edge.dispatched
        ? undefined
        : edge.rejectReason === "deferred"
          ? "not_dispatched_this_round"
          : (edge.rejectReason ?? "not_dispatched_this_round"),
    })),
    ...(params.formalTask ? { formalTask: params.formalTask } : {}),
    ...(userVisibleSummary ? { userVisibleSummary } : {}),
  };
}
