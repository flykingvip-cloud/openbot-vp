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
 * sticky agent/config `tools.exec.host=gateway|node` override — including when
 * the model explicitly echoes host=gateway|node. Otherwise file tools use the
 * account lease (`/account/workspace`, chromium) while shell runs on gateway
 * (uid `node`) or a paired Mac node — LIVE bot-2 growth-report regression
 * class 2026-10-31 / audit P1-1 + P1-3.
 *
 * Elevated remains the operator break-glass onto the gateway.
 * Intentional Desktop local-computer allow (`decideLocalComputerHost` → allow)
 * keeps host=node so the bounded Desktop path is not remapped.
 */
export function preferBoundSandboxExecHost(params: {
  host: ExecHost;
  sandboxAvailable: boolean;
  requestedHost: ExecHost | null;
  elevatedRequested: boolean;
  /** When true, keep intentional Desktop host=node from decideLocalComputerHost. */
  localComputerAllow?: boolean;
}): ExecHost {
  void params.requestedHost;
  if (params.elevatedRequested) {
    return "gateway";
  }
  if (!params.sandboxAvailable) {
    return params.host;
  }
  // Intentional Desktop local-computer allow path: do not remap host=node.
  if (params.localComputerAllow && params.host === "node") {
    return "node";
  }
  // Remap sticky/config or explicit model gateway|node onto the bound sandbox.
  if (params.host === "gateway" || params.host === "node") {
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
