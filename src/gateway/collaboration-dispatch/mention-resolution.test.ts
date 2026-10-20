import { describe, expect, test } from "vitest";
import { resolveMentionResolution } from "./mention-resolution.js";
import type { CollaborationBotTarget } from "./types.js";

const bots: CollaborationBotTarget[] = [
  { agentId: "bot-a", name: "市场助手", sessionKey: "agent:bot-a:main", updatedAt: 1 },
  { agentId: "bot-b", name: "数据助手", sessionKey: "agent:bot-b:main", updatedAt: 2 },
];

describe("mention resolution", () => {
  test("no at-mention is none/single", () => {
    const resolution = resolveMentionResolution({
      message: "分析一下市场",
      bots,
    });
    expect(resolution.mode).toBe("none");
    expect(resolution.primaryMode).toBe("single");
    expect(resolution.unmatched).toBe(false);
  });

  test("single mention is single_primary", () => {
    const resolution = resolveMentionResolution({
      message: "@市场助手 分析一下",
      bots,
    });
    expect(resolution.mode).toBe("single_primary");
    expect(resolution.primaryMode).toBe("single");
    expect(resolution.matchedAgentIds).toEqual(["bot-a"]);
  });

  test("two mentions are explicit_multi in mention order", () => {
    const resolution = resolveMentionResolution({
      message: "@市场助手 @数据助手 分别分析",
      bots,
    });
    expect(resolution.mode).toBe("explicit_multi");
    expect(resolution.primaryMode).toBe("explicit_multi");
    expect(resolution.matchedAgentIds).toEqual(["bot-a", "bot-b"]);
  });

  test("unknown mention is unmatched and does not pick a bot", () => {
    const resolution = resolveMentionResolution({
      message: "@不存在的机器人 你好",
      bots,
    });
    expect(resolution.unmatched).toBe(true);
    expect(resolution.matchedBots).toEqual([]);
    expect(resolution.unmatchedTokens.length).toBeGreaterThan(0);
  });

  test("broadcast tokens are not unmatched and do not pick a bot", () => {
    const resolution = resolveMentionResolution({
      message: "@所有人看一下",
      bots,
    });
    expect(resolution.unmatched).toBe(false);
    expect(resolution.matchedBots).toEqual([]);
    expect(resolution.unmatchedTokens).toEqual([]);
    expect(resolution.mode).toBe("none");
  });

  test("human handle and email match without selecting a bot", () => {
    const humans = [
      {
        userId: "user-1",
        name: "王军",
        handle: "wangjun",
        email: "hrqb@163.com",
      },
    ];
    const byHandle = resolveMentionResolution({
      message: "@wangjun 你来拍板",
      bots,
      humans,
    });
    expect(byHandle.unmatched).toBe(false);
    expect(byHandle.matchedBots).toEqual([]);
    expect(byHandle.unmatchedTokens).toEqual([]);

    const byEmail = resolveMentionResolution({
      message: "请拍板",
      explicitMentions: ["hrqb@163.com"],
      bots,
      humans,
    });
    expect(byEmail.unmatched).toBe(false);
    expect(byEmail.matchedBots).toEqual([]);
  });

  test("owner alias remains unmatched", () => {
    const resolution = resolveMentionResolution({
      message: "@所有者 每个人做一份总结",
      bots,
    });
    expect(resolution.unmatched).toBe(true);
    expect(resolution.unmatchedTokens).toContain("所有者");
  });

  test("structured __all__ broadcast token is not unmatched", () => {
    const resolution = resolveMentionResolution({
      message: "请看",
      explicitMentions: ["__all__"],
      bots,
    });
    expect(resolution.unmatched).toBe(false);
    expect(resolution.matchedBots).toEqual([]);
    expect(resolution.unmatchedTokens).toEqual([]);
  });

  test("partial multi-mention records matched bots and unmatched tokens together", () => {
    const resolution = resolveMentionResolution({
      message: "@市场助手 @ghost-bot 请协作",
      bots,
    });
    expect(resolution.unmatched).toBe(true);
    expect(resolution.matchedAgentIds).toEqual(["bot-a"]);
    expect(resolution.unmatchedTokens).toContain("ghost-bot");
  });

  test("human plus bot mention selects only the bot", () => {
    const humans = [{ userId: "user-1", name: "王军", handle: "wangjun" }];
    const resolution = resolveMentionResolution({
      message: "@wangjun @市场助手 请分工",
      bots,
      humans,
    });
    expect(resolution.unmatched).toBe(false);
    expect(resolution.matchedAgentIds).toEqual(["bot-a"]);
    expect(resolution.mode).toBe("single_primary");
  });

  test("explicit @ chip keeps its agent and ignores the random mention id", () => {
    const denseBots: CollaborationBotTarget[] = [
      {
        agentId: "bot--gaomidu",
        name: "高密度分析",
        sessionKey: "agent:bot--gaomidu:main",
        updatedAt: 1,
      },
      { agentId: "bot-b", name: "数据助手", sessionKey: "agent:bot-b:main", updatedAt: 2 },
    ];
    const mentionId = "6f1c0c3e-6a1a-4b1e-9c2d-0a0b1c2d3e4f";
    const resolution = resolveMentionResolution({
      message: "@高密度分析 请分析",
      explicitMentions: ["高密度分析", mentionId, "bot--gaomidu"],
      explicitMentionRefs: [
        {
          mentionId,
          agentId: "bot--gaomidu",
          displayName: "高密度分析",
          targetKind: "agent",
          targetId: "bot--gaomidu",
        },
      ],
      bots: denseBots,
    });
    expect(resolution.unmatched).toBe(false);
    expect(resolution.confirm).toBeNull();
    expect(resolution.matchedAgentIds).toEqual(["bot--gaomidu"]);
    expect(resolution.mode).toBe("single_primary");
  });

  test("chip display name still selects the robot when agentId is only a mention uuid", () => {
    const denseBots: CollaborationBotTarget[] = [
      {
        agentId: "bot--gaomidu",
        name: "高密度分析",
        sessionKey: "agent:bot--gaomidu:main",
        updatedAt: 1,
      },
      { agentId: "bot-b", name: "数据助手", sessionKey: "agent:bot-b:main", updatedAt: 2 },
    ];
    const mentionId = "6f1c0c3e-6a1a-4b1e-9c2d-0a0b1c2d3e4f";
    const resolution = resolveMentionResolution({
      message: "@高密度分析 请分析",
      explicitMentions: ["高密度分析", mentionId],
      explicitMentionRefs: [
        {
          mentionId,
          agentId: mentionId,
          displayName: "高密度分析",
        },
      ],
      bots: denseBots,
    });
    expect(resolution.unmatched).toBe(false);
    expect(resolution.confirm).toBeNull();
    expect(resolution.matchedAgentIds).toEqual(["bot--gaomidu"]);
  });

  test("spoken robot name selects that robot without asking", () => {
    const resolution = resolveMentionResolution({
      message: "请市场助手看一下",
      bots,
    });
    expect(resolution.unmatched).toBe(false);
    expect(resolution.confirm).toBeNull();
    expect(resolution.matchedAgentIds).toEqual(["bot-a"]);
    expect(resolution.mode).toBe("single_primary");
  });

  test("slightly wrong name asks to confirm and does not unmatched-stop", () => {
    const typo = resolveMentionResolution({
      message: "@市场助首 看一下",
      bots,
    });
    expect(typo.unmatched).toBe(false);
    expect(typo.matchedBots).toEqual([]);
    expect(typo.confirm?.ambiguous).toBe(false);
    expect(typo.confirm?.candidates.map((candidate) => candidate.agentId)).toEqual(["bot-a"]);
    expect(typo.confirm?.question).toContain("市场助手");

    const spoken = resolveMentionResolution({
      message: "市场助首",
      bots,
    });
    expect(spoken.unmatched).toBe(false);
    expect(spoken.confirm?.candidates.map((candidate) => candidate.agentId)).toEqual(["bot-a"]);
  });
});
