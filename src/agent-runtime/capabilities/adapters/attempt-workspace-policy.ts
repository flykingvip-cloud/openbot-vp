import { shouldForceEmployeeStewardToolFsWorkspaceOnly } from "../../../agents/builtin-steward/employee-isolation.js";
import { resolveEffectiveToolFsWorkspaceOnly } from "../../../agents/tool-fs-policy.js";
import type { OpenBotConfig } from "../../../config/config.js";

export function resolveAttemptFsWorkspaceOnly(params: {
  config?: OpenBotConfig;
  sessionAgentId: string;
  sessionKey?: string;
  /** Collaboration rounds must keep exec/tool cwd inside the group workspace root. */
  collaborationRoundInvoked?: boolean;
}): boolean {
  if (params.collaborationRoundInvoked) {
    return true;
  }
  if (
    shouldForceEmployeeStewardToolFsWorkspaceOnly({
      sessionKey: params.sessionKey,
      agentId: params.sessionAgentId,
    })
  ) {
    return true;
  }
  return resolveEffectiveToolFsWorkspaceOnly({
    cfg: params.config,
    agentId: params.sessionAgentId,
  });
}
