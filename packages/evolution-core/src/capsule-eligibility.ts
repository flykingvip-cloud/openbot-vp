/**
 * Capsule observation eligibility. Legacy objects missing a native
 * failureClusterRef cannot enter recurrence experiments. This module never
 * infers a cluster from title, body, sourceIds, or embedding similarity.
 */

export const CAPSULE_OBSERVATION_UNAVAILABLE_REASONS = [
  "legacy_missing_failure_cluster",
  "insufficient_lineage",
  "untrusted_cluster_reference",
] as const;
export type CapsuleObservationUnavailableReason =
  (typeof CAPSULE_OBSERVATION_UNAVAILABLE_REASONS)[number];

export type CapsuleObservationEligibility =
  | {
      eligible: true;
      failureClusterRef: string;
      provenance: "native";
    }
  | {
      eligible: false;
      reason: CapsuleObservationUnavailableReason;
    };

export type CapsuleEligibilityInput = {
  failureClusterRef?: unknown;
  clusterProvenance?: unknown;
  inferredFromSourceIds?: unknown;
  inferredFromText?: unknown;
  inferredFromEmbedding?: unknown;
};

const UNTRUSTED_REF_PREFIXES = [
  "guess:",
  "similar:",
  "inferred:",
  "embedding:",
  "sourceids:",
  "task:",
];
const PLACEHOLDER_REFS = new Set(["unknown", "n/a", "na", "none", "null", "inferred", "legacy"]);
const MECHANISM_CLUSTER_PATTERN = /^failure:[^:]+:[^:]+:[^:]+$/;

export type TrustedMechanismClassification = {
  diagnoserOrDomain?: unknown;
  cause?: unknown;
  mechanismVersion?: unknown;
};

/** Diagnoser that writes skill-invocation `failureCategory`. */
export const SKILL_INVOCATION_DIAGNOSER = "skill-invocation";
export const SKILL_INVOCATION_MECHANISM_VERSION = "v1";

/**
 * Closed vocabulary of reusable failure mechanisms. Instance keys, free text,
 * and generic buckets (`tool_error`, `run_failed`) are not mechanisms.
 */
const TRUSTED_MECHANISM_CAUSE_ALIASES: Record<string, string> = {
  timeout: "timeout",
  security: "security",
  security_violation: "security",
  security_violations: "security",
  authorization: "authorization",
  authz: "authorization",
  permission: "permission",
  routing: "routing",
  tenant_context_unresolved: "tenant_context_unresolved",
};

export function normalizeTrustedMechanismCause(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const key = raw.trim().toLowerCase().replace(/-/g, "_");
  if (!key || key.includes(":")) {
    return undefined;
  }
  return TRUSTED_MECHANISM_CAUSE_ALIASES[key];
}

/** Exactly one trusted cause. Mixed or empty measured categories stay unknown. */
export function uniqueTrustedMechanismCause(candidates: readonly unknown[]): string | undefined {
  const unique = new Set<string>();
  for (const candidate of candidates) {
    const cause = normalizeTrustedMechanismCause(candidate);
    if (cause) {
      unique.add(cause);
    }
  }
  if (unique.size !== 1) {
    return undefined;
  }
  return [...unique][0];
}

/** `failure:<diagnoser-or-domain>:<cause>:<mechanism-version>` */
export function composeTrustedMechanismClusterRef(
  input: TrustedMechanismClassification,
): string | undefined {
  const domain = typeof input.diagnoserOrDomain === "string" ? input.diagnoserOrDomain.trim() : "";
  const cause = typeof input.cause === "string" ? input.cause.trim() : "";
  const version = typeof input.mechanismVersion === "string" ? input.mechanismVersion.trim() : "";
  if (!domain || !cause || !version) {
    return undefined;
  }
  if (domain.includes(":") || cause.includes(":") || version.includes(":")) {
    return undefined;
  }
  if (domain.toLowerCase() === "task" || PLACEHOLDER_REFS.has(cause.toLowerCase())) {
    return undefined;
  }
  return `failure:${domain}:${cause}:${version}`;
}

export function nativeMechanismClusterMetadata(
  input: TrustedMechanismClassification,
): { failureClusterRef: string; clusterProvenance: "native" } | undefined {
  const cause = normalizeTrustedMechanismCause(input.cause);
  if (!cause) {
    return undefined;
  }
  const failureClusterRef = composeTrustedMechanismClusterRef({
    ...input,
    cause,
  });
  if (!failureClusterRef) {
    return undefined;
  }
  return { failureClusterRef, clusterProvenance: "native" };
}

export function isTrustedMechanismClusterRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!MECHANISM_CLUSTER_PATTERN.test(trimmed)) {
    return false;
  }
  const cause = trimmed.split(":")[2];
  return Boolean(normalizeTrustedMechanismCause(cause));
}

export function evaluateCapsuleObservationEligibility(
  input: CapsuleEligibilityInput,
): CapsuleObservationEligibility {
  if (
    input.inferredFromSourceIds === true ||
    input.inferredFromText === true ||
    input.inferredFromEmbedding === true
  ) {
    return { eligible: false, reason: "untrusted_cluster_reference" };
  }
  const ref = typeof input.failureClusterRef === "string" ? input.failureClusterRef.trim() : "";
  if (!ref) {
    return { eligible: false, reason: "legacy_missing_failure_cluster" };
  }
  const normalized = ref.toLowerCase();
  if (PLACEHOLDER_REFS.has(normalized)) {
    return { eligible: false, reason: "insufficient_lineage" };
  }
  if (UNTRUSTED_REF_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return { eligible: false, reason: "untrusted_cluster_reference" };
  }
  if (ref.length < 3) {
    return { eligible: false, reason: "insufficient_lineage" };
  }
  const provenance =
    typeof input.clusterProvenance === "string" ? input.clusterProvenance.trim() : "";
  if (!provenance) {
    return { eligible: false, reason: "insufficient_lineage" };
  }
  if (provenance !== "native") {
    return { eligible: false, reason: "untrusted_cluster_reference" };
  }
  if (!isTrustedMechanismClusterRef(ref)) {
    return { eligible: false, reason: "untrusted_cluster_reference" };
  }
  return { eligible: true, failureClusterRef: ref, provenance: "native" };
}

export type CapsuleObservationView = {
  availability: "available" | "unavailable";
  label: string;
  reason?: CapsuleObservationUnavailableReason;
  /** Null when unavailable. Never a synthetic 0% recurrence. */
  recurrenceRate: number | null;
};

export function projectCapsuleObservationView(input: {
  eligibility: CapsuleObservationEligibility;
  nativeRecurrenceRate?: number | null;
}): CapsuleObservationView {
  if (!input.eligibility.eligible) {
    return {
      availability: "unavailable",
      label: "legacy / observation unavailable",
      reason: input.eligibility.reason,
      recurrenceRate: null,
    };
  }
  const rate = input.nativeRecurrenceRate;
  return {
    availability: "available",
    label: "native cluster",
    recurrenceRate: typeof rate === "number" && Number.isFinite(rate) ? rate : null,
  };
}

export function capsuleEligibilityFromStoredFields(fields: {
  metadata?: Record<string, unknown> | null;
  structuredContent?: Record<string, unknown> | null;
}): CapsuleObservationEligibility {
  const metadata = fields.metadata ?? {};
  const structured = fields.structuredContent ?? {};
  const failureClusterRef =
    (typeof metadata.failureClusterRef === "string" && metadata.failureClusterRef) ||
    (typeof structured.failureClusterRef === "string" && structured.failureClusterRef) ||
    undefined;
  return evaluateCapsuleObservationEligibility({
    failureClusterRef,
    clusterProvenance: metadata.clusterProvenance ?? structured.clusterProvenance,
    inferredFromSourceIds: metadata.inferredFromSourceIds ?? structured.inferredFromSourceIds,
    inferredFromText: metadata.inferredFromText ?? structured.inferredFromText,
    inferredFromEmbedding: metadata.inferredFromEmbedding ?? structured.inferredFromEmbedding,
  });
}
