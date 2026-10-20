import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAssistantIdentity,
  resolveRosterAssistantFace,
  type AssistantIdentityState,
} from "./assistant-identity.ts";

function makeState(overrides: Partial<AssistantIdentityState> = {}): AssistantIdentityState {
  return {
    client: { request: vi.fn() } as unknown as AssistantIdentityState["client"],
    connected: true,
    sessionKey: "agent:bot-2:main",
    assistantName: "Assistant",
    assistantAvatar: "A",
    assistantAgentId: "main",
    agentsList: {
      agents: [{ id: "bot-2", name: "市场助手" }],
    },
    ...overrides,
  };
}

describe("loadAssistantIdentity roster fallback (DESKTOP_COMPUTER_STRIP_DISPLAY_NAME_M1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolveRosterAssistantFace prefers identity.name || name", () => {
    expect(resolveRosterAssistantFace([{ id: "bot-2", name: "市场助手" }], "bot-2")).toEqual({
      name: "市场助手",
      avatar: null,
      agentId: "bot-2",
    });
    expect(
      resolveRosterAssistantFace(
        [{ id: "s", name: "roster", identity: { name: "Skill孵化", avatar: "技" } }],
        "s",
      ),
    ).toEqual({ name: "Skill孵化", avatar: "技", agentId: "s" });
    expect(resolveRosterAssistantFace([{ id: "x" }], "x")).toBeNull();
  });

  it("overrides DEFAULT Assistant from identity.get with roster agent.name", async () => {
    const request = vi.fn(async () => ({
      agentId: "bot-2",
      name: "Assistant",
      avatar: "A",
    }));
    const state = makeState({
      client: { request } as unknown as AssistantIdentityState["client"],
    });
    await loadAssistantIdentity(state);
    expect(state.assistantName).toBe("市场助手");
    expect(state.assistantAgentId).toBe("bot-2");
    expect(state.assistantAvatar).toBeNull();
  });

  it("on switch error applies roster name instead of sticking previous DEFAULT", async () => {
    const request = vi.fn(async () => {
      throw new Error("network");
    });
    const state = makeState({
      client: { request } as unknown as AssistantIdentityState["client"],
      assistantName: "Assistant",
      assistantAvatar: "A",
      assistantAgentId: "main",
      sessionKey: "agent:bot-2:main",
    });
    await loadAssistantIdentity(state);
    expect(state.assistantName).toBe("市场助手");
    expect(state.assistantAgentId).toBe("bot-2");
  });
});
