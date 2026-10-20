/**
 * Deploy-level flags for inbound chat depth routing.
 * Not user-facing config. Default off; env overrides for tests and LIVE canaries.
 */

function resolveEnvBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  return defaultValue;
}

/** PR A: persist plain-text user messages before ACK. Attachments already persist. */
export function isChatInboundPersistEarlyEnabled(): boolean {
  return resolveEnvBool("OPENBOT_CHAT_INBOUND_PERSIST_EARLY", false);
}

/** PR B: compute depth in shadow mode only. */
export function isChatInboundDepthShadowEnabled(): boolean {
  return resolveEnvBool("OPENBOT_CHAT_INBOUND_DEPTH_SHADOW", false);
}

/** PR C: apply chat-lane skip of knowledge + empty tools. */
export function isChatInboundDepthRouterEnabled(): boolean {
  return resolveEnvBool("OPENBOT_CHAT_INBOUND_DEPTH_ROUTER", false);
}

/** PR D: knowledge source intersection + live-source gate. */
export function isChatInboundKnowledgePolicyEnabled(): boolean {
  return resolveEnvBool("OPENBOT_CHAT_INBOUND_KNOWLEDGE_POLICY", false);
}

/** PR E: retrieve read-only tool allowlist. */
export function isChatInboundToolPolicyEnabled(): boolean {
  return resolveEnvBool("OPENBOT_CHAT_INBOUND_TOOL_POLICY", false);
}

/**
 * Agent allowlist (besides the default "main" steward) whose `employee:` sessions are in scope
 * for inbound depth. Comma-separated agentIds; trimmed + lowercased. Default empty -> main-only
 * (identical to prior behavior). Opt-in; still gated by the inbound depth flags above.
 */
/**
 * Durable local JSONL harvest for `chat.depth_decided` (shadow scorecard).
 * Default: follows SHADOW or ROUTER (so LIVE Path B with SHADOW=1 gets harvest
 * after DIGEST without a new mandatory env). Explicit `0`/`false` disables;
 * explicit `1`/`true` forces on even without SHADOW/ROUTER.
 */
export function isChatInboundDepthHarvestEnabled(): boolean {
  const raw = process.env.OPENBOT_CHAT_INBOUND_DEPTH_HARVEST?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  return isChatInboundDepthShadowEnabled() || isChatInboundDepthRouterEnabled();
}

export function getChatInboundDepthAgentAllowlist(): string[] {
  const raw = process.env.OPENBOT_CHAT_INBOUND_DEPTH_AGENT_ALLOWLIST?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function listEnabledChatInboundFlags(): string[] {
  const enabled: string[] = [];
  if (isChatInboundPersistEarlyEnabled()) {
    enabled.push("chatInboundPersistEarly");
  }
  if (isChatInboundDepthShadowEnabled()) {
    enabled.push("chatInboundDepthShadow");
  }
  if (isChatInboundDepthRouterEnabled()) {
    enabled.push("chatInboundDepthRouter");
  }
  if (isChatInboundDepthHarvestEnabled()) {
    enabled.push("chatInboundDepthHarvest");
  }
  if (isChatInboundKnowledgePolicyEnabled()) {
    enabled.push("chatInboundKnowledgePolicy");
  }
  if (isChatInboundToolPolicyEnabled()) {
    enabled.push("chatInboundToolPolicy");
  }
  const depthAgentAllowlist = getChatInboundDepthAgentAllowlist();
  if (depthAgentAllowlist.length > 0) {
    enabled.push(`chatInboundDepthAgentAllowlist:${depthAgentAllowlist.length}`);
  }
  return enabled;
}
