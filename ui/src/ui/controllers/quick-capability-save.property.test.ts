import { describe, expect, it, vi } from "vitest";
import type { EmployeeCapabilityGateway } from "../capability/employee-capability/gateway-client.ts";
import {
  MockEmployeeCapabilityBackend,
  createMockEmployeeCapabilityGateway,
} from "../capability/employee-capability/mock-backend.ts";
import type {
  CapabilityAttribution,
  CapabilitySummary,
  CapabilityUsageBrief,
  RobotCapabilityProfile,
} from "../capability/employee-capability/types.ts";
import {
  createInitialQuickCapabilitySaveState,
  openQuickSave,
  submitQuickSave,
} from "./quick-capability-save.ts";

function makeAttribution(robotId: string): CapabilityAttribution {
  return {
    sourceRobot: { id: robotId, name: robotId },
    sourceTaskSummary: "客户合同审查任务",
    firstFormedScenario: "首次在合同处理时形成",
    highFrequencyScenarios: [],
  };
}

function makeUsage(robotId: string): CapabilityUsageBrief {
  return {
    robots: [{ id: robotId, name: robotId }],
    totalUsageCount: 1,
    lastUsedAt: 1,
  };
}

function makeCapability(id: string, robotId: string): CapabilitySummary {
  return {
    id,
    name: "客户情绪分析",
    summary: "分析客户消息中的情绪倾向",
    usageExamples: [],
    inputDescription: "",
    outputDescription: "",
    tags: [],
    category: "",
    avatar: null,
    health: "运行稳定",
    shareVisibility: "私有",
    maturity: null,
    attribution: makeAttribution(robotId),
    usage: makeUsage(robotId),
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

function makeProfile(robotId: string, capabilities: CapabilitySummary[]): RobotCapabilityProfile {
  return {
    robotId,
    whatItCanDo: capabilities,
    goodAt: [],
    recentlyLearned: [],
    sourcesOfAccumulation: [],
  };
}

function sampleText(prefix: string, index: number): string {
  return `${prefix}${index.toString().padStart(3, "0")}`;
}

describe("quick capability save properties", () => {
  it("submits only the allowed quick-save payload fields", async () => {
    // Feature: skill-lifecycle-asset-system, Property 5: 极简沉淀字段边界
    for (let index = 0; index < 100; index += 1) {
      const quickSave = vi.fn(
        async (_req: Parameters<EmployeeCapabilityGateway["quickSave"]>[0]) => ({
          capability: makeCapability(`cap-${index}`, `robot-${index}`),
        }),
      );
      const state = createInitialQuickCapabilitySaveState();
      state.gateway = {
        quickSave,
      } as Partial<EmployeeCapabilityGateway> as EmployeeCapabilityGateway;
      openQuickSave(state, {
        sourceAgentId: `robot-${index}`,
        sourceContextId: `ctx-${index}`,
        patternHint: {
          sampleTaskDescription: sampleText("任务", index),
          firstFormedScenario: sampleText("场景", index),
        },
        initialForm: {
          name: sampleText("能力", index),
          summary: sampleText("描述", index),
        },
      });

      await submitQuickSave(state);

      const payload = quickSave.mock.calls[0]?.[0];
      expect(payload).toBeDefined();
      if (!payload) {
        throw new Error("quickSave was not called");
      }
      expect(Object.keys(payload).toSorted()).toEqual([
        "name",
        "patternHint",
        "sourceAgentId",
        "sourceContextId",
        "summary",
      ]);
    }
  });

  it("creates attribution and draft state for successful saves", async () => {
    // Feature: skill-lifecycle-asset-system, Property 6: 极简沉淀建立能力归因
    // Feature: skill-lifecycle-asset-system, Property 7: 草稿标识
    const robotId = "robot-source";
    const seedCapability = makeCapability("cap-seed", robotId);
    const backend = new MockEmployeeCapabilityBackend({
      capabilities: [seedCapability],
      profiles: [makeProfile(robotId, [seedCapability])],
    });
    const gateway = createMockEmployeeCapabilityGateway(backend);

    for (let index = 0; index < 100; index += 1) {
      const state = createInitialQuickCapabilitySaveState();
      state.gateway = gateway;
      openQuickSave(state, {
        sourceAgentId: robotId,
        sourceContextId: `ctx-${index}`,
        patternHint: {
          sampleTaskDescription: sampleText("任务摘要", index),
          firstFormedScenario: sampleText("首次形成场景", index),
        },
        initialForm: {
          name: sampleText("能力", index),
          summary: sampleText("一句话描述", index),
        },
      });

      const saved = await submitQuickSave(state);

      expect(saved?.isDraft).toBe(true);
      expect(saved?.attribution.sourceRobot.id).toBe(robotId);
      expect(saved?.attribution.sourceTaskSummary).toBe(sampleText("任务摘要", index));
      expect(saved?.attribution.firstFormedScenario).toBe(sampleText("首次形成场景", index));
    }
  });

  it("rejects unknown source robots without creating an accumulation item", async () => {
    // Feature: skill-lifecycle-asset-system, Property 17: 来源机器人归因不可伪造
    const robotId = "robot-source";
    const seedCapability = makeCapability("cap-seed", robotId);
    const backend = new MockEmployeeCapabilityBackend({
      capabilities: [seedCapability],
      profiles: [makeProfile(robotId, [seedCapability])],
    });
    const gateway = createMockEmployeeCapabilityGateway(backend);

    for (let index = 0; index < 100; index += 1) {
      const before = await gateway.myAccumulation();
      const state = createInitialQuickCapabilitySaveState();
      state.gateway = gateway;
      openQuickSave(state, {
        sourceAgentId: `missing-${index}`,
        sourceContextId: `ctx-${index}`,
        initialForm: {
          name: sampleText("能力", index),
          summary: sampleText("一句话描述", index),
        },
      });

      await expect(submitQuickSave(state)).resolves.toBeNull();

      const after = await gateway.myAccumulation();
      expect(after.items).toHaveLength(before.items.length);
      expect(state.error).toContain(`missing-${index}`);
    }
  });
});
