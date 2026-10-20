import { afterEach, describe, expect, it } from "vitest";
import {
  getChatInboundDepthAgentAllowlist,
  isChatInboundDepthHarvestEnabled,
  isChatInboundDepthRouterEnabled,
  isChatInboundDepthShadowEnabled,
  isChatInboundKnowledgePolicyEnabled,
  isChatInboundPersistEarlyEnabled,
  isChatInboundToolPolicyEnabled,
  listEnabledChatInboundFlags,
} from "./chat-inbound-flags.js";

const FLAG_KEYS = [
  "OPENBOT_CHAT_INBOUND_PERSIST_EARLY",
  "OPENBOT_CHAT_INBOUND_DEPTH_SHADOW",
  "OPENBOT_CHAT_INBOUND_DEPTH_ROUTER",
  "OPENBOT_CHAT_INBOUND_KNOWLEDGE_POLICY",
  "OPENBOT_CHAT_INBOUND_TOOL_POLICY",
  "OPENBOT_CHAT_INBOUND_DEPTH_AGENT_ALLOWLIST",
  "OPENBOT_CHAT_INBOUND_DEPTH_HARVEST",
] as const;

const previous = new Map<string, string | undefined>();

function setEnv(key: string, value: string | undefined) {
  if (!previous.has(key)) {
    previous.set(key, process.env[key]);
  }
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

afterEach(() => {
  for (const [key, value] of previous) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  previous.clear();
});

describe("chat inbound flags", () => {
  it("defaults all flags off", () => {
    for (const key of FLAG_KEYS) {
      setEnv(key, undefined);
    }
    expect(isChatInboundPersistEarlyEnabled()).toBe(false);
    expect(isChatInboundDepthRouterEnabled()).toBe(false);
    expect(isChatInboundKnowledgePolicyEnabled()).toBe(false);
    expect(isChatInboundToolPolicyEnabled()).toBe(false);
    expect(listEnabledChatInboundFlags()).toEqual([]);
  });

  it("enables persist early from env", () => {
    setEnv("OPENBOT_CHAT_INBOUND_PERSIST_EARLY", "1");
    expect(isChatInboundPersistEarlyEnabled()).toBe(true);
    expect(listEnabledChatInboundFlags()).toEqual(["chatInboundPersistEarly"]);
  });

  it("enables the depth router from env without changing the default-off contract", () => {
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_ROUTER", "1");
    expect(isChatInboundDepthRouterEnabled()).toBe(true);
    expect(listEnabledChatInboundFlags()).toEqual([
      "chatInboundDepthRouter",
      "chatInboundDepthHarvest",
    ]);
  });

  it("enables knowledge policy from env without changing the default-off contract", () => {
    setEnv("OPENBOT_CHAT_INBOUND_KNOWLEDGE_POLICY", "1");
    expect(isChatInboundKnowledgePolicyEnabled()).toBe(true);
    expect(listEnabledChatInboundFlags()).toEqual(["chatInboundKnowledgePolicy"]);
  });

  it("enables tool policy from env without changing the default-off contract", () => {
    setEnv("OPENBOT_CHAT_INBOUND_TOOL_POLICY", "1");
    expect(isChatInboundToolPolicyEnabled()).toBe(true);
    expect(listEnabledChatInboundFlags()).toEqual(["chatInboundToolPolicy"]);
  });

  it("returns an empty depth agent allowlist when unset or blank", () => {
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_AGENT_ALLOWLIST", undefined);
    expect(getChatInboundDepthAgentAllowlist()).toEqual([]);
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_AGENT_ALLOWLIST", "   ");
    expect(getChatInboundDepthAgentAllowlist()).toEqual([]);
  });

  it("parses the depth agent allowlist from env (trim, lowercase, drop empties)", () => {
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_AGENT_ALLOWLIST", " Analyst , ,skill-hatch ,MAIN ");
    expect(getChatInboundDepthAgentAllowlist()).toEqual(["analyst", "skill-hatch", "main"]);
  });

  it("reports only the allowlist size in the enabled-flags summary (no raw agent id)", () => {
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_AGENT_ALLOWLIST", "analyst,skill-hatch");
    expect(listEnabledChatInboundFlags()).toEqual(["chatInboundDepthAgentAllowlist:2"]);
  });

  it("auto-enables harvest when shadow is on (no new mandatory flag)", () => {
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_SHADOW", "1");
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_HARVEST", undefined);
    expect(isChatInboundDepthShadowEnabled()).toBe(true);
    expect(isChatInboundDepthHarvestEnabled()).toBe(true);
    expect(listEnabledChatInboundFlags()).toEqual([
      "chatInboundDepthShadow",
      "chatInboundDepthHarvest",
    ]);
  });

  it("lets operators disable harvest explicitly while shadow stays on", () => {
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_SHADOW", "1");
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_HARVEST", "0");
    expect(isChatInboundDepthHarvestEnabled()).toBe(false);
    expect(listEnabledChatInboundFlags()).toEqual(["chatInboundDepthShadow"]);
  });

  it("lets operators force harvest on without shadow/router", () => {
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_HARVEST", "1");
    expect(isChatInboundDepthHarvestEnabled()).toBe(true);
    expect(listEnabledChatInboundFlags()).toEqual(["chatInboundDepthHarvest"]);
  });
});
