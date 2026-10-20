import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("execution-chain");

export const EXECUTION_CHAIN_PROVENANCE_EVENT = "execution_chain_provenance" as const;

export type GatewayFallbackProvenance = {
  kind: "gateway_fallback";
  initial_path: "gateway" | "embedded";
  initial_failure: {
    class: string;
    code: string | null;
    message: string;
  } | null;
  fallback: {
    attempted: boolean;
    owner: "agent-cli";
    target: "embedded-agent" | "none";
    retry_count: number;
  };
  context_preserved: {
    agent_id: string | null;
    session_id: string | null;
    session_key: string | null;
  };
  terminal_path: "gateway" | "embedded";
  tenant_fail_closed_unchanged: true;
};

export type ToolSelectionProvenance = {
  kind: "tool_selection";
  decision_owner: "model";
  decision_source: "model_tool_call";
  decision: {
    capability: string;
    reason: "unknown";
  };
  candidate_capabilities: string[] | "unknown";
  policy_filtered_capabilities: string[] | "unknown";
  selected_capability: string;
  policy_result: "allowed" | "denied";
  execution_allowed: boolean;
  execution_started: boolean;
  session_key?: string | null;
  session_id?: string | null;
  run_id?: string | null;
  tool_call_id?: string | null;
};

/**
 * Execution-layer vs independently verified side effects.
 *
 * - `applied`: the tool/wrapper reported success. This is NOT an independently
 *   observed file/process/remote mutation.
 * - `verified`: a separate verifier or receipt confirmed the external effect.
 *   Current production writers never emit this.
 * - Missing field on legacy records is read as `unknown`.
 */
export type MutationEffectObservation =
  | "not_attempted"
  | "blocked"
  | "applied"
  | "verified"
  | "unknown";

export type MutationAttemptProvenance = {
  kind: "mutation_attempt";
  tool: string;
  tool_call_id: string | null;
  session_id: string | null;
  session_key: string | null;
  run_id: string | null;
  resource: string | null;
  policy: {
    owner: "workspace-root-guard";
    decision: "allowed" | "denied";
    reason: "sandbox_boundary" | "passed_existing_guard" | null;
  };
  authorization: {
    decision: "unknown";
  };
  approval: {
    decision: "not_observed";
  };
  result: "denied" | "success" | "error";
  /**
   * Execution-layer effect report. Missing on legacy records is `unknown`.
   * `applied` means the tool returned success; it is not an independently
   * observed side effect. `verified` requires a separate verifier/receipt.
   * `result` is not a substitute for this field.
   */
  effectObserved?: MutationEffectObservation;
};

export type ExecPolicyProvenance = {
  kind: "exec_policy";
  capability: "exec";
  resource: {
    scope: "host_process_filesystem";
    target: string;
  };
  policy: {
    owner: "tools.exec";
    decision: "allowed" | "denied";
    reason: string;
  };
  authorization: {
    decision: "unknown";
  };
  approval: {
    decision: "observed" | "not_observed";
  };
  result: "success" | "denied" | "error";
  session_id: string | null;
  session_key: string | null;
  run_id: string | null;
  tool_call_id: string | null;
  /**
   * Execution-layer effect report. Missing on legacy records is `unknown`.
   * `applied` means the exec wrapper returned success; it is not an
   * independently observed host side effect. `verified` requires a separate
   * verifier/receipt. `result` is not a substitute for this field.
   */
  effectObserved?: MutationEffectObservation;
};

export type CollaborationReturnProvenance = {
  kind: "collaboration_return";
  parent_owner: string | null;
  dispatch: {
    mechanism: "sessions_spawn";
    runtime: string | null;
    mode: string | null;
  };
  child: {
    session_key: string | null;
    run_id: string | null;
  };
  execution: {
    status: string;
    failure_class: string | null;
  };
  result: {
    available: boolean;
  };
  aggregation: {
    source: "parent_session" | "child_session" | "pending_child";
  };
  return_owner: string | null;
  completion_claim: {
    delegated_task_completed: false;
  };
};

export type ExecutionChainProvenance =
  | GatewayFallbackProvenance
  | ToolSelectionProvenance
  | MutationAttemptProvenance
  | ExecPolicyProvenance
  | CollaborationReturnProvenance;

export function classifyGatewayFailure(err: unknown): {
  class: string;
  code: string | null;
  message: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  const explicitCode =
    typeof err === "object" && err && "code" in err && typeof err.code === "string"
      ? err.code
      : (/\bcode=([a-z_]+)/.exec(message)?.[1] ?? null);
  if (
    explicitCode === "unresolved_tenant" ||
    message.includes("unresolved_tenant") ||
    name === "TenantContextError"
  ) {
    return {
      class: "tenant_context_unresolved",
      code: explicitCode ?? "unresolved_tenant",
      message,
    };
  }
  return {
    class: "gateway_unavailable",
    code: explicitCode,
    message,
  };
}

export function classifyCollaborationFailure(error: unknown): string | null {
  if (error == null || error === "") {
    return null;
  }
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (message.includes("unresolved_tenant") || message.includes("TenantContextError")) {
    return "tenant_context_unresolved";
  }
  return "spawn_error";
}

const RECENT_PROVENANCE_LIMIT = 2000;
const RECENT_PROVENANCE_TTL_MS = 60 * 60 * 1000;
const recentProvenance: Array<{ at: number; record: ExecutionChainProvenance }> = [];

function retainRecentProvenance(now = Date.now()): void {
  while (recentProvenance.length > RECENT_PROVENANCE_LIMIT) {
    recentProvenance.shift();
  }
  while (
    recentProvenance.length > 0 &&
    now - (recentProvenance[0]?.at ?? 0) > RECENT_PROVENANCE_TTL_MS
  ) {
    recentProvenance.shift();
  }
}

function provenanceRunId(record: ExecutionChainProvenance): string | undefined {
  if ("run_id" in record && typeof record.run_id === "string" && record.run_id.trim()) {
    return record.run_id;
  }
  return undefined;
}

export function emitExecutionChainProvenance(record: ExecutionChainProvenance): void {
  log.info(EXECUTION_CHAIN_PROVENANCE_EVENT, {
    event: EXECUTION_CHAIN_PROVENANCE_EVENT,
    ...record,
  });
  recentProvenance.push({ at: Date.now(), record });
  retainRecentProvenance();
}

export function listRecentExecutionChainProvenance(filter: {
  startedAt: number;
  endedAt: number;
  runId?: string;
}): ExecutionChainProvenance[] {
  retainRecentProvenance();
  return recentProvenance
    .filter((row) => row.at >= filter.startedAt && row.at <= filter.endedAt)
    .filter((row) => {
      if (!filter.runId) {
        return true;
      }
      return provenanceRunId(row.record) === filter.runId;
    })
    .map((row) => row.record);
}

export function resetExecutionChainProvenanceForTest(): void {
  recentProvenance.length = 0;
}

export type TurnSecuritySensors = {
  securityAttempt?: boolean;
  securityControlDenied?: boolean;
  securityViolation?: boolean;
  authorizationBypass?: boolean;
  /**
   * Execution-layer report that a denied operation still claimed `applied`.
   * This is not a confirmed violation. Critical guardrails must ignore it.
   */
  suspectedAuthorizationBypass?: boolean;
};

/**
 * Independent confirmation of an external side effect.
 * Generic production verification is not implemented. The fail-closed
 * default never returns `verified` and never upgrades `applied`.
 */
export type ExternalEffectVerifyRequest = {
  effectObserved: MutationEffectObservation;
  receiptRef?: string;
};

export type ExternalEffectVerifier = {
  verify(input: ExternalEffectVerifyRequest): MutationEffectObservation;
};

export function createFailClosedExternalEffectVerifier(): ExternalEffectVerifier {
  return {
    verify(input) {
      // Not implemented: do not confirm external effects, even if a caller
      // already stamped `verified` or supplied a receipt ref.
      if (input.effectObserved === "verified") {
        return "unknown";
      }
      return input.effectObserved;
    },
  };
}

function isInspectedSecurityProvenance(
  record: ExecutionChainProvenance,
): record is MutationAttemptProvenance | ExecPolicyProvenance {
  return record.kind === "mutation_attempt" || record.kind === "exec_policy";
}

export function mutationEffectObserved(
  record: MutationAttemptProvenance | ExecPolicyProvenance,
): MutationEffectObservation {
  return record.effectObserved ?? "unknown";
}

function isExecutionReportedEffect(effect: MutationEffectObservation): boolean {
  return effect === "applied" || effect === "verified";
}

/**
 * Classify exec/sandbox provenance from explicit effect reports.
 * `result === "success"` never upgrades a deny into a bypass by itself.
 * `applied` is an execution-layer success report, not independent verification.
 * `verified` is reserved for an independent verifier/receipt.
 * Critical guardrails may consume only confirmed `securityViolation`.
 */
export function turnSecurityFromProvenance(
  records: readonly ExecutionChainProvenance[],
): TurnSecuritySensors {
  const inspected = records.filter(isInspectedSecurityProvenance);
  if (inspected.length === 0) {
    return {};
  }
  const denied = inspected.filter((record) => record.policy.decision === "denied");
  const deniedApplied = denied.filter((record) => mutationEffectObserved(record) === "applied");
  const deniedVerified = denied.filter((record) => mutationEffectObserved(record) === "verified");
  const blocked = denied.filter((record) => {
    const effect = mutationEffectObserved(record);
    return effect === "blocked" || effect === "not_attempted";
  });
  const deniedUnknown = denied.filter((record) => mutationEffectObserved(record) === "unknown");
  const allowedReported = inspected.filter(
    (record) =>
      record.policy.decision === "allowed" &&
      isExecutionReportedEffect(mutationEffectObserved(record)),
  );
  const suspectedBypass = deniedApplied.length > 0 || deniedVerified.length > 0;
  const confirmedBypass = deniedVerified.length > 0;
  const inspectedClean =
    deniedUnknown.length === 0 &&
    deniedApplied.length === 0 &&
    !confirmedBypass &&
    (blocked.length > 0 || allowedReported.length > 0);
  return {
    ...(denied.length > 0 ? { securityAttempt: true, securityControlDenied: true } : {}),
    ...(suspectedBypass ? { suspectedAuthorizationBypass: true } : {}),
    ...(confirmedBypass
      ? { securityViolation: true, authorizationBypass: true }
      : inspectedClean
        ? { securityViolation: false }
        : {}),
  };
}

export function securityViolationFromProvenance(
  records: readonly ExecutionChainProvenance[],
): boolean | undefined {
  return turnSecurityFromProvenance(records).securityViolation;
}

export function appendProvenance(
  existing: unknown,
  record: ExecutionChainProvenance,
): ExecutionChainProvenance[] {
  if (Array.isArray(existing)) {
    return [...existing, record];
  }
  if (existing && typeof existing === "object") {
    return [existing as ExecutionChainProvenance, record];
  }
  return [record];
}

export function attachExecutionChainProvenance<T>(value: T, record: ExecutionChainProvenance): T {
  emitExecutionChainProvenance(record);
  if (!value || typeof value !== "object") {
    return { meta: { executionChainProvenance: [record] } } as T;
  }
  const obj = value as Record<string, unknown>;
  if (obj.result && typeof obj.result === "object") {
    const result = obj.result as Record<string, unknown>;
    const meta =
      result.meta && typeof result.meta === "object"
        ? (result.meta as Record<string, unknown>)
        : {};
    return {
      ...obj,
      result: {
        ...result,
        meta: {
          ...meta,
          executionChainProvenance: appendProvenance(meta.executionChainProvenance, record),
        },
      },
    } as T;
  }
  const meta =
    obj.meta && typeof obj.meta === "object" ? (obj.meta as Record<string, unknown>) : {};
  return {
    ...obj,
    meta: {
      ...meta,
      executionChainProvenance: appendProvenance(meta.executionChainProvenance, record),
    },
  } as T;
}

export function decorateToolResultProvenance<T>(result: T, record: ExecutionChainProvenance): T {
  if (!result || typeof result !== "object") {
    return result;
  }
  const obj = result as Record<string, unknown>;
  const details =
    obj.details && typeof obj.details === "object" ? (obj.details as Record<string, unknown>) : {};
  return {
    ...obj,
    details: {
      ...details,
      executionChainProvenance: appendProvenance(details.executionChainProvenance, record),
    },
  } as T;
}

export function attachProvenanceToThrownError(
  err: unknown,
  record: ExecutionChainProvenance,
): never {
  emitExecutionChainProvenance(record);
  if (err instanceof Error) {
    Object.assign(err, { execution_chain: record });
  }
  throw err;
}

export function attachCollaborationReturnProvenance<T extends Record<string, unknown>>(
  result: T,
  params: {
    parentOwner: string | null;
    runtime: string | null;
    mode: string | null;
  },
): T & { execution_chain: CollaborationReturnProvenance } {
  const status = typeof result.status === "string" ? result.status : "unknown";
  const failed = status === "error";
  const record: CollaborationReturnProvenance = {
    kind: "collaboration_return",
    parent_owner: params.parentOwner,
    dispatch: {
      mechanism: "sessions_spawn",
      runtime: params.runtime,
      mode: params.mode,
    },
    child: {
      session_key: typeof result.childSessionKey === "string" ? result.childSessionKey : null,
      run_id: typeof result.runId === "string" ? result.runId : null,
    },
    execution: {
      status: failed ? "failed" : status,
      failure_class: failed ? classifyCollaborationFailure(result.error) : null,
    },
    result: {
      available: false,
    },
    aggregation: {
      source: failed ? "parent_session" : "pending_child",
    },
    return_owner: params.parentOwner,
    completion_claim: {
      delegated_task_completed: false,
    },
  };
  emitExecutionChainProvenance(record);
  return {
    ...result,
    execution_chain: record,
  };
}
