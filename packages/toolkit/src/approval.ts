import { randomUUID } from "node:crypto";
import type { PolicyEvaluation, PolicyFacts } from "./policy.js";

export type ApprovalOutcome = "approved" | "denied" | "expired";

export interface ApprovalRequest {
  approvalId: string;
  toolId: string;
  operation: string;
  facts: PolicyFacts;
  evaluation: PolicyEvaluation;
  /** Human-readable summary for UI / channel prompts. */
  summary: string;
  /** Optional caller-supplied context (session, actor, etc.). */
  context?: Record<string, unknown>;
  /** When true, UI should require an explicit confirm (destructive / control). */
  requiresExplicitApproval: boolean;
  ttlSeconds?: number;
}

export interface ApprovalResult {
  outcome: ApprovalOutcome;
  approvalId: string;
  decidedAt: string;
  reason?: string;
}

/**
 * Pluggable approval channel. Wire existing Gateway/Discord/Telegram/TUI
 * approval UI here, or use {@link createMockApprovalChannel} in tests.
 */
export type ApprovalChannel = {
  requestApproval(request: ApprovalRequest): Promise<ApprovalResult>;
};

export type ApprovalHook = (request: ApprovalRequest) => ApprovalResult | Promise<ApprovalResult>;

/** Wrap a clear sync/async hook as an ApprovalChannel. */
export function createHookApprovalChannel(hook: ApprovalHook): ApprovalChannel {
  return {
    async requestApproval(request) {
      return hook(request);
    },
  };
}

export interface MockApprovalOptions {
  /** Default outcome when no per-call override is set. */
  outcome?: ApprovalOutcome;
  reason?: string;
  /** Optional predicate to vary outcomes in tests. */
  decide?: (request: ApprovalRequest) => ApprovalOutcome;
}

/** Deterministic approval channel for unit tests. */
export function createMockApprovalChannel(options: MockApprovalOptions = {}): ApprovalChannel {
  return createHookApprovalChannel((request) => {
    const outcome = options.decide?.(request) ?? options.outcome ?? "approved";
    return {
      outcome,
      approvalId: request.approvalId,
      decidedAt: new Date().toISOString(),
      reason: options.reason,
    };
  });
}

/** Build an approval request from a policy evaluation. */
export function buildApprovalRequest(params: {
  evaluation: PolicyEvaluation;
  context?: Record<string, unknown>;
  approvalId?: string;
  ttlSeconds?: number;
  summary?: string;
}): ApprovalRequest {
  const { evaluation } = params;
  const facts = evaluation.facts;
  return {
    approvalId: params.approvalId ?? randomUUID(),
    toolId: facts.toolId,
    operation: facts.operation,
    facts,
    evaluation,
    summary:
      params.summary ??
      `Approve ${facts.toolId}.${facts.operation} (risk=${facts.risk}, sideEffects=${facts.sideEffects})`,
    context: params.context,
    requiresExplicitApproval: evaluation.requiresExplicitApproval,
    ttlSeconds: params.ttlSeconds,
  };
}
