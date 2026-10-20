import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { MentionMetadata } from "../../organization/mention-types.js";
import {
  decideParticipantsForTest,
  executeCollaborationRoundForTest,
} from "./__fixtures__/runtime-authority-test-utils.js";
import { resolveExplicitMentionTokens } from "./explicit-mention-tokens.js";
import { DEFAULT_COLLABORATION_POLICY } from "./policy.js";
import type { CollaborationBotTarget, CollaborationDispatchScope } from "./types.js";

const analyst: CollaborationBotTarget = {
  agentId: "bot--agent",
  name: "高密度分析",
  sessionKey: "agent:bot--agent:main:space:grp-daniel-hhd-gmail-com-upbeyond",
  updatedAt: 1,
};

function createScope(): CollaborationDispatchScope {
  return {
    groupId: "grp-daniel-hhd-gmail-com-upbeyond",
    rawSessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
    title: "数字人战队",
    bots: [analyst],
    members: {
      humans: [],
      bots: [{ agentId: analyst.agentId, name: analyst.name, status: "active" }],
    },
  };
}

function policyWithoutExtraTurns() {
  return {
    ...DEFAULT_COLLABORATION_POLICY,
    supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: false },
    coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
  };
}

function agentMention(params: {
  mentionId: string;
  displayName: string;
  agentId?: string;
}): MentionMetadata {
  const mentionText = `@${params.displayName}`;
  return {
    mention_id: params.mentionId,
    ...(params.agentId
      ? {
          agentId: params.agentId,
          target: { kind: "agent" as const, agentId: params.agentId },
          targetKind: "agent" as const,
          targetId: params.agentId,
        }
      : {}),
    displayName: params.displayName,
    offset: 0,
    length: mentionText.length,
  };
}

describe("structured mention_id is not a collaboration match token", () => {
  test("random mention_id plus a matching displayName does not abort; an unknown name still does", async () => {
    const uuidMentionId = randomUUID();
    const counterMentionId = `mention-${Date.now().toString(36)}-1`;
    const scope = createScope();

    for (const mentionId of [uuidMentionId, counterMentionId]) {
      const mention = agentMention({
        mentionId,
        displayName: "高密度分析",
        agentId: "bot--agent",
      });
      const tokens = resolveExplicitMentionTokens([mention]);
      expect(tokens).toContain("高密度分析");
      expect(tokens).toContain("bot--agent");
      expect(tokens).not.toContain(mentionId);

      const message = "@高密度分析 请分析并给出结论";
      const decision = decideParticipantsForTest({
        message,
        explicitMentions: tokens,
        scope,
        roundId: `round-matched-${mentionId}`,
      });
      expect(decision.mentionUnmatched).toBe(false);
      expect(decision.primaryQueue).toEqual(["bot--agent"]);
      expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["bot--agent"]);

      const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mention-id-match-"));
      const called: string[] = [];
      const round = await executeCollaborationRoundForTest({
        decision,
        policy: policyWithoutExtraTurns(),
        scope,
        message,
        sessionKey: scope.rawSessionKey,
        roundsDir,
        isAborted: () => false,
        runBot: async ({ bot }) => {
          called.push(bot.agentId);
          return { text: "结论：已按点名回应，并给出下一步建议。" };
        },
      });
      expect(called).toEqual(["bot--agent"]);
      expect(round.state).not.toBe("MENTION_UNMATCHED");
      expect(round.state).not.toBe("ROUND_ABORTED");
      expect(round.primaryQueue).toEqual(["bot--agent"]);
      expect(round.abortReason).toBeUndefined();
    }

    const unknownMentionId = randomUUID();
    const unknownMention = agentMention({
      mentionId: unknownMentionId,
      displayName: "不存在的机器人",
    });
    // Even if the anchor collides with a real agent id, it is not a match token.
    const collidingMention = agentMention({
      mentionId: "bot--agent",
      displayName: "不存在的机器人",
    });
    for (const mention of [unknownMention, collidingMention]) {
      const tokens = resolveExplicitMentionTokens([mention]);
      expect(tokens).toEqual(["不存在的机器人"]);
      expect(tokens).not.toContain(mention.mention_id);

      const message = "@不存在的机器人 请分析并给出结论";
      const decision = decideParticipantsForTest({
        message,
        explicitMentions: tokens,
        scope,
        roundId: `round-unknown-${mention.mention_id}`,
      });
      expect(decision.mentionUnmatched).toBe(true);
      expect(decision.primaryQueue).toEqual([]);
      expect(decision.executionBots).toEqual([]);

      const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mention-id-unknown-"));
      const round = await executeCollaborationRoundForTest({
        decision,
        policy: policyWithoutExtraTurns(),
        scope,
        message,
        sessionKey: scope.rawSessionKey,
        roundsDir,
        isAborted: () => false,
        runBot: async () => {
          throw new Error("unknown mention must not dispatch");
        },
      });
      expect(round.state).toBe("MENTION_UNMATCHED");
      expect(round.primaryQueue).toEqual([]);
      expect(round.occupancy).toBe("none");
    }
  });

  test("plugin mention tokens stay displayName and plugin id, not mention_id", () => {
    const mentionId = randomUUID();
    const tokens = resolveExplicitMentionTokens([
      {
        mention_id: mentionId,
        displayName: "GitHub",
        offset: 0,
        length: 7,
        target: { kind: "plugin", pluginId: "github" },
        targetKind: "plugin",
        targetId: "github",
      },
    ]);
    expect(tokens).toEqual(["GitHub", "github"]);
    expect(tokens).not.toContain(mentionId);
  });

  test("human mention tokens stay displayName and target id, not mention_id", () => {
    const mentionId = randomUUID();
    const tokens = resolveExplicitMentionTokens([
      {
        mention_id: mentionId,
        displayName: "王军",
        offset: 0,
        length: 3,
        target: { kind: "human", userId: "user-1" },
        targetKind: "human",
        targetId: "user-1",
      },
    ]);
    expect(tokens).toEqual(["王军", "user-1"]);
    expect(tokens).not.toContain(mentionId);
  });
});
