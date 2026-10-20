// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetCreditUsageStagesForTest,
  getCreditUsageStage,
  stageAtLeast,
  upsertCreditUsageStage,
} from "./credit-usage-stage-store.ts";

let dir: string;
let stagePath: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ob-credit-stage-"));
  stagePath = path.join(dir, "stages.json");
  await __resetCreditUsageStagesForTest(stagePath);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("credit-usage-stage-store", () => {
  it("stageAtLeast orders pipeline stages", () => {
    expect(stageAtLeast("bucket_debited", "ledger_written")).toBe(true);
    expect(stageAtLeast("ledger_written", "bucket_debited")).toBe(false);
    expect(stageAtLeast("done", "event_published")).toBe(true);
  });

  it("advances stage and never moves backward", async () => {
    await upsertCreditUsageStage(
      {
        enterpriseId: "ent-a",
        taskId: "t1",
        stage: "ledger_written",
        creditsCharged: 3,
      },
      stagePath,
    );
    const mid = await getCreditUsageStage("ent-a", "t1", stagePath);
    expect(mid?.stage).toBe("ledger_written");

    await upsertCreditUsageStage(
      {
        enterpriseId: "ent-a",
        taskId: "t1",
        stage: "bucket_debited",
        creditsCharged: 3,
      },
      stagePath,
    );
    // concurrent stale write to earlier stage ignored
    const stale = await upsertCreditUsageStage(
      {
        enterpriseId: "ent-a",
        taskId: "t1",
        stage: "ledger_written",
        creditsCharged: 3,
      },
      stagePath,
    );
    expect(stale.stage).toBe("bucket_debited");
  });
});
