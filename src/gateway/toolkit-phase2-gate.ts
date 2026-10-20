import {
  createHookApprovalChannel,
  createMockApprovalChannel,
  executeGated,
  inferPolicyFactsFromGatewayTool,
  loadExamplePolicy,
  type ApprovalChannel,
  type ExecutionReceipt,
  type PolicyEvaluation,
  type ToolAdapter,
  type ToolkitPolicy,
} from "@openbot/toolkit";

export type ToolkitPhase2GateMode = "off" | "enforce";

let cachedPolicy: ToolkitPolicy | undefined;

export function resolveToolkitPhase2GateMode(
  env: NodeJS.ProcessEnv = process.env,
): ToolkitPhase2GateMode {
  const raw = (env.OPENBOT_TOOLKIT_PHASE2_GATE ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "enforce" || raw === "on") {
    return "enforce";
  }
  return "off";
}

export function getToolkitPhase2Policy(): ToolkitPolicy {
  if (!cachedPolicy) {
    cachedPolicy = loadExamplePolicy();
  }
  return cachedPolicy;
}

/** Test helper: replace cached policy. */
export function setToolkitPhase2PolicyForTests(policy: ToolkitPolicy | undefined): void {
  cachedPolicy = policy;
}

export type GatewayToolkitApprovalResolution =
  | { kind: "channel"; channel: ApprovalChannel }
  | { kind: "preapproved"; approvalId: string }
  | { kind: "none" };

/**
 * Resolve an approval channel for HTTP `/tools/invoke`.
 * - Prefer an injected hook/channel (tests / future UI wiring)
 * - Else accept a pre-issued approval id header/body as already-approved
 * - Else none (require-approval will deny with APPROVAL_REQUIRED)
 */
export function resolveGatewayToolkitApproval(params: {
  approval?: ApprovalChannel;
  approvalHook?: ApprovalChannel["requestApproval"];
  preapprovedApprovalId?: string;
}): GatewayToolkitApprovalResolution {
  if (params.approval) {
    return { kind: "channel", channel: params.approval };
  }
  if (params.approvalHook) {
    return { kind: "channel", channel: createHookApprovalChannel(params.approvalHook) };
  }
  if (params.preapprovedApprovalId?.trim()) {
    const approvalId = params.preapprovedApprovalId.trim();
    return {
      kind: "preapproved",
      approvalId,
      // channel that auto-approves the matching id
    };
  }
  return { kind: "none" };
}

function preapprovedChannel(_approvalId: string): ApprovalChannel {
  return createMockApprovalChannel({
    outcome: "approved",
    reason: "preapproved-approval-id",
  });
}

export interface GatewayToolkitGateInput {
  toolName: string;
  action?: string;
  args: Record<string, unknown>;
  sessionKey: string;
  /** Opaque tool.execute wrapper — existing gateway adapters stay unchanged. */
  execute: () => Promise<unknown>;
  mode?: ToolkitPhase2GateMode;
  policy?: ToolkitPolicy;
  approval?: ApprovalChannel;
  approvalHook?: ApprovalChannel["requestApproval"];
  preapprovedApprovalId?: string;
  onReceipt?: (receipt: ExecutionReceipt) => void;
}

export type GatewayToolkitGateResult =
  | {
      gated: false;
      result: unknown;
    }
  | {
      gated: true;
      allowed: true;
      result: unknown;
      receipt: ExecutionReceipt;
      evaluation: PolicyEvaluation;
    }
  | {
      gated: true;
      allowed: false;
      statusCode: number;
      error: { type: string; message: string; code?: string };
      receipt: ExecutionReceipt;
      evaluation: PolicyEvaluation;
    };

/**
 * Thin Policy → Approval → Receipt gate around one Gateway tool invocation.
 * When mode is `off` (default / NO LIVE), returns `{ gated: false }` and the
 * caller should run the legacy execute path unchanged.
 */
export async function runGatewayToolkitPhase2Gate(
  input: GatewayToolkitGateInput,
): Promise<GatewayToolkitGateResult> {
  const mode = input.mode ?? resolveToolkitPhase2GateMode();
  if (mode === "off") {
    return { gated: false, result: undefined };
  }

  const policy = input.policy ?? getToolkitPhase2Policy();
  const facts = inferPolicyFactsFromGatewayTool({
    toolName: input.toolName,
    action: input.action,
  });

  const approvalResolution = resolveGatewayToolkitApproval({
    approval: input.approval,
    approvalHook: input.approvalHook,
    preapprovedApprovalId: input.preapprovedApprovalId,
  });

  let approval: ApprovalChannel | undefined;
  let approvalId: string | undefined;
  if (approvalResolution.kind === "channel") {
    approval = approvalResolution.channel;
  } else if (approvalResolution.kind === "preapproved") {
    approvalId = approvalResolution.approvalId;
    approval = preapprovedChannel(approvalId);
  }

  const adapter: ToolAdapter = {
    id: facts.toolId,
    operations: [facts.operation],
    risk: facts.risk,
    sideEffects: facts.sideEffects,
    execute: async () => {
      const output = await input.execute();
      return {
        status: "succeeded" as const,
        output,
        evidence: [{ kind: "log" as const, label: "gateway-tools-invoke" }],
        sideEffects: facts.sideEffects ? [`gateway:${input.toolName}`] : [],
      };
    },
  };

  const gated = await executeGated({
    adapter,
    request: {
      toolId: facts.toolId,
      operation: facts.operation,
      input: input.args,
      context: {
        taskId: `gateway:${input.sessionKey}`,
        actorId: "gateway-http",
        approvalId,
        idempotencyKey: `http-${input.toolName}-${Date.now()}`,
      },
    },
    policy,
    approval,
    facts,
    onReceipt: input.onReceipt,
  });

  if (gated.result.status === "denied") {
    const code = gated.result.error?.code;
    const statusCode = code === "APPROVAL_REQUIRED" || code === "APPROVAL_DENIED" ? 403 : 403;
    return {
      gated: true,
      allowed: false,
      statusCode,
      error: {
        type: "toolkit_policy",
        message: gated.result.error?.message ?? "toolkit policy denied",
        code,
      },
      receipt: gated.receipt,
      evaluation: gated.evaluation,
    };
  }

  if (gated.result.status === "failed") {
    return {
      gated: true,
      allowed: false,
      statusCode: 500,
      error: {
        type: "tool_error",
        message: gated.result.error?.message ?? "tool execution failed",
        code: gated.result.error?.code,
      },
      receipt: gated.receipt,
      evaluation: gated.evaluation,
    };
  }

  return {
    gated: true,
    allowed: true,
    result: gated.result.output,
    receipt: gated.receipt,
    evaluation: gated.evaluation,
  };
}
