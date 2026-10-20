import type {
  MemoryAtom,
  MemoryGovernanceMetrics,
  MemoryLifecycleMetadata,
  MemoryPrivacyMetadata,
  SourceObjectLink,
} from "../models.js";

/**
 * CW2-P2 Memory Domain v2 — additive atom defaults, separated scores,
 * type policy registry, dual-source coverage, identity boundary.
 */

export type MemoryRetentionClass = NonNullable<MemoryLifecycleMetadata["retentionClass"]>;
export type MemorySyncEligibility = MemoryPrivacyMetadata["syncEligibility"];

/** Forbidden runtime identity fields — CogniWeave must not persist these on atoms. */
export const ATOM_IDENTITY_BOUNDARY_KEYS = [
  "tenantId",
  "userId",
  "seatId",
  "principalId",
  "agentProfile",
  "operationalIdentityId",
  "isOrgAdmin",
] as const;

export type AtomTypeStability = "volatile" | "stable" | "immutable";
export type AtomConflictResolution = "prefer_higher_confidence" | "prefer_newer" | "manual_review";

export type AtomTypePolicy = {
  atomType: string;
  payloadSchemaId: string;
  stability: AtomTypeStability;
  retentionClass: MemoryRetentionClass;
  promotionDefault: MemorySyncEligibility;
  confirmationRequired: boolean;
  conflictResolution: AtomConflictResolution;
};

export type DualSourceCoverageMetric = {
  metricVersion: 1;
  sourceBindingCount: number;
  liveSourceCount: number;
  /** live / max(sourceBindingCount, 1) — used by dual-source injection gates. */
  coverageRatio: number;
};

const DEFAULT_PRIVACY: MemoryPrivacyMetadata = {
  privacyLevel: "private",
  syncEligibility: "blocked",
  consentRequired: false,
};

const FALLBACK_TYPE_POLICY: AtomTypePolicy = {
  atomType: "*",
  payloadSchemaId: "cogniweave.atom.generic.v1",
  stability: "stable",
  retentionClass: "standard",
  promotionDefault: "blocked",
  confirmationRequired: false,
  conflictResolution: "prefer_higher_confidence",
};

export const DEFAULT_ATOM_TYPE_POLICIES: Readonly<Record<string, AtomTypePolicy>> = {
  strategy: {
    atomType: "strategy",
    payloadSchemaId: "cogniweave.atom.strategy.v1",
    stability: "stable",
    retentionClass: "durable",
    promotionDefault: "eligible",
    confirmationRequired: false,
    conflictResolution: "prefer_higher_confidence",
  },
  failure_pattern: {
    atomType: "failure_pattern",
    payloadSchemaId: "cogniweave.atom.failure_pattern.v1",
    stability: "stable",
    retentionClass: "durable",
    promotionDefault: "eligible",
    confirmationRequired: false,
    conflictResolution: "prefer_newer",
  },
  anti_pattern: {
    atomType: "anti_pattern",
    payloadSchemaId: "cogniweave.atom.anti_pattern.v1",
    stability: "stable",
    retentionClass: "durable",
    promotionDefault: "blocked",
    confirmationRequired: true,
    conflictResolution: "manual_review",
  },
  preference: {
    atomType: "preference",
    payloadSchemaId: "cogniweave.atom.preference.v1",
    stability: "volatile",
    retentionClass: "standard",
    promotionDefault: "blocked",
    confirmationRequired: false,
    conflictResolution: "prefer_newer",
  },
  policy: {
    atomType: "policy",
    payloadSchemaId: "cogniweave.atom.policy.v1",
    stability: "immutable",
    retentionClass: "legal_hold",
    promotionDefault: "blocked",
    confirmationRequired: true,
    conflictResolution: "manual_review",
  },
};

export function resolveAtomTypePolicy(atomType: string): AtomTypePolicy {
  const key = atomType.trim();
  return DEFAULT_ATOM_TYPE_POLICIES[key] ?? { ...FALLBACK_TYPE_POLICY, atomType: key || "*" };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/** Strip forbidden identity fields from an atom-shaped object (identity boundary). */
export function stripAtomIdentityBoundary<T extends Record<string, unknown>>(input: T): T {
  const next = { ...input };
  for (const key of ATOM_IDENTITY_BOUNDARY_KEYS) {
    delete next[key];
  }
  return next;
}

export function hasAtomIdentityBoundaryViolation(input: Record<string, unknown>): string[] {
  return ATOM_IDENTITY_BOUNDARY_KEYS.filter((key) => key in input && input[key] !== undefined);
}

/**
 * Apply additive v2 defaults without rewriting existing explicit values.
 * Always strips identity-boundary keys.
 */
export function withAtomV2Defaults(atom: MemoryAtom): MemoryAtom {
  const sanitized = stripAtomIdentityBoundary(
    atom as MemoryAtom & Record<string, unknown>,
  ) as MemoryAtom;
  const policy = resolveAtomTypePolicy(sanitized.atomType);
  const privacy: MemoryPrivacyMetadata = {
    ...DEFAULT_PRIVACY,
    syncEligibility: policy.promotionDefault,
    ...sanitized.privacy,
  };
  const lifecycle: MemoryLifecycleMetadata = {
    retentionClass: policy.retentionClass,
    ...sanitized.lifecycle,
  };
  const governance: MemoryGovernanceMetrics = {
    scoreVersion: 1,
    ...sanitized.governance,
  };
  return {
    ...sanitized,
    privacy,
    lifecycle,
    governance,
  };
}

/** Admission: should this enter long-term canonical? Independent of retrieval/promotion. */
export function scoreAdmission(atom: MemoryAtom): number {
  const confidence = atom.metrics?.confidence ?? 0;
  const evidenceBoost = Math.min(0.25, (atom.provenance.evidenceRefs?.length ?? 0) * 0.05);
  const statusPenalty =
    atom.state.status === "deprecated" || atom.state.status === "conflicted" ? 0.4 : 0;
  return clamp01(confidence * 0.75 + evidenceBoost - statusPenalty);
}

/** Retrieval: should this inject for the current task? Independent of admission/promotion. */
export function scoreRetrieval(
  atom: MemoryAtom,
  opts?: { requiredAtomTypes?: string[]; queryTags?: string[] },
): number {
  const confidence = atom.metrics?.confidence ?? 0;
  const reuseBoost = Math.min(0.2, (atom.metrics?.reuseCount ?? 0) * 0.02);
  const typeMatch =
    opts?.requiredAtomTypes && opts.requiredAtomTypes.length > 0
      ? opts.requiredAtomTypes.includes(atom.atomType)
        ? 0.15
        : -0.1
      : 0;
  const tags = new Set(atom.trigger.contextTags.map((tag) => tag.toLowerCase()));
  const queryTags = opts?.queryTags ?? [];
  const tagHits = queryTags.filter((tag) => tags.has(tag.toLowerCase())).length;
  const tagBoost = Math.min(0.2, tagHits * 0.05);
  return clamp01(confidence * 0.55 + reuseBoost + typeMatch + tagBoost);
}

/** Promotion: eligible for Cloud Intelligence? Independent of admission/retrieval. */
export function scorePromotion(atom: MemoryAtom): number {
  const policy = resolveAtomTypePolicy(atom.atomType);
  if (atom.privacy?.syncEligibility === "blocked" || policy.promotionDefault === "blocked") {
    return 0;
  }
  if (atom.privacy?.privacyLevel === "private") {
    return 0;
  }
  if (policy.confirmationRequired && atom.privacy?.consentRequired !== false) {
    return clamp01((atom.metrics?.confidence ?? 0) * 0.3);
  }
  const confidence = atom.metrics?.confidence ?? 0;
  const eligibilityBoost = atom.privacy?.syncEligibility === "promoted" ? 0.25 : 0.1;
  return clamp01(confidence * 0.5 + eligibilityBoost);
}

export function attachSeparatedScores(
  atom: MemoryAtom,
  opts?: { requiredAtomTypes?: string[]; queryTags?: string[] },
): MemoryAtom {
  const base = withAtomV2Defaults(atom);
  return {
    ...base,
    governance: {
      ...base.governance,
      scoreVersion: 1,
      admissionScore: scoreAdmission(base),
      retrievalScore: scoreRetrieval(base, opts),
      promotionScore: scorePromotion(base),
      lastScoredAt: new Date().toISOString(),
    },
  };
}

/**
 * Dual-source coverage for injection gates (Gate P2 coverage metric).
 * A binding is live only when every link for that binding is still linked
 * (any `unlinkedAt` marks the binding non-live after Forget/unlink).
 */
export function computeDualSourceCoverage(
  links: ReadonlyArray<Pick<SourceObjectLink, "sourceBindingId" | "unlinkedAt">>,
): DualSourceCoverageMetric {
  const byBinding = new Map<string, Array<Pick<SourceObjectLink, "unlinkedAt">>>();
  for (const link of links) {
    const bucket = byBinding.get(link.sourceBindingId) ?? [];
    bucket.push(link);
    byBinding.set(link.sourceBindingId, bucket);
  }
  const sourceBindingCount = byBinding.size;
  let liveSourceCount = 0;
  for (const bucket of byBinding.values()) {
    if (bucket.length > 0 && bucket.every((link) => !link.unlinkedAt)) {
      liveSourceCount += 1;
    }
  }
  return {
    metricVersion: 1,
    sourceBindingCount,
    liveSourceCount,
    coverageRatio: liveSourceCount / Math.max(1, sourceBindingCount),
  };
}
