import fs from "node:fs/promises";
import {
  applyAgentConfig,
  findAgentEntryIndex,
  listAgentEntries,
} from "../../commands/agents.config.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { resolveSessionTranscriptsDirForAgent } from "../../config/sessions/paths.js";
import type { AgentConfig } from "../../config/types.agents.js";
import { resolveAgentDir, resolveAgentWorkspaceDir } from "../agent-scope.js";
import { ensureAgentWorkspace } from "../workspace.js";
import {
  buildPersonalMailAssistantAgentId,
  PERSONAL_MAIL_ASSISTANT_AVATAR,
  PERSONAL_MAIL_ASSISTANT_EMOJI,
  PERSONAL_MAIL_ASSISTANT_NAME,
} from "./identity.js";

const MAIL_ASSISTANT_TOOL_IDS = ["user_operational_identity"] as const;

function ensureMailAssistantTools(entry: AgentConfig): AgentConfig {
  const tools = entry.tools ?? {};
  const alsoAllow = Array.isArray(tools.alsoAllow) ? [...tools.alsoAllow] : [];
  const deny = Array.isArray(tools.deny) ? tools.deny : [];
  const additions = MAIL_ASSISTANT_TOOL_IDS.filter(
    (toolId) => !deny.includes(toolId) && !alsoAllow.includes(toolId),
  );
  if (additions.length === 0) {
    return entry;
  }
  return {
    ...entry,
    tools: {
      ...tools,
      alsoAllow: [...alsoAllow, ...additions],
    },
  };
}

/**
 * Idempotently ensure a per-user「邮件助手」agent exists in gateway config.
 */
export async function ensurePersonalMailAssistantForUser(params: {
  ownerId: string;
  ownerLabel?: string;
}): Promise<{ agentId: string; created: boolean }> {
  const ownerId = params.ownerId.trim();
  if (!ownerId) {
    throw new Error("ownerId is required to provision personal mail assistant.");
  }
  const agentId = buildPersonalMailAssistantAgentId(ownerId);
  const cfg = loadConfig();
  const entries = listAgentEntries(cfg);
  const index = findAgentEntryIndex(entries, agentId);
  if (index >= 0) {
    const existing = entries[index];
    const patched = ensureMailAssistantTools({
      ...existing,
      scope: existing.scope ?? "self",
      ownerType: existing.ownerType ?? "platform",
      ownerId: existing.ownerId ?? ownerId,
      ownerName: existing.ownerName ?? params.ownerLabel?.trim() ?? ownerId,
      identity: {
        name: existing.identity?.name ?? PERSONAL_MAIL_ASSISTANT_NAME,
        emoji: existing.identity?.emoji ?? PERSONAL_MAIL_ASSISTANT_EMOJI,
        avatar: existing.identity?.avatar ?? PERSONAL_MAIL_ASSISTANT_AVATAR,
      },
    });
    if (JSON.stringify(patched) !== JSON.stringify(existing)) {
      const nextList = [...entries];
      nextList[index] = patched;
      await writeConfigFile({
        ...cfg,
        agents: { ...cfg.agents, list: nextList },
      });
    }
    return { agentId, created: false };
  }

  let nextConfig = applyAgentConfig(cfg, {
    agentId,
    name: PERSONAL_MAIL_ASSISTANT_NAME,
    scope: "self",
    ownerType: "platform",
    ownerId,
    ownerName: params.ownerLabel?.trim() || ownerId,
    identity: {
      name: PERSONAL_MAIL_ASSISTANT_NAME,
      emoji: PERSONAL_MAIL_ASSISTANT_EMOJI,
      avatar: PERSONAL_MAIL_ASSISTANT_AVATAR,
    },
  });
  const workspaceDir = resolveAgentWorkspaceDir(nextConfig, agentId);
  nextConfig = applyAgentConfig(nextConfig, {
    agentId,
    workspace: workspaceDir,
    agentDir: resolveAgentDir(nextConfig, agentId),
  });
  const list = listAgentEntries(nextConfig);
  const newIndex = findAgentEntryIndex(list, agentId);
  if (newIndex >= 0) {
    const nextList = [...list];
    nextList[newIndex] = ensureMailAssistantTools(nextList[newIndex]);
    nextConfig = {
      ...nextConfig,
      agents: { ...nextConfig.agents, list: nextList },
    };
  }

  const skipBootstrap = Boolean(nextConfig.agents?.defaults?.skipBootstrap);
  await ensureAgentWorkspace({ dir: workspaceDir, ensureBootstrapFiles: !skipBootstrap });
  await fs.mkdir(resolveSessionTranscriptsDirForAgent(agentId), { recursive: true });
  await writeConfigFile(nextConfig);
  return { agentId, created: true };
}
