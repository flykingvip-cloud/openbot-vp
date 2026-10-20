import { CATALOG_FIELD_LIMITS } from "./limits.js";
import type {
  ActorRef,
  CognitiveTier,
  DataGovernanceEnvelope,
  PreservationPriority,
  RetrievalEligibility,
  RetrievalGovernance,
  RetrievalPatch,
} from "./types.js";

const FORBIDDEN_WIRE_KEYS = new Set([
  "owner",
  "scope",
  "classification",
  "canonicalBindingId",
  "bindings",
  "legalHold",
  "lifecycleState",
  "activeLifecycleOperation",
  "cognitiveProvenanceRef",
  "cognitiveProvenanceBindingId",
  "lastCognitiveMutationId",
  "retrievalGovernance",
]);

const RETRIEVAL_PATCH_KEYS = new Set([
  "eligibility",
  "basePriority",
  "freshnessPolicyId",
  "applicabilityPolicyId",
]);

const COGNITIVE_TIERS = new Set<CognitiveTier>(["C0", "C1", "C2", "C3", "C4"]);
const PRESERVATION_PRIORITIES = new Set<PreservationPriority>([
  "rebuildable",
  "standard",
  "important",
  "critical",
]);
const RETRIEVAL_ELIGIBILITIES = new Set<RetrievalEligibility>(["blocked", "eligible", "retired"]);

const ELIGIBILITY_RANK: Record<RetrievalEligibility, number> = {
  eligible: 0,
  retired: 1,
  blocked: 2,
};

export type CognitivePatchInput = {
  cognitiveTier?: CognitiveTier;
  preservationPriority?: PreservationPriority;
  retrievalPatch?: RetrievalPatch;
};

export type CognitivePatchDenied = {
  ok: false;
  error:
    | "field_not_writable"
    | "actor_not_authorized"
    | "eligibility_not_monotonic"
    | "priority_not_monotonic"
    | "retrieval_governance_missing"
    | "retrieval_governance_incomplete"
    | "invalid_cognitive_field"
    | "missing_field";
};

export function parseCognitivePatchInput(
  patch: Record<string, unknown>,
): { ok: true; patch: CognitivePatchInput } | CognitivePatchDenied {
  for (const key of Object.keys(patch)) {
    if (FORBIDDEN_WIRE_KEYS.has(key)) {
      return { ok: false, error: "field_not_writable" };
    }
    if (key !== "cognitiveTier" && key !== "preservationPriority" && key !== "retrievalPatch") {
      return { ok: false, error: "field_not_writable" };
    }
  }
  if (
    patch.cognitiveTier === undefined &&
    patch.preservationPriority === undefined &&
    patch.retrievalPatch === undefined
  ) {
    return { ok: false, error: "missing_field" };
  }
  const parsed: CognitivePatchInput = {};
  if (patch.cognitiveTier !== undefined) {
    if (
      typeof patch.cognitiveTier !== "string" ||
      !COGNITIVE_TIERS.has(patch.cognitiveTier as CognitiveTier)
    ) {
      return { ok: false, error: "invalid_cognitive_field" };
    }
    parsed.cognitiveTier = patch.cognitiveTier as CognitiveTier;
  }
  if (patch.preservationPriority !== undefined) {
    if (
      typeof patch.preservationPriority !== "string" ||
      !PRESERVATION_PRIORITIES.has(patch.preservationPriority as PreservationPriority)
    ) {
      return { ok: false, error: "invalid_cognitive_field" };
    }
    parsed.preservationPriority = patch.preservationPriority as PreservationPriority;
  }
  if (patch.retrievalPatch !== undefined) {
    if (
      !patch.retrievalPatch ||
      typeof patch.retrievalPatch !== "object" ||
      Array.isArray(patch.retrievalPatch)
    ) {
      return { ok: false, error: "invalid_cognitive_field" };
    }
    const raw = patch.retrievalPatch as Record<string, unknown>;
    for (const key of Object.keys(raw)) {
      if (!RETRIEVAL_PATCH_KEYS.has(key)) {
        return { ok: false, error: "field_not_writable" };
      }
    }
    const retrievalPatch: RetrievalPatch = {};
    if (raw.eligibility !== undefined) {
      if (
        typeof raw.eligibility !== "string" ||
        !RETRIEVAL_ELIGIBILITIES.has(raw.eligibility as RetrievalEligibility)
      ) {
        return { ok: false, error: "invalid_cognitive_field" };
      }
      retrievalPatch.eligibility = raw.eligibility as RetrievalEligibility;
    }
    if (raw.basePriority !== undefined) {
      if (
        typeof raw.basePriority !== "number" ||
        !Number.isFinite(raw.basePriority) ||
        raw.basePriority < 0 ||
        raw.basePriority > 1
      ) {
        return { ok: false, error: "invalid_cognitive_field" };
      }
      retrievalPatch.basePriority = raw.basePriority;
    }
    if (raw.freshnessPolicyId !== undefined) {
      const freshnessPolicyId = parsePolicyId(raw.freshnessPolicyId);
      if (!freshnessPolicyId.ok) {
        return freshnessPolicyId;
      }
      retrievalPatch.freshnessPolicyId = freshnessPolicyId.value;
    }
    if (raw.applicabilityPolicyId !== undefined) {
      const applicabilityPolicyId = parsePolicyId(raw.applicabilityPolicyId);
      if (!applicabilityPolicyId.ok) {
        return applicabilityPolicyId;
      }
      retrievalPatch.applicabilityPolicyId = applicabilityPolicyId.value;
    }
    parsed.retrievalPatch = retrievalPatch;
  }
  return { ok: true, patch: parsed };
}

function parsePolicyId(value: unknown): { ok: true; value: string } | CognitivePatchDenied {
  if (typeof value !== "string") {
    return { ok: false, error: "invalid_cognitive_field" };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > CATALOG_FIELD_LIMITS.bindingIdMax) {
    return { ok: false, error: "invalid_cognitive_field" };
  }
  return { ok: true, value: trimmed };
}

function mergeRetrievalGovernance(
  stored: RetrievalGovernance | undefined,
  patch: RetrievalPatch | undefined,
  actor: ActorRef,
): { ok: true; value: RetrievalGovernance | undefined } | CognitivePatchDenied {
  if (patch === undefined) {
    return { ok: true, value: stored };
  }
  if (
    actor.kind === "worker" &&
    (patch.freshnessPolicyId !== undefined || patch.applicabilityPolicyId !== undefined)
  ) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!stored) {
    if (actor.kind === "worker") {
      return { ok: false, error: "retrieval_governance_missing" };
    }
    if (
      patch.eligibility === undefined ||
      patch.basePriority === undefined ||
      patch.freshnessPolicyId === undefined ||
      patch.applicabilityPolicyId === undefined
    ) {
      return { ok: false, error: "retrieval_governance_incomplete" };
    }
    return {
      ok: true,
      value: {
        eligibility: patch.eligibility,
        basePriority: patch.basePriority,
        freshnessPolicyId: patch.freshnessPolicyId,
        applicabilityPolicyId: patch.applicabilityPolicyId,
      },
    };
  }
  return {
    ok: true,
    value: {
      eligibility: patch.eligibility ?? stored.eligibility,
      basePriority: patch.basePriority ?? stored.basePriority,
      freshnessPolicyId: patch.freshnessPolicyId ?? stored.freshnessPolicyId,
      applicabilityPolicyId: patch.applicabilityPolicyId ?? stored.applicabilityPolicyId,
    },
  };
}

function assertMonotonicity(params: {
  actor: ActorRef;
  stored: RetrievalGovernance | undefined;
  merged: RetrievalGovernance | undefined;
  patch: CognitivePatchInput;
}): CognitivePatchDenied | null {
  const { actor, stored, merged, patch } = params;
  if (actor.kind === "operator" || actor.kind === "system") {
    return null;
  }
  if (actor.kind === "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (patch.cognitiveTier !== undefined || patch.preservationPriority !== undefined) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!patch.retrievalPatch) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!stored || !merged) {
    return { ok: false, error: "retrieval_governance_missing" };
  }
  if (ELIGIBILITY_RANK[merged.eligibility] < ELIGIBILITY_RANK[stored.eligibility]) {
    return { ok: false, error: "eligibility_not_monotonic" };
  }
  if (merged.basePriority > stored.basePriority) {
    return { ok: false, error: "priority_not_monotonic" };
  }
  if (
    merged.freshnessPolicyId !== stored.freshnessPolicyId ||
    merged.applicabilityPolicyId !== stored.applicabilityPolicyId
  ) {
    return { ok: false, error: "actor_not_authorized" };
  }
  return null;
}

export function applyCognitivePatch(params: {
  envelope: DataGovernanceEnvelope;
  actor: ActorRef;
  patch: CognitivePatchInput;
}):
  | {
      ok: true;
      next: Pick<
        DataGovernanceEnvelope,
        "cognitiveTier" | "preservationPriority" | "retrievalGovernance"
      >;
    }
  | CognitivePatchDenied {
  const mergedRetrieval = mergeRetrievalGovernance(
    params.envelope.retrievalGovernance,
    params.patch.retrievalPatch,
    params.actor,
  );
  if (!mergedRetrieval.ok) {
    return mergedRetrieval;
  }
  if (mergedRetrieval.value) {
    if (
      !Number.isFinite(mergedRetrieval.value.basePriority) ||
      mergedRetrieval.value.basePriority < 0 ||
      mergedRetrieval.value.basePriority > 1
    ) {
      return { ok: false, error: "invalid_cognitive_field" };
    }
  }
  const mono = assertMonotonicity({
    actor: params.actor,
    stored: params.envelope.retrievalGovernance,
    merged: mergedRetrieval.value,
    patch: params.patch,
  });
  if (mono) {
    return mono;
  }
  return {
    ok: true,
    next: {
      cognitiveTier: params.patch.cognitiveTier ?? params.envelope.cognitiveTier,
      preservationPriority:
        params.patch.preservationPriority ?? params.envelope.preservationPriority,
      retrievalGovernance: mergedRetrieval.value,
    },
  };
}

export function patchedFieldNames(
  patch: CognitivePatchInput,
): Array<"cognitiveTier" | "preservationPriority" | "retrievalPatch"> {
  const fields: Array<"cognitiveTier" | "preservationPriority" | "retrievalPatch"> = [];
  if (patch.cognitiveTier !== undefined) {
    fields.push("cognitiveTier");
  }
  if (patch.preservationPriority !== undefined) {
    fields.push("preservationPriority");
  }
  if (patch.retrievalPatch !== undefined) {
    fields.push("retrievalPatch");
  }
  return fields;
}
