import { describe, expect, it } from "vitest";
import {
  MockEmployeeCapabilityBackend,
  createMockEmployeeCapabilityGateway,
} from "../capability/employee-capability/mock-backend.ts";
import type {
  CapabilitySummary,
  CapabilityUsageBrief,
} from "../capability/employee-capability/types.ts";
import { shouldConfirmBeforeCapabilityChange } from "./capability-usage-brief.ts";

const hiddenUsageFields = [
  "sharedGroups",
  "dependentSkills",
  "enterpriseConsumers",
  "dependencyGraph",
];

function makeUsage(robotCount: number): CapabilityUsageBrief {
  return {
    robots: Array.from({ length: robotCount }, (_, index) => ({
      id: `robot-${index}`,
      name: `机器人${index}`,
    })),
    totalUsageCount: robotCount * 3,
    lastUsedAt: robotCount > 0 ? 1_700_000_000_000 + robotCount : null,
  };
}

function makeCapability(): CapabilitySummary {
  return {
    id: "cap-usage",
    name: "客户沟通整理",
    summary: "把客户沟通整理为摘要和行动建议",
    usageExamples: [],
    inputDescription: "",
    outputDescription: "",
    tags: [],
    category: "",
    avatar: null,
    health: "运行稳定",
    shareVisibility: "私有",
    maturity: null,
    attribution: {
      sourceRobot: { id: "robot-a", name: "销售助手" },
      sourceTaskSummary: "客户沟通任务",
      firstFormedScenario: "首次在客户跟进时形成",
      highFrequencyScenarios: [],
    },
    usage: {
      robots: [{ id: "robot-a", name: "销售助手" }],
      totalUsageCount: 1,
      lastUsedAt: 1,
    },
    usageMetrics: {
      robotCount: 1,
      groupCount: 0,
      totalUsageCount: 1,
      lastUsedAt: 1,
    },
    versionInfo: {
      currentVersion: "1.0.0",
      versionCount: 1,
      submittedVersion: null,
    },
    recentUpdate: null,
    isDraft: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("capability usage brief properties", () => {
  it("keeps usage brief fields inside the employee-layer boundary", () => {
    // Feature: skill-lifecycle-asset-system, Property 13: 能力使用简述字段边界
    for (let index = 0; index < 100; index += 1) {
      const usage = makeUsage(index % 8);
      expect(Object.keys(usage).toSorted()).toEqual(["lastUsedAt", "robots", "totalUsageCount"]);
      const serialized = JSON.stringify(usage);
      for (const field of hiddenUsageFields) {
        expect(serialized).not.toContain(field);
      }
    }
  });

  it("requires explicit confirmation only when robots are using the capability", () => {
    // Feature: skill-lifecycle-asset-system, Property 14: 编辑/删除前展示使用简述
    for (let index = 0; index < 100; index += 1) {
      const usage = makeUsage(index % 5);
      expect(shouldConfirmBeforeCapabilityChange(usage)).toBe(usage.robots.length > 0);
    }
  });

  it("keeps usage brief robots consistent after install and remove events", async () => {
    // Feature: skill-lifecycle-asset-system, Property 15: 使用简述事件一致性
    for (let index = 0; index < 100; index += 1) {
      const capability = makeCapability();
      const backend = new MockEmployeeCapabilityBackend({
        capabilities: [capability],
        profiles: [
          {
            robotId: "robot-a",
            whatItCanDo: [capability],
            goodAt: [],
            recentlyLearned: [],
            sourcesOfAccumulation: [],
          },
          {
            robotId: `robot-extra-${index}`,
            whatItCanDo: [],
            goodAt: [],
            recentlyLearned: [],
            sourcesOfAccumulation: [],
          },
        ],
      });
      const gateway = createMockEmployeeCapabilityGateway(backend);

      await gateway.installToRobot({
        capabilityId: capability.id,
        agentId: `robot-extra-${index}`,
      });
      const installed = await gateway.usageBrief({ capabilityId: capability.id });
      expect(installed.usage.robots.map((robot) => robot.id)).toContain(`robot-extra-${index}`);

      await gateway.removeFromRobot({
        capabilityId: capability.id,
        agentId: `robot-extra-${index}`,
      });
      const removed = await gateway.usageBrief({ capabilityId: capability.id });
      expect(removed.usage.robots.map((robot) => robot.id)).not.toContain(`robot-extra-${index}`);
    }
  });
});
