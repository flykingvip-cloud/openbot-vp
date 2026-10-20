import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCronRunLogEntriesPageAll } from "./run-log.js";

/**
 * `allowedJobIds` is the mechanism that keeps an owner-scoped `cron.runs`
 * aggregate query from reading other users' run history, so it is exercised
 * against real files here rather than through a mock.
 */
async function seedRunLogs(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "openbot-cron-runlog-"));
  const storePath = path.join(root, "jobs.json");
  const runsDir = path.join(root, "runs");
  await mkdir(runsDir, { recursive: true });
  const entry = (jobId: string, ts: number, summary: string) =>
    `${JSON.stringify({ ts, jobId, action: "finished", status: "ok", summary })}\n`;
  await writeFile(path.join(runsDir, "job-own.jsonl"), entry("job-own", 1000, "my run"), "utf-8");
  await writeFile(
    path.join(runsDir, "job-colleague.jsonl"),
    entry("job-colleague", 2000, "stock analysis run"),
    "utf-8",
  );
  return storePath;
}

describe("readCronRunLogEntriesPageAll allowedJobIds", () => {
  it("returns every job's history when unrestricted", async () => {
    const storePath = await seedRunLogs();
    const page = await readCronRunLogEntriesPageAll({ storePath });
    expect(page.entries.map((e) => e.jobId).toSorted()).toEqual(["job-colleague", "job-own"]);
    expect(page.total).toBe(2);
  });

  it("reads only the allowed job's history", async () => {
    const storePath = await seedRunLogs();
    const page = await readCronRunLogEntriesPageAll({
      storePath,
      allowedJobIds: ["job-own"],
    });
    expect(page.entries.map((e) => e.jobId)).toEqual(["job-own"]);
    expect(page.total).toBe(1);
  });

  it("returns nothing when the caller owns no jobs", async () => {
    const storePath = await seedRunLogs();
    const page = await readCronRunLogEntriesPageAll({ storePath, allowedJobIds: [] });
    expect(page.entries).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("ignores an allowed id that has no log file", async () => {
    const storePath = await seedRunLogs();
    const page = await readCronRunLogEntriesPageAll({
      storePath,
      allowedJobIds: ["job-own", "job-never-ran"],
    });
    expect(page.entries.map((e) => e.jobId)).toEqual(["job-own"]);
  });

  it("does not leak a foreign entry stored in an allowed job's file", async () => {
    // Defense in depth: filtering by file name alone would return this entry.
    const storePath = await seedRunLogs();
    const runsDir = path.join(path.dirname(storePath), "runs");
    await writeFile(
      path.join(runsDir, "job-own.jsonl"),
      `${JSON.stringify({ ts: 1000, jobId: "job-own", action: "finished", status: "ok" })}\n` +
        `${JSON.stringify({ ts: 1500, jobId: "job-colleague", action: "finished", status: "ok" })}\n`,
      "utf-8",
    );
    const page = await readCronRunLogEntriesPageAll({
      storePath,
      allowedJobIds: ["job-own"],
    });
    expect(page.entries.map((e) => e.jobId)).toEqual(["job-own"]);
  });
});
