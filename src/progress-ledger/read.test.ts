import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureCronLedgerSeeded, observeCronToolEvent, recordHumanGate } from "./cron-binding.js";
import { PROGRESS_LEDGER_ENABLED_ENV } from "./feature.js";
import { attachProgressToCronJobs, listCronHumanGates, readCronProgressView } from "./read.js";
import { createFileLedgerStore } from "./store.js";

const job = {
  id: "job-ui",
  name: "Q2 巡检",
  description: `巡检\n<!--openbot-task-meta:${encodeURIComponent(
    JSON.stringify({
      goal: "Q2 竞品价格巡检",
      acceptanceRules: ["已拉取竞品价格", "已计算内部价差"],
    }),
  )}-->`,
};

describe("readCronProgressView", () => {
  it("returns null when the feature is off", async () => {
    expect(
      await readCronProgressView({
        job,
        cronStorePath: "/tmp/missing-cron.json",
        env: {},
        readConfig: () => false,
      }),
    ).toBeNull();
  });

  it("returns a canonical projection from the ledger, never a run summary", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "progress-read-"));
    const cronStorePath = path.join(dir, "jobs.json");
    const store = createFileLedgerStore({ cronStorePath, taskId: job.id });
    await ensureCronLedgerSeeded({ store, job, atMs: 1_000 });
    await observeCronToolEvent({
      store,
      job,
      phase: "start",
      toolName: "crm_query",
      atMs: 2_000,
    });
    await observeCronToolEvent({
      store,
      job,
      phase: "result",
      toolName: "crm_query",
      atMs: 2_100,
    });
    const view = await readCronProgressView({
      job,
      cronStorePath,
      nowMs: 2_200,
      env: { [PROGRESS_LEDGER_ENABLED_ENV]: "1" },
      readConfig: () => false,
    });
    expect(view?.projectionKind).toBe("canonical");
    expect(view?.acceptanceProgress).toEqual({ met: 0, total: 2 });
    expect(view?.executionProgress.completed).toBe(0);
    expect(view?.headline).toContain("项验收已满足");
    expect(view?.headline).not.toMatch(/即将完成|马上完成/);
  });

  it("does not attach progress when the flag is off", async () => {
    const jobs = [job];
    const result = await attachProgressToCronJobs(jobs, {
      cronStorePath: "/tmp/missing-cron.json",
      env: {},
      readConfig: () => false,
    });
    expect(result).toBe(jobs);
    expect(result[0]).not.toHaveProperty("progress");
  });

  it("lists human gates for the owner and skips them when the flag is off", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "progress-gate-"));
    const cronStorePath = path.join(dir, "jobs.json");
    const store = createFileLedgerStore({ cronStorePath, taskId: job.id });
    await ensureCronLedgerSeeded({ store, job, atMs: 1_000 });
    await recordHumanGate({
      store,
      taskId: job.id,
      stepId: "E1",
      reason: "blocked_user",
      question: "价差按含税价还是活动价？",
      atMs: 2_000,
    });
    const owned = {
      ...job,
      sessionKey: "agent:main:cron:job-ui",
      ownership: { ownerId: "user-1", tenantId: "t1" },
    };
    expect(
      await listCronHumanGates({
        jobs: [owned],
        actorIdentities: ["user-1"],
        actorTenantId: "t1",
        cronStorePath,
        env: {},
        readConfig: () => false,
      }),
    ).toEqual([]);
    const gates = await listCronHumanGates({
      jobs: [owned, { ...owned, id: "other", ownership: { ownerId: "user-2" } }],
      actorIdentities: ["user-1"],
      actorTenantId: "t1",
      cronStorePath,
      nowMs: 2_100,
      env: { [PROGRESS_LEDGER_ENABLED_ENV]: "1" },
      readConfig: () => false,
    });
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({
      id: "ledger-gate:job-ui",
      title: "价差按含税价还是活动价？",
      reason: "blocked_user",
    });
  });
});
