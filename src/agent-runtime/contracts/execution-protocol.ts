import type { OperationIdentity } from "./operation.js";

export type ExecutionContext = OperationIdentity & {
  attemptId: string;
  policyVersion: string;
  ownerToken: string;
};

export type StepEvent =
  | { type: "step_started"; context: ExecutionContext; atMs: number }
  | {
      type: "tool_result";
      context: ExecutionContext;
      toolCallId: string;
      result: unknown;
      atMs: number;
    }
  | { type: "step_waiting"; context: ExecutionContext; condition: WaitCondition; atMs: number }
  | { type: "step_succeeded"; context: ExecutionContext; atMs: number }
  | {
      type: "step_failed";
      context: ExecutionContext;
      error: string;
      retryable: boolean;
      atMs: number;
    };

export type WaitCondition = {
  waitId: string;
  reason: "external_operation" | "timer" | "human_gate" | "worker_capacity";
  wakeOn: readonly string[];
  deadlineAtMs?: number;
};

export type StandardExecutionResult =
  | { kind: "completed"; context: ExecutionContext; evidence: readonly string[] }
  | { kind: "waiting"; context: ExecutionContext; condition: WaitCondition }
  | { kind: "failed"; context: ExecutionContext; error: string; retryable: boolean };
