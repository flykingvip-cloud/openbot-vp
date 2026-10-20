import { describe, expect, it } from "vitest";
import type { EmployeeCapabilityGateway } from "../capability/employee-capability/gateway-client.ts";
import {
  createInitialCapabilityRecommendationState,
  installRecommendation,
  loadRecommendations,
} from "./capability-recommendation.ts";

describe("capability recommendations controller", () => {
  it("loads recommendations for a robot", async () => {
    const state = createInitialCapabilityRecommendationState();
    state.gateway = {
      recommendations: async () => ({
        recommendations: [
          {
            capability: {
              id: "cap-1",
              name: "客户摘要",
              summary: "整理客户沟通内容",
              usageExamples: [],
              inputDescription: "",
              outputDescription: "",
              tags: [],
              category: "",
              avatar: null,
              health: "运行稳定",
              shareVisibility: "已进入企业资产库",
              maturity: "企业认证",
              attribution: {
                sourceRobot: { id: "robot-1", name: "机器人" },
                sourceTaskSummary: "",
                firstFormedScenario: "",
                highFrequencyScenarios: [],
              },
              usage: { robots: [], totalUsageCount: 0, lastUsedAt: null },
              usageMetrics: {
                robotCount: 0,
                groupCount: 0,
                totalUsageCount: 0,
                lastUsedAt: null,
              },
              versionInfo: {
                currentVersion: "1.0.0",
                versionCount: 1,
                submittedVersion: null,
              },
              recentUpdate: null,
              isDraft: false,
              createdAt: 0,
              updatedAt: 0,
            },
            reason: "已在企业资产库中沉淀，适合补充这个机器人",
          },
        ],
      }),
    } as unknown as Partial<EmployeeCapabilityGateway> as EmployeeCapabilityGateway;

    await loadRecommendations(state, "robot-1");

    expect(state.agentId).toBe("robot-1");
    expect(state.recommendations).toHaveLength(1);
    expect(state.error).toBeNull();
  });

  it("installs a recommendation and removes it from the local list", async () => {
    const state = createInitialCapabilityRecommendationState();
    state.agentId = "robot-1";
    state.recommendations = [
      {
        capability: {
          id: "cap-1",
          name: "客户摘要",
          summary: "整理客户沟通内容",
          usageExamples: [],
          inputDescription: "",
          outputDescription: "",
          tags: [],
          category: "",
          avatar: null,
          health: "运行稳定",
          shareVisibility: "已共享到协作小组",
          maturity: null,
          attribution: {
            sourceRobot: { id: "robot-1", name: "机器人" },
            sourceTaskSummary: "",
            firstFormedScenario: "",
            highFrequencyScenarios: [],
          },
          usage: { robots: [], totalUsageCount: 0, lastUsedAt: null },
          usageMetrics: {
            robotCount: 0,
            groupCount: 0,
            totalUsageCount: 0,
            lastUsedAt: null,
          },
          versionInfo: {
            currentVersion: "1.0.0",
            versionCount: 1,
            submittedVersion: null,
          },
          recentUpdate: null,
          isDraft: false,
          createdAt: 0,
          updatedAt: 0,
        },
        reason: "来自协作小组共享，适合当前工作场景",
      },
    ];
    state.gateway = {
      installToRobot: async (req: { capabilityId: string; agentId: string }) => ({
        capabilityId: req.capabilityId,
        agentId: req.agentId,
      }),
    } as unknown as Partial<EmployeeCapabilityGateway> as EmployeeCapabilityGateway;

    const response = await installRecommendation(state, "cap-1");

    expect(response).toEqual({ capabilityId: "cap-1", agentId: "robot-1" });
    expect(state.recommendations).toHaveLength(0);
    expect(state.busyCapabilityId).toBeNull();
  });

  it("keeps the recommendation and shows the next step when install is blocked", async () => {
    const state = createInitialCapabilityRecommendationState();
    state.agentId = "robot-1";
    state.recommendations = [
      {
        capability: {
          id: "openai-whisper-api",
          name: "语音转写",
          summary: "把语音转成文字",
          usageExamples: [],
          inputDescription: "",
          outputDescription: "",
          tags: [],
          category: "",
          avatar: null,
          health: "运行稳定",
          shareVisibility: "已进入企业资产库",
          maturity: null,
          attribution: {
            sourceRobot: { id: "robot-1", name: "机器人" },
            sourceTaskSummary: "",
            firstFormedScenario: "",
            highFrequencyScenarios: [],
          },
          usage: { robots: [], totalUsageCount: 0, lastUsedAt: null },
          usageMetrics: {
            robotCount: 0,
            groupCount: 0,
            totalUsageCount: 0,
            lastUsedAt: null,
          },
          versionInfo: {
            currentVersion: "1.0.0",
            versionCount: 1,
            submittedVersion: null,
          },
          recentUpdate: null,
          isDraft: false,
          createdAt: 0,
          updatedAt: 0,
        },
        reason: "已在企业资产库中沉淀，适合补充这个机器人",
      },
    ];
    let installed = false;
    state.gateway = {
      preflight: async () => ({
        capabilityId: "openai-whisper-api",
        status: "needs_setup",
        nextStep: "需要先完成服务配置",
        canInstall: false,
      }),
      installToRobot: async () => {
        installed = true;
        return { capabilityId: "openai-whisper-api", agentId: "robot-1" };
      },
    } as unknown as Partial<EmployeeCapabilityGateway> as EmployeeCapabilityGateway;

    const response = await installRecommendation(state, "openai-whisper-api");

    expect(response).toBeNull();
    expect(installed).toBe(false);
    expect(state.recommendations).toHaveLength(1);
    expect(state.installHints["openai-whisper-api"]).toBe("需要先完成服务配置");
    expect(state.error).toBeNull();
  });
});
