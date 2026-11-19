import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { drainUsageOutbox } from "./usage-outbox-drain.js";
import {
  enqueueUsageOutbox,
  listUsageOutboxDue,
  markUsageOutboxProcessing,
} from "./usage-outbox-store.js";

vi.mock("./record-credit-usage.js", () => ({
  recordCreditUsage: vi.fn(async () => ({
    recorded: true,
    deduped: false,
    creditsCharged: 1,
    stage: "done",
  })),
}));
vi.mock("./credit-reservation-store.js", () => ({
  settleCreditReservation: vi.fn(async () => undefined),
}));
const roots: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-recovery-"));
  roots.push(dir);
  return path.join(dir, "outbox.json");
}
const payload = {
  enterpriseId: "test-enterprise",
  taskId: "test-operation",
  modelId: "test/model",
  policyId: "test-policy",
};

it("recovers a persisted receipt without requiring the original enqueue caller", async () => {
  const storePath = fixture();
  await enqueueUsageOutbox(payload, storePath);
  // The drainer reads disk independently; it receives no in-memory receipt.
  expect(await drainUsageOutbox({ storePath })).toMatchObject({ succeeded: 1, failed: 0 });
  expect(await listUsageOutboxDue({ storePath })).toEqual([]);
  expect(await drainUsageOutbox({ storePath })).toMatchObject({ succeeded: 0 });
  const { recordCreditUsage } = await import("./record-credit-usage.js");
  expect(recordCreditUsage).toHaveBeenCalledTimes(1);
});

it("retries an interrupted processing record from durable storage", async () => {
  const storePath = fixture();
  const receipt = await enqueueUsageOutbox(payload, storePath);
  await markUsageOutboxProcessing(receipt.id, storePath);
  expect(await drainUsageOutbox({ storePath })).toMatchObject({ succeeded: 1 });
  expect(await listUsageOutboxDue({ storePath })).toEqual([]);
});

it("deduplicates repeated delivery of the same durable receipt after completion", async () => {
  const storePath = fixture();
  await enqueueUsageOutbox(payload, storePath);
  await drainUsageOutbox({ storePath });
  await enqueueUsageOutbox(payload, storePath);
  await drainUsageOutbox({ storePath });
  const { recordCreditUsage } = await import("./record-credit-usage.js");
  expect(recordCreditUsage).toHaveBeenCalledTimes(1);
});
