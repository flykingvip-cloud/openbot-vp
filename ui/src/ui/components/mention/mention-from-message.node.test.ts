import { describe, expect, it } from "vitest";
import { normalizeMentionMetadata } from "../../../../../src/organization/mention-target.js";
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
  {
    kind: "plugin",
    agentId: "plugin:ext:origin",
    displayName: "Origin",
    roleName: "插件",
    online: true,
    isCoordinator: false,
    isBot: false,
  },
];

describe("buildMentionsFromMessage plugin targets", () => {
  it("extracts MCP/plugin @ picks as plugin targets, not agent or human", () => {
    const mentions = buildMentionsFromMessage("请用 @GitHub 和 @Origin", candidates, {
      createMentionId: (() => {
        let n = 0;
        return () => `m-${++n}`;
      })(),
    });
    expect(mentions).toHaveLength(2);
    expect(mentions[0]).toMatchObject({
      displayName: "GitHub",
      targetKind: "plugin",
      target: { kind: "plugin", pluginId: "plugin:connector:github-personal:id-github" },
    });
    expect(mentions[1]).toMatchObject({
      displayName: "Origin",
      targetKind: "plugin",
      target: { kind: "plugin", pluginId: "plugin:ext:origin" },
    });
    for (const mention of mentions) {
      expect(mention.agentId).toBeUndefined();
      expect(mention.target?.kind).toBe("plugin");
      const normalized = normalizeMentionMetadata(mention);
      expect(normalized.targetKind).toBe("plugin");
      expect(normalized.agentId).toBeUndefined();
    }
  });

  it("keeps human and agent mentions distinguishable from plugins", () => {
    const mentions = buildMentionsFromMessage("@Alice @HelperBot @GitHub", candidates, {
      createMentionId: (() => {
        let n = 0;
        return () => `m-${++n}`;
      })(),
    });
    expect(mentions.map((m) => m.targetKind)).toEqual(["human", "agent", "plugin"]);
    expect(mentions.map((m) => m.target?.kind)).toEqual(["human", "agent", "plugin"]);
  });
});
