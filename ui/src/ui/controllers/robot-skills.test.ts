import { describe, expect, it } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import { loadRobotSkills, toggleRobotSkillEnabled, type RobotSkillsState } from "./robot-skills.ts";
import { containsSkillRuntimeField } from "./skill-models.ts";

type RequestHandler = (method: string, params?: unknown) => unknown;

function toGatewayRequest(handler: RequestHandler): GatewayBrowserClient["request"] {
  return ((method, params) =>
    Promise.resolve(handler(method, params))) as GatewayBrowserClient["request"];
}

function createState(request: RequestHandler): RobotSkillsState {
  return {
    client: { request: toGatewayRequest(request) } as GatewayBrowserClient,
    connected: true,
    robotSkillsLoading: false,
    robotSkillsError: null,
    robotSkillsList: [],
    robotSkillsBusyKey: null,
    robotSkillsAgentId: null,
    robotSkillsMessages: {},
  };
}

describe("robot skills controller", () => {
  it("loads robot capabilities as employee-visible entries", async () => {
    const state = createState(async () => ({
      skills: [
        {
          id: "skill-1",
          profile: {
            id: "skill-1",
            name: "自动生成周报",
            summary: "根据项目进展生成周报草稿",
            assetType: "capability",
          },
          enabled: true,
          installedVersion: "1.0.0",
          runtimeDefinition: { prompts: ["hidden"] },
        },
      ],
    }));

    await loadRobotSkills(state, "agent-1");

    expect(state.robotSkillsAgentId).toBe("agent-1");
    expect(state.robotSkillsList[0]).toMatchObject({
      id: "skill-1",
      enabled: true,
      installedVersion: "1.0.0",
      profile: { name: "自动生成周报" },
    });
    expect(containsSkillRuntimeField(state.robotSkillsList)).toBe(false);
  });

  it("optimistically toggles capability enabled state and rolls back on failure", async () => {
    const state = createState(async () => {
      throw new Error("network down");
    });
    state.robotSkillsAgentId = "agent-1";
    state.robotSkillsList = [
      {
        id: "skill-1",
        profile: {
          id: "skill-1",
          name: "合同审查",
          summary: "检查风险条款",
          assetType: "capability",
          usageExamples: [],
          inputDescription: "",
          outputDescription: "",
          tags: [],
          category: "",
          avatar: "",
          visibility: "private",
        },
        lifecycle: "draft",
        health: {
          status: "healthy",
          successRate: 1,
          avgLatency: 0,
          lastVerifiedAt: null,
          failureReasons: [],
        },
        sourceRobot: { id: "agent-1", name: "法务助手" },
        usageCount: 0,
        lastUsedAt: null,
        enabled: true,
        installedVersion: "1.0.0",
        latestVersion: null,
      },
    ];

    await toggleRobotSkillEnabled(state, "skill-1", false);

    expect(state.robotSkillsList[0]?.enabled).toBe(true);
    expect(state.robotSkillsError).toBe("network down");
    expect(state.robotSkillsMessages["skill-1"]?.kind).toBe("error");
  });
});
