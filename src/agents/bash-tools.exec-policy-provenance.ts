import {
  attachProvenanceToThrownError,
  decorateToolResultProvenance,
  emitExecutionChainProvenance,
  type ExecPolicyProvenance,
  type MutationEffectObservation,
} from "../infra/execution-chain-provenance.js";

export type ExecPolicyDraft = {
  session_id: string | null;
  session_key: string | null;
  run_id: string | null;
  tool_call_id: string | null;
  command: string;
  host: string;
  security: string;
  ask: string;
  /**
   * Set only by an existing tools.exec SoT (processGatewayAllowlist allow-through,
   * elevated bypass after that owner is skipped, or node/sandbox owner after it
   * actually allowed execution). Wrapper inference is not a SoT.
   */
  policyDecision?: "allowed";
};

export function isExecPolicyDenyMessage(message: string): boolean {
  return /^exec denied:/i.test(message);
}

export function isExecApprovalPendingResult(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const status = (value as { details?: { status?: unknown } }).details?.status;
  return status === "approval-pending" || status === "approval-unavailable";
}

export function markExecPolicyAllowed(draft: ExecPolicyDraft): void {
  draft.policyDecision = "allowed";
}

function effectObservedFromExecPolicy(
  decision: ExecPolicyProvenance["policy"]["decision"],
  result: ExecPolicyProvenance["result"],
): MutationEffectObservation {
  if (decision === "denied") {
    return "blocked";
  }
  // Tool/wrapper reported success only. Never `verified` — that needs an
  // independent receipt. This path cannot observe host-process side effects.
  if (result === "success") {
    return "applied";
  }
  return "unknown";
}

export function createExecPolicyProvenance(
  draft: ExecPolicyDraft,
  params: {
    decision: ExecPolicyProvenance["policy"]["decision"];
    result: ExecPolicyProvenance["result"];
    reason?: string;
  },
): ExecPolicyProvenance {
  const reason =
    params.reason ??
    (params.decision === "denied"
      ? `exec denied: host=${draft.host} security=${draft.security}`
      : `host=${draft.host} security=${draft.security} ask=${draft.ask}`);
  return {
    kind: "exec_policy",
    capability: "exec",
    resource: {
      scope: "host_process_filesystem",
      target: draft.command,
    },
    policy: {
      owner: "tools.exec",
      decision: params.decision,
      reason,
    },
    authorization: { decision: "unknown" },
    // Never infer pass/fail from requiresExecApproval=false. Only mark observed
    // when a real approval decision event exists; this path does not invent one.
    approval: { decision: "not_observed" },
    result: params.result,
    effectObserved: effectObservedFromExecPolicy(params.decision, params.result),
    session_id: draft.session_id,
    session_key: draft.session_key,
    run_id: draft.run_id,
    tool_call_id: draft.tool_call_id,
  };
}

export function readExecPolicyProvenance(value: unknown): ExecPolicyProvenance | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const withChain = value as { execution_chain?: unknown };
  if (isExecPolicyRecord(withChain.execution_chain)) {
    return withChain.execution_chain;
  }
  const details = (value as { details?: { executionChainProvenance?: unknown } }).details;
  const records = details?.executionChainProvenance;
  if (Array.isArray(records)) {
    for (const record of records) {
      if (isExecPolicyRecord(record)) {
        return record;
      }
    }
  }
  if (isExecPolicyRecord(records)) {
    return records;
  }
  return null;
}

function isExecPolicyRecord(value: unknown): value is ExecPolicyProvenance {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "exec_policy" &&
    (value as { policy?: { owner?: unknown } }).policy?.owner === "tools.exec",
  );
}

export async function runWithExecPolicyProvenance<T>(
  draft: ExecPolicyDraft,
  run: (draft: ExecPolicyDraft) => Promise<T>,
): Promise<T> {
  try {
    const result = await run(draft);
    // Reuse existing approval/pending tool details. Do not invent a second
    // pending decision type, and never stamp allowed+success on this path.
    if (isExecApprovalPendingResult(result)) {
      return result;
    }
    if (draft.policyDecision !== "allowed") {
      return result;
    }
    const record = createExecPolicyProvenance(draft, {
      decision: "allowed",
      result: "success",
    });
    emitExecutionChainProvenance(record);
    return decorateToolResultProvenance(result, record);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isExecPolicyDenyMessage(message)) {
      attachProvenanceToThrownError(
        err,
        createExecPolicyProvenance(draft, {
          decision: "denied",
          result: "denied",
          reason: message,
        }),
      );
    }
    if (draft.policyDecision === "allowed") {
      attachProvenanceToThrownError(
        err,
        createExecPolicyProvenance(draft, {
          decision: "allowed",
          result: "error",
          reason: `host=${draft.host} security=${draft.security} ask=${draft.ask}; execution_error`,
        }),
      );
    }
    throw err;
  }
}
