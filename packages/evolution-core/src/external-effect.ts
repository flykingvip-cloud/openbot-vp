/**
 * External effect verification is independent of Adapter.apply receipts
 * and independent of statistical outcome verification.
 *
 * APPLIED = adapter reported execution.
 * EFFECT_VERIFIED = independent read-after-write verifier confirmed target state.
 * OUTCOME_VERIFIED = statistical experiment confirmed business improvement.
 * PROMOTED = governance approved expansion.
 */
import type { EvolutionDomain, EvolutionTarget } from "./types.js";
import { evolutionTargetKey } from "./types.js";

export const EXTERNAL_EFFECT_OUTCOMES = [
  "verified",
  "not_observed",
  "contradicted",
  "inconclusive",
] as const;
export type ExternalEffectOutcome = (typeof EXTERNAL_EFFECT_OUTCOMES)[number];

export const EVOLUTION_LIFECYCLE_STAGES = [
  "APPLIED",
  "EFFECT_VERIFIED",
  "OUTCOME_VERIFIED",
  "PROMOTED",
] as const;
export type EvolutionLifecycleStage = (typeof EVOLUTION_LIFECYCLE_STAGES)[number];

export type ExpectedExternalEffect = {
  kind: string;
  field?: string;
  expectedValue?: unknown;
  expectedVersion?: string;
  expectedEnabled?: boolean;
  agentId?: string;
};

export type ObservationReceipt = {
  receiptId: string;
  requestId: string;
  applicationId: string;
  targetKey: string;
  tenantScope: string | null;
};

export type WorkingStyleDomainSnapshot = {
  status: "ok";
  version: string;
  hash: string;
  rawLength: number;
  fieldValue?: unknown;
};

export type SkillInstallationDomainSnapshot = {
  status: "ok";
  agentId: string;
  skillId: string;
  installedVersion: string;
  enabled: boolean;
  skillVersion: string;
};

export type DomainReadResult<T> = T | { status: "missing" } | { status: "unreadable" };

export type TenantEvidence =
  | { status: "ok"; tenantId: string }
  | { status: "unavailable" }
  | { status: "conflict" };

export type ExternalEffectDomainReader = {
  readWorkingStyle?(agentId: string): Promise<DomainReadResult<WorkingStyleDomainSnapshot>>;
  readSkillInstallation?(input: {
    agentId: string;
    skillId: string;
  }): Promise<DomainReadResult<SkillInstallationDomainSnapshot>>;
  readAgentTenantEvidence?(agentId: string): Promise<TenantEvidence>;
};

export type ExternalEffectVerificationContext = {
  trustedTenantId: string | null;
  now: string;
  readDomain: ExternalEffectDomainReader;
  resolveCredential: (credentialRef: string) => Promise<null>;
  verifyReceipt: (
    receipt: ObservationReceipt,
    request: ExternalEffectVerificationRequest,
  ) => boolean;
};

export interface ExternalEffectVerifier {
  readonly verifierId: string;
  readonly verifierKind: string;
  readonly implementationVersion: string;
  readonly supportedDomains: readonly EvolutionDomain[];
  readonly supportedEffectKinds: readonly string[];
  verify(
    request: ExternalEffectVerificationRequest,
    context: ExternalEffectVerificationContext,
  ): Promise<ExternalEffectVerificationResult>;
}

export type ExternalEffectVerificationRequest = {
  requestId: string;
  proposalId: string;
  experimentId: string;
  applicationId: string;
  target: EvolutionTarget;
  expectedEffect: ExpectedExternalEffect;
  applicationReceiptRef: string;
  tenantScope: string | null;
  verifierId: string;
  evidenceRefs: string[];
  expiresAt: string;
};

export type ExternalEffectVerificationResult = {
  requestId: string;
  resultId: string;
  outcome: ExternalEffectOutcome;
  observedAt: string;
  verifierId: string;
  evidenceRefs: string[];
  observationReceiptRef: string;
  verifierImplementationVersion: string;
  observedTargetVersion?: string;
  observedTargetHash?: string;
  receipt: ObservationReceipt;
};

export function bindObservationReceipt(
  request: ExternalEffectVerificationRequest,
  receiptId: string,
): ObservationReceipt {
  return {
    receiptId,
    requestId: request.requestId,
    applicationId: request.applicationId,
    targetKey: evolutionTargetKey(request.target),
    tenantScope: request.tenantScope,
  };
}

export function observationReceiptMatchesRequest(
  receipt: ObservationReceipt,
  request: ExternalEffectVerificationRequest,
): boolean {
  return (
    receipt.requestId === request.requestId &&
    receipt.applicationId === request.applicationId &&
    receipt.targetKey === evolutionTargetKey(request.target) &&
    receipt.tenantScope === request.tenantScope
  );
}

export function bindExternalEffectResult(input: {
  request: ExternalEffectVerificationRequest;
  outcome: ExternalEffectOutcome;
  observedAt: string;
  evidenceRefs: string[];
  observationReceiptRef: string;
  verifierImplementationVersion: string;
  observedTargetVersion?: string;
  observedTargetHash?: string;
}): ExternalEffectVerificationResult {
  const receipt = bindObservationReceipt(input.request, input.observationReceiptRef);
  return {
    requestId: input.request.requestId,
    resultId: `eefr:${input.request.requestId}`,
    outcome: input.outcome,
    observedAt: input.observedAt,
    verifierId: input.request.verifierId,
    evidenceRefs: input.evidenceRefs,
    observationReceiptRef: input.observationReceiptRef,
    verifierImplementationVersion: input.verifierImplementationVersion,
    ...(input.observedTargetVersion ? { observedTargetVersion: input.observedTargetVersion } : {}),
    ...(input.observedTargetHash ? { observedTargetHash: input.observedTargetHash } : {}),
    receipt,
  };
}

export const VERIFIER_STATUSES = ["active", "suspended", "revoked"] as const;
export type VerifierStatus = (typeof VERIFIER_STATUSES)[number];

export type EvolutionVerifierRecord = {
  verifierId: string;
  verifierKind: string;
  supportedTargetDomains: readonly string[];
  supportedEffectKinds: readonly string[];
  tenantScope: string | null;
  credentialRef: string;
  status: VerifierStatus;
  expiresAt: string;
  independentFromAdapterIds: readonly string[];
  authorityGrantRef: string;
  /** Builtin local verifiers declare code identity instead of an unresolved key-ref. */
  trustedBy?: "code-identity";
};

export const TRUSTED_CREDENTIAL_REF_PREFIXES = ["secret-ref:", "pubkey:", "key-ref:"] as const;
export const CODE_IDENTITY_CREDENTIAL_PREFIX = "code-identity:" as const;

export function codeIdentityCredentialRef(verifierId: string): string {
  return `${CODE_IDENTITY_CREDENTIAL_PREFIX}${verifierId}`;
}

export function isCodeIdentityCredentialRef(value: string, verifierId: string): boolean {
  return value.trim() === codeIdentityCredentialRef(verifierId);
}

/**
 * Prefix-form check only. A matching prefix does not mean the secret, pubkey,
 * or key was resolved or that a signature was verified.
 */
export function isTrustedCredentialRef(value: string): boolean {
  const trimmed = value.trim();
  return TRUSTED_CREDENTIAL_REF_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** External credential resolution is not implemented. Always fail closed. */
export function isResolvedVerifierCredential(_value: string): false {
  void _value;
  return false;
}

export function classifyEvolutionLifecycleStage(input: {
  applicationApplied: boolean;
  externalEffectOutcome?: ExternalEffectOutcome | null;
  proposalStatus: string;
}): EvolutionLifecycleStage | null {
  if (input.proposalStatus === "PROMOTED") {
    return "PROMOTED";
  }
  if (input.proposalStatus === "VERIFIED") {
    return "OUTCOME_VERIFIED";
  }
  if (input.externalEffectOutcome === "verified") {
    return "EFFECT_VERIFIED";
  }
  if (input.applicationApplied) {
    return "APPLIED";
  }
  return null;
}

export function applicationReceiptIsNotEffectProof(applicationReceiptRef: string): true {
  void applicationReceiptRef;
  return true;
}

export function assertExternalEffectBinding(input: {
  request: ExternalEffectVerificationRequest;
  proposalId: string;
  experimentId: string;
  applicationId: string;
  target: EvolutionTarget;
  tenantScope: string | null;
}): { ok: true } | { ok: false; code: string; reason: string } {
  if (input.request.proposalId !== input.proposalId) {
    return {
      ok: false,
      code: "proposal_mismatch",
      reason: "request is not bound to this proposal",
    };
  }
  if (input.request.experimentId !== input.experimentId) {
    return {
      ok: false,
      code: "experiment_mismatch",
      reason: "request is not bound to this experiment",
    };
  }
  if (input.request.applicationId !== input.applicationId) {
    return {
      ok: false,
      code: "application_mismatch",
      reason: "request is not bound to this application",
    };
  }
  if (evolutionTargetKey(input.request.target) !== evolutionTargetKey(input.target)) {
    return { ok: false, code: "target_mismatch", reason: "request target does not match" };
  }
  if (input.request.tenantScope !== input.tenantScope) {
    return { ok: false, code: "tenant_mismatch", reason: "request tenant does not match" };
  }
  return { ok: true };
}

export function canEnterOutcomeVerification(input: {
  statisticalImproved: boolean;
  sampleSize: number;
  minimumSampleSize: number;
  rollbackDrillPassed: boolean;
  grantActive: boolean;
  requireExternalEffect: boolean;
  externalEffectOutcome?: ExternalEffectOutcome | null;
}): { ok: true } | { ok: false; code: string; reason: string } {
  if (!input.grantActive) {
    return { ok: false, code: "grant_inactive", reason: "grant must still be valid" };
  }
  if (!input.rollbackDrillPassed) {
    return { ok: false, code: "rollback_drill_required", reason: "rollback drill must pass" };
  }
  if (!input.statisticalImproved || input.sampleSize < input.minimumSampleSize) {
    return {
      ok: false,
      code: "verification_not_improved",
      reason: "OUTCOME_VERIFIED requires a statistical improved result",
    };
  }
  if (input.requireExternalEffect && input.externalEffectOutcome !== "verified") {
    return {
      ok: false,
      code:
        input.externalEffectOutcome === "contradicted"
          ? "external_effect_contradicted"
          : "external_effect_required",
      reason:
        input.externalEffectOutcome === "contradicted"
          ? "statistical improvement cannot override a contradicted external effect"
          : "surface requires an independent external effect verification",
    };
  }
  return { ok: true };
}

export function canPromoteWithExternalEffect(input: {
  proposalStatus: string;
  verificationId?: string;
  riskLevel: string;
  requireExternalEffect: boolean;
  externalEffectOutcome?: ExternalEffectOutcome | null;
}): { ok: true } | { ok: false; code: string; reason: string } {
  if (input.proposalStatus !== "VERIFIED") {
    return {
      ok: false,
      code: "not_verified",
      reason: "EFFECT_VERIFIED is not OUTCOME_VERIFIED; promotion requires metric verification",
    };
  }
  if (!input.verificationId?.trim()) {
    return {
      ok: false,
      code: "verification_missing",
      reason: "promotion requires a stored verification id",
    };
  }
  if (input.riskLevel === "critical") {
    return {
      ok: false,
      code: "critical_forbidden",
      reason: "critical proposals cannot be promoted by evolution",
    };
  }
  if (input.requireExternalEffect && input.externalEffectOutcome === "contradicted") {
    return {
      ok: false,
      code: "external_effect_contradicted",
      reason: "statistical improvement cannot promote a contradicted external effect",
    };
  }
  if (input.requireExternalEffect && input.externalEffectOutcome !== "verified") {
    return {
      ok: false,
      code: "external_effect_required",
      reason: "promotion requires independent external effect verification",
    };
  }
  return { ok: true };
}
