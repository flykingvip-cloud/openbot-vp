import { describe, expect, it } from "vitest";
import type { MentionMetadata } from "../../organization/mention-types.js";
import {
  formatComposerPluginMentionTurnPrompt,
  mergeMentionedPluginToolAllowlist,
  parseComposerPluginMentionId,
  resolveComposerPluginMentionBindings,
} from "./composer-plugin-mention-bindings.js";

function pluginMention(pluginId: string, displayName: string): MentionMetadata {
  return {
    mention_id: `m-${pluginId}`,
    displayName,
    offset: 0,
    length: displayName.length + 1,
    target: { kind: "plugin", pluginId },
    targetKind: "plugin",
    targetId: pluginId,
  };
}

describe("parseComposerPluginMentionId", () => {
  it("parses connector provider + identityId", () => {
    expect(parseComposerPluginMentionId("plugin:connector:github-personal:id-github")).toEqual({
      kind: "connector",
      provider: "github-personal",
      identityId: "id-github",
    });
  });

  it("parses OpenBot extension plugin ids", () => {
    expect(parseComposerPluginMentionId("plugin:ext:origin")).toEqual({
      kind: "plugin",
      openBotPluginId: "origin",
    });
  });

  it("treats bare ids as OpenBot plugin ids", () => {
    expect(parseComposerPluginMentionId("optional-demo")).toEqual({
      kind: "plugin",
      openBotPluginId: "optional-demo",
    });
  });
});

describe("resolveComposerPluginMentionBindings", () => {
  it("maps connector + plugin mentions onto allowlist and turn prompt", () => {
    const bindings = resolveComposerPluginMentionBindings([
      pluginMention("plugin:connector:github-personal:id-github", "GitHub"),
      pluginMention("plugin:ext:origin", "Origin"),
      {
        mention_id: "m-human",
        displayName: "Alice",
        offset: 0,
        length: 6,
        target: { kind: "human", userId: "alice" },
        targetKind: "human",
        targetId: "alice",
      },
    ]);

    expect(bindings.connectors).toEqual([
      expect.objectContaining({
        provider: "github-personal",
        identityId: "id-github",
        displayName: "GitHub",
      }),
    ]);
    expect(bindings.plugins).toEqual([
      expect.objectContaining({ openBotPluginId: "origin", displayName: "Origin" }),
    ]);
    expect(bindings.pluginToolAllowlist).toEqual(["origin"]);
    expect(bindings.turnPrompt).toContain("user_operational_identity");
    expect(bindings.turnPrompt).toContain("provider=github-personal");
    expect(bindings.turnPrompt).toContain("pluginId=origin");
  });

  it("ignores non-plugin mentions and dedupes", () => {
    const bindings = resolveComposerPluginMentionBindings([
      pluginMention("plugin:ext:origin", "Origin"),
      pluginMention("plugin:ext:origin", "Origin again"),
      {
        mention_id: "m-bot",
        agentId: "bot-1",
        displayName: "Helper",
        offset: 0,
        length: 7,
        target: { kind: "agent", agentId: "bot-1" },
        targetKind: "agent",
        targetId: "bot-1",
      },
    ]);
    expect(bindings.pluginToolAllowlist).toEqual(["origin"]);
    expect(bindings.connectors).toEqual([]);
  });
});

describe("mergeMentionedPluginToolAllowlist", () => {
  it("appends mentioned plugin ids so optional tools become available", () => {
    expect(mergeMentionedPluginToolAllowlist(["group:fs"], ["origin", "origin"])).toEqual([
      "group:fs",
      "origin",
    ]);
  });
});

describe("formatComposerPluginMentionTurnPrompt", () => {
  it("returns undefined when nothing was mentioned", () => {
    expect(formatComposerPluginMentionTurnPrompt({ connectors: [], plugins: [] })).toBeUndefined();
  });
});
