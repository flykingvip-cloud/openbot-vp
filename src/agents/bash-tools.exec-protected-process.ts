import type { ExecHost } from "../infra/exec-approvals.js";

const PID_ONE_SIGNAL_PATTERN =
  /(?:^|[\s;&|'"(])(?:\/[\w./-]+\/)?kill\b[^\n;&|]*\s-?1(?=\s|$|[;&|'" ])/iu;
const GATEWAY_PROCESS_SIGNAL_PATTERN =
  /(?:^|[\s;&|'"(])(?:\/[\w./-]+\/)?(?:pkill|killall)\b[^\n;&|]*\b(?:openbot|openclaw)(?:-gateway)?\b/iu;

export function resolveConfiguredExecHost(params: {
  configuredHost?: ExecHost;
  sandboxAvailable: boolean;
}): ExecHost {
  return params.configuredHost ?? (params.sandboxAvailable ? "sandbox" : "gateway");
}

export function assertProtectedGatewayProcessCommandAllowed(params: {
  command: string;
  host: ExecHost;
  runtimePid?: number;
}): void {
  if (params.host !== "gateway" || params.runtimePid !== 1) {
    return;
  }
  if (
    !PID_ONE_SIGNAL_PATTERN.test(params.command) &&
    !GATEWAY_PROCESS_SIGNAL_PATTERN.test(params.command)
  ) {
    return;
  }
  throw new Error(
    "Exec denied: agents cannot signal the production gateway process. Use the external deployment supervisor with explicit operator approval.",
  );
}
