/**
 * 会话和席位的 exec 请求只能沿 maxAsk / minSecurity 收紧。
 * elevated full 仍是操作者 break-glass，不从席位规则或会话 /exec 打开。
 */
import {
  compileSeatPolicyPriority,
  type SeatPolicyClamp,
  type SeatPolicyControls,
} from "../gateway/seat-rules/priority-compiler.js";
import type { ExecAsk, ExecHost, ExecSecurity } from "../infra/exec-approvals.js";
import {
  operatorElevatedFullBreakGlass,
  resolveRuntimeAskSource,
  type RuntimeAskSource,
} from "./bash-tools.exec-host-shared.js";

export type ResolveExecSecurityAskInput = {
  configuredSecurity: ExecSecurity;
  configuredAsk: ExecAsk;
  configuredHost: ExecHost;
  seat?: SeatPolicyControls;
  session?: SeatPolicyControls;
  elevatedRequested: boolean;
  elevatedMode: string;
};

export type ResolvedExecSecurityAsk = {
  security: ExecSecurity;
  ask: ExecAsk;
  runtimeAskSource: RuntimeAskSource;
  bypassApprovals: boolean;
  clamps: SeatPolicyClamp[];
};

export function resolveExecSecurityAskWithinCeiling(
  input: ResolveExecSecurityAskInput,
): ResolvedExecSecurityAsk {
  const compiled = compileSeatPolicyPriority({
    enterpriseHard: {
      security: input.configuredSecurity,
      ask: input.configuredAsk,
      host: input.configuredHost,
      credentialPolicy: "enterprise_shared",
      executionPlacement: input.configuredHost === "node" ? "node_agent" : "gateway",
    },
    seatPrefs: input.seat ? { controls: input.seat } : undefined,
    sessionTemp: input.session ? { controls: input.session } : undefined,
  });
  const bypassApprovals = operatorElevatedFullBreakGlass({
    source: "operator",
    elevatedRequested: input.elevatedRequested,
    elevatedMode: input.elevatedMode,
  });
  if (bypassApprovals) {
    return {
      security: "full",
      ask: "off",
      runtimeAskSource: "operator",
      bypassApprovals: true,
      clamps: compiled.clamps,
    };
  }
  return {
    security: compiled.security,
    ask: compiled.ask,
    runtimeAskSource: resolveRuntimeAskSource({
      seatAsk: input.seat?.ask,
      sessionAsk: input.session?.ask,
    }),
    bypassApprovals: false,
    clamps: compiled.clamps,
  };
}
