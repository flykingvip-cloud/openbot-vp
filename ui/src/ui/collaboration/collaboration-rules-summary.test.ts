import { describe, expect, it } from "vitest";
import { projectSpaceEffectivePolicyView } from "../../../../src/gateway/collaboration-dispatch/policy-lane-presentation.js";
import type { GatewayCollaborationGroupOperatingState } from "../../../../src/gateway/collaboration-learning.js";
import {
  buildCollaborationRulesDrawerSections,
  buildCollaborationRulesSummary,
  resolveActiveCollaborationRulesSections,
  resolveActiveCollaborationRulesSummary,
} from "./collaboration-rules-summary.ts";

/** Server-side view (what collaboration.spaces.list returns as `effectivePolicy`). */
function serverView(params: {
  collaborationPolicy?: Record<string, unknown>;
  collaborationMode?: string | null;
  finalDecisionMode?: string | null;
  allowAgentPublishProposal?: boolean | null;
  systemInstructions?: string[];
}) {
  return projectSpaceEffectivePolicyView({
    operatingState: {
      collaborationPolicy: params.collaborationPolicy ?? {},
    } as unknown as GatewayCollaborationGroupOperatingState,
    collaborationMode: params.collaborationMode ?? null,
    finalDecisionPolicy:
      params.finalDecisionMode || params.allowAgentPublishProposal != null
        ? {
            mode: params.finalDecisionMode ?? null,
            allowAgentPublishProposal: params.allowAgentPublishProposal ?? null,
          }
        : null,
    systemInstructions: params.systemInstructions ?? null,
  });
}

describe("buildCollaborationRulesDrawerSections (server-rendered effective, BP-20)", () => {
  it("separates forced system lines from guidance", () => {
    const sections = buildCollaborationRulesDrawerSections({
      effectivePolicy: serverView({
        collaborationPolicy: {
          humanStartsNewRound: true,
          openDiscussionWithoutMention: true,
          mentionBotMustRespond: true,
          maxVisibleBotRepliesPerRound: 5,
          botMaySelfAdvanceWithoutHuman: true,
          entersWaitingForHumanAfterVisibleTurnsExhausted: true,
        },
        systemInstructions: [
          "口头协议以磁盘 capabilities 为准",
          "未列出的工具不要重试",
          "自定义规则不得被摘要截断",
        ],
      }),
    });
    const byId = Object.fromEntries(sections.map((section) => [section.id, section]));
    expect(byId.system?.enforcement).toBe("forced");
    expect(byId.guidance?.enforcement).toBe("guidance");
    expect(byId.guidance?.lines).toEqual([
      "口头协议以磁盘 capabilities 为准",
      "未列出的工具不要重试",
      "自定义规则不得被摘要截断",
    ]);
    expect(
      byId.system?.lines.some((line) => line.includes("无法关闭") || line.includes("无增量可沉默")),
    ).toBe(true);
  });

  it("shows 可自推进 when the group stores it as true (now runtime-enforced)", () => {
    const view = serverView({
      collaborationPolicy: {
        mentionBotMustRespond: true,
        botMaySelfAdvanceWithoutHuman: true,
      },
    });
    expect(view.effective.governance.botMaySelfAdvanceWithoutHuman).toBe(true);
    expect(view.runtimeNotEnforced).not.toContain("governance.botMaySelfAdvanceWithoutHuman");
    expect(view.runtimeNotEnforced).toContain("participation.proactiveBots");
    const lines = buildCollaborationRulesSummary({ effectivePolicy: view });
    expect(lines.some((line) => line.includes("自推进"))).toBe(true);
  });

  it("hides 可自推进 when the server still lists it as not enforced", () => {
    const view = serverView({
      collaborationPolicy: { mentionBotMustRespond: true, botMaySelfAdvanceWithoutHuman: true },
    });
    const lines = buildCollaborationRulesSummary({
      effectivePolicy: {
        ...view,
        runtimeNotEnforced: ["governance.botMaySelfAdvanceWithoutHuman"],
      },
    });
    expect(lines.filter((line) => line.includes("自推进"))).toEqual([]);
  });

  it("treats final-decision and proposal lines as live governance, not pending storage", () => {
    const sections = buildCollaborationRulesDrawerSections({
      effectivePolicy: serverView({
        collaborationPolicy: {
          mentionBotMustRespond: true,
          entersWaitingForHumanAfterVisibleTurnsExhausted: true,
          botMaySelfAdvanceWithoutHuman: true,
        },
        finalDecisionMode: "human_required",
        allowAgentPublishProposal: true,
      }),
    });
    const governance = sections.find((section) => section.id === "governance");
    expect(governance?.lines.some((line) => line.includes("需要人类确认"))).toBe(true);
    expect(governance?.lines.some((line) => line.includes("允许机器人在委托模式下发布提案"))).toBe(
      true,
    );
    expect(governance?.lines.filter((line) => line.includes("待接入治理闸"))).toEqual([]);
    expect(governance?.lines.filter((line) => line.includes("待接入任务状态机"))).toEqual([]);
    expect(governance?.lines.some((line) => line.includes("交付物批准/发布"))).toBe(true);
    const roles = sections.find((section) => section.id === "roles");
    expect(roles?.lines.some((line) => line.includes("任务交接必须填写"))).toBe(true);
  });

  it("shows requested versus effective (provenance) when L2 exceeds the visible-reply ceiling", () => {
    const sections = buildCollaborationRulesDrawerSections({
      effectivePolicy: serverView({
        collaborationPolicy: {
          mentionBotMustRespond: true,
          maxVisibleBotRepliesPerRound: 20,
        },
      }),
    });
    const strategy = sections.find((section) => section.id === "strategy");
    expect(
      strategy?.lines.some((line) => line.includes("本群设置：20") && line.includes("生效：12")),
    ).toBe(true);
    const system = sections.find((section) => section.id === "system");
    expect(system?.lines.some((line) => line.includes("不施加群级限制"))).toBe(true);
  });

  it("states that task mode requires a submitted deliverable", () => {
    const sections = buildCollaborationRulesDrawerSections({
      effectivePolicy: serverView({
        collaborationMode: "task_driven",
        collaborationPolicy: { mentionBotMustRespond: true, replyLanguage: "zh" },
      }),
    });
    const strategy = sections.find((section) => section.id === "strategy");
    expect(strategy?.lines.some((line) => line.includes("必须有已提交的关联交付物"))).toBe(true);
    expect(strategy?.lines.some((line) => line.includes("持续使用中文回复"))).toBe(true);
    expect(strategy?.lines.some((line) => line.includes("3 句内收口"))).toBe(true);
  });

  it("renders replyLanguage from effective.presentation (unset = per-turn, matching runtime)", () => {
    const line = (replyLanguage?: string) =>
      buildCollaborationRulesSummary({
        effectivePolicy: serverView({
          collaborationPolicy: {
            mentionBotMustRespond: true,
            ...(replyLanguage ? { replyLanguage } : {}),
          },
        }),
      }).find((entry) => /语种回复|使用(中|英)文回复/.test(entry));
    expect(line("en")).toBe("本群持续使用英文回复。");
    expect(line("zh")).toBe("本群持续使用中文回复。");
    expect(line("inherit")).toBe("本群按用户本轮语种回复。");
    // Previously the client-compiled drawer claimed 中文 for unset; runtime detects per turn.
    expect(line(undefined)).toBe("本群按用户本轮语种回复。");
    expect(line("fr")).toBe("本群语言设置「fr」无效；按用户本轮语种回复。");
  });

  it("without a server view renders only static lines and never compiles client-side", () => {
    const sections = buildCollaborationRulesDrawerSections({
      systemInstructions: ["值班时先复述约束"],
    });
    const ids = sections.map((section) => section.id);
    expect(ids).toEqual(["system", "strategy", "roles", "guidance"]);
    expect(sections.find((s) => s.id === "strategy")?.lines).toEqual([
      "本群生效策略由服务端下发，当前尚未获取。",
    ]);
    expect(sections.find((s) => s.id === "guidance")?.lines).toEqual(["值班时先复述约束"]);
    expect(sections.flatMap((s) => s.lines).some((line) => line.includes("自推进"))).toBe(false);
  });
});

describe("buildCollaborationRulesSummary", () => {
  it("keeps every operator instruction after system and strategy lines", () => {
    const summary = buildCollaborationRulesSummary({
      effectivePolicy: serverView({
        collaborationPolicy: {
          humanStartsNewRound: true,
          openDiscussionWithoutMention: true,
          mentionBotMustRespond: true,
          maxVisibleBotRepliesPerRound: 5,
          botMaySelfAdvanceWithoutHuman: true,
          entersWaitingForHumanAfterVisibleTurnsExhausted: true,
        },
        systemInstructions: [
          "口头协议以磁盘 capabilities 为准",
          "未列出的工具不要重试",
          "自定义规则不得被摘要截断",
        ],
      }),
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "口头协议以磁盘 capabilities 为准",
        "未列出的工具不要重试",
        "自定义规则不得被摘要截断",
      ]),
    );
    expect(summary.indexOf("被 @ 必须进入本轮候选；无增量可沉默。")).toBeLessThan(
      summary.indexOf("口头协议以磁盘 capabilities 为准"),
    );
  });

  it("does not evict custom rules when they duplicate later policy wording", () => {
    const summary = buildCollaborationRulesSummary({
      effectivePolicy: serverView({
        collaborationPolicy: { mentionBotMustRespond: true },
        systemInstructions: ["适时保持沉默也是协作的一部分", "值班时先复述约束"],
      }),
    });

    expect(summary.filter((line) => line === "适时保持沉默也是协作的一部分")).toHaveLength(1);
    expect(summary).toContain("值班时先复述约束");
  });
});

describe("resolveActiveCollaborationRulesSummary", () => {
  it("renders the active space's server effectivePolicy", () => {
    const summary = resolveActiveCollaborationRulesSummary({
      activeSessionKey: "space:grp-alpha",
      spaces: [
        {
          id: "space:grp-other",
          groupId: "grp-other",
          systemInstructions: ["不该出现"],
        },
        {
          id: "space:grp-alpha",
          groupId: "grp-alpha",
          systemInstructions: ["第一条自定义", "第二条自定义"],
          effectivePolicy: serverView({
            collaborationPolicy: { mentionBotMustRespond: true },
            systemInstructions: ["第一条自定义", "第二条自定义"],
          }),
        },
      ],
    });

    expect(summary).toEqual(
      expect.arrayContaining([
        "第一条自定义",
        "第二条自定义",
        "被 @ 必须进入本轮候选；无增量可沉默。",
      ]),
    );
    expect(summary).not.toContain("不该出现");
  });

  it("falls back to static lines + raw instructions when the space has no server view", () => {
    const sections = resolveActiveCollaborationRulesSections({
      activeSessionKey: "grp-alpha",
      spaces: [{ id: "space:grp-alpha", groupId: "grp-alpha", systemInstructions: ["仅自定义"] }],
    });
    expect(sections.find((s) => s.id === "guidance")?.lines).toEqual(["仅自定义"]);
    expect(sections.find((s) => s.id === "governance")).toBeUndefined();
  });
});
