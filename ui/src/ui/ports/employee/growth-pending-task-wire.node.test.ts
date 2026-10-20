// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { GrowthStatusView } from "../../controllers/agent-growth.ts";
import { sendChatMessage } from "../../controllers/chat.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  afterRobotSkillInstallForGrowth,
  beginInstallCapabilitiesFlow,
  resumeGrowthPendingTask,
  showGrowthContinueBanner,
  skipEnhanceAndShowContinue,
  stashGrowthPendingTaskLocal,
  type GrowthPendingTaskHost,
} from "./growth-pending-task-wire.ts";

function growingView(partial: Partial<GrowthStatusView> = {}): GrowthStatusView {
  return {
    lifecycleState: "growing",
    dimensions: { identity: 50, capability: 50, knowledge: 0, habits: 0 },
    activationScore: 25,
    operationalScore: null,
    capabilityReadiness: false,
    isActivated: false,
    templateId: "sales_assistant",
    ...partial,
  };
}

function host(partial: Partial<GrowthPendingTaskHost> = {}): GrowthPendingTaskHost {
  return {
    client: null,
    connected: true,
    sessionKey: "agent:helper:main",
    agentsList: null,
    collaborationSpacesResult: null,
    workbenchTeamSelectedKey: "agent:helper:main",
    workbenchActiveGrowthStatus: growingView(),
    chatMessage: "帮我做市场分析",
    workbenchPrimaryModule: "assistant",
    workbenchRobotWorkbenchTab: "overview",
    workbenchGroupProfileView: "chat",
    workbenchGrowthPendingTask: null,
    workbenchGrowthContinueBannerVisible: false,
    workbenchGrowthContinueSkippedEnhance: false,
    workbenchRecommendedSkillKeys: null,
    requestUpdate: vi.fn(),
    ...partial,
  };
}

describe("growth-pending-task-wire", () => {
  it("stashes draft and shows continue banner without sending", () => {
    const h = host();
    stashGrowthPendingTaskLocal(h, h.chatMessage, { source: "composer" });
    showGrowthContinueBanner(h);
    expect(h.workbenchGrowthPendingTask?.draftText).toBe("帮我做市场分析");
    expect(h.workbenchGrowthContinueBannerVisible).toBe(true);

    const send = vi.fn();
    resumeGrowthPendingTask(h);
    expect(h.chatMessage).toBe("帮我做市场分析");
    expect(h.workbenchGrowthContinueBannerVisible).toBe(false);
    expect(h.workbenchGrowthGateProceedAuthorized).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("blocked → install → resume → chat.send(growthGateProceed=true)", async () => {
    const draft = "帮我做市场分析";
    const request = vi.fn(async (method: string) => {
      if (method === "agents.recompute-growth") {
        return {
          agentId: "helper",
          growthStatus: growingView({
            pendingTaskContext: {
              draftText: draft,
              source: "composer",
              suggestedSkillKeys: ["market_research"],
              taskGaps: [
                {
                  key: "market_research",
                  label: "市场调研",
                  kind: "skill",
                  status: "satisfied",
                },
              ],
              extractedAtMs: 1,
              extractStatus: "ready",
            },
          }),
        };
      }
      if (method === "chat.send") {
        return { ok: true, runId: "run-1" };
      }
      return {};
    });
    const chatHost = {
      ...host({
        client: { request } as unknown as GatewayBrowserClient,
        connected: true,
        sessionKey: "agent:helper:main",
        workbenchGrowthPendingTask: {
          draftText: draft,
          source: "composer",
          suggestedSkillKeys: ["market_research"],
          taskGaps: [
            {
              key: "market_research",
              label: "市场调研",
              kind: "skill",
              status: "missing",
            },
          ],
          extractedAtMs: 1,
          extractStatus: "ready",
        },
        workbenchGrowthContinueBannerVisible: true,
        workbenchGrowthGateProceedAuthorized: false,
      }),
      chatMessages: [] as unknown[],
      chatSending: false,
      chatRunId: null as string | null,
      chatStream: null as string | null,
      chatStreamStartedAt: null as number | null,
      lastError: null as string | null,
    };

    await afterRobotSkillInstallForGrowth(chatHost);
    expect(chatHost.workbenchGrowthContinueBannerVisible).toBe(true);
    expect(chatHost.workbenchGrowthGateProceedAuthorized).toBe(true);

    resumeGrowthPendingTask(chatHost, { proceed: true });
    expect(chatHost.chatMessage).toBe(draft);
    expect(chatHost.workbenchGrowthGateProceedAuthorized).toBe(true);

    const runId = await sendChatMessage(
      chatHost as unknown as Parameters<typeof sendChatMessage>[0],
      draft,
      undefined,
      { growthGateProceed: true },
    );
    expect(runId).toBeTruthy();
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: draft,
        growthGateProceed: true,
      }),
    );
  });

  it("skip enhance keeps draft and marks skipped banner", () => {
    const h = host({ chatMessage: "原任务草稿" });
    skipEnhanceAndShowContinue(h);
    expect(h.workbenchGrowthPendingTask?.draftText).toBe("原任务草稿");
    expect(h.workbenchGrowthContinueBannerVisible).toBe(true);
    expect(h.workbenchGrowthContinueSkippedEnhance).toBe(true);
  });

  it("beginInstallCapabilitiesFlow opens skills and analyzes when connected", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "agents.analyze-growth-task") {
        return {
          agentId: "helper",
          growthStatus: {
            lifecycleState: "growing",
            dimensions: { identity: 10, capability: 0, knowledge: 0, habits: 0 },
            activationScore: 5,
            operationalScore: null,
            capabilityReadiness: false,
            isActivated: false,
            templateId: "sales_assistant",
            pendingTaskContext: {
              draftText: "帮我做市场分析",
              source: "composer",
              suggestedSkillKeys: ["market_research"],
              taskGaps: [
                {
                  key: "market_research",
                  label: "市场调研",
                  kind: "skill",
                  status: "missing",
                },
              ],
              extractedAtMs: 1,
              extractStatus: "ready",
            },
            milestones: {},
          },
          capabilityGaps: [],
          funnel: {
            hasSessionOpened: true,
            hasIdentityCompleted: false,
            hasFirstSkillInstalled: false,
            hasFirstMissionSent: false,
            hasFirstMissionSuccess: false,
            preludeDismissed: false,
          },
          recommendation: {
            kind: "install_capabilities",
            reason: "growth.recommend.install_for_task",
            priority: 30,
            gaps: [
              {
                key: "market_research",
                label: "市场调研",
                kind: "skill",
                status: "missing",
              },
            ],
            canSkip: true,
            target: {
              module: "assistant",
              tab: "skills",
              recommendedSkillKeys: ["market_research"],
            },
          },
        };
      }
      return {};
    });
    const h = host({
      client: { request } as unknown as GatewayBrowserClient,
      connected: true,
    });
    await beginInstallCapabilitiesFlow(h, ["crm"]);
    expect(h.workbenchPrimaryModule).toBe("assistant");
    expect(h.workbenchRobotWorkbenchTab).toBe("skills");
    expect(h.workbenchRecommendedSkillKeys).toEqual(["market_research"]);
    expect(h.workbenchGrowthPendingTask?.draftText).toBe("帮我做市场分析");
    expect(request).toHaveBeenCalledWith(
      "agents.analyze-growth-task",
      expect.objectContaining({ draftText: "帮我做市场分析", source: "composer" }),
    );
  });
});
