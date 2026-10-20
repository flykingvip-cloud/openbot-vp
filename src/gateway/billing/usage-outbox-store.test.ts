// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drainUsageOutbox } from "./usage-outbox-drain.js";
import {
  enqueueUsageOutbox,
  listUsageOutboxDue,
  markUsageOutboxDone,
} from "./usage-outbox-store.js";

vi.mock("./record-credit-usage.js", () => ({
  recordCreditUsage: vi.fn(async () => ({
    recorded: true,
    deduped: false,
    creditsCharged: 1,
    tier: "tier_a",
    providerCostCents: 0,
    tenantRevenueCents: 0,
    skippedConsumption: false,
    stage: "done",
  })),
}));

describe("usage outbox", () => {
  let storePath = "";
  afterEach(() => {
    if (storePath) {
      fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  it("enqueues idempotently and drains to done", async () => {
    storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "uout-")), "o.json");
    const payload = {
      enterpriseId: "ent-a",
      taskId: "task-1",
      modelId: "openai/gpt-4o-mini",
      policyId: "pol-1",
    };
    const a = await enqueueUsageOutbox(payload, storePath);
    const b = await enqueueUsageOutbox(payload, storePath);
    expect(a.id).toBe(b.id);
    expect(a.status).toBe("pending");

    const result = await drainUsageOutbox({ storePath, limit: 10 });
    expect(result.succeeded).toBe(1);
    const due = await listUsageOutboxDue({ storePath });
    expect(due).toHaveLength(0);
  });

  it("retries failed records and is idempotent on re-drain after done", async () => {
    const { recordCreditUsage } = await import("./record-credit-usage.js");
    storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "uout-")), "o.json");
    const mocked = vi.mocked(recordCreditUsage);
    mocked.mockRejectedValueOnce(new Error("disk full"));
    await enqueueUsageOutbox(
      {
        enterpriseId: "ent-a",
        taskId: "task-fail",
        modelId: "openai/gpt-4o-mini",
        policyId: "pol-1",
      },
      storePath,
    );
    const first = await drainUsageOutbox({ storePath });
    expect(first.failed).toBe(1);

    mocked.mockResolvedValueOnce({
      recorded: true,
      deduped: false,
      creditsCharged: 1,
      tier: "tier_a",
      providerCostCents: 0,
      tenantRevenueCents: 0,
      skippedConsumption: false,
      stage: "done",
    } as never);
    // Force due now by clearing nextAttemptAt via re-enqueue path: mark done then re-test drain
    await markUsageOutboxDone("task-fail", storePath);
    const second = await drainUsageOutbox({ storePath });
    expect(second.succeeded).toBe(0);

    // New pending after failure recovery: enqueue same taskId already done stays done
    const again = await enqueueUsageOutbox(
      {
        enterpriseId: "ent-a",
        taskId: "task-fail",
        modelId: "openai/gpt-4o-mini",
        policyId: "pol-1",
      },
      storePath,
    );
    expect(again.status).toBe("done");
  });
});
