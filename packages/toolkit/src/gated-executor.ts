import { createHash } from "node:crypto";
import type { ApprovalChannel } from "./approval.js";
import { buildApprovalRequest } from "./approval.js";
import type {
  ExecutionReceipt,
  ToolAdapter,
  ToolEvidence,
  ToolRequest,
  ToolResult,
} from "./contracts.js";
import {
  evaluatePolicy,
  type PolicyEvaluation,
  type PolicyFacts,
  type ToolkitPolicy,
} from "./policy.js";
import { completeReceipt, failReceipt, startReceipt } from "./receipt.js";

export interface GatedExecuteInput<TInput = unknown, TOutput = unknown> {
  adapter: ToolAdapter<TInput, TOutput>;
  request: ToolRequest<TInput>;
  policy: ToolkitPolicy;
  /** Required when policy yields require-approval; otherwise optional. */
  approval?: ApprovalChannel;
  /**
   * Override or supplement facts inferred from the adapter.
   * `toolId` / `operation` default from the request; risk/sideEffects from the adapter.
   */
  facts?: Partial<PolicyFacts>;
  /** Called whenever a receipt is finalized (succeeded / failed / denied). */
  onReceipt?: (receipt: ExecutionReceipt) => void;
  /** Extra evidence to attach at start. */
  initialEvidence?: ToolEvidence[];
}

export interface GatedExecuteResult<TOutput = unknown> {
  evaluation: PolicyEvaluation;
  receipt: ExecutionReceipt;
  result: ToolResult<TOutput>;
}

function digest(value: unknown): string | undefined {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) {
      return undefined;
    }
    return `sha256:${createHash("sha256").update(json).digest("hex")}`;
  } catch {
    return undefined;
  }
}

function buildFacts<TInput, TOutput>(
  adapter: ToolAdapter<TInput, TOutput>,
  request: ToolRequest<TInput>,
  overrides?: Partial<PolicyFacts>,
): PolicyFacts {
  return {
    toolId: overrides?.toolId ?? request.toolId,
    operation: overrides?.operation ?? request.operation,
    risk: overrides?.risk ?? adapter.risk,
    sideEffects: overrides?.sideEffects ?? adapter.sideEffects,
    destructive: overrides?.destructive ?? false,
    credentialAccess: overrides?.credentialAccess ?? false,
    withinWorkspace: overrides?.withinWorkspace ?? false,
    scopedCredentialAccess: overrides?.scopedCredentialAccess ?? false,
  };
}

function deniedResult<TOutput = unknown>(
  message: string,
  code = "POLICY_DENIED",
): ToolResult<TOutput> {
  return {
    status: "denied",
    evidence: [],
    sideEffects: [],
    retryable: false,
    error: { code, message },
  };
}

function emitReceipt(
  receipt: ExecutionReceipt,
  onReceipt?: (receipt: ExecutionReceipt) => void,
): ExecutionReceipt {
  onReceipt?.(receipt);
  return receipt;
}

/**
 * Execute a tool adapter through Policy → Approval → Receipt.
 * Every terminal path (allow / allow-with-receipt / require-approval / deny)
 * writes a schema-aligned ExecutionReceipt via Phase 1 helpers.
 */
export async function executeGated<TInput = unknown, TOutput = unknown>(
  input: GatedExecuteInput<TInput, TOutput>,
): Promise<GatedExecuteResult<TOutput>> {
  const facts = buildFacts(input.adapter, input.request, input.facts);
  const evaluation = evaluatePolicy(input.policy, facts);

  let approvalId = input.request.context.approvalId;

  if (evaluation.decision === "deny") {
    const running = startReceipt({
      toolId: facts.toolId,
      operation: facts.operation,
      approvalId,
      idempotencyKey: input.request.context.idempotencyKey,
      inputDigest: digest(input.request.input),
      evidence: input.initialEvidence,
    });
    const receipt = emitReceipt(
      completeReceipt(running, {
        status: "denied",
        evidence: [
          {
            kind: "log",
            label: "policy-deny",
            metadata: { reason: evaluation.reason, rawDecision: evaluation.rawDecision },
          },
        ],
      }),
      input.onReceipt,
    );
    return {
      evaluation,
      receipt,
      result: deniedResult<TOutput>(`Policy denied: ${evaluation.reason}`),
    };
  }

  if (evaluation.decision === "require-approval") {
    if (!input.approval) {
      const running = startReceipt({
        toolId: facts.toolId,
        operation: facts.operation,
        idempotencyKey: input.request.context.idempotencyKey,
        inputDigest: digest(input.request.input),
        evidence: input.initialEvidence,
      });
      const receipt = emitReceipt(
        completeReceipt(running, {
          status: "denied",
          evidence: [
            {
              kind: "log",
              label: "approval-channel-missing",
              metadata: { reason: evaluation.reason },
            },
          ],
        }),
        input.onReceipt,
      );
      return {
        evaluation,
        receipt,
        result: deniedResult<TOutput>(
          `Policy requires approval but no approval channel is configured (${evaluation.reason})`,
          "APPROVAL_REQUIRED",
        ),
      };
    }

    const approvalRequest = buildApprovalRequest({
      evaluation,
      approvalId,
      ttlSeconds: input.policy.limits?.approvalTtlSeconds,
      context: {
        taskId: input.request.context.taskId,
        actorId: input.request.context.actorId,
        workspaceId: input.request.context.workspaceId,
      },
    });
    const approvalResult = await input.approval.requestApproval(approvalRequest);
    approvalId = approvalResult.approvalId;

    if (approvalResult.outcome !== "approved") {
      const running = startReceipt({
        toolId: facts.toolId,
        operation: facts.operation,
        approvalId,
        idempotencyKey: input.request.context.idempotencyKey,
        inputDigest: digest(input.request.input),
        evidence: input.initialEvidence,
      });
      const receipt = emitReceipt(
        completeReceipt(running, {
          status: "denied",
          evidence: [
            {
              kind: "log",
              label: "approval-denied",
              metadata: {
                outcome: approvalResult.outcome,
                reason: approvalResult.reason ?? evaluation.reason,
              },
            },
          ],
        }),
        input.onReceipt,
      );
      return {
        evaluation,
        receipt,
        result: deniedResult<TOutput>(
          `Approval ${approvalResult.outcome}: ${approvalResult.reason ?? evaluation.reason}`,
          approvalResult.outcome === "expired" ? "APPROVAL_EXPIRED" : "APPROVAL_DENIED",
        ),
      };
    }
  }

  const running = startReceipt({
    toolId: facts.toolId,
    operation: facts.operation,
    approvalId,
    idempotencyKey: input.request.context.idempotencyKey,
    inputDigest: digest(input.request.input),
    evidence: input.initialEvidence,
  });

  try {
    const result = await input.adapter.execute({
      ...input.request,
      context: { ...input.request.context, approvalId },
    });

    if (result.status === "failed") {
      const receipt = emitReceipt(
        failReceipt(running, {
          error: result.error ?? { code: "TOOL_FAILED", message: "tool execution failed" },
          sideEffects: result.sideEffects,
          evidence: result.evidence,
        }),
        input.onReceipt,
      );
      return { evaluation, receipt, result };
    }

    if (result.status === "denied" || result.status === "cancelled") {
      const receipt = emitReceipt(
        completeReceipt(running, {
          status: result.status,
          sideEffects: result.sideEffects,
          evidence: result.evidence,
          outputDigest: digest(result.output),
        }),
        input.onReceipt,
      );
      return { evaluation, receipt, result };
    }

    const receipt = emitReceipt(
      completeReceipt(running, {
        status: "succeeded",
        sideEffects: result.sideEffects,
        evidence: result.evidence,
        outputDigest: digest(result.output),
      }),
      input.onReceipt,
    );
    return { evaluation, receipt, result: { ...result, status: "succeeded" } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const receipt = emitReceipt(
      failReceipt(running, {
        error: { code: "TOOL_EXCEPTION", message },
      }),
      input.onReceipt,
    );
    return {
      evaluation,
      receipt,
      result: {
        status: "failed",
        evidence: [],
        sideEffects: [],
        retryable: true,
        error: { code: "TOOL_EXCEPTION", message },
      },
    };
  }
}
