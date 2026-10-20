import { describe, expect, it } from "vitest";
import type { MentionChipData } from "../../../../../src/organization/mention-types.js";
import {
  parseInternalAnchors,
  serializeMentions,
  toInternalAnchors,
  type MentionSerializablePart,
} from "./mention-serializer.js";

function chip(overrides: Partial<MentionChipData> = {}): MentionChipData {
  return {
    mention_id: overrides.mention_id ?? "chip-id",
    agentId: overrides.agentId ?? "agent-a",
    displayName: overrides.displayName ?? "Agent A",
    isAll: overrides.isAll ?? false,
  };
}

function idSequence(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `id-${index}`;
}

describe("mention serializer", () => {
  it("serializes mixed text and chips into plain text and metadata offsets", () => {
    const result = serializeMentions(
      [
        "Hi ",
        chip({ agentId: "agent-a", displayName: "Agent A" }),
        " and ",
        chip({ agentId: "__all__", displayName: "所有人", isAll: true }),
      ],
      { createMentionId: idSequence("mention-1", "mention-2") },
    );

    expect(result.text).toBe("Hi @Agent A and @所有人");
    expect(result.mentions).toMatchObject([
      {
        mention_id: "mention-1",
        agentId: "agent-a",
        displayName: "Agent A",
        offset: 3,
        length: 8,
        target: { kind: "agent", agentId: "agent-a" },
      },
      {
        mention_id: "mention-2",
        agentId: "__all__",
        displayName: "所有人",
        offset: 16,
        length: 4,
        target: { kind: "all" },
      },
    ]);
  });

  it("gives repeated mentions of the same member independent ids and offsets", () => {
    const repeatedChip = chip({ agentId: "agent-a", displayName: "Agent A" });
    const result = serializeMentions([repeatedChip, " then ", repeatedChip], {
      createMentionId: idSequence("mention-a", "mention-b"),
    });

    expect(result.text).toBe("@Agent A then @Agent A");
    expect(result.mentions.map((mention) => mention.mention_id)).toEqual([
      "mention-a",
      "mention-b",
    ]);
    expect(result.mentions.map((mention) => mention.offset)).toEqual([0, 14]);
  });

  it("can serialize a message made only of mention chips", () => {
    const result = serializeMentions(
      [
        { type: "mention", chip: chip({ agentId: "agent-a", displayName: "Agent A" }) },
        { type: "mention", chip: chip({ agentId: "agent-b", displayName: "Agent B" }) },
      ],
      { createMentionId: idSequence("mention-a", "mention-b") },
    );

    expect(result.text).toBe("@Agent A@Agent B");
    expect(result.mentions.map((mention) => mention.offset)).toEqual([0, 8]);
  });

  it("supports explicit text segment objects", () => {
    const parts: MentionSerializablePart[] = [
      { type: "text", text: "请看 " },
      { type: "mention", chip: chip({ displayName: "张管理员" }) },
    ];

    expect(serializeMentions(parts, { createMentionId: idSequence("mention-1") })).toMatchObject({
      text: "请看 @张管理员",
      mentions: [{ offset: 3, length: 5 }],
    });
  });

  it("converts mixed content into escaped internal anchors", () => {
    const result = toInternalAnchors(
      ["Use <this> & ", chip({ agentId: "agent-a", displayName: "A&B" }), " safely"],
      { createMentionId: idSequence("mention-1") },
    );

    expect(result.value).toBe(
      'Use &lt;this&gt; &amp; <mention id="mention-1">@A&amp;B</mention> safely',
    );
    expect(result.text).toBe("Use <this> & @A&B safely");
    expect(result.mentions[0]).toMatchObject({
      mention_id: "mention-1",
      agentId: "agent-a",
      displayName: "A&B",
      offset: 13,
      length: 4,
    });
  });

  it("parses internal anchors back into plain text and metadata", () => {
    const result = parseInternalAnchors(
      'Hi <mention id="mention-1">@Agent A</mention> and <mention id="mention-2">@所有人</mention>',
      {
        resolveAgentId(anchor) {
          return anchor.mention_id === "mention-2" ? "__all__" : "agent-a";
        },
      },
    );

    expect(result.text).toBe("Hi @Agent A and @所有人");
    expect(result.mentions).toEqual([
      {
        mention_id: "mention-1",
        agentId: "agent-a",
        displayName: "Agent A",
        offset: 3,
        length: 8,
      },
      {
        mention_id: "mention-2",
        agentId: "__all__",
        displayName: "所有人",
        offset: 16,
        length: 4,
      },
    ]);
  });

  it("round trips anchor serialization with stable ids when requested", () => {
    const parts = [
      "Ping ",
      chip({
        mention_id: "existing-1",
        agentId: "agent-a",
        displayName: "Agent A",
      }),
    ];
    const anchored = toInternalAnchors(parts, { reuseExistingMentionIds: true });
    const parsed = parseInternalAnchors(anchored.value, {
      resolveAgentId: () => "agent-a",
    });

    expect(parsed).toEqual({
      text: anchored.text,
      mentions: anchored.mentions,
    });
  });

  it("uses the mention id as a safe default agent id when no resolver is provided", () => {
    expect(
      parseInternalAnchors('<mention id="mention-1">@Agent A</mention>').mentions[0],
    ).toMatchObject({
      mention_id: "mention-1",
      agentId: "mention-1",
    });
  });
});
