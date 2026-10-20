import { describe, expect, test } from "vitest";
import {
  classifyPlaceholderReply,
  classifyPrimaryCompletion,
  collaborationSocialSilenceFallback,
  COLLABORATION_SOCIAL_FALLBACK_REPLY,
  isCollaborationAvailabilityCheck,
  isCollaborationSocialCheck,
  isCollaborationChitchat,
  resolvePrimaryDeadlineMs,
  resolveTimeoutTaskType,
} from "./completion-contract.js";
import { DEFAULT_COLLABORATION_POLICY } from "./policy.js";

describe("completion contract", () => {
  test("placeholder phrases are not complete", () => {
    expect(classifyPlaceholderReply("我先看看")).toBe(true);
    expect(classifyPlaceholderReply("已认领：记忆盘点")).toBe(true);
    expect(classifyPlaceholderReply("收到，已记录")).toBe(true);
    expect(classifyPlaceholderReply("收到，结论如下：通过评审")).toBe(false);
    expect(classifyPrimaryCompletion("我先看看").hasConclusion).toBe(false);
    // Length alone is not enough for non-chitchat — needs structural signals.
    expect(classifyPrimaryCompletion("端午节起源于纪念屈原，是中国传统节日。").hasConclusion).toBe(
      false,
    );
    // …but a real visible body is still a completed primary (quality tag only).
    expect(classifyPrimaryCompletion("端午节起源于纪念屈原，是中国传统节日。")).toMatchObject({
      responseStatus: "complete",
      visibleReply: true,
    });
    expect(classifyPrimaryCompletion("EXIT:0", "execution")).toMatchObject({
      responseStatus: "complete",
      hasConclusion: false,
      visibleReply: true,
    });
    expect(classifyPrimaryCompletion("我先看看", "execution")).toMatchObject({
      responseStatus: "placeholder",
      visibleReply: false,
    });
    expect(
      classifyPrimaryCompletion("结论：端午节起源于纪念屈原，是中国传统节日。").hasConclusion,
    ).toBe(true);
    expect(
      classifyPrimaryCompletion("建议下一步：先盘点记忆系统的写入路径。", "analysis").hasConclusion,
    ).toBe(true);
    expect(
      classifyPrimaryCompletion("信息不足：缺任务截止时间和负责人。", "analysis", {
        mentionBotMustRespond: true,
      }).hasConclusion,
    ).toBe(true);
  });

  test("lead_plus_supplement chitchat resolves to chitchat task type", () => {
    expect(isCollaborationChitchat("你好")).toBe(true);
    expect(isCollaborationChitchat("大家好")).toBe(true);
    expect(isCollaborationChitchat("下午好")).toBe(true);
    expect(isCollaborationChitchat("请研究这份资料")).toBe(false);
    expect(isCollaborationChitchat("各位介绍一下自己")).toBe(false);
    expect(isCollaborationChitchat("还有谁在线")).toBe(false);
    expect(
      resolveTimeoutTaskType({
        responseMode: "lead_plus_supplement",
        message: "你好",
      }),
    ).toBe("chitchat");
    expect(
      resolveTimeoutTaskType({
        responseMode: "lead_plus_supplement",
        message: "请给出明确结论和建议下一步",
      }),
    ).toBe("analysis");
  });

  test("chitchat short replies count as complete", () => {
    expect(classifyPrimaryCompletion("在的", "chitchat").hasConclusion).toBe(true);
    expect(classifyPrimaryCompletion("你好！", "chitchat").hasConclusion).toBe(true);
    expect(classifyPrimaryCompletion("我先看看", "chitchat").hasConclusion).toBe(false);
  });

  test("chitchat deadline uses policy chitchat budget", () => {
    const startedAtMs = 1_000;
    const deadline = resolvePrimaryDeadlineMs({
      policy: DEFAULT_COLLABORATION_POLICY,
      taskType: "chitchat",
      startedAtMs,
    });
    expect(deadline - startedAtMs).toBe(
      DEFAULT_COLLABORATION_POLICY.fallback.timeoutPolicy.byTaskType.chitchat,
    );
  });

  test("research timeout is at least 60s", () => {
    const taskType = resolveTimeoutTaskType({ message: "请研究这份资料" });
    expect(taskType).toBe("research");
    const deadline = resolvePrimaryDeadlineMs({
      policy: DEFAULT_COLLABORATION_POLICY,
      taskType,
      startedAtMs: 1_000,
    });
    expect(deadline - 1_000).toBeGreaterThanOrEqual(60_000);
  });

  test("group overlay cannot shrink research below 30s or into a 15s takeover", () => {
    const overlay = {
      ...DEFAULT_COLLABORATION_POLICY,
      fallback: {
        ...DEFAULT_COLLABORATION_POLICY.fallback,
        timeoutPolicy: {
          ...DEFAULT_COLLABORATION_POLICY.fallback.timeoutPolicy,
          byTaskType: {
            ...DEFAULT_COLLABORATION_POLICY.fallback.timeoutPolicy.byTaskType,
            research: 15_000,
          },
        },
      },
    };
    const budget =
      resolvePrimaryDeadlineMs({
        policy: overlay,
        taskType: "research",
        startedAtMs: 0,
      }) - 0;
    expect(budget).toBeGreaterThanOrEqual(30_000);
    expect(budget).toBeGreaterThan(15_000);
  });

  test("greetings and availability checks stay chitchat in any response mode", () => {
    expect(isCollaborationAvailabilityCheck("你们大家现在还是不能接任务吗")).toBe(true);
    expect(isCollaborationAvailabilityCheck("有人吗")).toBe(true);
    expect(isCollaborationAvailabilityCheck("在吗")).toBe(true);
    expect(isCollaborationAvailabilityCheck("请帮我写一份接任务方案")).toBe(false);
    expect(isCollaborationAvailabilityCheck("这个客户不能接任务，怎么处理")).toBe(false);
    expect(isCollaborationAvailabilityCheck("有人吗，把昨天的纪要发我")).toBe(false);
    expect(
      resolveTimeoutTaskType({
        responseMode: "lead_plus_supplement",
        message: "这个客户不能接任务，怎么处理",
      }),
    ).toBe("analysis");
    expect(
      resolveTimeoutTaskType({
        responseMode: "lead_plus_supplement",
        message: "有人吗，把昨天的纪要发我",
      }),
    ).toBe("analysis");
    expect(
      resolveTimeoutTaskType({
        responseMode: "debate_or_brainstorm",
        message: "大家好",
      }),
    ).toBe("chitchat");
    expect(
      resolveTimeoutTaskType({
        responseMode: "lead_plus_supplement",
        message: "你们大家现在还是不能接任务吗",
      }),
    ).toBe("chitchat");
    expect(classifyPrimaryCompletion("在的，现在可以接。", "chitchat").hasConclusion).toBe(true);
  });

  test("debate rounds accept any visible body but not placeholders", () => {
    expect(isCollaborationSocialCheck("这个方案你怎么看")).toBe(false);
    expect(
      resolveTimeoutTaskType({ responseMode: "debate_or_brainstorm", message: "这个方案你怎么看" }),
    ).not.toBe("chitchat");
    const body = "我倾向先做小范围试点，风险更可控。";
    expect(classifyPrimaryCompletion(body, "unknown").hasConclusion).toBe(false);
    expect(
      classifyPrimaryCompletion(body, "unknown", { acceptVisibleBody: true }).hasConclusion,
    ).toBe(true);
    expect(
      classifyPrimaryCompletion("我先看看", "unknown", { acceptVisibleBody: true }).hasConclusion,
    ).toBe(false);
  });

  test("silent must-answer speakers get a fixed short reply only for social checks", () => {
    expect(
      collaborationSocialSilenceFallback({ message: "大家好", contributionRole: "lead" }),
    ).toBe(COLLABORATION_SOCIAL_FALLBACK_REPLY);
    expect(collaborationSocialSilenceFallback({ message: "在吗", dispatchRole: "fallback" })).toBe(
      COLLABORATION_SOCIAL_FALLBACK_REPLY,
    );
    expect(
      collaborationSocialSilenceFallback({
        message: "大家好",
        contributionRole: "supplement",
        dispatchRole: "supplement",
      }),
    ).toBeNull();
    expect(
      collaborationSocialSilenceFallback({
        message: "这个客户不能接任务，怎么处理",
        contributionRole: "lead",
        dispatchRole: "primary",
      }),
    ).toBeNull();
  });
});
