import { describe, expect, it } from "vitest";
import { type AgentChannelBindingFact, computeAgentRuntimeHealth } from "./agent-runtime-health.js";

function channel(
  channelId: string,
  accountId: string,
  connected: boolean,
): AgentChannelBindingFact {
  return { channelId, accountId, connected };
}

describe("computeAgentRuntimeHealth", () => {
  it("reports unconfigured when the agent has no resolvable model", () => {
    const report = computeAgentRuntimeHealth({
      agentId: "sales-bot",
      modelConfigured: false,
      boundChannels: [channel("telegram", "default", true)],
    });
    expect(report.health).toBe("unconfigured");
    expect(report.reasons).toEqual(["no-model-configured"]);
    // Model gate wins even if a channel happens to be connected.
    expect(report.connectedChannelCount).toBe(1);
  });

  it("reports online when model is ready and the agent has no bound channels", () => {
    const report = computeAgentRuntimeHealth({
      agentId: "main",
      modelConfigured: true,
      boundChannels: [],
    });
    expect(report.health).toBe("online");
    expect(report.reasons).toEqual(["no-bound-channels"]);
    expect(report.boundChannelCount).toBe(0);
  });

  it("reports online when all bound channels are connected", () => {
    const report = computeAgentRuntimeHealth({
      agentId: "main",
      modelConfigured: true,
      boundChannels: [channel("telegram", "default", true), channel("discord", "default", true)],
    });
    expect(report.health).toBe("online");
    expect(report.reasons).toEqual(["all-bound-channels-connected"]);
    expect(report.connectedChannelCount).toBe(2);
  });

  it("reports degraded when only some bound channels are connected", () => {
    const report = computeAgentRuntimeHealth({
      agentId: "main",
      modelConfigured: true,
      boundChannels: [channel("telegram", "default", true), channel("discord", "default", false)],
    });
    expect(report.health).toBe("degraded");
    expect(report.reasons).toEqual(["some-bound-channels-disconnected"]);
    expect(report.connectedChannelCount).toBe(1);
    expect(report.boundChannelCount).toBe(2);
  });

  it("reports offline when the agent has bound channels but none are connected", () => {
    const report = computeAgentRuntimeHealth({
      agentId: "sales-bot",
      modelConfigured: true,
      boundChannels: [channel("telegram", "default", false), channel("whatsapp", "default", false)],
    });
    expect(report.health).toBe("offline");
    expect(report.reasons).toEqual(["all-bound-channels-disconnected"]);
    expect(report.connectedChannelCount).toBe(0);
  });
});
