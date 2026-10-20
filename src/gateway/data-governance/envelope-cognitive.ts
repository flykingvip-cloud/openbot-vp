import { CATALOG_FIELD_LIMITS } from "./limits.js";
import type {
  ActiveCognitiveMergeOp,
  CognitiveEnvelopeFields,
  CognitiveProvenanceNodeType,
  CognitiveProvenanceRef,
  CognitiveTier,
  DataGovernanceEnvelope,
  EnvelopeValidationError,
  GovernanceEnvelopeSchemaVersion,
  MergeFinalizationState,
  PreservationPriority,
  RetrievalEligibility,
  RetrievalGovernance,
} from "./types.js";

export const COGNITIVE_ENVELOPE_KEYS = [
  "cognitiveTier",
  "preservationPriority",
  "retrievalGovernance",
  "cognitiveProvenanceRef",
  "cognitiveProvenanceBindingId",
  "lastCognitiveMutationId",
  // P3-e strong merge fields (B29/B34/B35/B39). Strong, never projection: the merge
  // state machine and the merge-protected CAS predicate read them.
  "activeCognitiveMergeOp",
  "lastAcceptedFencingToken",
  "lastAcceptedConflictGraphEpoch",
  "mergeFinalizationState",
  "lastMergeReceiptId",
  "mergedDerivedMemoryResourceId",
] as const;

const COGNITIVE_KEY_SET = new Set<string>(COGNITIVE_ENVELOPE_KEYS);

const COGNITIVE_TIERS = new Set<CognitiveTier>(["C0", "C1", "C2", "C3", "C4"]);
const PRESERVATION_PRIORITIES = new Set<PreservationPriority>([
  "rebuildable",
  "standard",
  "important",
  "critical",
]);
const RETRIEVAL_ELIGIBILITIES = new Set<RetrievalEligibility>(["blocked", "eligible", "retired"]);
const PROVENANCE_NODE_TYPES = new Set<CognitiveProvenanceNodeType>([
  "MemoryAtom",
  "EventSkeleton",
  "Entity",
  "Scenario",
  "Problem",
  "Evidence",
]);

export function isCognitiveEnvelopeKey(key: string): boolean {
  return COGNITIVE_KEY_SET.has(key);
}

export function envelopeHasCognitiveKeys(raw: Record<string, unknown>): boolean {
  return COGNITIVE_ENVELOPE_KEYS.some((key) => raw[key] !== undefined);
}

function boundedId(
  value: unknown,
  field: string,
  errors: EnvelopeValidationError[],
): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ code: "missing_field", field, message: `${field} required` });
    return undefined;
  }
  if (value.length > CATALOG_FIELD_LIMITS.bindingIdMax) {
    errors.push({ code: "field_too_long", field, message: `${field} exceeds limit` });
    return undefined;
  }
  return value.trim();
}

function parseRetrievalGovernance(
  input: unknown,
  errors: EnvelopeValidationError[],
): RetrievalGovernance | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push({
      code: "invalid_cognitive_field",
      field: "retrievalGovernance",
      message: "retrievalGovernance must be an object",
    });
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const allowed = new Set([
    "eligibility",
    "basePriority",
    "freshnessPolicyId",
    "applicabilityPolicyId",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      errors.push({
        code: "unknown_field",
        field: `retrievalGovernance.${key}`,
        message: "unknown retrievalGovernance field",
      });
    }
  }
  if (
    typeof raw.eligibility !== "string" ||
    !RETRIEVAL_ELIGIBILITIES.has(raw.eligibility as RetrievalEligibility)
  ) {
    errors.push({
      code: "invalid_cognitive_field",
      field: "retrievalGovernance.eligibility",
      message: "eligibility invalid",
    });
  }
  if (
    typeof raw.basePriority !== "number" ||
    !Number.isFinite(raw.basePriority) ||
    raw.basePriority < 0 ||
    raw.basePriority > 1
  ) {
    errors.push({
      code: "invalid_cognitive_field",
      field: "retrievalGovernance.basePriority",
      message: "basePriority must be finite in [0, 1]",
    });
  }
  const freshnessPolicyId = boundedId(
    raw.freshnessPolicyId,
    "retrievalGovernance.freshnessPolicyId",
    errors,
  );
  const applicabilityPolicyId = boundedId(
    raw.applicabilityPolicyId,
    "retrievalGovernance.applicabilityPolicyId",
    errors,
  );
  if (
    typeof raw.eligibility !== "string" ||
    !RETRIEVAL_ELIGIBILITIES.has(raw.eligibility as RetrievalEligibility) ||
    typeof raw.basePriority !== "number" ||
    !Number.isFinite(raw.basePriority) ||
    raw.basePriority < 0 ||
    raw.basePriority > 1 ||
    !freshnessPolicyId ||
    !applicabilityPolicyId
  ) {
    return undefined;
  }
  return {
    eligibility: raw.eligibility as RetrievalEligibility,
    basePriority: raw.basePriority,
    freshnessPolicyId,
    applicabilityPolicyId,
  };
}

export function parseCognitiveProvenanceRef(
  input: unknown,
  errors: EnvelopeValidationError[],
): CognitiveProvenanceRef | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push({
      code: "invalid_cognitive_field",
      field: "cognitiveProvenanceRef",
      message: "cognitiveProvenanceRef must be an object",
    });
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const allowed = new Set(["schemaPackage", "nodeType", "objectId", "version", "provenanceHash"]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      errors.push({
        code: "unknown_field",
        field: `cognitiveProvenanceRef.${key}`,
        message: "unknown cognitiveProvenanceRef field",
      });
      return undefined;
    }
  }
  if (raw.schemaPackage !== "cogniweave-sdk") {
    errors.push({
      code: "invalid_cognitive_field",
      field: "cognitiveProvenanceRef.schemaPackage",
      message: "schemaPackage must be cogniweave-sdk",
    });
  }
  if (
    typeof raw.nodeType !== "string" ||
    !PROVENANCE_NODE_TYPES.has(raw.nodeType as CognitiveProvenanceNodeType)
  ) {
    errors.push({
      code: "invalid_cognitive_field",
      field: "cognitiveProvenanceRef.nodeType",
      message: "nodeType invalid",
    });
  }
  const objectId = boundedId(raw.objectId, "cognitiveProvenanceRef.objectId", errors);
  const provenanceHash = boundedId(
    raw.provenanceHash,
    "cognitiveProvenanceRef.provenanceHash",
    errors,
  );
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) {
    errors.push({
      code: "invalid_cognitive_field",
      field: "cognitiveProvenanceRef.version",
      message: "version must be an integer >= 1",
    });
  }
  if (
    raw.schemaPackage !== "cogniweave-sdk" ||
    typeof raw.nodeType !== "string" ||
    !PROVENANCE_NODE_TYPES.has(raw.nodeType as CognitiveProvenanceNodeType) ||
    !objectId ||
    !provenanceHash ||
    typeof raw.version !== "number" ||
    !Number.isInteger(raw.version) ||
    raw.version < 1
  ) {
    return undefined;
  }
  return {
    schemaPackage: "cogniweave-sdk",
    nodeType: raw.nodeType as CognitiveProvenanceNodeType,
    objectId,
    version: raw.version,
    provenanceHash,
  };
}

const MERGE_FINALIZATION_STATES = new Set<MergeFinalizationState>([
  "pending_finalization",
  "finalized",
]);

const ACTIVE_MERGE_OP_KEYS = new Set([
  "mergeId",
  "fencingToken",
  "derivedMemoryResourceId",
  "conflictGraphEpoch",
  "state",
  "expiresAt",
]);

/** Fencing generations are monotonic safe integers >= 0; strings are rejected. */
function fencingGeneration(
  value: unknown,
  field: string,
  errors: EnvelopeValidationError[],
): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    errors.push({
      code: "invalid_cognitive_field",
      field,
      message: `${field} must be a safe non-negative integer`,
    });
    return undefined;
  }
  return value;
}

function parseActiveCognitiveMergeOp(
  input: unknown,
  errors: EnvelopeValidationError[],
): ActiveCognitiveMergeOp | null | undefined {
  if (input === null) {
    return null;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    errors.push({
      code: "invalid_cognitive_field",
      field: "activeCognitiveMergeOp",
      message: "activeCognitiveMergeOp must be an object or null",
    });
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!ACTIVE_MERGE_OP_KEYS.has(key)) {
      errors.push({
        code: "unknown_field",
        field: `activeCognitiveMergeOp.${key}`,
        message: "unknown activeCognitiveMergeOp field",
      });
      return undefined;
    }
  }
  const mergeId = boundedId(raw.mergeId, "activeCognitiveMergeOp.mergeId", errors);
  const derivedMemoryResourceId = boundedId(
    raw.derivedMemoryResourceId,
    "activeCognitiveMergeOp.derivedMemoryResourceId",
    errors,
  );
  const expiresAt = boundedId(raw.expiresAt, "activeCognitiveMergeOp.expiresAt", errors);
  const fencingToken = fencingGeneration(
    raw.fencingToken,
    "activeCognitiveMergeOp.fencingToken",
    errors,
  );
  const conflictGraphEpoch = fencingGeneration(
    raw.conflictGraphEpoch,
    "activeCognitiveMergeOp.conflictGraphEpoch",
    errors,
  );
  if (raw.state !== "attaching") {
    errors.push({
      code: "invalid_cognitive_field",
      field: "activeCognitiveMergeOp.state",
      message: "state must be attaching",
    });
  }
  if (
    !mergeId ||
    !derivedMemoryResourceId ||
    !expiresAt ||
    fencingToken === undefined ||
    conflictGraphEpoch === undefined ||
    raw.state !== "attaching"
  ) {
    return undefined;
  }
  return {
    mergeId,
    fencingToken,
    derivedMemoryResourceId,
    conflictGraphEpoch,
    state: "attaching",
    expiresAt,
  };
}

function parseCognitiveMergeFields(
  raw: Record<string, unknown>,
  errors: EnvelopeValidationError[],
  fields: CognitiveEnvelopeFields,
): void {
  if (raw.activeCognitiveMergeOp !== undefined) {
    const op = parseActiveCognitiveMergeOp(raw.activeCognitiveMergeOp, errors);
    if (op !== undefined) {
      fields.activeCognitiveMergeOp = op;
    }
  }
  if (raw.lastAcceptedFencingToken !== undefined) {
    const token = fencingGeneration(
      raw.lastAcceptedFencingToken,
      "lastAcceptedFencingToken",
      errors,
    );
    if (token !== undefined) {
      fields.lastAcceptedFencingToken = token;
    }
  }
  if (raw.lastAcceptedConflictGraphEpoch !== undefined) {
    const epoch = fencingGeneration(
      raw.lastAcceptedConflictGraphEpoch,
      "lastAcceptedConflictGraphEpoch",
      errors,
    );
    if (epoch !== undefined) {
      fields.lastAcceptedConflictGraphEpoch = epoch;
    }
  }
  if (raw.mergeFinalizationState !== undefined) {
    if (
      typeof raw.mergeFinalizationState !== "string" ||
      !MERGE_FINALIZATION_STATES.has(raw.mergeFinalizationState as MergeFinalizationState)
    ) {
      errors.push({
        code: "invalid_cognitive_field",
        field: "mergeFinalizationState",
        message: "mergeFinalizationState invalid",
      });
    } else {
      fields.mergeFinalizationState = raw.mergeFinalizationState as MergeFinalizationState;
    }
  }
  if (raw.lastMergeReceiptId !== undefined) {
    const id = boundedId(raw.lastMergeReceiptId, "lastMergeReceiptId", errors);
    if (id) {
      fields.lastMergeReceiptId = id;
    }
  }
  if (raw.mergedDerivedMemoryResourceId !== undefined) {
    const id = boundedId(
      raw.mergedDerivedMemoryResourceId,
      "mergedDerivedMemoryResourceId",
      errors,
    );
    if (id) {
      fields.mergedDerivedMemoryResourceId = id;
    }
  }
}

/** Parse optional v2 cognitive fields. v1 callers must not invoke this. */
export function parseCognitiveEnvelopeFields(
  raw: Record<string, unknown>,
  errors: EnvelopeValidationError[],
): CognitiveEnvelopeFields {
  const fields: CognitiveEnvelopeFields = {};
  if (raw.cognitiveTier !== undefined) {
    if (
      typeof raw.cognitiveTier !== "string" ||
      !COGNITIVE_TIERS.has(raw.cognitiveTier as CognitiveTier)
    ) {
      errors.push({
        code: "invalid_cognitive_field",
        field: "cognitiveTier",
        message: "cognitiveTier invalid",
      });
    } else {
      fields.cognitiveTier = raw.cognitiveTier as CognitiveTier;
    }
  }
  if (raw.preservationPriority !== undefined) {
    if (
      typeof raw.preservationPriority !== "string" ||
      !PRESERVATION_PRIORITIES.has(raw.preservationPriority as PreservationPriority)
    ) {
      errors.push({
        code: "invalid_cognitive_field",
        field: "preservationPriority",
        message: "preservationPriority invalid",
      });
    } else {
      fields.preservationPriority = raw.preservationPriority as PreservationPriority;
    }
  }
  if (raw.retrievalGovernance !== undefined) {
    const governance = parseRetrievalGovernance(raw.retrievalGovernance, errors);
    if (governance) {
      fields.retrievalGovernance = governance;
    }
  }
  if (raw.cognitiveProvenanceRef !== undefined) {
    const ref = parseCognitiveProvenanceRef(raw.cognitiveProvenanceRef, errors);
    if (ref) {
      fields.cognitiveProvenanceRef = ref;
    }
  }
  if (raw.cognitiveProvenanceBindingId !== undefined) {
    const id = boundedId(raw.cognitiveProvenanceBindingId, "cognitiveProvenanceBindingId", errors);
    if (id) {
      fields.cognitiveProvenanceBindingId = id;
    }
  }
  if (raw.lastCognitiveMutationId !== undefined) {
    const id = boundedId(raw.lastCognitiveMutationId, "lastCognitiveMutationId", errors);
    if (id) {
      fields.lastCognitiveMutationId = id;
    }
  }
  parseCognitiveMergeFields(raw, errors, fields);
  return fields;
}

export function cognitiveEnvelopeFingerprint(envelope: CognitiveEnvelopeFields): string {
  return JSON.stringify({
    cognitiveTier: envelope.cognitiveTier ?? null,
    preservationPriority: envelope.preservationPriority ?? null,
    retrievalGovernance: envelope.retrievalGovernance ?? null,
    cognitiveProvenanceRef: envelope.cognitiveProvenanceRef ?? null,
    cognitiveProvenanceBindingId: envelope.cognitiveProvenanceBindingId ?? null,
    lastCognitiveMutationId: envelope.lastCognitiveMutationId ?? null,
    activeCognitiveMergeOp: envelope.activeCognitiveMergeOp ?? null,
    lastAcceptedFencingToken: envelope.lastAcceptedFencingToken ?? null,
    lastAcceptedConflictGraphEpoch: envelope.lastAcceptedConflictGraphEpoch ?? null,
    mergeFinalizationState: envelope.mergeFinalizationState ?? null,
    lastMergeReceiptId: envelope.lastMergeReceiptId ?? null,
    mergedDerivedMemoryResourceId: envelope.mergedDerivedMemoryResourceId ?? null,
  });
}

/**
 * Merge fencing generations and terminal merge refs never move backwards (B34/B39/B43).
 * Enforced on every cognitive Catalog write, so a stale writer cannot rewind the state
 * that admission and recovery classification depend on.
 */
export function assertNoMergeFencingRegression(params: {
  existing: DataGovernanceEnvelope | null | undefined;
  next: DataGovernanceEnvelope;
}): EnvelopeValidationError | null {
  const previous = params.existing;
  if (!previous) {
    return null;
  }
  const priorToken = previous.lastAcceptedFencingToken ?? 0;
  const nextToken = params.next.lastAcceptedFencingToken ?? 0;
  if (nextToken < priorToken) {
    return {
      code: "invalid_cognitive_field",
      field: "lastAcceptedFencingToken",
      message: "lastAcceptedFencingToken must not decrease",
    };
  }
  const priorEpoch = previous.lastAcceptedConflictGraphEpoch ?? 0;
  const nextEpoch = params.next.lastAcceptedConflictGraphEpoch ?? 0;
  if (nextEpoch < priorEpoch) {
    return {
      code: "invalid_cognitive_field",
      field: "lastAcceptedConflictGraphEpoch",
      message: "lastAcceptedConflictGraphEpoch must not decrease",
    };
  }
  // Commit is irreversible: terminal refs may never be cleared or repointed (B43).
  if (
    previous.lastMergeReceiptId &&
    params.next.lastMergeReceiptId !== previous.lastMergeReceiptId
  ) {
    return {
      code: "invalid_cognitive_field",
      field: "lastMergeReceiptId",
      message: "lastMergeReceiptId is terminal and immutable",
    };
  }
  if (
    previous.mergedDerivedMemoryResourceId &&
    params.next.mergedDerivedMemoryResourceId !== previous.mergedDerivedMemoryResourceId
  ) {
    return {
      code: "invalid_cognitive_field",
      field: "mergedDerivedMemoryResourceId",
      message: "mergedDerivedMemoryResourceId is terminal and immutable",
    };
  }
  // Finalized products are never forced back to pending (B35).
  if (
    previous.mergeFinalizationState === "finalized" &&
    params.next.mergeFinalizationState === "pending_finalization"
  ) {
    return {
      code: "invalid_cognitive_field",
      field: "mergeFinalizationState",
      message: "finalized merge product must not revert to pending_finalization",
    };
  }
  return null;
}

export function isCognitiveMetadataMutation(
  existing: DataGovernanceEnvelope | null | undefined,
  next: DataGovernanceEnvelope,
): boolean {
  if (!existing) {
    return (
      next.schemaVersion === 2 ||
      envelopeHasCognitiveKeys(next as unknown as Record<string, unknown>)
    );
  }
  if (existing.schemaVersion === 1 && next.schemaVersion === 2) {
    return true;
  }
  return cognitiveEnvelopeFingerprint(existing) !== cognitiveEnvelopeFingerprint(next);
}

export function assertNoEnvelopeSchemaDowngrade(params: {
  existing: DataGovernanceEnvelope | null | undefined;
  next: DataGovernanceEnvelope;
}): EnvelopeValidationError | null {
  if (params.existing?.schemaVersion === 2 && params.next.schemaVersion === 1) {
    return {
      code: "schema_downgrade_denied",
      field: "schemaVersion",
      message: "envelope schemaVersion 2→1 is denied",
    };
  }
  return null;
}

export function readEnvelopeSchemaVersion(
  raw: Record<string, unknown>,
): GovernanceEnvelopeSchemaVersion | null {
  if (raw.schemaVersion === 1 || raw.schemaVersion === 2) {
    return raw.schemaVersion;
  }
  return null;
}
