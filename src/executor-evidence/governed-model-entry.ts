/**
 * Locator for the existing governed model entry. Does not add a parallel
 * model config and does not treat high_quality_reasoning as a configured role.
 * Isolated transport only — this module never opens a network connection.
 */
import type { TrustedScope } from "../task-outcome/types.js";
import {
  beginModelCall,
  finishModelCall,
  type ExecutorEvidenceContext,
  type ModelCallEvidence,
} from "./model-call-evidence.js";

export const GOVERNED_MODEL_ENTRY = {
  roleToModelRef: [
    "src/gateway/model-entitlement/employee-model-gate.ts#resolveEmployeeModelGate",
    "src/gateway/model-entitlement/resolve-effective-model-set.ts#resolveEffectiveModelSet",
  ],
  entitlementQuotaConcurrency: [
    "src/agents/model-fallback.ts#runWithModelFallback",
    "src/gateway/model-entitlement/employee-model-gate.ts#resolveEmployeeEntitlementAllowlist",
    "src/gateway/model-entitlement/seat-model-grant-store.ts#revokeModelGrant",
  ],
  cancelTimeoutFallbackUsage: "src/agents/model-fallback.ts#runFallbackCandidate",
  notConfiguredRoles: ["high_quality_reasoning"],
} as const;

export type IsolatedGovernedResult = {
  applied: false;
  taskResultWritten: false;
  fallback: "rule_v1" | null;
  hypothesis: { text: string; source: string } | null;
  evidence: ModelCallEvidence | null;
};

function ruleFallback(reason: string): IsolatedGovernedResult {
  return {
    applied: false,
    taskResultWritten: false,
    fallback: "rule_v1",
    hypothesis: { text: reason, source: "rule_v1" },
    evidence: null,
  };
}

/**
 * Diagnostic bypass. Returns a sourced hypothesis or rule_v1. Never writes a
 * TaskOutcome and never calls a real provider.
 */
export async function runIsolatedGovernedModelCall(params: {
  purpose: string;
  modelRef: string | null;
  resolutionSource: string;
  configVersion: string;
  agentId: string;
  scope: TrustedScope;
  taskId: string;
  runId: string;
  storeRoot?: string;
  admission: () => { allowed: boolean; configVersion: string };
  transport: (req: { callId: string; modelRef: string; signal: AbortSignal }) => Promise<{
    usage?: unknown;
    providerRequestId?: string | null;
    providerResponseId?: string | null;
  }>;
  timeoutMs?: number;
}): Promise<IsolatedGovernedResult> {
  if (
    params.resolutionSource === "high_quality_reasoning" ||
    params.purpose === "high_quality_reasoning" ||
    !params.modelRef
  ) {
    return ruleFallback("model ref is not configured for this purpose");
  }
  const before = params.admission();
  if (!before.allowed || before.configVersion !== params.configVersion) {
    return ruleFallback("admission withdrawn or config version mismatch before the call");
  }
  const context: ExecutorEvidenceContext = {
    agentId: params.agentId,
    scope: params.scope,
    taskId: params.taskId,
    runId: params.runId,
    storeRoot: params.storeRoot,
    provenance: "injected",
    collector: "isolated-governed-transport",
  };
  const slash = params.modelRef.indexOf("/");
  const provider = slash > 0 ? params.modelRef.slice(0, slash) : "unconfigured";
  const model = slash > 0 ? params.modelRef.slice(slash + 1) : params.modelRef;
  const call = beginModelCall({
    context,
    attemptId: `${params.runId}:governed:0:${params.modelRef}`,
    attemptKind: "turn",
    provider,
    model,
  });
  const abort = new AbortController();
  const timeoutMs = params.timeoutMs ?? 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        abort.abort();
        reject(Object.assign(new Error("isolated transport timeout"), { name: "TimeoutError" }));
      }, timeoutMs);
    }
  });
  try {
    const pending = params.transport({
      callId: call.callId,
      modelRef: params.modelRef,
      signal: abort.signal,
    });
    const raced = timeoutMs > 0 ? await Promise.race([pending, timeout]) : await pending;
    const during = params.admission();
    if (!during.allowed) {
      abort.abort();
      finishModelCall(call, {
        status: "cancelled",
        terminalCause: "cancelled",
        usageSource: "absent",
      });
      return {
        ...ruleFallback("admission withdrawn while the request was in flight"),
        evidence: call,
      };
    }
    if (during.configVersion !== params.configVersion) {
      abort.abort();
      finishModelCall(call, {
        status: "cancelled",
        terminalCause: "cancelled",
        usageSource: "absent",
      });
      return {
        ...ruleFallback("config version changed while the request was in flight"),
        evidence: call,
      };
    }
    finishModelCall(call, {
      status: "completed",
      usage: raced.usage,
      usageSource: "isolated_transport",
      usageAggregation: "per_call",
      providerRequestId: raced.providerRequestId ?? null,
      providerResponseId: raced.providerResponseId ?? null,
    });
    return {
      applied: false,
      taskResultWritten: false,
      fallback: null,
      hypothesis: {
        text: `candidate ${params.modelRef} for ${params.purpose}`,
        source: params.resolutionSource,
      },
      evidence: call,
    };
  } catch (err) {
    const timeoutHit = err instanceof Error && err.name === "TimeoutError";
    finishModelCall(call, {
      status: "failed",
      terminalCause: timeoutHit ? "timeout" : "error",
      usageSource: "absent",
    });
    return {
      ...ruleFallback(timeoutHit ? "isolated transport timed out" : "isolated transport failed"),
      evidence: call,
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
