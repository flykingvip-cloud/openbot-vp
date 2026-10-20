import { describe, expect, it } from "vitest";
import { resolveCollaborationSpeakingAgentId } from "./collaboration-speaking-agent.ts";

describe("resolveCollaborationSpeakingAgentId", () => {
  it("returns null outside collaboration spaces", () => {
    expect(
      resolveCollaborationSpeakingAgentId({
        sessionKey: "agent:main:main",
        chatRunId: "run-1",
        chatStream: "hi",
        sending: true,
      }),
    ).toBeNull();
  });

  it("resolves the speaker on agent-scoped group session keys", () => {
    expect(
      resolveCollaborationSpeakingAgentId({
        sessionKey: "agent:main:main:space:grp-demo",
        chatRunId: "run-round",
        chatStream: "你好",
        chatStreamSessionKey: "agent:bot-2:main:space:grp-demo",
      }),
    ).toBe("bot-2");
  });

  it("prefers the child bot session key while streaming", () => {
    expect(
      resolveCollaborationSpeakingAgentId({
        sessionKey: "space:grp-demo",
        chatRunId: "run-round",
        chatStream: "你好",
        chatStreamSessionKey: "agent:bot-2:main:space:grp-demo",
      }),
    ).toBe("bot-2");
  });

  it("parses agent id from collaboration dispatch run ids", () => {
    expect(
      resolveCollaborationSpeakingAgentId({
        sessionKey: "space:grp-demo",
        chatRunId: "0377a6f4-2ec2-4518-9494-2176a061b8ca:primary:bot-2",
        chatStream: "在",
      }),
    ).toBe("bot-2");
  });

  it("falls back to round plan lead while send is in flight", () => {
    expect(
      resolveCollaborationSpeakingAgentId({
        sessionKey: "space:grp-demo",
        chatRunId: "round-1",
        chatStream: null,
        sending: true,
        collaborationRoundPlan: {
          roundId: "round-1",
          sessionKey: "space:grp-demo",
          responseMode: "lead_plus_supplement",
          summaryText: "本轮参与 1 人",
          participants: [
            {
              agentId: "bot-2",
              displayName: "市场助手",
              tier: "duty",
              contributionRole: "lead",
              reasonText: "职责",
            },
          ],
        },
      }),
    ).toBe("bot-2");
  });
});
