/**
 * Startup rules for managed multitenant exec (v4.1 §6.2–§6.3).
 *
 * Personal Local is untouched. A passing check means account execution
 * isolation (files and browser), not blast-radius isolation after a Gateway
 * compromise, and not I4 / dedicated.
 */
import type { OpenBotConfig } from "../../config/types.js";
import { isAccountWorkerEnvFlagOn } from "./account-worker-flags.js";

export const ACCOUNT_EXECUTION_ISOLATION_CLAIM = "account_execution_isolation";

/**
 * Docker account worker is an execution boundary for managed multitenant.
 * P6b: both flags default ON when unset; either explicitly off disables the
 * boundary. Sandbox mode and exec host are checked separately by the startup gate.
 */
export function dockerAccountWorkerExecutionBoundary(env: NodeJS.ProcessEnv): boolean {
  return (
    isAccountWorkerEnvFlagOn(env.OPENBOT_ACCOUNT_WORKER) &&
    isAccountWorkerEnvFlagOn(env.OPENBOT_ACCOUNT_WORKER_DOCKER)
  );
}

export type MultitenantSandboxStartupIssue = "sandbox-off" | "unscoped-gateway-exec";

export function multitenantSandboxStartupIssue(
  cfg: OpenBotConfig | undefined,
): MultitenantSandboxStartupIssue | null {
  const mode = cfg?.agents?.defaults?.sandbox?.mode ?? "off";
  const execHost = cfg?.tools?.exec?.host;
  if (mode === "off") {
    return "sandbox-off";
  }
  if (execHost === "gateway" || execHost === "node") {
    return "unscoped-gateway-exec";
  }
  // non-main leaves the main session on the Gateway host unless host is forced
  // to the account sandbox.
  if (mode === "non-main" && execHost !== "sandbox") {
    return "unscoped-gateway-exec";
  }
  if (mode === "all") {
    return null;
  }
  return "unscoped-gateway-exec";
}
