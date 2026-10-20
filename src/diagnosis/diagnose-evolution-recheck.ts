/**
 * Track A DiagnosisRecheckPort. First period: Working DNA and skill installation.
 * Does not import the Gateway control plane, does not Apply, and does not
 * copy report prose or evidence payloads.
 */
import {
  assertDiagnosisRecheckBinding,
  assertDiagnosisRecheckRequest,
  assertDiagnosisRecheckResult,
  assertEvolutionVerificationRef,
  canonicalizeFindingRefs,
  type DiagnosisRecheckOutcome,
  type DiagnosisRecheckPort,
  type DiagnosisRecheckRequest,
  type DiagnosisRecheckResult,
} from "@openbot/evolution-core";

export const DIAGNOSIS_RECHECK_SURFACES = [
  "agent.working-dna",
  "capability.skill-installation",
] as const;

export type DiagnosisRecheckSurfaceId = (typeof DIAGNOSIS_RECHECK_SURFACES)[number];

export type DiagnosisRecheckObservation = {
  status: "ok" | "missing" | "unreadable" | "timeout";
  observedHash: string | null;
  baselineHash: string | null;
  expectedHash: string | null;
  effectWindowRef?: string | null;
  observedTenantScope?: string | null;
  agentMatched?: boolean;
  versionMatched?: boolean;
  enabled?: boolean | null;
};

export type DiagnosisRecheckObserver = {
  observe(request: DiagnosisRecheckRequest): Promise<DiagnosisRecheckObservation>;
};

export type DiagnosisRecheckPortOptions = {
  trustedTenantScope?: string | null;
};

export function isDiagnosisRecheckSurface(
  surfaceId: string,
): surfaceId is DiagnosisRecheckSurfaceId {
  return (DIAGNOSIS_RECHECK_SURFACES as readonly string[]).includes(surfaceId);
}

export function createDiagnosisRecheckPort(
  observer: DiagnosisRecheckObserver,
  options: DiagnosisRecheckPortOptions = {},
): DiagnosisRecheckPort {
  return {
    async recheck(request) {
      try {
        assertEvolutionVerificationRef(request.verificationRef);
      } catch {
        return finish(request, "BLOCKED", "verification_incomplete", ["obs:recheck-verification"]);
      }
      try {
        assertDiagnosisRecheckRequest(request);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("report prose") || message.includes("evidence payload")) {
          throw err;
        }
        return finish(request, "BLOCKED", "invalid_request", ["obs:recheck-invalid"]);
      }
      if (options.trustedTenantScope !== undefined) {
        const trusted = options.trustedTenantScope?.trim() ?? "";
        const got = request.tenantScope?.trim() ?? "";
        if (trusted !== got) {
          return finish(request, "BLOCKED", "tenant_mismatch", ["obs:recheck-tenant"]);
        }
      }
      if (!isDiagnosisRecheckSurface(request.surfaceId)) {
        return finish(request, "BLOCKED", "unsupported_surface", ["obs:recheck-unsupported"]);
      }
      if (request.surfaceId === "capability.skill-installation") {
        const skillId = request.target.domain === "capability" ? request.target.skillId.trim() : "";
        if (!skillId) {
          return finish(request, "BLOCKED", "unknown_target", ["obs:recheck-unknown-target"]);
        }
      }
      if (request.surfaceId === "agent.working-dna") {
        const agentId = request.target.domain === "agent" ? request.target.agentId.trim() : "";
        if (!agentId) {
          return finish(request, "BLOCKED", "unknown_target", ["obs:recheck-unknown-target"]);
        }
      }

      let observation: DiagnosisRecheckObservation;
      try {
        observation = await observer.observe(request);
      } catch {
        return finish(request, "INCONCLUSIVE", "sot_unreadable", ["obs:recheck-inconclusive"]);
      }
      if (observation.status === "timeout") {
        return finish(request, "INCONCLUSIVE", "sot_timeout", ["obs:recheck-timeout"]);
      }
      if (observation.status !== "ok" || !observation.observedHash?.trim()) {
        return finish(
          request,
          "INCONCLUSIVE",
          observation.status === "missing" ? "sot_missing" : "sot_unreadable",
          ["obs:recheck-inconclusive"],
        );
      }
      if (
        observation.observedTenantScope != null &&
        (request.tenantScope?.trim() ?? "") !== observation.observedTenantScope.trim()
      ) {
        return finish(request, "BLOCKED", "tenant_mismatch", ["obs:recheck-tenant"]);
      }

      const observed = observation.observedHash.trim();
      const refs = observation.effectWindowRef?.trim()
        ? [`obs:recheck:${observed}`, observation.effectWindowRef.trim()]
        : [`obs:recheck:${observed}`];
      if (
        observation.agentMatched === false ||
        observation.versionMatched === false ||
        observation.enabled === false
      ) {
        return finish(request, "STILL_OPEN", "sot_relation_mismatch", refs);
      }
      if (observation.baselineHash?.trim() && observed === observation.baselineHash.trim()) {
        return finish(request, "STILL_OPEN", "sot_unchanged", refs);
      }
      if (!observation.expectedHash?.trim()) {
        return finish(request, "INCONCLUSIVE", "expected_unknown", refs);
      }
      if (observed !== observation.expectedHash.trim()) {
        return finish(request, "REGRESSED", "sot_diverged", refs);
      }
      if (request.surfaceId === "agent.working-dna" && !observation.effectWindowRef?.trim()) {
        return finish(request, "INCONCLUSIVE", "effect_window_unreadable", refs);
      }
      return finish(request, "RESOLVED", "sot_confirmed", refs);
    },
  };
}

function finish(
  request: DiagnosisRecheckRequest,
  outcome: DiagnosisRecheckOutcome,
  reasonCode: string,
  observedEvidenceRefs: readonly string[],
): DiagnosisRecheckResult {
  const refs = observedEvidenceRefs.filter((ref) => ref.trim());
  const result: DiagnosisRecheckResult = {
    outcome: refs.length === 0 ? "BLOCKED" : outcome,
    reasonCode: refs.length === 0 ? "observed_evidence_missing" : reasonCode,
    findingRefs: findingRefsOf(request),
    target: request.target,
    verificationRef: request.verificationRef,
    observedEvidenceRefs: refs.length === 0 ? ["obs:recheck-empty"] : refs,
  };
  try {
    assertDiagnosisRecheckResult(result);
    const binding = assertDiagnosisRecheckBinding(request, result);
    if (!binding.ok) {
      return {
        ...result,
        outcome: "BLOCKED",
        reasonCode: binding.code,
        observedEvidenceRefs: ["obs:recheck-binding"],
      };
    }
  } catch {
    return {
      ...result,
      outcome: "BLOCKED",
      reasonCode: "invalid_result",
      observedEvidenceRefs: ["obs:recheck-binding"],
    };
  }
  return result;
}

function findingRefsOf(request: DiagnosisRecheckRequest): readonly string[] {
  try {
    return canonicalizeFindingRefs(request.findingRefs);
  } catch {
    return request.findingRefs?.some((ref) => ref?.trim())
      ? request.findingRefs
      : ["finding:unbound"];
  }
}
