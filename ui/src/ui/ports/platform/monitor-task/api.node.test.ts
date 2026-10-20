import { describe, expect, it } from "vitest";
import {
  MONITOR_JOB_PAUSE_METHOD,
  MONITOR_JOB_REPORT_GET_METHOD,
  MONITOR_JOB_RESUME_METHOD,
  MONITOR_JOB_RUN_METHOD,
  MONITOR_SCHEDULE_APPLY_METHOD,
  monitorRunParams,
  monitorScheduleApplyParams,
  snapshotFromDescribe,
} from "./api.ts";

describe("monitor task gateway params", () => {
  it("uses the live schedule and job method names", () => {
    expect(MONITOR_SCHEDULE_APPLY_METHOD).toBe("diagnosis.schedule.apply");
    expect(MONITOR_JOB_PAUSE_METHOD).toBe("diagnosis.job.pause");
    expect(MONITOR_JOB_RESUME_METHOD).toBe("diagnosis.job.resume");
    expect(MONITOR_JOB_RUN_METHOD).toBe("diagnosis.job.run");
    expect(MONITOR_JOB_REPORT_GET_METHOD).toBe("diagnosis.job.report.get");
  });

  it("sends selector ids and does not ask for repair", () => {
    const input = {
      tenantId: "tenant-a",
      cadence: "daily" as const,
      agentIds: ["agent-a", "agent-b"],
      groupId: "group-1",
      roundId: "round-9",
      failureMinCount: 2,
      efficiencyMaxTotalMs: null,
    };
    const schedule = monitorScheduleApplyParams(input);
    expect(schedule.cadence).toBe("daily");
    expect(schedule.agentIds).toEqual(["agent-a", "agent-b"]);
    expect(schedule.targets).toEqual([
      { agentId: "agent-a" },
      { agentId: "agent-b" },
      { groupId: "group-1", roundId: "round-9" },
    ]);
    expect(schedule).not.toHaveProperty("repair");
    expect(schedule).not.toHaveProperty("fix");
    const run = monitorRunParams(input);
    expect(run).not.toHaveProperty("repair");
    expect(run).not.toHaveProperty("fix");
    expect(run.agentIds).toEqual(["agent-a", "agent-b"]);
  });

  it("reads cadence and pause without inventing a definition", () => {
    expect(
      snapshotFromDescribe({
        ok: true,
        definition: null,
        binding: null,
        cadence: "off",
        runs: [],
      }),
    ).toMatchObject({ cadence: "off", paused: false, hasDefinition: false });
  });
});
