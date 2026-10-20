import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GrowthStatus } from "./types.js";

const readRobotGrowthStatus = vi.fn<() => Promise<GrowthStatus | null>>();
vi.mock("./store.js", () => ({
  readRobotGrowthStatus: () => readRobotGrowthStatus(),
}));

const { buildGrowthBirthSystemPrompt } = await import("./birth-context.js");

const cfg = {} as never;

function status(partial: Partial<GrowthStatus>): GrowthStatus {
  return {
    lifecycleState: "birth",
    dimensions: { identity: 80, capability: 0, knowledge: 0, habits: 0 },
    birthAtMs: 1,
    activationScore: 20,
    operationalScore: null,
    capabilityReadiness: false,
    isActivated: false,
    templateId: "generic_worker",
    milestones: { createdAtMs: 1 },
    ...partial,
  };
}

beforeEach(() => {
  readRobotGrowthStatus.mockReset();
});

describe("buildGrowthBirthSystemPrompt", () => {
  it("returns undefined when no growth status", async () => {
    readRobotGrowthStatus.mockResolvedValue(null);
    expect(await buildGrowthBirthSystemPrompt({ cfg, agentId: "main" })).toBeUndefined();
  });

  it("returns undefined past birth/growing (mission_ready)", async () => {
    readRobotGrowthStatus.mockResolvedValue(status({ lifecycleState: "mission_ready" }));
    expect(await buildGrowthBirthSystemPrompt({ cfg, agentId: "main" })).toBeUndefined();
  });

  it("includes role, activation%, and required capability gaps for an industry template", async () => {
    readRobotGrowthStatus.mockResolvedValue(
      status({ lifecycleState: "birth", templateId: "contract_reviewer", activationScore: 35 }),
    );
    const prompt = await buildGrowthBirthSystemPrompt({ cfg, agentId: "c" });
    expect(prompt).toContain("诞生回合");
    expect(prompt).toContain("合同审查机器人");
    expect(prompt).toContain("35%");
    expect(prompt).toContain("距离上岗");
    expect(prompt).toContain("第一人称");
    expect(prompt).toContain("IDENTITY.md");
    expect(prompt).toContain("USER.md");
    expect(prompt).toContain("主人");
  });

  it("omits the gaps line for generic_worker (no required caps)", async () => {
    readRobotGrowthStatus.mockResolvedValue(status({ lifecycleState: "growing" }));
    const prompt = await buildGrowthBirthSystemPrompt({ cfg, agentId: "g" });
    expect(prompt).toBeDefined();
    expect(prompt).not.toContain("距离上岗");
  });
});
