import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SIDE_EFFECT_CLASSES } from "../conversation-task/types.js";
import {
  DEFAULT_WORKING_STYLE,
  deriveWorkingStyleDelta,
  renderWorkingStyleInstructions,
  WORKING_STYLE_MIN_SAMPLES_LEARNING,
} from "../gateway/agent-growth/genome.js";
import { shouldBlockGrowthTaskSend } from "../gateway/agent-growth/growth-task-gate.js";
import { buildStewardSystemPreamble } from "./builtin-steward/behavior-rules.js";
import {
  CONFIRMATION_INTERNAL_STEPS,
  CONFIRMATION_MUST_ASK_EXTRAS,
  renderConfirmationTierInstructions,
} from "./confirmation-tiers.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

function expectTierLines(snapshot: string): void {
  for (const line of renderConfirmationTierInstructions().split("\n")) {
    expect(snapshot).toContain(line);
  }
}

function internalSection(snapshot: string): string {
  const marker = "必须问：";
  const at = snapshot.indexOf(marker);
  expect(at).toBeGreaterThan(0);
  return snapshot.slice(0, at);
}

describe("confirmation tier prompt snapshot", () => {
  it("does the next writing step without 要不要我, and still confirms delete, publish, and key reset", () => {
    const snapshot = renderWorkingStyleInstructions(DEFAULT_WORKING_STYLE);
    expectTierLines(snapshot);
    expect(snapshot).not.toContain("要不要我");
    expect(snapshot).not.toContain("Confirm before taking consequential");

    const internal = internalSection(snapshot);
    for (const step of ["继续写", "改标题", "出下一节"] as const) {
      expect(CONFIRMATION_INTERNAL_STEPS).toContain(step);
      expect(internal).toContain(step);
      expect(internal).not.toContain("要不要我");
    }

    const mustAsk = snapshot.slice(snapshot.indexOf("必须问："));
    for (const action of ["删除", "发布", "重置密钥"] as const) {
      expect(CONFIRMATION_MUST_ASK_EXTRAS).toContain(action);
      expect(mustAsk).toContain(action);
    }
    expect(mustAsk).toContain("确认");
  });

  it("keeps every classifySideEffect class except none on the must-ask tier, plus delete and credentials", () => {
    const mustAsk = renderConfirmationTierInstructions().slice(
      renderConfirmationTierInstructions().indexOf("必须问："),
    );
    for (const kind of SIDE_EFFECT_CLASSES) {
      if (kind === "none") {
        expect(mustAsk).not.toContain("none");
        continue;
      }
      expect(mustAsk).toContain(kind);
    }
    expect(mustAsk).toContain("删除");
    expect(mustAsk).toContain("写凭证");
    expect(mustAsk).toContain("重置密钥");
  });

  it("renders high-takeover confirm_first as the two tiers, not ask-more-often", () => {
    const delta = deriveWorkingStyleDelta({
      tasksTotal: WORKING_STYLE_MIN_SAMPLES_LEARNING,
      humanTakeoverRate: 0.8,
      taskSuccessRate: 0.4,
    });
    expect(delta.decisionPreference).toBe("confirm_first");
    const snapshot = renderWorkingStyleInstructions({ ...DEFAULT_WORKING_STYLE, ...delta });
    expectTierLines(snapshot);
    expect(snapshot).toContain("继续写");
    expect(snapshot).toContain("重置密钥");
    expect(snapshot).not.toContain("要不要我");
    expect(snapshot).not.toMatch(/更常发问|每一步都要|ask more often/);
  });

  it("does not let autonomous wording drop the must-ask tier", () => {
    const snapshot = renderWorkingStyleInstructions({
      ...DEFAULT_WORKING_STYLE,
      decisionPreference: "autonomous",
    });
    expectTierLines(snapshot);
    expect(snapshot).toContain("重置密钥");
    expect(snapshot).not.toContain("要不要我");
  });
});

describe("steward preamble confirmation alignment", () => {
  const preamble = buildStewardSystemPreamble();

  it("uses the same two tiers and delivers a named task", () => {
    expect(preamble).toContain(renderConfirmationTierInstructions());
    expect(preamble).toContain("用户已经点名任务就交付");
    expect(preamble).not.toContain("要不要我");
    expect(internalSection(preamble)).toContain("出下一节");
  });

  it("keeps schedule confirmation on calendar writes only", () => {
    expect(preamble).toContain("schedule.entry.add");
    expect(preamble).toContain("不要把这条日程确认推广");
    expect(preamble).toContain("写作、调研、技能草稿");
  });

  it("keeps user-guidance step confirmation on navigation the agent cannot click", () => {
    expect(preamble).toContain("user-guidance-protocol");
    expect(preamble).toContain("一步一确认只用于");
    expect(preamble).toContain("点不了的界面导航");
    expect(preamble).toContain("不要用于已经派下的写作、调研、技能草稿");
  });
});

describe("skill prompt fences", () => {
  it("limits user-guidance one-step confirmation to interface navigation", () => {
    const skill = readRepo("skills/user-guidance-protocol/SKILL.md");
    expect(skill).toContain("一步一确认");
    expect(skill).toContain("代理点不了的界面导航");
    expect(skill).toContain("不要用于已经派下的写作、调研、技能草稿");
    expect(skill).toContain("继续写");
    expect(skill).toContain("重置密钥");
  });

  it("does not let independent-work skip high-risk confirmation", () => {
    const skill = readRepo("skills/independent-work/SKILL.md");
    const procedure = readRepo("skills/independent-work/references/procedure.md");
    for (const text of [skill, procedure]) {
      const browserAt = text.indexOf("不要再问");
      const fenceAt = text.indexOf("不取消高风险确认", Math.max(browserAt, 0));
      expect(browserAt).toBeGreaterThan(-1);
      expect(fenceAt).toBeGreaterThan(browserAt);
      const fence = text.slice(fenceAt, fenceAt + 180);
      expect(fence).toContain("删除");
      expect(fence).toContain("发布");
      expect(fence).toContain("重置密钥");
      expect(fence).toContain("确认");
    }
  });
});

describe("growth gate stays first mission and a real skill gap", () => {
  it("does not block a later step or a first mission with no missing skill", () => {
    expect(
      shouldBlockGrowthTaskSend({
        hadFirstMissionSent: true,
        pending: {
          draftText: "继续写下一节",
          source: "sent_mission",
          suggestedSkillKeys: ["market_research"],
          taskGaps: [
            { key: "market_research", label: "市场调研", kind: "skill", status: "missing" },
          ],
          extractedAtMs: 1,
          extractStatus: "ready",
        },
      }),
    ).toBe(false);
    expect(
      shouldBlockGrowthTaskSend({
        hadFirstMissionSent: false,
        pending: {
          draftText: "改标题",
          source: "composer",
          suggestedSkillKeys: [],
          taskGaps: [],
          extractedAtMs: 1,
          extractStatus: "ready",
        },
      }),
    ).toBe(false);
  });
});
