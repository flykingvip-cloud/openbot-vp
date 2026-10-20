import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  buildAgentRuntimeHealthReports,
  collectAgentRuntimeHealth,
  isChannelAccountConnected,
  resolveAgentBoundChannelRefs,
} from "./agent-runtime-health-collect.js";
import type { ChannelRuntimeSnapshot } from "./server-channels.js";

describe("isChannelAccountConnected", () => {
  it("requires both running and connected", () => {
    expect(isChannelAccountConnected({ running: true, connected: true })).toBe(true);
    expect(isChannelAccountConnected({ running: true, connected: false })).toBe(false);
    expect(isChannelAccountConnected({ running: false, connected: true })).toBe(false);
    expect(isChannelAccountConnected(undefined)).toBe(false);
    expect(isChannelAccountConnected(null)).toBe(false);
  });
});

describe("resolveAgentBoundChannelRefs", () => {
  const cfg = {
    bindings: [
      { agentId: "sales-bot", match: { channel: "telegram", accountId: "default" } },
      { agentId: "sales-bot", match: { channel: "discord", accountId: "default" } },
      // duplicate of the first — must dedupe
      { agentId: "sales-bot", match: { channel: "telegram", accountId: "default" } },
      // wildcard account — must be skipped
      { agentId: "sales-bot", match: { channel: "slack", accountId: "*" } },
      // different agent — must not leak
      { agentId: "main", match: { channel: "telegram", accountId: "default" } },
    ],
  } as unknown as OpenBotConfig;

  it("returns distinct concrete channel/account pairs for the agent", () => {
    const refs = resolveAgentBoundChannelRefs(cfg, "sales-bot");
    expect(refs).toEqual([
      { channelId: "telegram", accountId: "default" },
      { channelId: "discord", accountId: "default" },
    ]);
  });

  it("returns an empty list for an agent with no bindings", () => {
    expect(resolveAgentBoundChannelRefs(cfg, "ghost")).toEqual([]);
  });
});

describe("buildAgentRuntimeHealthReports", () => {
  it("maps injected facts to health and de-duplicates agent ids", () => {
    const reports = buildAgentRuntimeHealthReports({
      agentIds: ["main", "sales-bot", "research", "ghost", "main"],
      isModelConfigured: (id) => id !== "ghost",
      resolveBoundChannels: (id) => {
        if (id === "sales-bot") {
          return [
            { channelId: "telegram", accountId: "default" },
            { channelId: "discord", accountId: "default" },
          ];
        }
        if (id === "research") {
          return [{ channelId: "telegram", accountId: "default" }];
        }
        return [];
      },
      isChannelConnected: (channelId) => channelId === "telegram",
    });

    const byId = Object.fromEntries(reports.map((r) => [r.agentId, r.health]));
    expect(byId).toEqual({
      main: "online", // model ok, no channels
      "sales-bot": "degraded", // telegram connected, discord not
      research: "online", // sole channel connected
      ghost: "unconfigured", // no model
    });
    // "main" appears twice in input but is reported once.
    expect(reports.filter((r) => r.agentId === "main")).toHaveLength(1);
  });

  it("reports offline when all bound channels are down", () => {
    const [report] = buildAgentRuntimeHealthReports({
      agentIds: ["sales-bot"],
      isModelConfigured: () => true,
      resolveBoundChannels: () => [{ channelId: "telegram", accountId: "default" }],
      isChannelConnected: () => false,
    });
    expect(report.health).toBe("offline");
  });
});

describe("collectAgentRuntimeHealth", () => {
  const cfg = {
    agents: {
      list: [{ id: "main", model: "openai/gpt-4o" }, { id: "sales-bot" }],
      defaults: { model: "openai/gpt-4o-mini" },
    },
    bindings: [
      { agentId: "sales-bot", match: { channel: "telegram", accountId: "default" } },
      { agentId: "sales-bot", match: { channel: "discord", accountId: "default" } },
    ],
  } as unknown as OpenBotConfig;

  // telegram default connected via channel-level fallback; discord default down.
  const runtimeSnapshot = {
    channels: { telegram: { running: true, connected: true } },
    channelAccounts: { discord: { default: { running: true, connected: false } } },
  } as unknown as ChannelRuntimeSnapshot;

  it("derives online (no channels) and degraded (partial connectivity) from real state", () => {
    const reports = collectAgentRuntimeHealth({
      cfg,
      agentIds: ["main", "sales-bot"],
      runtimeSnapshot,
    });
    const byId = Object.fromEntries(reports.map((r) => [r.agentId, r]));
    expect(byId.main.health).toBe("online");
    expect(byId.main.boundChannelCount).toBe(0);
    expect(byId["sales-bot"].health).toBe("degraded");
    expect(byId["sales-bot"].boundChannelCount).toBe(2);
    expect(byId["sales-bot"].connectedChannelCount).toBe(1);
  });

  it("derives unconfigured when no effective model resolves", () => {
    const cfgNoDefault = {
      agents: { list: [{ id: "ghost" }] },
    } as unknown as OpenBotConfig;
    const [report] = collectAgentRuntimeHealth({
      cfg: cfgNoDefault,
      agentIds: ["ghost"],
      runtimeSnapshot: { channels: {}, channelAccounts: {} } as unknown as ChannelRuntimeSnapshot,
    });
    expect(report.health).toBe("unconfigured");
  });
});
