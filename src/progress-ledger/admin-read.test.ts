import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAdminProgressLedger } from "./admin-read.js";
import { ensureCronLedgerSeeded, recordHumanGate } from "./cron-binding.js";
import { PROGRESS_LEDGER_ENABLED_ENV } from "./feature.js";
import { createLedgerMetrics } from "./metrics.js";
import { createFileLedgerStore } from "./store.js";

const job = {
  id: "job-admin",
  name: "Q2 巡检",
  ownership: { ownerId: "user-1", tenantId: "t1" },
  description: `巡检\n<!--openbot-task-meta:${encodeURIComponent(
    JSON.stringify({
      goal: "Q2 竞品价格巡检",
      acceptanceRules: ["已拉取竞品价格", "已计算内部价差"],
    }),
  )}-->`,
};

describe("readAdminProgressLedger", () => {
  it("does not import a writer (admin is read-only)", () => {
    const source = readFileSync(fileURLToPath(new URL("./admin-read.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/appendLedgerEvent|writer\.js/);
  });

  it("returns no items when the flag is off", async () => {
    const metrics = createLedgerMetrics();
    const result = await readAdminProgressLedger({
      jobs: [job],
      cronStorePath: "/tmp/missing-cron.json",
      env: {},
      readConfig: () => false,
      metrics,
    });
    expect(result).toEqual({
      projectionKind: "canonical",
      items: [],
      metrics: metrics.snapshot(),
    });
  });

  it("returns the same canonical projection as cron.list", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "progress-admin-"));
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
    const result = await readAdminProgressLedger({
      jobs: [job, { id: "plain", name: "普通任务", description: "没有验收" }],
      cronStorePath,
      nowMs: 2_100,
      env: { [PROGRESS_LEDGER_ENABLED_ENV]: "1" },
      readConfig: () => false,
      metrics: createLedgerMetrics(),
    });
    expect(result.projectionKind).toBe("canonical");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.progress.projectionKind).toBe("canonical");
    expect(result.items[0]?.progress.headline).toContain("项验收已满足");
    expect(result.items[0]?.progress.blockingGate?.question).toBe("价差按含税价还是活动价？");
    expect(result.items[0]?.ownerId).toBe("user-1");
  });
});
