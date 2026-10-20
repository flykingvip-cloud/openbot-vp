// Feature: skill-lifecycle-asset-system, Property 19: 推荐来源过滤
// Feature: skill-lifecycle-asset-system, Property 20: 推荐安装建立机器人关联
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MockEmployeeCapabilityBackend,
  createMockEmployeeCapabilityGateway,
} from "../capability/employee-capability/mock-backend.ts";
import type {
  CapabilitySummary,
  RobotCapabilityProfile,
} from "../capability/employee-capability/types.ts";
import { CAPABILITY_SHARE_VISIBILITIES } from "../capability/employee-capability/types.ts";

function capability(id: string, shareVisibility: CapabilitySummary["shareVisibility"]) {
  return {
    id,
    name: `能力${id}`,
    summary: `用于工作场景${id}`,
    usageExamples: [],
    inputDescription: "",
    outputDescription: "",
    tags: [],
    category: "通用",
    avatar: null,
    health: "运行稳定",
    shareVisibility,
    maturity: null,
    attribution: {
      sourceRobot: { id: "robot-source", name: "来源机器人" },
      sourceTaskSummary: "",
      firstFormedScenario: "",
      highFrequencyScenarios: [],
    },
    usage: { robots: [], totalUsageCount: 0, lastUsedAt: null },
    usageMetrics: { robotCount: 0, groupCount: 0, totalUsageCount: 0, lastUsedAt: null },
    recentUpdate: null,
    versionInfo: { currentVersion: "1.0.0", versionCount: 1, submittedVersion: null },
    isDraft: false,
    createdAt: 0,
    updatedAt: 0,
    enterpriseLifecycle: {
      stage: "draft",
      stageLabel: "资产草稿",
      nextStep: "补充信息后可共享或提交企业。",
    },
  } satisfies CapabilitySummary;
}

function profile(robotId: string, caps: CapabilitySummary[]): RobotCapabilityProfile {
  return {
    robotId,
    whatItCanDo: caps,
    goodAt: [],
    recentlyLearned: [],
    sourcesOfAccumulation: [],
  };
}

describe("capability recommendation properties", () => {
  it("only recommends collaboration-shared or enterprise-library capabilities", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...CAPABILITY_SHARE_VISIBILITIES), {
          minLength: 1,
          maxLength: 20,
        }),
        async (visibilities) => {
          const capabilities = visibilities.map((visibility, index) =>
            capability(`cap-${index}`, visibility),
          );
          const backend = new MockEmployeeCapabilityBackend({
            capabilities,
            profiles: [profile("robot-target", [])],
          });
          const gateway = createMockEmployeeCapabilityGateway(backend);

          const response = await gateway.recommendations({ agentId: "robot-target" });

          for (const entry of response.recommendations) {
            expect(["已共享到协作小组", "已进入企业资产库"]).toContain(
              entry.capability.shareVisibility,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("installing a recommendation removes it from the next recommendation list", async () => {
    const recommended = capability("cap-install", "已进入企业资产库");
    const backend = new MockEmployeeCapabilityBackend({
      capabilities: [recommended],
      profiles: [profile("robot-target", [])],
    });
    const gateway = createMockEmployeeCapabilityGateway(backend);

    expect(
      (await gateway.recommendations({ agentId: "robot-target" })).recommendations,
    ).toHaveLength(1);
    await gateway.installToRobot({ capabilityId: "cap-install", agentId: "robot-target" });
    expect(
      (await gateway.recommendations({ agentId: "robot-target" })).recommendations,
    ).toHaveLength(0);
  });
});
