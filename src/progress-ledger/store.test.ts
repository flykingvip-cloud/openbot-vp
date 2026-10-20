import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { foldEvents } from "./fold.js";
import { createFileLedgerStore, resolveProgressLedgerPath } from "./store.js";
import { seedPlan } from "./test-helpers.js";
import { appendLedgerEvent } from "./writer.js";

describe("file ledger store", () => {
  it("rejects path traversal in task ids", () => {
    expect(() =>
      resolveProgressLedgerPath({ cronStorePath: "/tmp/cron/jobs.json", taskId: "../x" }),
    ).toThrow(/invalid progress ledger task id/);
  });

  it("replays JSONL to the same folded ledger", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "progress-ledger-"));
    const cronStorePath = path.join(dir, "jobs.json");
    const store = createFileLedgerStore({ cronStorePath, taskId: "job-1" });
    const seed = seedPlan()[0];
    if (!seed) {
      throw new Error("missing seed");
    }
    const { ledger } = await appendLedgerEvent(store, { ...seed, taskId: "job-1" });
    const replayed = foldEvents(await store.loadEvents());
    expect(replayed).toEqual(ledger);
    const filePath = resolveProgressLedgerPath({ cronStorePath, taskId: "job-1" });
    const raw = await fs.readFile(filePath, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(1);
  });
});
