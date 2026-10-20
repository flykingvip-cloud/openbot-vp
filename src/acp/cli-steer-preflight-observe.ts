import { buildExecutionPreflight } from "../agents/execution-preflight/resolve.js";
import type { OpenBotConfig } from "../config/config.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { logWarn } from "../logger.js";
import { normalizeAgentId } from "../routing/session-key.js";

/**
 * Observe-only. Unset/off keeps CLI ACP turns and `/acp steer` on today's path.
 * Truthy values match isTruthyEnvValue (1, true, yes, on).
 * One flag, two task ids: CLI turns and steer are different seams.
 */
export const ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV = "OPENBOT_ACP_CLI_STEER_PREFLIGHT_OBSERVE";

export type AcpCliSteerObserveKind = "cli-turn" | "steer";

export function isAcpCliSteerPreflightObserveEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isTruthyEnvValue(env[ACP_CLI_STEER_PREFLIGHT_OBSERVE_ENV]);
}

/** Process-local trace key. Not a completion, ledger, or authorization id. */
export function acpCliSteerObserveTaskId(
  kind: AcpCliSteerObserveKind,
  sessionKey: string,
  agentId: string,
): string {
  const prefix = kind === "cli-turn" ? "acp-cli-turn" : "acp-steer";
  return `${prefix}:${sessionKey}:${normalizeAgentId(agentId)}`;
}

/**
 * Names already admitted by `allowedAgents`. An empty allowlist admits the
 * resolved agent. These are observe labels, not a Pi tool catalog.
 */
export function acpCliSteerObserveNames(cfg: OpenBotConfig, agentId: string): string[] {
  const allowed = (cfg.acp?.allowedAgents ?? [])
    .map((entry) => normalizeAgentId(entry))
    .filter(Boolean);
  if (allowed.length > 0) {
    return allowed;
  }
  const resolved = normalizeAgentId(agentId);
  return resolved ? [resolved] : [];
}

export function observeAcpCliSteerPreflight(params: {
  kind: AcpCliSteerObserveKind;
  cfg: OpenBotConfig;
  sessionKey: string;
  agentId: string;
}): void {
  if (!isAcpCliSteerPreflightObserveEnabled()) {
    return;
  }
  try {
    const names = acpCliSteerObserveNames(params.cfg, params.agentId);
    // Record the existing preflight trace only. The returned tool set is unused.
    buildExecutionPreflight({
      taskId: acpCliSteerObserveTaskId(params.kind, params.sessionKey, params.agentId),
      sessionId: params.sessionKey,
      message: normalizeAgentId(params.agentId),
      skills: [],
      policyToolNames: names,
      catalogToolNames: names,
    });
  } catch (err) {
    logWarn(`acp-cli-steer: observe preflight failed: ${String(err)}`);
  }
}
