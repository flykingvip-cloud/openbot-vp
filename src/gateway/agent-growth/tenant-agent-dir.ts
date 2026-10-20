import { resolveAgentDir } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveAgentDirForClient } from "../tenant-context.js";

export type AgentGrowthPathOpts = { agentDir?: string };

export function resolveGrowthAgentDir(
  cfg: OpenBotConfig,
  agentId: string,
  opts?: AgentGrowthPathOpts,
): string {
  return opts?.agentDir ?? resolveAgentDir(cfg, agentId);
}

export async function resolveGrowthAgentDirForClient(
  client: GatewayClient | null,
  agentId: string,
  cfg?: OpenBotConfig,
): Promise<string> {
  return resolveAgentDirForClient(client, agentId, cfg);
}
