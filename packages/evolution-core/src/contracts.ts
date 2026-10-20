import type {
  ApplicationScope,
  EvolutionApplication,
  EvolutionDomain,
  EvolutionExperiment,
  EvolutionProposal,
  EvolutionRiskLevel,
  EvolutionTarget,
  ExperimentStrategy,
  MetricContract,
  ObservationWindow,
} from "./types.js";

export type TargetSnapshot = {
  target: EvolutionTarget;
  version: string;
  surfaceId: string;
  sourceOfTruth: string;
  rollbackRef?: string;
};

export type EvolutionContext = {
  proposal: EvolutionProposal;
  experiment: EvolutionExperiment;
  grantId: string;
  tenantScope: string | null;
  surfaceId: string;
  commandId: string;
};

export type ValidationResult = { ok: true } | { ok: false; code: string; reason: string };

export type ApplyEvolutionInput<TCandidate = unknown> = {
  candidate: TCandidate;
  context: EvolutionContext;
  idempotencyKey: string;
  scope: ApplicationScope;
};

export type ObserveApplicationInput = {
  application: EvolutionApplication;
  windowRef: string;
  window?: ObservationWindow;
};

export type MetricObservation = {
  metricId: string;
  value: number;
  sampleSize: number;
  windowRef: string;
};

export type RollbackResult = {
  applicationId: string;
  status: "rolled_back" | "failed";
  restoredVersion: string;
  failureClusterRef?: string;
  reason?: string;
};

export interface EvolutionAdapter<TCandidate = unknown> {
  readonly adapterId: string;
  readonly domain: EvolutionDomain;
  inspect(target: EvolutionTarget): Promise<TargetSnapshot>;
  validate(candidate: TCandidate, context: EvolutionContext): Promise<ValidationResult>;
  apply(input: ApplyEvolutionInput<TCandidate>): Promise<EvolutionApplication>;
  observe(input: ObserveApplicationInput): Promise<MetricObservation[]>;
  observeTarget?(
    target: EvolutionTarget,
    windowRef: string,
    window?: ObservationWindow,
  ): Promise<MetricObservation[]>;
  rollback(application: EvolutionApplication): Promise<RollbackResult>;
}

export type EvolutionSurface = {
  surfaceId: string;
  domain: EvolutionDomain;
  sourceOfTruth: string;
  authorityRole: string;
  allowedOperations: readonly string[];
  riskLevel: EvolutionRiskLevel;
  experimentStrategy: ExperimentStrategy;
  requiredApprovals: readonly string[];
  requiredRegressionLocks: readonly string[];
  adapterId: string;
  rollbackStrategy: string;
  autoApply: boolean;
  /** Independent read-after-write proof required before OUTCOME_VERIFIED. */
  requiresExternalEffectVerification?: boolean;
  externalEffectKind?: string;
  /** Code-fixed verifier id. Missing when external verification is unsupported. */
  requiredVerifierId?: string;
  /** required = mapped verifier; unsupported = fail-closed, never a DNA fallback. */
  externalVerificationPolicy?: "required" | "unsupported";
};

export type AuthorityGrantView = {
  grantId: string;
  status: string;
  tenantScope: string | null;
  allowedEvidence: readonly string[];
  allowedActions: readonly string[];
  confidentialityCeiling: "personal" | "enterprise" | "platform";
  targetPrincipal?: string;
  expired?: boolean;
  revoked?: boolean;
};

export type AuthorityGateInput = {
  surface: EvolutionSurface | null;
  grant: AuthorityGrantView | { status: "missing" };
  tenantScope: string | null;
  trustedTenantId: string | null;
  requestedAction: string;
  evidenceRefs: readonly string[];
  confidentialityScope: "personal" | "enterprise" | "platform";
  expandScope: boolean;
};

export type AuthorityGateDecision =
  | { ok: true; surface: EvolutionSurface }
  | { ok: false; code: string; reason: string };

export const GRANT_BLOCKING_STATUSES = new Set([
  "DENIED",
  "EXPIRED",
  "REVOKED",
  "CONSUMED",
  "SUSPENDED",
  "REQUESTED",
  "missing",
]);

export type GrantActivity = { active: true } | { active: false; code: string; reason: string };

export function classifyGrantActivity(grant: {
  status: string;
  grantId?: string;
  expired?: boolean;
  revoked?: boolean;
}): GrantActivity {
  if (grant.status === "missing" || typeof grant.grantId !== "string" || !grant.grantId.trim()) {
    return { active: false, code: "authorization_required", reason: "linked grant is missing" };
  }
  if (grant.expired || grant.status === "EXPIRED") {
    return { active: false, code: "grant_expired", reason: "linked grant is expired" };
  }
  if (grant.revoked || grant.status === "REVOKED") {
    return { active: false, code: "grant_revoked", reason: "linked grant is revoked" };
  }
  if (GRANT_BLOCKING_STATUSES.has(grant.status) || grant.status !== "APPROVED") {
    return { active: false, code: "grant_inactive", reason: "linked grant is not approved" };
  }
  return { active: true };
}

export function isActiveEvolutionGrant(grant: {
  status: string;
  grantId?: string;
  expired?: boolean;
  revoked?: boolean;
}): boolean {
  return classifyGrantActivity(grant).active;
}

export function confidentialityRank(scope: "personal" | "enterprise" | "platform"): number {
  if (scope === "personal") {
    return 0;
  }
  if (scope === "enterprise") {
    return 1;
  }
  return 2;
}

export function evaluateAuthorityGate(input: AuthorityGateInput): AuthorityGateDecision {
  if (!input.surface) {
    return { ok: false, code: "unknown_surface", reason: "unregistered surface fails closed" };
  }
  if (input.expandScope) {
    return {
      ok: false,
      code: "scope_widened",
      reason: "expired or revoked grants cannot expand scope",
    };
  }
  const grant = input.grant;
  const activity = classifyGrantActivity(grant);
  if (!activity.active) {
    return { ok: false, code: activity.code, reason: activity.reason };
  }
  if (!("grantId" in grant)) {
    return { ok: false, code: "authorization_required", reason: "linked grant is missing" };
  }
  if (input.tenantScope !== input.trustedTenantId) {
    return {
      ok: false,
      code: "tenant_mismatch",
      reason: "proposal tenant must match trusted tenant",
    };
  }
  if (grant.tenantScope !== input.tenantScope) {
    return {
      ok: false,
      code: "scope_widened",
      reason: "proposal tenant exceeds grant tenant scope",
    };
  }
  if (
    confidentialityRank(input.confidentialityScope) >
    confidentialityRank(grant.confidentialityCeiling)
  ) {
    return {
      ok: false,
      code: "scope_widened",
      reason: "proposal cannot exceed grant confidentiality",
    };
  }
  if (input.evidenceRefs.some((id) => !grant.allowedEvidence.includes(id))) {
    return {
      ok: false,
      code: "scope_widened",
      reason: "evidence refs exceed the authorization grant",
    };
  }
  if (!input.surface.allowedOperations.includes(input.requestedAction)) {
    return {
      ok: false,
      code: "operation_forbidden",
      reason: "surface does not allow this operation",
    };
  }
  if (
    input.surface.requiredApprovals.includes("platform") &&
    (input.requestedAction === "apply" ||
      input.requestedAction === "verify" ||
      input.requestedAction === "promote") &&
    !grant.allowedActions.includes("platform")
  ) {
    return {
      ok: false,
      code: "platform_approval_required",
      reason: "critical surface requires platform approval",
    };
  }
  if (
    input.requestedAction !== "inspect" &&
    !grant.allowedActions.includes(input.requestedAction)
  ) {
    return {
      ok: false,
      code: "scope_widened",
      reason: "requested action exceeds grant allowedActions",
    };
  }
  return { ok: true, surface: input.surface };
}

export type DefaultMetricSet = {
  primary: MetricContract;
  guardrails: MetricContract[];
};

export const REQUIRED_GUARDRAIL_METRIC_IDS = [
  "security_violations",
  "human_takeover_rate",
  "error_retry_rate",
  "p95_latency",
  "token_cost",
  "delivery_failure_rate",
  "cross_tenant_contamination",
] as const;
