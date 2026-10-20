import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  resolvePlatformModelsConfig,
  resolvePlatformModelsMode,
} from "./platform-models-config.js";
import { loadPlatformModelsManagementSnapshot } from "./platform-models-snapshot.js";

describe("platform-models-config", () => {
  it("defaults to native mode", () => {
    expect(resolvePlatformModelsMode({})).toBe("native");
    expect(resolvePlatformModelsConfig({}).mode).toBe("native");
  });

  it("reads aor_enhanced from gateway.platform.models.mode", () => {
    expect(
      resolvePlatformModelsMode({
        gateway: { platform: { models: { mode: "aor_enhanced" } } },
      }),
    ).toBe("aor_enhanced");
  });
});

describe("loadPlatformModelsManagementSnapshot", () => {
  it("returns native snapshot without aor block", async () => {
    const snapshot = await loadPlatformModelsManagementSnapshot({
      cfg: {},
      catalog: [],
    });
    expect(snapshot.mode).toBe("native");
    expect(snapshot.generatedAt).toMatch(/^\d{4}-/);
    expect(snapshot.aor).toBeUndefined();
    expect(Array.isArray(snapshot.usageByModel)).toBe(true);
    expect(Array.isArray(snapshot.usageByTask)).toBe(true);
    expect(Array.isArray(snapshot.usageByPlan)).toBe(true);
    expect(Array.isArray(snapshot.taskProfiles)).toBe(true);
  });

  it("flags unmapped plans in aor_enhanced governance", async () => {
    const snapshot = await loadPlatformModelsManagementSnapshot({
      cfg: {
        gateway: { platform: { models: { mode: "aor_enhanced" } } },
        models: {
          taskPlans: {
            general: {
              taskProfileId: "general_text",
              name: "General",
              primaryModelIds: ["openai/gpt-4.1-mini"],
            },
          },
        },
      } as OpenBotConfig,
      catalog: [],
    });
    expect(snapshot.mode).toBe("aor_enhanced");
    expect(
      snapshot.governanceIssues?.some((issue) => issue.type === "aor_execution_unmapped"),
    ).toBe(true);
  });

  it("preserves plan control fields and routing constraints in snapshot", async () => {
    const snapshot = await loadPlatformModelsManagementSnapshot({
      cfg: {
        models: {
          taskPlans: {
            coding: {
              taskProfileId: "coding",
              name: "Coding",
              primaryModelIds: ["anthropic/claude-sonnet"],
              userSelectable: true,
              tenantOverrideAllowed: true,
            },
          },
          routingPolicies: {
            coding_policy: {
              taskProfileId: "coding",
              planId: "coding",
              primaryModelIds: ["anthropic/claude-sonnet"],
              fallbackModelIds: ["openai/gpt-4.1-mini"],
              maxCostPerRequest: 0.12,
              maxLatencyMs: 2500,
              requiredCapabilities: ["code"],
              requiredHealth: "healthy",
              scope: {
                tenantIds: ["tenant-a"],
                agentIds: ["agent-1"],
              },
            },
          },
        },
      } as OpenBotConfig,
      catalog: [],
    });
    expect(snapshot.taskPlans[0]?.userSelectable).toBe(true);
    expect(snapshot.taskPlans[0]?.tenantOverrideAllowed).toBe(true);
    expect(snapshot.routingPolicies[0]?.maxCostPerRequest).toBe(0.12);
    expect(snapshot.routingPolicies[0]?.scope.tenantIds).toEqual(["tenant-a"]);
    expect(snapshot.routingPolicies[0]?.requiredCapabilities).toEqual(["code"]);
    expect(snapshot.taskProfiles.some((profile) => profile.taskProfileId === "coding")).toBe(true);
  });

  it("maps explicit aorExecution on task plans", async () => {
    const snapshot = await loadPlatformModelsManagementSnapshot({
      cfg: {
        gateway: { platform: { models: { mode: "aor_enhanced" } } },
        models: {
          taskPlans: {
            coding: {
              taskProfileId: "coding",
              name: "Coding Review",
              primaryModelIds: ["anthropic/claude-sonnet"],
              aorExecution: {
                taskTypeId: "coding.review",
                selectorStrategy: "bandit",
                evaluatorMode: "workspace",
              },
            },
          },
        },
      } as OpenBotConfig,
      catalog: [],
    });
    expect(snapshot.taskPlans[0]?.aorExecution?.taskTypeId).toBe("coding.review");
    expect(
      snapshot.governanceIssues.some((issue) => issue.issueId === "aor-unmapped-plan:coding"),
    ).toBe(false);
  });
});
