import type { OpenBotConfig } from "../config/config.js";
import { resolveSecurityProfile } from "../gateway/security-profile.js";
import {
  DEFAULT_TOOL_WRITE_CHANNELS,
  type WorkspaceWriteChannel,
} from "../gateway/workspace/write-channel.js";
import { resolveAgentConfig } from "./agent-scope.js";

export type ToolFsPolicy = {
  workspaceOnly: boolean;
  /** C17 write channels granted to agent tools. */
  writeChannels: readonly WorkspaceWriteChannel[];
};

export function createToolFsPolicy(params: {
  workspaceOnly?: boolean;
  writeChannels?: readonly WorkspaceWriteChannel[];
}): ToolFsPolicy {
  return {
    workspaceOnly: params.workspaceOnly === true,
    writeChannels: params.writeChannels ?? DEFAULT_TOOL_WRITE_CHANNELS,
  };
}

export function resolveToolFsConfig(params: { cfg?: OpenBotConfig; agentId?: string }): {
  workspaceOnly?: boolean;
} {
  const cfg = params.cfg;
  const globalFs = cfg?.tools?.fs;
  const agentFs =
    cfg && params.agentId ? resolveAgentConfig(cfg, params.agentId)?.tools?.fs : undefined;
  return {
    workspaceOnly: agentFs?.workspaceOnly ?? globalFs?.workspaceOnly,
  };
}

/**
 * Effective workspaceOnly gate.
 * Managed Enterprise always forces workspace-only FS (C17 write boundary).
 */
export function resolveEffectiveToolFsWorkspaceOnly(params: {
  cfg?: OpenBotConfig;
  agentId?: string;
}): boolean {
  if (
    params.cfg &&
    resolveSecurityProfile(params.cfg, process.env).profile === "managed_enterprise"
  ) {
    return true;
  }
  return resolveToolFsConfig(params).workspaceOnly === true;
}

/** Default tool write channels: interaction drafts only (never primary without explicit grant). */
export function resolveEffectiveToolWriteChannels(_params?: {
  cfg?: OpenBotConfig;
  agentId?: string;
}): readonly WorkspaceWriteChannel[] {
  return DEFAULT_TOOL_WRITE_CHANNELS;
}
