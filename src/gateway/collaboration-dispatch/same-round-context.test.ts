import { describe, expect, test } from "vitest";
import {
  buildSameRoundContext,
  estimateCoverageMapOverlap,
  formatSameRoundContextForPrompt,
  shouldAttemptPrimaryQualityRedo,
  shouldForceNoReplyFromCoverageMap,
} from "./same-round-context.js";

describe("same-round context", () => {
  test("includes only replies already completed, never future turns", () => {
    const first = buildSameRoundContext([
      {
        agentId: "bot-a",
        agentName: "Bot A",
        contributionRole: "lead",
        text: "记忆系统的主特征是分层检索。",
        messageId: "m1",
      },
    ]);
    expect(first?.replies.map((reply) => reply.agentId)).toEqual(["bot-a"]);
    expect(first?.summary).toContain("Bot A");
    expect(first?.summary).not.toContain("Bot B");
    expect(first?.coveredClaims.some((c) => c.includes("分层检索"))).toBe(true);
    expect(first?.evidencePointers).toEqual([
      expect.objectContaining({ agentId: "bot-a", messageId: "m1", claimIndex: 0 }),
    ]);

    const afterSecond = buildSameRoundContext([
      {
        agentId: "bot-a",
        agentName: "Bot A",
        contributionRole: "lead",
        text: "记忆系统的主特征是分层检索。",
      },
      {
        agentId: "bot-b",
        agentName: "Bot B",
        contributionRole: "supplement",
        text: "补充：还需要租户隔离边界。",
      },
    ]);
    expect(afterSecond?.replies.map((reply) => reply.agentId)).toEqual(["bot-a", "bot-b"]);
  });

  test("empty prior replies produce no same-round context", () => {
    expect(buildSameRoundContext([])).toBeUndefined();
  });

  test("coverage gate forces NO_REPLY on high claim overlap for supplements", () => {
    const ctx = buildSameRoundContext([
      {
        agentId: "bot-a",
        agentName: "Bot A",
        contributionRole: "lead",
        text: "记忆系统的主特征是分层检索与租户隔离。",
      },
    ])!;
    const candidate = "记忆系统的主特征是分层检索与租户隔离。";
    expect(
      estimateCoverageMapOverlap({ candidateText: candidate, sameRoundContext: ctx }),
    ).toBeGreaterThanOrEqual(0.55);
    expect(
      shouldForceNoReplyFromCoverageMap({
        candidateText: candidate,
        contributionRole: "supplement",
        sameRoundContext: ctx,
      }),
    ).toBe(true);
    expect(
      shouldForceNoReplyFromCoverageMap({
        candidateText: "另外可以补充向量召回的评测指标口径。",
        contributionRole: "supplement",
        sameRoundContext: ctx,
      }),
    ).toBe(false);
  });

  test("challenge without conflict is forced NO_REPLY when overlapping; with conflict allowed", () => {
    const base = buildSameRoundContext([
      {
        agentId: "bot-a",
        agentName: "Bot A",
        contributionRole: "lead",
        text: "记忆系统的主特征是分层检索与租户隔离。",
      },
    ])!;
    expect(base.conflicts).toEqual([]);
    expect(
      shouldForceNoReplyFromCoverageMap({
        candidateText: "记忆系统的主特征是分层检索与租户隔离。",
        contributionRole: "challenge",
        sameRoundContext: base,
      }),
    ).toBe(true);

    const withConflict = buildSameRoundContext([
      {
        agentId: "bot-a",
        agentName: "Bot A",
        contributionRole: "lead",
        text: "记忆系统的主特征是分层检索与租户隔离。",
      },
      {
        agentId: "bot-c",
        agentName: "Bot C",
        contributionRole: "challenge",
        text: "不对，主特征应是端到端延迟而不是分层检索。",
      },
    ])!;
    expect(withConflict.conflicts.length).toBeGreaterThan(0);
    expect(
      shouldForceNoReplyFromCoverageMap({
        candidateText: "继续质疑：分层检索并非主特征。",
        contributionRole: "challenge",
        sameRoundContext: withConflict,
      }),
    ).toBe(false);
  });

  test("prompt formatter consumes coveredClaims / conflicts / evidencePointers", () => {
    const ctx = buildSameRoundContext([
      {
        agentId: "bot-a",
        agentName: "Bot A",
        contributionRole: "lead",
        text: "记忆系统的主特征是分层检索。",
        messageId: "mid-1",
      },
    ])!;
    const text = formatSameRoundContextForPrompt(ctx);
    expect(text).toContain("coveredClaims");
    expect(text).toContain("evidencePointers");
    expect(text).toContain("bot-a#mid-1");
    expect(text).toContain("NO_REPLY");
  });

  test("primary quality redo stub stays off", () => {
    expect(shouldAttemptPrimaryQualityRedo({ primaryText: "bad", enabled: true })).toBe(false);
    expect(shouldAttemptPrimaryQualityRedo({ enabled: false })).toBe(false);
  });
});
