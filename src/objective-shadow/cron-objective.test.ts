import { describe, expect, it } from "vitest";
import { parsePersonalCronTaskMetaRecord } from "../cron/personal-task-meta.js";
import {
  CRON_OBJECTIVE_ID_PREFIX,
  cronCandidatesFromJob,
  deriveCronObjectiveIdentity,
} from "./cron-objective.js";

const GOAL_361 = "监控 361 京东淘宝价格";
const GOAL_COURSE = "监控竞品中医课程价格";
const INTENT_361 = "盯京东淘宝 361 价格";
const INTENT_COURSE = "盯竞品中医课程价格";

function personalCronDescription(overrides: Record<string, unknown> = {}): string {
  const meta = {
    dataBindings: [
      {
        bindingId: "runtime-today",
        kind: "runtime_date",
        resourceId: "today",
        label: "今天日期",
      },
    ],
    intentText: INTENT_361,
    goal: GOAL_361,
    acceptanceRules: ["已拉取价格", "已对比价差"],
    notify: { inApp: true },
    selectedGroups: ["ops"],
    ...overrides,
  };
  return `巡检\n<!--openbot-task-meta:${encodeURIComponent(JSON.stringify(meta))}-->`;
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-job",
    enabled: true,
    sessionTarget: "isolated",
    schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
    delivery: { mode: "announce", surfaces: ["workbench-agent-main"] },
    payload: { kind: "agentTurn", model: "claude-opus-4-1", message: "按目标执行巡检" },
    description: personalCronDescription(),
    ...overrides,
  };
}

describe("server-derived Cron Objective identity", () => {
  it("builds a complete candidate from current PersonalCronTaskMetaRecord without leaking text", () => {
    const description = personalCronDescription();
    const parsed = parsePersonalCronTaskMetaRecord(description);
    expect(parsed).toBeTruthy();
    expect(parsed).not.toHaveProperty("objectiveId");
    expect(parsed).not.toHaveProperty("revision");
    const [candidate] = cronCandidatesFromJob(job({ description }));
    expect(candidate?.source).toBe("cron");
    expect(candidate?.objectiveId).toBe(`${CRON_OBJECTIVE_ID_PREFIX}test-job`);
    expect(candidate?.objectiveId).not.toBe("test-job");
    expect(typeof candidate?.revision).toBe("number");
    expect(candidate?.revision).not.toBe(1);
    const serialized = JSON.stringify(candidate);
    expect(serialized).not.toContain(GOAL_361);
    expect(serialized).not.toContain(INTENT_361);
    expect(serialized).not.toContain("已拉取价格");
    expect(serialized).not.toContain("按目标执行巡检");
  });

  it("changes revision when goal changes", () => {
    const before = deriveCronObjectiveIdentity(job());
    const after = deriveCronObjectiveIdentity(
      job({ description: personalCronDescription({ goal: GOAL_COURSE }) }),
    );
    expect(after?.objectiveId).toBe(before?.objectiveId);
    expect(after?.revision).not.toBe(before?.revision);
  });

  it("changes revision when intentText changes", () => {
    const before = deriveCronObjectiveIdentity(job());
    const after = deriveCronObjectiveIdentity(
      job({ description: personalCronDescription({ intentText: INTENT_COURSE }) }),
    );
    expect(after?.objectiveId).toBe(before?.objectiveId);
    expect(after?.revision).not.toBe(before?.revision);
  });

  it("changes revision when acceptanceRules change", () => {
    const before = deriveCronObjectiveIdentity(job());
    const after = deriveCronObjectiveIdentity(
      job({
        description: personalCronDescription({
          acceptanceRules: ["已拉取价格", "已写入对比表"],
        }),
      }),
    );
    expect(after?.objectiveId).toBe(before?.objectiveId);
    expect(after?.revision).not.toBe(before?.revision);
  });

  it("keeps objectiveId and revision when only occurrence/run identity changes", () => {
    const first = deriveCronObjectiveIdentity(job());
    const second = deriveCronObjectiveIdentity(job());
    expect(first?.objectiveId).toBe(second?.objectiveId);
    expect(first?.revision).toBe(second?.revision);
  });

  it("changes revision when schedule or delivery changes", () => {
    const before = deriveCronObjectiveIdentity(job());
    const scheduleChanged = deriveCronObjectiveIdentity(
      job({ schedule: { kind: "cron", expr: "0 18 * * *", tz: "UTC" } }),
    );
    const deliveryChanged = deriveCronObjectiveIdentity(job({ delivery: { mode: "none" } }));
    expect(scheduleChanged?.objectiveId).toBe(before?.objectiveId);
    expect(deliveryChanged?.objectiveId).toBe(before?.objectiveId);
    expect(scheduleChanged?.revision).not.toBe(before?.revision);
    expect(deliveryChanged?.revision).not.toBe(before?.revision);
  });

  it("changes revision when compiled instruction changes and still omits the text", () => {
    const before = deriveCronObjectiveIdentity(job());
    const after = deriveCronObjectiveIdentity(
      job({
        payload: { kind: "agentTurn", model: "claude-opus-4-1", message: "改写后的执行指令" },
      }),
    );
    expect(after?.revision).not.toBe(before?.revision);
    expect(
      JSON.stringify(cronCandidatesFromJob(job({ compiledInstruction: "改写后的执行指令" }))),
    ).not.toContain("改写后的执行指令");
  });

  it("does not invent an objective when the permanent job id is missing", () => {
    expect(cronCandidatesFromJob(job({ id: "" }))).toEqual([]);
    expect(deriveCronObjectiveIdentity(job({ id: "   " }))).toBeNull();
  });
});
