export type ToolRisk = "low" | "medium" | "high" | "control";
export type ToolStatus = "running" | "succeeded" | "failed" | "denied" | "cancelled";

export interface ToolContext {
  taskId: string;
  actorId: string;
  workspaceId?: string;
  approvalId?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface ToolRequest<TInput = unknown> {
  toolId: string;
  operation: string;
  input: TInput;
  context: ToolContext;
}

export interface ToolEvidence {
  kind: "log" | "diff" | "screenshot" | "citation" | "artifact" | "external-state";
  label: string;
  uri?: string;
  digest?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolResult<TOutput = unknown> {
  status: ToolStatus;
  output?: TOutput;
  evidence: ToolEvidence[];
  sideEffects: string[];
  retryable?: boolean;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

export interface ToolAdapter<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly operations: readonly string[];
  readonly risk: ToolRisk;
  readonly sideEffects: boolean;
  execute(request: ToolRequest<TInput>): Promise<ToolResult<TOutput>>;
}

export interface ExecutionReceipt {
  receiptId: string;
  toolId: string;
  operation: string;
  status: ToolStatus;
  startedAt: string;
  completedAt?: string;
  approvalId?: string;
  idempotencyKey?: string;
  inputDigest?: string;
  outputDigest?: string;
  sideEffects: string[];
  evidence: ToolEvidence[];
  error?: Record<string, unknown>;
}
