import { describe, expect, test } from "vitest";
import { classifyEpisodeIntent } from "./episode-intent.js";
import { resolveEpisodeNeed } from "./need-resolver.js";

describe("resolveEpisodeNeed §6.1", () => {
  test("mentioned members win over roll-call and task", () => {
    expect(
      resolveEpisodeNeed({
        intent: "roll_call",
        mentionedAgentIds: ["bot-a", " bot-a ", "bot-b"],
        eligibleAgentIds: ["bot-a", "bot-c"],
        taskOwnerAgentId: "owner",
      }),
    ).toEqual({ agentIds: ["bot-a", "bot-b"], source: "mention" });
  });

  test("roll-call Need is unanswered eligible members", () => {
    expect(
      resolveEpisodeNeed({
        intent: "roll_call",
        eligibleAgentIds: ["bot-a", "bot-b", "bot-c", "bot-b"],
        answeredAgentIds: ["bot-b"],
      }),
    ).toEqual({ agentIds: ["bot-a", "bot-c"], source: "roll_call" });
  });

  test("task Need is owner plus handoff receivers", () => {
    expect(
      resolveEpisodeNeed({
        intent: "task",
        taskOwnerAgentId: " owner ",
        handoffReceiverAgentIds: ["recv", "owner", ""],
      }),
    ).toEqual({ agentIds: ["owner", "recv"], source: "task" });
  });

  test("other intents without labels are Need empty and excluded from coverage", () => {
    expect(resolveEpisodeNeed({ intent: "discussion" })).toEqual({
      agentIds: [],
      source: "none",
    });
    expect(resolveEpisodeNeed({ intent: "review", labeledAgentIds: null })).toEqual({
      agentIds: [],
      source: "none",
    });
  });

  test("a label array is source labeled, including an empty annotation", () => {
    expect(resolveEpisodeNeed({ intent: "discussion", labeledAgentIds: ["human-pick"] })).toEqual({
      agentIds: ["human-pick"],
      source: "labeled",
    });
    expect(resolveEpisodeNeed({ intent: "chitchat", labeledAgentIds: [] })).toEqual({
      agentIds: [],
      source: "labeled",
    });
  });
});

describe("classifyEpisodeIntent", () => {
  test("hint and a throwing hook do not block the deterministic kind", () => {
    expect(classifyEpisodeIntent({ message: "你好", hintedIntent: "task" })).toBe("task");
    expect(
      classifyEpisodeIntent(
        { message: "预算怎么拆" },
        {
          classify: () => {
            throw new Error("shadow hook down");
          },
        },
      ),
    ).toBe("discussion");
    expect(classifyEpisodeIntent({ message: "预算怎么拆" }, { classify: () => "review" })).toBe(
      "review",
    );
  });

  test("roll-call, review, task, mention, and chitchat", () => {
    expect(classifyEpisodeIntent({ message: "点名" })).toBe("roll_call");
    expect(classifyEpisodeIntent({ message: "讨论", mentionAll: true })).toBe("roll_call");
    expect(classifyEpisodeIntent({ message: "请评审这版方案" })).toBe("review");
    expect(classifyEpisodeIntent({ message: "继续做", responseMode: "single_owner" })).toBe("task");
    expect(
      classifyEpisodeIntent({
        message: "看一下",
        mentionMode: "single_primary",
        mentionedAgentIds: ["bot-a"],
      }),
    ).toBe("mention_only");
    expect(classifyEpisodeIntent({ message: "你好" })).toBe("chitchat");
    expect(classifyEpisodeIntent({ message: "预算怎么拆" })).toBe("discussion");
  });
});
