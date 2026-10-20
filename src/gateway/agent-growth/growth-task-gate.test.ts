import { describe, expect, it } from "vitest";
import { shouldBlockGrowthTaskSend, unmetSkillKeysFromTaskGaps } from "./growth-task-gate.ts";

describe("growth-task-gate", () => {
  it("extracts missing skill keys", () => {
    expect(
      unmetSkillKeysFromTaskGaps([
        { key: "crm", status: "missing" },
        { key: "done", status: "satisfied" },
      ]),
    ).toEqual(["crm"]);
  });

  it("does not block birth turn, proceed, or after first mission", () => {
    expect(
      shouldBlockGrowthTaskSend({
        growthBirthTurn: true,
        hadFirstMissionSent: false,
        pending: {
          draftText: "x",
          source: "composer",
          suggestedSkillKeys: ["crm"],
          taskGaps: [{ key: "crm", label: "CRM", kind: "skill", status: "missing" }],
          extractedAtMs: 1,
          extractStatus: "ready",
        },
      }),
    ).toBe(false);
    expect(
      shouldBlockGrowthTaskSend({
        growthGateProceed: true,
        hadFirstMissionSent: false,
        pending: {
          draftText: "x",
          source: "composer",
          suggestedSkillKeys: ["crm"],
          taskGaps: [{ key: "crm", label: "CRM", kind: "skill", status: "missing" }],
          extractedAtMs: 1,
          extractStatus: "ready",
        },
      }),
    ).toBe(false);
    expect(
      shouldBlockGrowthTaskSend({
        hadFirstMissionSent: true,
        pending: {
          draftText: "x",
          source: "sent_mission",
          suggestedSkillKeys: ["crm"],
          taskGaps: [{ key: "crm", label: "CRM", kind: "skill", status: "missing" }],
          extractedAtMs: 1,
          extractStatus: "ready",
        },
      }),
    ).toBe(false);
  });

  it("blocks first mission when unmet task skills exist", () => {
    expect(
      shouldBlockGrowthTaskSend({
        hadFirstMissionSent: false,
        pending: {
          draftText: "做市场分析",
          source: "composer",
          suggestedSkillKeys: ["market_research"],
          taskGaps: [
            { key: "market_research", label: "市场调研", kind: "skill", status: "missing" },
          ],
          extractedAtMs: 1,
          extractStatus: "ready",
        },
      }),
    ).toBe(true);
  });

  it("does not block when gaps are empty after analyze/fallback", () => {
    expect(
      shouldBlockGrowthTaskSend({
        hadFirstMissionSent: false,
        pending: {
          draftText: "随便聊聊",
          source: "composer",
          suggestedSkillKeys: [],
          taskGaps: [],
          extractedAtMs: 1,
          extractStatus: "failed_fallback",
        },
      }),
    ).toBe(false);
  });
});
