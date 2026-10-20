import { describe, expect, it } from "vitest";
import { buildComposerMentionCandidates } from "./build-mention-candidates.ts";
import { buildMentionsFromMessage } from "./mention-from-message.ts";
import { buildMentionInsertion, resolveComposerMentionInsertToken } from "./mention-insert.ts";
import { deriveMentionPopupItems } from "./mention-popup.ts";

const directory = {
  humans: [
    {
      user: "wang@example.com",
      userId: "user-wang",
      displayName: "王军",
      status: "active" as const,
    },
    { user: "li@example.com", userId: "user-li", displayName: "李敏", status: "active" as const },
    {
      user: "gone@example.com",
      userId: "user-gone",
      displayName: "停用",
      status: "suspended" as const,
    },
    {
      user: "agent:bot:main",
      userId: "agent:bot:main",
      displayName: "agent:bot:main",
      status: "active" as const,
    },
  ],
  robots: [
    { agentId: "bot-wang", displayName: "王助理", ownerUserId: "user-me" },
    { agentId: "bot-market", displayName: "市场助手", ownerUserId: "user-li" },
    { agentId: "main", displayName: "大白管家", ownerUserId: "user-me" },
  ],
  ownedAgentIds: ["bot-wang"],
  actorIdentities: ["user-me", "me@example.com"],
};

describe("composer @ mention match", () => {
  it("matches a partial name to enterprise humans and the user's own robots only", () => {
    const candidates = buildComposerMentionCandidates(directory);
    const items = deriveMentionPopupItems({ candidates, query: "王" }).filter(
      (item) => item.type === "candidate",
    );
    expect(items.map((item) => item.displayName).toSorted()).toEqual(["王军", "王助理"]);
    expect(items.find((item) => item.displayName === "王军")).toMatchObject({
      kind: "human",
      userId: "user-wang",
      isBot: false,
      roleName: "同事",
    });
    expect(items.find((item) => item.displayName === "王助理")).toMatchObject({
      kind: "agent",
      agentId: "bot-wang",
      isBot: true,
      roleName: "我的机器人",
    });
    expect(items.map((item) => item.displayName)).not.toContain("市场助手");
    expect(items.map((item) => item.displayName)).not.toContain("李敏");
    expect(candidates.map((candidate) => candidate.displayName)).not.toContain("停用");
    expect(candidates.map((candidate) => candidate.displayName)).not.toContain("agent:bot:main");
    expect(candidates.map((candidate) => candidate.displayName)).not.toContain("大白管家");
  });

  it("inserts a stable mention that send can resolve to that exact person", () => {
    const candidates = buildComposerMentionCandidates(directory);
    const human = candidates.find((candidate) => candidate.userId === "user-wang");
    expect(human).toBeTruthy();
    const token = resolveComposerMentionInsertToken(human!, candidates);
    expect(token).toBe("王军");
    const inserted = buildMentionInsertion({
      value: "@王",
      triggerOffset: 0,
      cursor: 2,
      displayName: token,
    });
    expect(inserted.next).toBe("@王军 ");
    const mentions = buildMentionsFromMessage(inserted.next, candidates, {
      createMentionId: () => "m-wang",
    });
    expect(mentions).toEqual([
      expect.objectContaining({
        displayName: "王军",
        targetKind: "human",
        targetId: "user-wang",
        target: { kind: "human", userId: "user-wang" },
      }),
    ]);

    const robot = candidates.find((candidate) => candidate.agentId === "bot-wang");
    const robotMentions = buildMentionsFromMessage("@bot-wang 看一下", candidates, {
      createMentionId: () => "m-bot",
    });
    expect(robotMentions[0]).toMatchObject({
      agentId: "bot-wang",
      displayName: robot?.displayName,
      target: { kind: "agent", agentId: "bot-wang" },
    });
  });

  it("uses the user id when two colleagues share a display name", () => {
    const candidates = buildComposerMentionCandidates({
      humans: [
        { user: "a@example.com", userId: "user-a", displayName: "王军", status: "active" },
        { user: "b@example.com", userId: "user-b", displayName: "王军", status: "active" },
      ],
      robots: [],
      ownedAgentIds: [],
      actorIdentities: ["user-me"],
    });
    const selected = candidates.find((candidate) => candidate.userId === "user-b");
    expect(resolveComposerMentionInsertToken(selected!, candidates)).toBe("user-b");
    const mentions = buildMentionsFromMessage("@user-b 你好", candidates, {
      createMentionId: () => "m-b",
    });
    expect(mentions).toHaveLength(1);
    expect(mentions[0]?.targetId).toBe("user-b");
  });
});
