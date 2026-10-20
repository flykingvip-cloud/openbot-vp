import { listChatChannels } from "../../../channels/registry.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { isChannelConfigured } from "../../../config/plugin-auto-enable.js";
import type { DataCapabilityDescriptor } from "../types.js";

export function channelCapabilityId(channelId: string): string {
  return `cap:channel:${channelId}`;
}

/**
 * Real (non-demo) data capabilities for messaging channels the bot is actually
 * configured for (Slack, Feishu, Telegram, …). Unlike the seeded demo connectors,
 * these reflect live configuration — they only appear when a channel has real
 * credentials/config present, and are flagged `isSample: false` so the UI shows
 * them as genuine connectors rather than samples.
 */
export function buildConfiguredChannelCapabilityDescriptors(
  cfg: OpenBotConfig,
  env: NodeJS.ProcessEnv = process.env,
): DataCapabilityDescriptor[] {
  return listChatChannels()
    .filter((meta) => isChannelConfigured(cfg, meta.id, env))
    .map((meta) => ({
      id: channelCapabilityId(meta.id),
      title: `${meta.label} 协作渠道`,
      summary: `已连接的 ${meta.label} 渠道，可作为协作会话上下文来源（真实连接器）`,
      sourceSystems: [meta.label],
      scenarios: ["协作消息", "会话上下文"],
      visibleAgents: [],
      scopeLabel: "已连接",
      accessState: "granted",
      isSample: false,
    }));
}
