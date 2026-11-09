import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, it, expect, vi } from "vitest";
import { createExecutionJournal } from "./execution-journal.js";
const roots: string[] = [];
const run = promisify(execFile);
const scope = {
  kind: "personal",
  personalDomainId: "domain",
  subjectRef: "subject",
  authzScopeRef: "grant",
} as const;
const fact = (eventId = "start") => ({
  eventId,
  taskId: "task",
  runId: "run",
  scope,
  occurredAt: 100,
  stage: "started" as const,
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "execution-journal-"));
  roots.push(root);
  return root;
}
describe("bounded durable execution journal", () => {
  it("serializes processes competing for the last disk slot while independent roots remain writable", async () => {
    const root = await setup();
    const worker = path.join(await setup(), "disk-race.mts");
    const module = fileURLToPath(new URL("./execution-journal.ts", import.meta.url));
    await fs.writeFile(
      worker,
      "import {createExecutionJournal} from " +
        JSON.stringify(module) +
        ";const input=JSON.parse(process.argv[2]);const j=createExecutionJournal({rootDir:input.root,enabled:()=>true,now:()=>100,maxRootBytes:5500});process.stdout.write(JSON.stringify(await j.appendFact(input.entry))); ",
    );
    const results = await Promise.all(
      ["a", "b"].map((id) =>
        run(process.execPath, [
          "--import",
          "tsx",
          worker,
          JSON.stringify({ root, entry: { agentId: id, fact: fact(id) } }),
        ]),
      ),
    );
    const parsed = results.map((r) => JSON.parse(r.stdout) as { ok: boolean; reason?: string });
    expect(parsed.filter((r) => r.ok)).toHaveLength(1);
    expect(parsed.find((r) => !r.ok)?.reason).toBe("root_disk_capacity");
    const independent = createExecutionJournal({
      rootDir: await setup(),
      enabled: () => true,
      now: () => 100,
      maxRootBytes: 5500,
    });
    expect((await independent.appendFact({ agentId: "bot", fact: fact() })).ok).toBe(true);
  });
  it("counts leftover temporary bytes and rejects unknown root entries without deletion", async () => {
    const root = await setup();
    await fs.writeFile(path.join(root, "leftover.tmp"), "x".repeat(9000));
    const j = createExecutionJournal({
      rootDir: root,
      enabled: () => true,
      now: () => 100,
      maxRootBytes: 10000,
    });
    expect(await j.appendFact({ agentId: "bot", fact: fact() })).toMatchObject({
      ok: false,
      reason: "root_disk_capacity",
    });
    expect((await fs.stat(path.join(root, "leftover.tmp"))).size).toBe(9000);
    await fs.mkdir(path.join(root, "unknown"));
    expect(await j.appendFact({ agentId: "bot", fact: fact() })).toMatchObject({
      ok: false,
      reason: "root_budget_unknown",
    });
  });
  it("serializes independent processes competing for the last partition slot", async () => {
    const root = await setup();
    const worker = path.join(await setup(), "root-race.mts");
    const module = fileURLToPath(new URL("./execution-journal.ts", import.meta.url));
    await fs.writeFile(
      worker,
      "import {createExecutionJournal} from " +
        JSON.stringify(module) +
        ";const input=JSON.parse(process.argv[2]);const j=createExecutionJournal({rootDir:input.root,enabled:()=>true,now:()=>100,maxPartitions:1});process.stdout.write(JSON.stringify(await j.appendFact(input.entry))); ",
    );
    const results = await Promise.all(
      ["a", "b"].map((id) =>
        run(process.execPath, [
          "--import",
          "tsx",
          worker,
          JSON.stringify({ root, entry: { agentId: id, fact: fact(id) } }),
        ]),
      ),
    );
    const parsed = results.map((r) => JSON.parse(r.stdout) as { ok: boolean; reason?: string });
    expect(parsed.filter((r) => r.ok)).toHaveLength(1);
    expect(parsed.find((r) => !r.ok)?.reason).toBe("root_partition_capacity");
  });
  it("refuses extra partitions and reserves replacement temporary space", async () => {
    const root = await setup();
    const j = createExecutionJournal({
      rootDir: root,
      enabled: () => true,
      now: () => 100,
      maxPartitions: 1,
      maxRootBytes: 100000,
    });
    expect((await j.appendFact({ agentId: "bot", fact: fact() })).ok).toBe(true);
    expect(await j.appendFact({ agentId: "other", fact: fact() })).toMatchObject({
      ok: false,
      reason: "root_partition_capacity",
    });
    const file = path.join(root, (await fs.readdir(root)).find((n) => n.endsWith(".json"))!);
    const before = await fs.readFile(file, "utf8");
    const tight = createExecutionJournal({
      rootDir: root,
      enabled: () => true,
      now: () => 100,
      maxRootBytes: Buffer.byteLength(before) + 1000,
    });
    expect(await tight.appendFact({ agentId: "bot", fact: fact("next") })).toMatchObject({
      ok: false,
      reason: "root_disk_capacity",
    });
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
  it("bounds payload reads even when a file grows after stat", async () => {
    const root = await setup();
    const journal = createExecutionJournal({
      rootDir: root,
      enabled: () => true,
      now: () => 100,
      maxBytes: 4096,
    });
    expect((await journal.appendFact({ agentId: "bot", fact: fact() })).ok).toBe(true);
    const file = path.join(root, (await fs.readdir(root))[0]);
    const originalStat = fs.stat.bind(fs);
    const stat = vi
      .spyOn(fs, "stat")
      .mockImplementation(async (...args: Parameters<typeof fs.stat>) => {
        const result = await originalStat(...args);
        if (args[0] === file) {
          await fs.writeFile(file, "x".repeat(20000));
        }
        return result;
      });
    const read = vi.spyOn(fs, "readFile");
    try {
      expect((await journal.query({ agentId: "bot", scope })).ok).toBe(false);
      expect(read).not.toHaveBeenCalled();
    } finally {
      stat.mockRestore();
      read.mockRestore();
    }
  });
  it("rejects oversized files before reading their payload without repairing disk", async () => {
    const root = await setup();
    const journal = createExecutionJournal({
      rootDir: root,
      enabled: () => true,
      now: () => 100,
      maxBytes: 4096,
    });
    expect((await journal.appendFact({ agentId: "bot", fact: fact() })).ok).toBe(true);
    const file = path.join(root, (await fs.readdir(root))[0]);
    await fs.writeFile(file, "x".repeat(4097));
    const read = vi.spyOn(fs, "readFile");
    try {
      expect((await journal.query({ agentId: "bot", scope })).ok).toBe(false);
      expect(read).not.toHaveBeenCalled();
      expect((await fs.stat(file)).size).toBe(4097);
    } finally {
      read.mockRestore();
    }
  });
  it("defaults disabled and query never creates directories", async () => {
    const root = path.join(await setup(), "missing");
    const journal = createExecutionJournal({ rootDir: root });
    expect((await journal.appendFact({ agentId: "bot", fact: fact() })).ok).toBe(false);
    expect((await journal.query({ agentId: "bot", scope })).ok).toBe(false);
    await expect(fs.stat(root)).rejects.toThrow();
    const enabled = createExecutionJournal({ rootDir: root, enabled: () => true });
    expect((await enabled.query({ agentId: "bot", scope })).ok).toBe(false);
    await expect(fs.stat(root)).rejects.toThrow();
  });
  it("survives restart, preserves immutable ids, and isolates agent/scope", async () => {
    const root = await setup();
    const options = { rootDir: root, enabled: () => true, now: () => 100 };
    const j = createExecutionJournal(options);
    expect(await j.appendFact({ agentId: "bot", fact: fact() })).toMatchObject({
      ok: true,
      replayed: false,
    });
    expect(await j.appendFact({ agentId: "bot", fact: fact() })).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect(
      await j.appendFact({ agentId: "bot", fact: { ...fact(), stage: "failed" } }),
    ).toMatchObject({ ok: false, reason: "immutable_conflict" });
    expect(
      (
        await j.appendLink({
          agentId: "bot",
          receipt: {
            receiptId: "link",
            scope,
            taskId: "task",
            runId: "run",
            outcomeVersion: 1,
            attemptId: "attempt",
            attemptGranularity: "turn",
            eventIds: ["start"],
          },
        })
      ).ok,
    ).toBe(true);
    const r = await createExecutionJournal(options).query({ agentId: "bot", scope });
    if (!r.ok) {
      throw new Error("failed");
    }
    expect(r.facts).toHaveLength(1);
    expect(r.links).toHaveLength(1);
    expect(r.watermark.lastSequence).toBe(2);
    expect((await j.query({ agentId: "other", scope })).ok).toBe(false);
    expect((await j.query({ agentId: "bot", scope: { ...scope, subjectRef: "other" } })).ok).toBe(
      false,
    );
  });
  it("reports capacity and logical TTL truncation without query writes", async () => {
    const root = await setup();
    let now = 100;
    const j = createExecutionJournal({
      rootDir: root,
      enabled: () => true,
      now: () => now,
      capacity: 1,
      ttlMs: 10,
    });
    await j.appendFact({ agentId: "bot", fact: fact() });
    await j.appendFact({ agentId: "bot", fact: fact("second") });
    const file = path.join(root, (await fs.readdir(root)).find((n) => n.endsWith(".json"))!);
    const before = await fs.readFile(file, "utf8");
    now = 110;
    const r = await j.query({ agentId: "bot", scope });
    if (!r.ok) {
      throw new Error("failed");
    }
    expect(r.facts).toEqual([]);
    expect(r.truncated).toBe(true);
    expect(r.watermark.discardedThrough).toBe(2);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
  it("ignores half-written temporary files and rejects corrupt committed history", async () => {
    const root = await setup();
    const j = createExecutionJournal({ rootDir: root, enabled: () => true, now: () => 100 });
    await j.appendFact({ agentId: "bot", fact: fact() });
    await fs.writeFile(path.join(root, "partial.tmp"), "{broken");
    expect((await j.query({ agentId: "bot", scope })).ok).toBe(true);
    const file = path.join(root, (await fs.readdir(root)).find((n) => n.endsWith(".json"))!);
    await fs.writeFile(file, "{broken");
    expect(await j.query({ agentId: "bot", scope })).toMatchObject({ ok: false, state: "unknown" });
    expect((await j.appendFact({ agentId: "bot", fact: fact("new") })).ok).toBe(false);
    expect(await fs.readFile(file, "utf8")).toBe("{broken");
  });
  it("rejects non-whitelisted payload and nonexistent linked facts", async () => {
    const root = await setup();
    const j = createExecutionJournal({ rootDir: root, enabled: () => true, now: () => 100 });
    expect(
      (
        await j.appendFact({
          agentId: "bot",
          fact: { ...fact(), body: "secret" } as ReturnType<typeof fact>,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await j.appendLink({
          agentId: "bot",
          receipt: {
            receiptId: "l",
            scope,
            taskId: "task",
            runId: "run",
            outcomeVersion: 1,
            attemptId: "a",
            attemptGranularity: "turn",
            eventIds: ["missing"],
          },
        })
      ).ok,
    ).toBe(false);
  });
  it("serializes independent processes appending distinct facts without lost updates", async () => {
    const root = await setup();
    const worker = path.join(root, "worker.mjs");
    const module = fileURLToPath(new URL("./execution-journal.ts", import.meta.url));
    await fs.writeFile(
      worker,
      "import {createExecutionJournal} from " +
        JSON.stringify(module) +
        ";const input=JSON.parse(process.argv[2]);const j=createExecutionJournal({rootDir:input.root,enabled:()=>true,now:()=>100});process.stdout.write(JSON.stringify(await j.appendFact(input.entry)));",
    );
    const results = await Promise.all(
      ["a", "b"].map((id) =>
        run(process.execPath, [
          "--import",
          "tsx",
          worker,
          JSON.stringify({ root, entry: { agentId: "bot", fact: fact(id) } }),
        ]),
      ),
    );
    expect(results.every((r) => JSON.parse(r.stdout).ok)).toBe(true);
    const r = await createExecutionJournal({
      rootDir: root,
      enabled: () => true,
      now: () => 100,
    }).query({ agentId: "bot", scope });
    if (!r.ok) {
      throw new Error("failed");
    }
    expect(r.facts).toHaveLength(2);
  });
  it("retains immutable identity tombstones after TTL and enforces private modes", async () => {
    const root = await setup();
    let now = 100;
    const j = createExecutionJournal({
      rootDir: root,
      enabled: () => true,
      now: () => now,
      ttlMs: 10,
    });
    await j.appendFact({ agentId: "bot", fact: fact() });
    now = 110;
    expect(
      await j.appendFact({ agentId: "bot", fact: { ...fact(), stage: "failed" } }),
    ).toMatchObject({ ok: false, reason: "immutable_conflict" });
    const file = path.join(root, (await fs.readdir(root)).find((n) => n.endsWith(".json"))!);
    expect((await fs.stat(root)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });
  it("refuses contradictory version links over the same execution facts", async () => {
    const root = await setup();
    const j = createExecutionJournal({ rootDir: root, enabled: () => true, now: () => 100 });
    await j.appendFact({ agentId: "bot", fact: fact() });
    const receipt = {
      receiptId: "one",
      scope,
      taskId: "task",
      runId: "run",
      outcomeVersion: 1,
      attemptId: "attempt",
      attemptGranularity: "turn" as const,
      eventIds: ["start"],
    };
    expect((await j.appendLink({ agentId: "bot", receipt })).ok).toBe(true);
    expect(
      await j.appendLink({
        agentId: "bot",
        receipt: { ...receipt, receiptId: "two", outcomeVersion: 2 },
      }),
    ).toMatchObject({ ok: false, reason: "link_version_conflict" });
  });
});
