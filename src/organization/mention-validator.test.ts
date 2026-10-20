import { describe, expect, it } from "vitest";
import type { MentionMetadata } from "./mention-types.js";
import { validateMentions } from "./mention-validator.js";
import type { RuntimeOrganizationContext } from "./runtime.js";

function createContext(): RuntimeOrganizationContext {
  return {
    organization: { id: "upbeyond", name: "UPBEYOND" },
    self: {
      agentId: "agent-a",
      displayName: "Agent A",
      organizationId: "upbeyond",
      permissions: [],
      reachableAgents: [],
      identitySource: "fallback",
      capabilities: [],
    },
    members: [
      { agentId: "agent-a", displayName: "Agent A" },
      { agentId: "agent-b", displayName: "Agent B" },
    ],
    humans: [
      { userId: "alice", displayName: "Alice", status: "active" },
      { userId: "invited-user", displayName: "Invited", status: "invited" },
      { userId: "removed-user", displayName: "Removed", status: "removed" },
    ],
  };
}

function mention(overrides: Partial<MentionMetadata> = {}): MentionMetadata {
  return {
    mention_id: "mention-1",
    agentId: "agent-b",
    displayName: "Agent B",
    offset: 6,
    length: 8,
    ...overrides,
  };
}

describe("mention validator", () => {
  it("accepts valid direct and broadcast mentions", () => {
    const message = "hello @Agent B and @所有人";
    const result = validateMentions(
      [
        mention(),
        mention({
          mention_id: "mention-2",
          agentId: "__all__",
          displayName: "所有人",
          offset: 19,
          length: 4,
        }),
      ],
      message,
      createContext(),
    );

    expect(result.invalid).toEqual([]);
    expect(result.valid.map((item) => item.agentId)).toEqual(["agent-b", "__all__"]);
  });

  it("rejects malformed mention entries without throwing", () => {
    const result = validateMentions(
      [{ mention_id: "mention-1", agentId: "agent-b" }],
      "hello @Agent B",
      createContext(),
    );

    expect(result.valid).toEqual([]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.reason).toContain("MentionMetadata schema");
  });

  it("rejects non-array mention payloads", () => {
    const result = validateMentions("not-an-array", "hello", createContext());

    expect(result.valid).toEqual([]);
    expect(result.invalid).toEqual([
      {
        mention: "not-an-array",
        reason: "Mentions payload must be an array",
      },
    ]);
  });

  it("rejects duplicate mention ids", () => {
    const result = validateMentions(
      [mention(), mention({ offset: 18 })],
      "hello @Agent B hi @Agent B",
      createContext(),
    );

    expect(result.valid).toEqual([]);
    expect(result.invalid).toHaveLength(2);
    expect(result.invalid.every((item) => item.reason.includes("Duplicate mention_id"))).toBe(true);
  });

  it("rejects out-of-bounds offsets", () => {
    const result = validateMentions([mention({ offset: 99 })], "hello @Agent B", createContext());

    expect(result.valid).toEqual([]);
    expect(result.invalid[0]?.reason).toContain("exceeds message length");
  });

  it("marks unknown agents invalid so delivery can skip them", () => {
    const result = validateMentions(
      [mention({ agentId: "missing-agent" })],
      "hello @Agent B",
      createContext(),
    );

    expect(result.valid).toEqual([]);
    expect(result.invalid[0]).toMatchObject({
      mention: expect.objectContaining({ agentId: "missing-agent" }),
      reason: expect.stringContaining("not found in organization members"),
    });
  });

  it("requires offsets to point at the mention display text", () => {
    const result = validateMentions([mention({ offset: 0 })], "hello @Agent B", createContext());

    expect(result.valid).toEqual([]);
    expect(result.invalid[0]?.reason).toContain('does not match "@Agent B"');
  });

  it("accepts active human targets without requiring agentId", () => {
    const message = "ping @Alice";
    const result = validateMentions(
      [
        {
          mention_id: "mention-human",
          displayName: "Alice",
          offset: 5,
          length: 6,
          target: { kind: "human", userId: "alice" },
        },
      ],
      message,
      createContext(),
    );
    expect(result.invalid).toEqual([]);
    expect(result.valid[0]?.target).toEqual({ kind: "human", userId: "alice" });
    expect(result.valid[0]?.agentId).toBeUndefined();
  });

  it("rejects invited and non-member humans", () => {
    const invited = validateMentions(
      [
        {
          mention_id: "m-invited",
          displayName: "Invited",
          offset: 0,
          length: 8,
          target: { kind: "human", userId: "invited-user" },
        },
      ],
      "@Invited",
      createContext(),
    );
    expect(invited.valid).toEqual([]);
    expect(invited.invalid[0]?.reason).toContain("not an active group member");

    const outsider = validateMentions(
      [
        {
          mention_id: "m-out",
          displayName: "Outsider",
          offset: 0,
          length: 9,
          target: { kind: "human", userId: "outsider" },
        },
      ],
      "@Outsider",
      createContext(),
    );
    expect(outsider.valid).toEqual([]);
    expect(outsider.invalid[0]?.reason).toContain("not found in collaboration group roster");
  });

  it("keeps accepting legacy agentId payloads", () => {
    const result = validateMentions([mention()], "hello @Agent B", createContext());
    expect(result.invalid).toEqual([]);
    expect(result.valid[0]?.target).toEqual({ kind: "agent", agentId: "agent-b" });
  });

  it("accepts plugin MCP connector mentions without requiring org membership", () => {
    const message = "请用 @GitHub 开 issue";
    const result = validateMentions(
      [
        {
          mention_id: "mention-plugin",
          displayName: "GitHub",
          offset: 3,
          length: 7,
          target: { kind: "plugin", pluginId: "plugin:connector:github-personal:id-github" },
          targetKind: "plugin",
          targetId: "plugin:connector:github-personal:id-github",
        },
      ],
      message,
      createContext(),
    );
    expect(result.invalid).toEqual([]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0]).toMatchObject({
      targetKind: "plugin",
      target: { kind: "plugin", pluginId: "plugin:connector:github-personal:id-github" },
    });
    expect(result.valid[0]?.agentId).toBeUndefined();
  });
});
