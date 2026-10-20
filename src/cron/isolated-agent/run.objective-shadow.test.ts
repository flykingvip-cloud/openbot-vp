import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CRON_OBJECTIVE_ID_PREFIX,
  deriveCronObjectiveIdentity,
} from "../../objective-shadow/cron-objective.js";
import {
  OBJECTIVE_SHADOW_FLAG_ENV,
  OBJECTIVE_SHADOW_HMAC_KEY_ENV,
} from "../../objective-shadow/feature.js";
import { OBJECTIVE_SHADOW_LOG_ENV } from "../../objective-shadow/ingress-hook.js";
import { readShadowRecords } from "../../objective-shadow/log.js";
import {
  enableObjectiveShadowForTest,
  resolveShadowTestLogPath,
} from "../../objective-shadow/test-env.js";
import {
  makeIsolatedAgentTurnJob,
  makeIsolatedAgentTurnParams,
  setupRunCronIsolatedAgentTurnSuite,
} from "./run.suite-helpers.js";
import { loadRunCronIsolatedAgentTurn, makeCronSession } from "./run.test-harness.js";
import { resolveCronSessionMock } from "./run.test-harness.js";

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();
const HMAC_KEY = "cron-shadow-hmac";

function cronTurnParams(description?: string) {
  return makeIsolatedAgentTurnParams({
    job: makeIsolatedAgentTurnJob({
      ownership: { tenantId: "tenant-cron" },
      ...(description ? { description } : {}),
    }),
  });
}

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
    intentText: "写巡检日报",
    goal: "完成巡检日报",
    acceptanceRules: ["发出摘要"],
    notify: { inApp: true },
    selectedGroups: ["ops"],
    ...overrides,
  };
  return `巡检\n<!--openbot-task-meta:${encodeURIComponent(JSON.stringify(meta))}-->`;
}

describe("runCronIsolatedAgentTurn objective shadow wiring", () => {
  setupRunCronIsolatedAgentTurnSuite();

  let root: string;
  let logPath: string;
  let previous: Record<string, string | undefined>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cron-obj-shadow-"));
    logPath = resolveShadowTestLogPath(path.join(root, "objective-shadow.jsonl"));
    previous = {
      [OBJECTIVE_SHADOW_FLAG_ENV]: process.env[OBJECTIVE_SHADOW_FLAG_ENV],
      [OBJECTIVE_SHADOW_HMAC_KEY_ENV]: process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV],
      [OBJECTIVE_SHADOW_LOG_ENV]: process.env[OBJECTIVE_SHADOW_LOG_ENV],
    };
    process.env[OBJECTIVE_SHADOW_LOG_ENV] = logPath;
    if (logPath === path.join(root, "objective-shadow.jsonl")) {
      delete process.env[OBJECTIVE_SHADOW_FLAG_ENV];
      delete process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV];
    }
    resolveCronSessionMock.mockReturnValue(
      makeCronSession({
        sessionEntry: { sessionId: "occ-tick-1", updatedAt: 0, systemSent: false },
      }),
    );
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("does not write JSONL or change status when the shadow flag is OFF", async () => {
    const result = await runCronIsolatedAgentTurn(cronTurnParams(personalCronDescription()));
    expect(result.status).toBe("ok");
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it("ON observes a current-format PersonalCron job with stable objective and distinct occurrences", async () => {
    enableObjectiveShadowForTest(HMAC_KEY);
    const description = personalCronDescription();
    const expected = deriveCronObjectiveIdentity({
      id: "test-job",
      sessionTarget: "isolated",
      schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
      payload: { kind: "agentTurn", message: "test" },
      compiledInstruction: "test",
      description,
    });
    expect(expected?.objectiveId).toBe(`${CRON_OBJECTIVE_ID_PREFIX}test-job`);
    expect(expected?.revision).toEqual(expect.any(Number));

    resolveCronSessionMock
      .mockReturnValueOnce(
        makeCronSession({
          sessionEntry: { sessionId: "occ-tick-1", updatedAt: 0, systemSent: false },
        }),
      )
      .mockReturnValueOnce(
        makeCronSession({
          sessionEntry: { sessionId: "occ-tick-2", updatedAt: 0, systemSent: false },
        }),
      );

    const firstParams = cronTurnParams(description);
    const secondParams = cronTurnParams(description);
    expect(await runCronIsolatedAgentTurn(firstParams)).toMatchObject({ status: "ok" });
    expect(await runCronIsolatedAgentTurn(secondParams)).toMatchObject({ status: "ok" });

    const records = readShadowRecords(logPath);
    expect(records).toHaveLength(2);
    expect(records[0]?.correlation.runId).toBe("occ-tick-1");
    expect(records[1]?.correlation.runId).toBe("occ-tick-2");
    expect(records[0]?.correlation.cronOccurrenceId).toBe("occ-tick-1");
    expect(records[1]?.correlation.cronOccurrenceId).toBe("occ-tick-2");
    expect(records[0]?.correlation.cronOccurrenceId).not.toBe(
      records[1]?.correlation.cronOccurrenceId,
    );
    expect(records[0]?.correlation.objectiveId).toBe(expected?.objectiveId);
    expect(records[1]?.correlation.objectiveId).toBe(expected?.objectiveId);
    expect(records[0]?.correlation.revision).toBe(expected?.revision);
    expect(records[1]?.correlation.revision).toBe(expected?.revision);
    expect(records[0]?.correlation.runId).not.toBe("test-job");
    expect(records[0]?.correlation.objectiveId).not.toBe("test-job");
    expect(records[0]?.correlation.objectiveId).not.toBe(records[0]?.correlation.runId);
    expect(records[0]?.proposedDisposition).toBe("generated");
    const raw = fs.readFileSync(logPath, "utf8");
    expect(raw).not.toContain("写巡检日报");
    expect(raw).not.toContain("完成巡检日报");
    expect(raw).not.toContain("发出摘要");
  });

  it("ON changes revision when Cron goal changes and does not log the goal text", async () => {
    enableObjectiveShadowForTest(HMAC_KEY);
    resolveCronSessionMock
      .mockReturnValueOnce(
        makeCronSession({
          sessionEntry: { sessionId: "occ-goal-1", updatedAt: 0, systemSent: false },
        }),
      )
      .mockReturnValueOnce(
        makeCronSession({
          sessionEntry: { sessionId: "occ-goal-2", updatedAt: 0, systemSent: false },
        }),
      );
    const firstParams = cronTurnParams(personalCronDescription({ goal: "监控 361 京东淘宝价格" }));
    const secondParams = cronTurnParams(personalCronDescription({ goal: "监控竞品中医课程价格" }));
    expect(await runCronIsolatedAgentTurn(firstParams)).toMatchObject({ status: "ok" });
    expect(await runCronIsolatedAgentTurn(secondParams)).toMatchObject({ status: "ok" });
    const records = readShadowRecords(logPath);
    expect(records).toHaveLength(2);
    expect(records[0]?.correlation.objectiveId).toBe(records[1]?.correlation.objectiveId);
    expect(records[0]?.correlation.revision).not.toBe(records[1]?.correlation.revision);
    const raw = fs.readFileSync(logPath, "utf8");
    expect(raw).not.toContain("监控 361 京东淘宝价格");
    expect(raw).not.toContain("监控竞品中医课程价格");
  });

  it("ON changes revision when structured Cron config changes", async () => {
    enableObjectiveShadowForTest(HMAC_KEY);
    const firstDescription = personalCronDescription();
    const changedDescription = personalCronDescription({
      dataBindings: [
        {
          bindingId: "cap-crm",
          kind: "capability",
          resourceId: "crm.customers",
          label: "客户列表",
        },
      ],
    });
    resolveCronSessionMock
      .mockReturnValueOnce(
        makeCronSession({
          sessionEntry: { sessionId: "occ-cfg-1", updatedAt: 0, systemSent: false },
        }),
      )
      .mockReturnValueOnce(
        makeCronSession({
          sessionEntry: { sessionId: "occ-cfg-2", updatedAt: 0, systemSent: false },
        }),
      );
    const firstParams = cronTurnParams(firstDescription);
    const secondParams = cronTurnParams(changedDescription);
    expect(await runCronIsolatedAgentTurn(firstParams)).toMatchObject({ status: "ok" });
    expect(await runCronIsolatedAgentTurn(secondParams)).toMatchObject({ status: "ok" });
    const records = readShadowRecords(logPath);
    expect(records).toHaveLength(2);
    expect(records[0]?.correlation.objectiveId).toBe(records[1]?.correlation.objectiveId);
    expect(records[0]?.correlation.revision).not.toBe(records[1]?.correlation.revision);
    expect(records[0]?.correlation.runId).not.toBe("test-job");
    expect(records[1]?.correlation.runId).not.toBe("test-job");
  });

  it("ON skips proposed units when the Cron candidate has no legal revision", async () => {
    enableObjectiveShadowForTest(HMAC_KEY);
    const { observeObjectiveShadowFromIngress } =
      await import("../../objective-shadow/ingress-hook.js");
    observeObjectiveShadowFromIngress({
      ingress: "cron_isolated",
      tenantId: "tenant-cron",
      tenantScope: "identified",
      runId: "occ-missing-rev",
      cronOccurrenceId: "occ-missing-rev",
      cronJobId: "test-job",
      candidates: [{ source: "cron", objectiveId: `${CRON_OBJECTIVE_ID_PREFIX}test-job` }],
    });
    const records = readShadowRecords(logPath);
    expect(records).toHaveLength(1);
    expect(records[0]?.resolveStatus).toBe("skipped");
    expect(records[0]?.proposed).toEqual([]);
    expect(records[0]?.proposedDisposition).not.toBe("generated");
    expect(records[0]?.correlation.runId).toBe("occ-missing-rev");
    expect(records[0]?.correlation.runId).not.toBe("test-job");
  });
});
