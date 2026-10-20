import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  listEvolutionLoopLogsForTests,
  resetEvolutionLoopLogsForTests,
} from "../evolution-control/evolution-loop-log.js";
import {
  lookupRuntimeOwnershipBinding,
  resetRuntimeOwnershipProofsForTests,
} from "../evolution-control/runtime-ownership-proof.js";
import {
  appendEvolutionTaskOutcome,
  readEvolutionTaskOutcomes,
} from "./evolution-task-outcomes.js";

const AGENT_ID = "growth-bot";

let tmpDir = "";
let cfg: OpenBotConfig;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-evo-outcomes-"));
  cfg = {
    agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] },
  } as unknown as OpenBotConfig;
  resetRuntimeOwnershipProofsForTests();
  resetEvolutionLoopLogsForTests();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  resetRuntimeOwnershipProofsForTests();
  resetEvolutionLoopLogsForTests();
});

describe("evolution task outcomes", () => {
  it("writes a completed task with attribution and issues a run binding", () => {
    const row = appendEvolutionTaskOutcome(cfg, {
      agentId: AGENT_ID,
      occurredAt: Date.parse("2026-09-11T04:00:00.000Z"),
      succeeded: true,
      runId: "run-ok",
      tenantId: "tenant-acme",
      taskId: "task-ok",
    });
    expect(row).toMatchObject({
      runId: "run-ok",
      agentId: AGENT_ID,
      tenantId: "tenant-acme",
      taskId: "task-ok",
      surfaceId: "task.execution",
      outcome: "completed",
      observationEligibility: "eligible",
      attribution: { source: "task-outcome" },
    });
    expect(lookupRuntimeOwnershipBinding("run-ok")?.tenantId).toBe("tenant-acme");
    expect(readEvolutionTaskOutcomes(cfg, AGENT_ID)).toHaveLength(1);
    expect(
      listEvolutionLoopLogsForTests().some((entry) => entry.event === "evolution.outcome.written"),
    ).toBe(true);
  });

  it("writes a failed task from the real execution result", () => {
    const row = appendEvolutionTaskOutcome(cfg, {
      agentId: AGENT_ID,
      occurredAt: Date.now(),
      succeeded: false,
      runId: "run-fail",
      tenantId: "tenant-acme",
    });
    expect(row.outcome).toBe("failed");
    expect(row.succeeded).toBe(false);
  });

  it("marks a missing runId unavailable and does not issue a binding", () => {
    const row = appendEvolutionTaskOutcome(cfg, {
      agentId: AGENT_ID,
      occurredAt: Date.now(),
      succeeded: true,
      tenantId: "tenant-acme",
    });
    expect(row.outcome).toBe("unavailable");
    expect(row.observationEligibility).toBe("unavailable");
    expect(row.runId).toBeUndefined();
    expect(lookupRuntimeOwnershipBinding("")).toBeNull();
  });

  it("rejects a missing tenant instead of inferring one", () => {
    const row = appendEvolutionTaskOutcome(cfg, {
      agentId: AGENT_ID,
      occurredAt: Date.now(),
      succeeded: true,
      runId: "run-no-tenant",
    });
    expect(row.outcome).toBe("rejected");
    expect(row.observationEligibility).toBe("rejected");
    expect(row.tenantId).toBeUndefined();
    expect(lookupRuntimeOwnershipBinding("run-no-tenant")).toBeNull();
  });

  it("does not swallow a write failure", () => {
    const blocker = path.join(tmpDir, "blocked-agent");
    fs.writeFileSync(blocker, "not-a-directory");
    const blockedCfg = {
      agents: { list: [{ id: AGENT_ID, agentDir: blocker }] },
    } as unknown as OpenBotConfig;
    expect(() =>
      appendEvolutionTaskOutcome(blockedCfg, {
        agentId: AGENT_ID,
        occurredAt: Date.now(),
        succeeded: true,
        runId: "run-write-fail",
        tenantId: "tenant-acme",
        taskId: "task-write-fail",
      }),
    ).toThrow();
    expect(
      listEvolutionLoopLogsForTests().some(
        (entry) =>
          entry.event === "evolution.outcome.write_failed" &&
          entry.runId === "run-write-fail" &&
          entry.taskId === "task-write-fail",
      ),
    ).toBe(true);
  });
});
