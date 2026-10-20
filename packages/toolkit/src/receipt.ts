import { randomUUID } from "node:crypto";
import type { ExecutionReceipt, ToolEvidence, ToolStatus } from "./contracts.js";
import { assertValidExecutionReceipt } from "./validate.js";

export interface StartReceiptInput {
  toolId: string;
  operation: string;
  receiptId?: string;
  startedAt?: string;
  approvalId?: string;
  idempotencyKey?: string;
  inputDigest?: string;
  sideEffects?: string[];
  evidence?: ToolEvidence[];
  /** When true (default), validate the running receipt against the schema. */
  validate?: boolean;
}

export interface CompleteReceiptInput {
  outputDigest?: string;
  completedAt?: string;
  sideEffects?: string[];
  evidence?: ToolEvidence[];
  status?: Extract<ToolStatus, "succeeded" | "denied" | "cancelled">;
  validate?: boolean;
}

export interface FailReceiptInput {
  error:
    | { code?: string; message: string; details?: Record<string, unknown> }
    | Record<string, unknown>;
  completedAt?: string;
  sideEffects?: string[];
  evidence?: ToolEvidence[];
  status?: Extract<ToolStatus, "failed" | "denied" | "cancelled">;
  validate?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function maybeValidate(receipt: ExecutionReceipt, validate: boolean | undefined): ExecutionReceipt {
  if (validate !== false) {
    assertValidExecutionReceipt(receipt);
  }
  return receipt;
}

/** Start an execution receipt in `running` status (aligns with receipt schema + contracts). */
export function startReceipt(input: StartReceiptInput): ExecutionReceipt {
  const receipt: ExecutionReceipt = {
    receiptId: input.receiptId ?? randomUUID(),
    toolId: input.toolId,
    operation: input.operation,
    status: "running",
    startedAt: input.startedAt ?? nowIso(),
    approvalId: input.approvalId,
    idempotencyKey: input.idempotencyKey,
    inputDigest: input.inputDigest,
    sideEffects: input.sideEffects ? [...input.sideEffects] : [],
    evidence: input.evidence ? [...input.evidence] : [],
  };
  return maybeValidate(receipt, input.validate);
}

/** Mark a receipt as successfully completed (or denied/cancelled if specified). */
export function completeReceipt(
  receipt: ExecutionReceipt,
  input: CompleteReceiptInput = {},
): ExecutionReceipt {
  if (receipt.status !== "running") {
    throw new Error(`Cannot complete receipt in status: ${receipt.status}`);
  }
  const next: ExecutionReceipt = {
    ...receipt,
    status: input.status ?? "succeeded",
    completedAt: input.completedAt ?? nowIso(),
    outputDigest: input.outputDigest ?? receipt.outputDigest,
    sideEffects: input.sideEffects
      ? [...receipt.sideEffects, ...input.sideEffects]
      : [...receipt.sideEffects],
    evidence: input.evidence ? [...receipt.evidence, ...input.evidence] : [...receipt.evidence],
  };
  return maybeValidate(next, input.validate);
}

/** Mark a receipt as failed (or denied/cancelled if specified). */
export function failReceipt(receipt: ExecutionReceipt, input: FailReceiptInput): ExecutionReceipt {
  if (receipt.status !== "running") {
    throw new Error(`Cannot fail receipt in status: ${receipt.status}`);
  }
  const error =
    "message" in input.error && typeof input.error.message === "string"
      ? {
          code: "code" in input.error ? input.error.code : undefined,
          message: input.error.message,
          ...("details" in input.error && input.error.details
            ? { details: input.error.details }
            : {}),
        }
      : { ...input.error };

  const next: ExecutionReceipt = {
    ...receipt,
    status: input.status ?? "failed",
    completedAt: input.completedAt ?? nowIso(),
    sideEffects: input.sideEffects
      ? [...receipt.sideEffects, ...input.sideEffects]
      : [...receipt.sideEffects],
    evidence: input.evidence ? [...receipt.evidence, ...input.evidence] : [...receipt.evidence],
    error,
  };
  return maybeValidate(next, input.validate);
}

/** Append evidence while the receipt is still running. */
export function appendEvidence(
  receipt: ExecutionReceipt,
  evidence: ToolEvidence | ToolEvidence[],
): ExecutionReceipt {
  if (receipt.status !== "running") {
    throw new Error(`Cannot append evidence in status: ${receipt.status}`);
  }
  const items = Array.isArray(evidence) ? evidence : [evidence];
  return {
    ...receipt,
    evidence: [...receipt.evidence, ...items],
  };
}
