import { describe, expect, it } from "vitest";
import type { MentionCandidate } from "../../../../../src/organization/mention-types.js";
import { deriveMentionPopupItems } from "./mention-popup.ts";

describe("human mention candidates", () => {
  const candidates: MentionCandidate[] = [
    {
      kind: "human",
      agentId: "",
      userId: "alice",
      displayName: "Alice",
      roleName: "成员",
      online: true,
      isCoordinator: false,
      isBot: false,
    },
    {
      kind: "human",
      agentId: "",
      userId: "self-user",
      displayName: "Me",
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
  ];

  it("includes active humans and bots while excluding the current user", () => {
    const items = deriveMentionPopupItems({
      candidates,
      query: "",
      currentUserId: "self-user",
    });
    const labels = items.map((item) => item.displayName);
    expect(labels).toContain("所有人");
    expect(labels).toContain("Alice");
    expect(labels).toContain("HelperBot");
    expect(labels).not.toContain("Me");
  });
});
