/**
 * Governance decision envelope (governance closure plan v1.0 §4.1, ADR-1/ADR-2/ADR-4).
 *
 * This module only freezes types and pure constructors. It performs no I/O and holds
 * no authorization logic: adapters (PR-4b onward) describe decisions that existing
 * authorities (commercial gate, model entitlement, access control, …) already made.
 *
 * `GovernanceTraceEntry` intentionally mirrors the hit/detail/effect shape of the
 * Fabric trace without importing it; `stage` is an open string so this envelope never
 * widens or depends on the Fabric closed enum.
 */

export type GovernanceEffect = "allow" | "deny" | "approval_required" | "skipped";

export type GovernanceSource =
  | "access-control"
  | "agent-invocation"
  | "model-entitlement"
  | "commercial-run"
  | "fabric"
  | "capability"
  | "node"
  | "session"
  | "other";

export type GovernanceMode = "legacy" | "shadow" | "enforced";

export const GOVERNANCE_MODES: readonly GovernanceMode[] = ["legacy", "shadow", "enforced"];

/** Shape close to the Fabric trace, but an independent type. `stage` is not the Fabric enum. */
export type GovernanceTraceEntry = {
  stage: string;
  hit: boolean;
  /** Must not contain credentials, emails, or tokens. */
  detail?: string;
  effect: "allow" | "deny" | "modify" | "neutral";
};

/**
 * Divergence classes for shadow comparison (plan §8.3).
 * D0 same effect · D1 stricter, known bypass · D2 stricter, missing attribution/seat data ·
 * D3 more permissive · D4 different subjects · D5 either side skipped · D6 shadow threw.
 */
export type DivergenceClass = "D0" | "D1" | "D2" | "D3" | "D4" | "D5" | "D6";

export type GovernanceSubject = {
  kind: "agent" | "model" | "capability" | "node" | "run";
  id: string;
};

export type GovernanceDecision = {
  effect: GovernanceEffect;
  decisionId: string;
  source: GovernanceSource;
  mode: GovernanceMode;
  /**
   * Execution-entry id from the registry (`E2`, `E8`, `E11`, …), stamped only by a
   * writer that already knows its entry. `E6` covers E6a / E6b / E6c, which the
   * envelope cannot tell apart. Absent means the offline reports fall back to the
   * source mapping or `(unspecified)`.
   */
  entry?: string;
  reason?: string;
  matchedRules?: string[];
  decisionTrace?: GovernanceTraceEntry[];
  runId?: string;
  requestId?: string;
  parentRunId?: string;
  parentDecisionId?: string;
  commercialAuthorizationId?: string;
  tenantId?: string;
  actorId?: string;
  /** Account Computer correlation. Not a new decision id. */
  userId?: string;
  /** Run execution id. Distinct from decisionId. */
  executionId?: string;
  /** Empty in P0. Runtime Controller fills this in P2. */
  runtimeLeaseId?: string;
  dataSpaceRef?: string;
  browserNamespaceRef?: string;
  subject?: GovernanceSubject;
  shadow?: {
    existing: Pick<GovernanceDecision, "effect" | "source" | "reason">;
    divergence?: DivergenceClass;
  };
  ts: string;
};

/**
 * Billing context a parent run already holds (governance closure P4-1). `enterpriseId`
 * and `policyId` come from the parent gate's `modelGate.creditReporting`; the
 * subscription / plan ids come from the same-named fields on that gate, only when set.
 */
export type RunCreditReporting = {
  enterpriseId?: string;
  policyId?: string;
  subscriptionId?: string;
  planId?: string;
  planVersionId?: string;
  subscriptionSnapshotId?: string;
};

/**
 * Run-start governance snapshot (plan §4.7.1). Type only in PR-4a; the in-process
 * handoff that carries it to child runs lands with PR-1b.
 */
export type RunGovernanceSnapshot = {
  /** The run's primary decisionId. */
  snapshotId: string;
  runId: string;
  parentRunId?: string;
  tenantId?: string;
  actorId?: string;
  governanceMode: GovernanceMode;
  decisions: GovernanceDecision[];
  effectiveModelSet?: { allowlist: string[]; preferredModelOrder?: string[] };
  commercialAuthorizationId?: string;
  /**
   * Set only when the parent's commercial gate was acquired and exposed
   * `creditReporting` (P4-1). In-process only; never read from RPC params.
   */
  creditReporting?: RunCreditReporting;
  createdAt: string;
  expiresAt?: string;
};

export type GovernanceDecisionInput = Omit<GovernanceDecision, "ts"> & {
  /** ISO timestamp. Callers pass it so the constructor stays pure. */
  ts: string;
};

export class GovernanceDecisionInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernanceDecisionInvariantError";
  }
}

/**
 * Validates the envelope invariants and returns a normalized copy (optional fields that
 * are `undefined` are dropped so JSONL lines stay compact). Throws on developer errors:
 *  - empty decisionId / ts,
 *  - `mode: "legacy"` with an effect other than `skipped` (plan §4.1 / §4.3).
 */
export function createGovernanceDecision(input: GovernanceDecisionInput): GovernanceDecision {
  if (!input.decisionId?.trim()) {
    throw new GovernanceDecisionInvariantError("decisionId is required");
  }
  if (!input.ts?.trim()) {
    throw new GovernanceDecisionInvariantError("ts is required");
  }
  if (input.mode === "legacy" && input.effect !== "skipped") {
    throw new GovernanceDecisionInvariantError(
      `legacy mode must carry effect "skipped" (got "${input.effect}")`,
    );
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  if (input.decisionTrace) {
    out.decisionTrace = input.decisionTrace.map((entry) => ({ ...entry }));
  }
  if (input.matchedRules) {
    out.matchedRules = [...input.matchedRules];
  }
  return out as GovernanceDecision;
}

/**
 * The source did not evaluate because the run has no enterprise scope
 * (commercial gate `skipped`). Always `effect: "skipped"` + `mode: "legacy"` (plan §4.4).
 */
export function createLegacySkippedDecision(
  input: Omit<GovernanceDecisionInput, "effect" | "mode">,
): GovernanceDecision {
  return createGovernanceDecision({
    ...input,
    effect: "skipped",
    mode: "legacy",
    reason: input.reason ?? "no-enterprise-scope",
  });
}

/**
 * Pure divergence classifier (plan §8.3). The caller supplies context the envelope
 * cannot infer: whether both sides judged the same object, and why a stricter shadow
 * decision is stricter.
 */
export function classifyDivergence(params: {
  existing: GovernanceEffect;
  shadow: GovernanceEffect;
  sameSubject?: boolean;
  shadowThrew?: boolean;
  stricterCause?: "known-bypass" | "missing-attribution";
}): DivergenceClass {
  if (params.shadowThrew) {
    return "D6";
  }
  if (params.sameSubject === false) {
    return "D4";
  }
  if (params.existing === "skipped" || params.shadow === "skipped") {
    return "D5";
  }
  if (params.existing === params.shadow) {
    return "D0";
  }
  const rank = (effect: GovernanceEffect): number =>
    effect === "allow" ? 0 : effect === "approval_required" ? 1 : 2;
  if (rank(params.shadow) > rank(params.existing)) {
    return params.stricterCause === "missing-attribution" ? "D2" : "D1";
  }
  return "D3";
}
