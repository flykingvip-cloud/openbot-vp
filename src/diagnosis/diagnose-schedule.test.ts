import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDiagnoseRequest } from "./diagnose-policy.js";
import {
  deleteDiagnosisSchedule,
  listDueDiagnosisSchedules,
  markDiagnosisScheduleRun,
  upsertDiagnosisSchedule,
} from "./diagnose-schedule.js";

const tmpDir = path.join(os.tmpdir(), `openbot-diag-sched-${Date.now()}`);

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("diagnosis schedules", () => {
  it("does not persist cadence=off and only runs daily once per UTC day", () => {
    const tenantId = "tenant-sched-a";
    expect(
      upsertDiagnosisSchedule({
        tenantId,
        request: parseDiagnoseRequest({ cadence: "off", agentId: "a", sessionKey: "agent:a:main" }),
        configDir: tmpDir,
      }),
    ).toBeNull();
    const daily = upsertDiagnosisSchedule({
      tenantId,
      request: parseDiagnoseRequest({
        cadence: "daily",
        window: "7d",
        mode: "FULL",
        agentId: "a",
        sessionKey: "agent:a:main",
      }),
      now: Date.parse("2026-09-18T10:00:00.000Z"),
      configDir: tmpDir,
    });
    expect(daily?.window).toBe("7d");
    expect(daily?.mode).toBe("FULL");
    expect(
      listDueDiagnosisSchedules({ now: Date.parse("2026-09-18T11:00:00.000Z"), configDir: tmpDir }),
    ).toHaveLength(1);
    markDiagnosisScheduleRun({
      tenantId,
      now: Date.parse("2026-09-18T11:00:00.000Z"),
      configDir: tmpDir,
    });
    expect(
      listDueDiagnosisSchedules({ now: Date.parse("2026-09-18T23:00:00.000Z"), configDir: tmpDir }),
    ).toHaveLength(0);
    expect(
      listDueDiagnosisSchedules({ now: Date.parse("2026-09-19T01:00:00.000Z"), configDir: tmpDir }),
    ).toHaveLength(1);
    deleteDiagnosisSchedule(tenantId, tmpDir);
    expect(
      listDueDiagnosisSchedules({ now: Date.parse("2026-09-19T01:00:00.000Z"), configDir: tmpDir }),
    ).toHaveLength(0);
  });
});
