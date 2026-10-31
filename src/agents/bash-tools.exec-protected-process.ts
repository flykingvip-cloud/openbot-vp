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

/**
 * When a session sandbox is bound to the exec tool, prefer host=sandbox over a
 * sticky agent/config `tools.exec.host=gateway` override. Otherwise file tools
 * use the account lease (`/account/workspace`, chromium) while shell runs in
 * the gateway process (uid `node`, no chromium) — LIVE bot-2 growth-report
 * regression 2026-10-31.
 *
 * Elevated remains the operator break-glass onto the gateway. An explicit
 * model-requested host=gateway|node is left unchanged (existing allow/deny
 * gates still apply).
 */
export function preferBoundSandboxExecHost(params: {
  host: ExecHost;
  sandboxAvailable: boolean;
  requestedHost: ExecHost | null;
  elevatedRequested: boolean;
}): ExecHost {
  if (params.elevatedRequested) {
    return "gateway";
  }
  if (params.sandboxAvailable && params.host === "gateway" && params.requestedHost == null) {
    return "sandbox";
  }
  return params.host;
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
