/**
 * 席位策略演练（闸门 6）。
 *
 * 定义：只走 Fabric `check`（policy check）与/或 `dryRunDiff` 的只裁决路径。
 * - 不执行有副作用的工具
 * - 不写审批放行、不改允许列表
 * - 演练结果不能当作下次真执行的预授权
 * - 不新增 ExecAsk 第四值；不把 ask 改成 off
 * - 仍用同一套天花板计算「若真执行是否要审批」，但不弹审批
 */
import type { FabricExecutionRecord } from "../../fabric/audit.js";
import type { PolicyDecision, ToolRequest } from "../../fabric/contract.js";
import {
  dryRunDiff,
  isRelaxation,
  type CandidatePolicy,
  type DryRunDiff,
} from "../../fabric/replay.js";
import type { CheckResult, FabricService } from "../../fabric/service.js";
import {
  normalizeExecAsk,
  requiresExecApproval,
  type ExecAsk,
  type ExecSecurity,
} from "../../infra/exec-approvals.js";

export type SeatDrillOutcome = "allow" | "deny" | "tighten";

export type SeatDrillResult = {
  outcome: SeatDrillOutcome;
  /** Fabric 裁决摘要（ALLOW / DENY / MODIFY）。 */
  decision: CheckResult["decision"];
  reason?: string;
  matchedRules: string[];
  /** 相对基线是否构成放宽（DENY→非 DENY，或减弱沙箱/重开网络）。 */
  relaxation: boolean;
  /** 若真执行，按当前有效 ask/security 是否要审批（不弹窗、不改 ask）。 */
  wouldRequireApprovalIfExecuted: boolean;
  effectiveAsk: ExecAsk;
  effectiveSecurity: ExecSecurity;
  /** 恒为 false：演练永不构成预授权。 */
  preAuthorization: false;
  /** 恒为 false：演练不持久化允许列表或审批放行。 */
  persisted: false;
};

export type SeatDryRunDiffDrillResult = {
  diff: DryRunDiff;
  /** 任一 entry 标为 relaxation 即 true。 */
  relaxation: boolean;
  preAuthorization: false;
  persisted: false;
};

function mapOutcome(decision: CheckResult["decision"]): SeatDrillOutcome {
  if (decision === "DENY") {
    return "deny";
  }
  if (decision === "MODIFY") {
    return "tighten";
  }
  return "allow";
}

function checkResultToDecision(result: CheckResult): PolicyDecision {
  if (result.decision === "DENY") {
    return {
      decision: "DENY",
      reason: result.reason ?? "denied",
      matchedRules: result.matchedRules,
      decisionTrace: result.decisionTrace,
    };
  }
  if (result.decision === "MODIFY") {
    return {
      decision: "MODIFY",
      constraints: result.constraints ?? {},
      matchedRules: result.matchedRules,
      decisionTrace: result.decisionTrace,
    };
  }
  return {
    decision: "ALLOW",
    matchedRules: result.matchedRules,
    decisionTrace: result.decisionTrace,
  };
}

/**
 * 单次 policy check 演练：只调用 `check`，绝不调用 `execute`。
 */
export function runSeatPolicyDrill(input: {
  check: (request: ToolRequest) => CheckResult;
  request: ToolRequest;
  effectiveAsk: ExecAsk;
  effectiveSecurity: ExecSecurity;
  analysisOk?: boolean;
  allowlistSatisfied?: boolean;
  /** 可选基线裁决，用于标放宽。 */
  baselineDecision?: PolicyDecision;
}): SeatDrillResult {
  // 闸门 6：禁止把 ask 拧松到 off 来「演练放行」。
  if (normalizeExecAsk(input.effectiveAsk) === null) {
    throw new Error("invalid effectiveAsk for seat drill");
  }

  const checkResult = input.check(input.request);
  const candidate = checkResultToDecision(checkResult);
  const relaxation = input.baselineDecision
    ? isRelaxation(input.baselineDecision, candidate)
    : false;

  const wouldRequireApprovalIfExecuted = requiresExecApproval({
    ask: input.effectiveAsk,
    security: input.effectiveSecurity,
    analysisOk: input.analysisOk ?? true,
    allowlistSatisfied: input.allowlistSatisfied ?? false,
  });

  return {
    outcome: mapOutcome(checkResult.decision),
    decision: checkResult.decision,
    reason: checkResult.reason,
    matchedRules: checkResult.matchedRules,
    relaxation,
    wouldRequireApprovalIfExecuted,
    effectiveAsk: input.effectiveAsk,
    effectiveSecurity: input.effectiveSecurity,
    preAuthorization: false,
    persisted: false,
  };
}

/**
 * 用 FabricService.check 跑演练（decide-only）。调用方不得传入 execute 路径。
 */
export function runSeatPolicyDrillViaFabric(input: {
  fabric: Pick<FabricService, "check">;
  request: ToolRequest;
  effectiveAsk: ExecAsk;
  effectiveSecurity: ExecSecurity;
  analysisOk?: boolean;
  allowlistSatisfied?: boolean;
  baselineDecision?: PolicyDecision;
}): SeatDrillResult {
  return runSeatPolicyDrill({
    check: (request) => input.fabric.check(request),
    request: input.request,
    effectiveAsk: input.effectiveAsk,
    effectiveSecurity: input.effectiveSecurity,
    analysisOk: input.analysisOk,
    allowlistSatisfied: input.allowlistSatisfied,
    baselineDecision: input.baselineDecision,
  });
}

/**
 * 历史记录上的候选策略 diff 演练：纯 dryRunDiff，无副作用。
 */
export function runSeatDryRunDiffDrill(input: {
  records: readonly FabricExecutionRecord[];
  candidate: CandidatePolicy;
}): SeatDryRunDiffDrillResult {
  const diff = dryRunDiff(input.records, input.candidate);
  return {
    diff,
    relaxation: diff.relaxationCount > 0,
    preAuthorization: false,
    persisted: false,
  };
}

/**
 * 闸门 6 硬拒绝：演练结果不得写成允许列表或下次预授权。
 * 故意无成功路径；测试锁定 throw。
 */
export function applySeatDrillAsPreAuthorization(
  _result: SeatDrillResult | SeatDryRunDiffDrillResult,
): never {
  throw new Error(
    "seat_drill_cannot_preauthorize: drill results must not authorize real execution",
  );
}

/** 演练默认样例请求（无副作用命令名；真正执行不会被本模块触发）。 */
export function buildSeatDrillSampleRequest(params?: {
  tenantId?: string;
  command?: string;
  sessionId?: string;
}): ToolRequest {
  const command = params?.command?.trim() || "echo seat-policy-drill";
  return {
    id: `seat-drill-${Date.now()}`,
    source: { type: "cursor", tenantId: params?.tenantId },
    tool: { name: "exec" },
    // Fabric ToolRequest.input 只认 args/cwd/env；命令经 args 交给探测。
    input: { args: [command] },
    context: {},
    trace: {
      sessionId: params?.sessionId ?? "seat-drill",
      correlationId: `seat-drill-${Date.now()}`,
    },
  };
}
