import crypto from "node:crypto";
import {
  maxAsk,
  minSecurity,
  resolveExecApprovals,
  type ExecAsk,
  type ExecSecurity,
} from "../infra/exec-approvals.js";
import { resolveRegisteredExecApprovalDecision } from "./bash-tools.exec-approval-request.js";
import { DEFAULT_APPROVAL_TIMEOUT_MS } from "./bash-tools.exec-runtime.js";

type ResolvedExecApprovals = ReturnType<typeof resolveExecApprovals>;

export type ExecHostApprovalContext = {
  approvals: ResolvedExecApprovals;
  hostSecurity: ExecSecurity;
  hostAsk: ExecAsk;
  askFallback: ResolvedExecApprovals["agent"]["askFallback"];
};

export type ExecApprovalPendingState = {
  warningText: string;
  expiresAtMs: number;
  preResolvedDecision: string | null | undefined;
};

export type ExecApprovalRequestState = ExecApprovalPendingState & {
  noticeSeconds: number;
};

export function createExecApprovalPendingState(params: {
  warnings: string[];
  timeoutMs: number;
}): ExecApprovalPendingState {
  return {
    warningText: params.warnings.length ? `${params.warnings.join("\n")}\n\n` : "",
    expiresAtMs: Date.now() + params.timeoutMs,
    preResolvedDecision: undefined,
  };
}

export function createExecApprovalRequestState(params: {
  warnings: string[];
  timeoutMs: number;
  approvalRunningNoticeMs: number;
}): ExecApprovalRequestState {
  const pendingState = createExecApprovalPendingState({
    warnings: params.warnings,
    timeoutMs: params.timeoutMs,
  });
  return {
    ...pendingState,
    noticeSeconds: Math.max(1, Math.round(params.approvalRunningNoticeMs / 1000)),
  };
}

export function createExecApprovalRequestContext(params: {
  warnings: string[];
  timeoutMs: number;
  approvalRunningNoticeMs: number;
  createApprovalSlug: (approvalId: string) => string;
}): ExecApprovalRequestState & {
  approvalId: string;
  approvalSlug: string;
  contextKey: string;
} {
  const approvalId = crypto.randomUUID();
  const pendingState = createExecApprovalRequestState({
    warnings: params.warnings,
    timeoutMs: params.timeoutMs,
    approvalRunningNoticeMs: params.approvalRunningNoticeMs,
  });
  return {
    ...pendingState,
    approvalId,
    approvalSlug: params.createApprovalSlug(approvalId),
    contextKey: `exec:${approvalId}`,
  };
}

export function createDefaultExecApprovalRequestContext(params: {
  warnings: string[];
  approvalRunningNoticeMs: number;
  createApprovalSlug: (approvalId: string) => string;
}) {
  return createExecApprovalRequestContext({
    warnings: params.warnings,
    timeoutMs: DEFAULT_APPROVAL_TIMEOUT_MS,
    approvalRunningNoticeMs: params.approvalRunningNoticeMs,
    createApprovalSlug: params.createApprovalSlug,
  });
}

export function resolveBaseExecApprovalDecision(params: {
  decision: string | null;
  askFallback: ResolvedExecApprovals["agent"]["askFallback"];
  obfuscationDetected: boolean;
}): {
  approvedByAsk: boolean;
  deniedReason: string | null;
  timedOut: boolean;
} {
  if (params.decision === "deny") {
    return { approvedByAsk: false, deniedReason: "user-denied", timedOut: false };
  }
  if (!params.decision) {
    if (params.obfuscationDetected) {
      return {
        approvedByAsk: false,
        deniedReason: "approval-timeout (obfuscation-detected)",
        timedOut: true,
      };
    }
    if (params.askFallback === "full") {
      return { approvedByAsk: true, deniedReason: null, timedOut: true };
    }
    if (params.askFallback === "deny") {
      return { approvedByAsk: false, deniedReason: "approval-timeout", timedOut: true };
    }
    return { approvedByAsk: false, deniedReason: null, timedOut: true };
  }
  return { approvedByAsk: false, deniedReason: null, timedOut: false };
}

export type RuntimeAskSource = "operator" | "seat" | "session";

/**
 * 审批文件 ask=off 压过更严运行时 ask，只留给操作者 break-glass。
 * 席位和会话必须走 maxAsk，不能触发这条旁路。
 */
export function resolveHostAsk(params: {
  runtimeAsk: ExecAsk;
  approvalsAsk: ExecAsk;
  runtimeAskSource?: RuntimeAskSource;
}): ExecAsk {
  const source = params.runtimeAskSource ?? "operator";
  if (source === "operator" && params.approvalsAsk === "off") {
    return "off";
  }
  return maxAsk(params.runtimeAsk, params.approvalsAsk);
}

export function resolveRuntimeAskSource(params: {
  seatAsk?: ExecAsk;
  sessionAsk?: ExecAsk;
}): RuntimeAskSource {
  if (params.sessionAsk) {
    return "session";
  }
  if (params.seatAsk) {
    return "seat";
  }
  return "operator";
}

/** elevated → security=full, ask=off。席位和会话 /exec 传 source 时永远打不开。 */
export function operatorElevatedFullBreakGlass(params: {
  source: RuntimeAskSource;
  elevatedRequested: boolean;
  elevatedMode: string;
}): boolean {
  return params.source === "operator" && params.elevatedRequested && params.elevatedMode === "full";
}

export function resolveExecHostApprovalContext(params: {
  agentId?: string;
  security: ExecSecurity;
  ask: ExecAsk;
  host: "gateway" | "node";
  runtimeAskSource?: RuntimeAskSource;
}): ExecHostApprovalContext {
  const approvals = resolveExecApprovals(params.agentId, {
    security: params.security,
    ask: params.ask,
  });
  const hostSecurity = minSecurity(params.security, approvals.agent.security);
  const hostAsk = resolveHostAsk({
    runtimeAsk: params.ask,
    approvalsAsk: approvals.agent.ask,
    runtimeAskSource: params.runtimeAskSource,
  });
  const askFallback = approvals.agent.askFallback;
  if (hostSecurity === "deny") {
    throw new Error(`exec denied: host=${params.host} security=deny`);
  }
  return { approvals, hostSecurity, hostAsk, askFallback };
}

export async function resolveApprovalDecisionOrUndefined(params: {
  approvalId: string;
  preResolvedDecision: string | null | undefined;
  onFailure: () => void;
}): Promise<string | null | undefined> {
  try {
    return await resolveRegisteredExecApprovalDecision({
      approvalId: params.approvalId,
      preResolvedDecision: params.preResolvedDecision,
    });
  } catch {
    params.onFailure();
    return undefined;
  }
}
