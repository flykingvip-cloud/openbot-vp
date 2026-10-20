import { describe, expect, it } from "vitest";
import type { MentionCandidate } from "../../../../../src/organization/mention-types.js";
import { FuzzyMatcher, isSubsequenceMatch, match } from "./fuzzy-matcher.js";

function candidate(overrides: Partial<MentionCandidate>): MentionCandidate {
  return {
    agentId: overrides.agentId ?? "agent-a",
    displayName: overrides.displayName ?? "Agent A",
    roleName: overrides.roleName,
    online: overrides.online ?? true,
    isCoordinator: overrides.isCoordinator ?? false,
    isBot: overrides.isBot ?? true,
    collaborationFrequency: overrides.collaborationFrequency,
    projectParticipation: overrides.projectParticipation,
    capabilityTags: overrides.capabilityTags,
    currentTask: overrides.currentTask,
  };
}

describe("FuzzyMatcher", () => {
  it("returns all candidates for empty queries with online candidates first", () => {
    const results = match(
      [
        candidate({ agentId: "offline", displayName: "Alice", online: false }),
        candidate({ agentId: "online", displayName: "Bob", online: true }),
      ],
      "",
    );

    expect(results.map((result) => result.candidate.agentId)).toEqual(["online", "offline"]);
  });

  it("ranks prefix matches before substring and subsequence matches", () => {
    const results = match(
      [
        candidate({ agentId: "substring", displayName: "The Agent" }),
        candidate({ agentId: "subsequence", displayName: "A long editor" }),
        candidate({ agentId: "prefix", displayName: "Agent Smith" }),
      ],
      "age",
    );

    expect(results.map((result) => [result.candidate.agentId, result.matchType])).toEqual([
      ["prefix", "prefix"],
      ["substring", "substring"],
      ["subsequence", "subsequence"],
    ]);
  });

  it("matches displayName, roleName, agentId, capability tags, and current task fields", () => {
    const results = match(
      [
        candidate({ agentId: "writer-bot", displayName: "Nova", roleName: "内容运营" }),
        candidate({ agentId: "qa-reviewer", displayName: "Echo" }),
      ],
      "review",
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      matchedField: "agentId",
      candidate: { agentId: "qa-reviewer" },
    });

    const roleResults = match(
      [candidate({ agentId: "ops", displayName: "Nova", roleName: "Content Operator" })],
      "operator",
    );
    expect(roleResults[0]?.matchedField).toBe("roleName");

    const tagResults = match(
      [
        candidate({
          agentId: "ledger-bot",
          displayName: "Ledger",
          capabilityTags: ["发票", "Finance"],
        }),
      ],
      "finance",
    );
    expect(tagResults[0]?.matchedField).toBe("capabilityTags");

    const taskResults = match(
      [
        candidate({
          agentId: "handoff-bot",
          displayName: "Relay",
          currentTask: "handoff incident follow-up",
        }),
      ],
      "incident",
    );
    expect(taskResults[0]?.matchedField).toBe("currentTask");
  });

  it("performs case-insensitive Latin matching", () => {
    expect(match([candidate({ agentId: "agent-a", displayName: "Alice" })], "ali")).toHaveLength(1);
    expect(match([candidate({ agentId: "agent-a", displayName: "Alice" })], "ALI")).toHaveLength(1);
  });

  it("supports subsequence checks", () => {
    expect(isSubsequenceMatch("Agent Smith", "asm")).toBe(true);
    expect(isSubsequenceMatch("Agent Smith", "zz")).toBe(false);
  });

  it("supports common Chinese pinyin and initial matching", () => {
    const results = FuzzyMatcher.match(
      [
        candidate({ agentId: "zhang-admin", displayName: "张管理员" }),
        candidate({ agentId: "li-admin", displayName: "李管理员" }),
      ],
      "zgly",
    );

    expect(results[0]?.candidate.agentId).toBe("zhang-admin");
    expect(results[0]?.matchType).toBe("prefix");
  });

  it("breaks tied scores by collaboration signals, online status, and display name", () => {
    const results = match(
      [
        candidate({
          agentId: "low-signal",
          displayName: "Ava",
          online: true,
          collaborationFrequency: 0,
        }),
        candidate({
          agentId: "high-collab",
          displayName: "Abe",
          online: false,
          collaborationFrequency: 10,
        }),
        candidate({
          agentId: "high-project",
          displayName: "Ada",
          online: true,
          collaborationFrequency: 5,
          projectParticipation: 8,
        }),
        candidate({
          agentId: "online",
          displayName: "Ada",
          online: true,
          collaborationFrequency: 5,
          projectParticipation: 1,
        }),
        candidate({
          agentId: "offline",
          displayName: "Aaa",
          online: false,
          collaborationFrequency: 5,
          projectParticipation: 1,
        }),
      ],
      "a",
    );

    expect(results.map((result) => result.candidate.agentId)).toEqual([
      "high-collab",
      "high-project",
      "online",
      "offline",
      "low-signal",
    ]);
  });
});
