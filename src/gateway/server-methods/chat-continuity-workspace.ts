import type { OpenBotConfig } from "../../config/types.js";
import * as chatCheckpointStore from "../checkpoint-store.js";
import type { GatewayClient } from "./types.js";

export type ResolvePrimaryWorkspaceDir = (params: {
  cfg: OpenBotConfig;
  sessionKey: string;
  agentId: string;
  client: GatewayClient | null;
}) => Promise<string | null>;

/** Turn-complete checkpoint capture: authorized cwd first, then tenant locator candidates. */
export async function resolveContinuityWorkspaceDirForTurn(params: {
  cfg: OpenBotConfig;
  sessionKey: string;
  agentId: string;
  client: GatewayClient | null;
  resolvePrimaryWorkspaceDir: ResolvePrimaryWorkspaceDir;
}): Promise<string | null> {
  const primary = await params.resolvePrimaryWorkspaceDir({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    client: params.client,
  });
  if (primary) {
    return primary;
  }
  const candidates = await chatCheckpointStore.resolveChatCheckpointWorkspaceDirsForClient({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    client: params.client,
    primaryWorkspaceDir: null,
  });
  return candidates[0] ?? null;
}
