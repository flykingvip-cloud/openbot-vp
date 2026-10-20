import { describe, expect, it } from "vitest";
import type { MentionCandidate } from "../../../../../src/organization/mention-types.js";
import { buildMentionsFromMessage } from "./mention-from-message.ts";

const candidates: MentionCandidate[] = [
  {
    kind: "human",
    agentId: "",
    userId: "alice",
    displayName: "Alice",
    online: true,
    isCoordinator: false,
    isBot: false,
  },
  {
    kind: "agent",
    agentId: "bot-1",
    displayName: "HelperBot",
    online: true,
    isCoordinator: false,
    isBot: true,
  },
  {
    kind: "plugin",
    agentId: "plugin:connector:github-personal:id-github",
    displayName: "GitHub",
    roleName: "已连接",
    online: true,
    isCoordinator: false,
    isBot: false,
  },
];

describe("buildMentionsFromMessage", () => {
  it("builds human target metadata without inventing agentId", () => {
    const mentions = buildMentionsFromMessage("Hey @Alice please join", candidates, {
      createMentionId: () => "m-human",
    });
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({
      mention_id: "m-human",
      displayName: "Alice",
      target: { kind: "human", userId: "alice" },
      targetKind: "human",
      targetId: "alice",
    });
    expect(mentions[0]?.agentId).toBeUndefined();
  });

  it("builds agent target metadata for bots", () => {
    const mentions = buildMentionsFromMessage("@HelperBot go", candidates, {
      createMentionId: () => "m-bot",
    });
    expect(mentions[0]).toMatchObject({
      target: { kind: "agent", agentId: "bot-1" },
      agentId: "bot-1",
    });
  });

  it("builds plugin target metadata for MCP connectors and plugins", () => {
    const mentions = buildMentionsFromMessage("请用 @GitHub 开个 issue", candidates, {
      createMentionId: () => "m-plugin",
    });
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({
      mention_id: "m-plugin",
      displayName: "GitHub",
      target: { kind: "plugin", pluginId: "plugin:connector:github-personal:id-github" },
      targetKind: "plugin",
      targetId: "plugin:connector:github-personal:id-github",
    });
    expect(mentions[0]?.agentId).toBeUndefined();
    expect(mentions[0]?.target?.kind).not.toBe("agent");
    expect(mentions[0]?.target?.kind).not.toBe("human");
  });
});
