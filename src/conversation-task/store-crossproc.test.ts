import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileKeyForTenant } from "./canonical.js";
import { SqliteActivationControlPlane } from "./control-plane.js";
import { openTaskStore } from "./store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "__fixtures__");

/** Build the argv to run a TS worker under the current runtime (bun or node+tsx). */
function workerArgv(workerFile: string, args: string[]): string[] {
  const workerPath = path.join(FIXTURES, workerFile);
  const underBun = Boolean((process as unknown as { versions?: { bun?: string } }).versions?.bun);
  return underBun ? [workerPath, ...args] : ["--import", "tsx", workerPath, ...args];
}

function spawnWorker(workerFile: string, args: string[]): ChildProcess {
  return spawn(process.execPath, workerArgv(workerFile, args), {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Run a worker to completion and resolve with its full stdout. */
function runWorker(workerFile: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnWorker(workerFile, args);
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += String(d)));
    child.stderr?.on("data", (d) => (err += String(d)));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(out);
      } else {
        reject(new Error(`worker exited ${code}: ${err}`));
      }
    });
  });
}

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-xproc-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function dbPathFor(tenantId: string): string {
  return path.join(root, "tenant", `${fileKeyForTenant(tenantId)}.db`);
}

describe("B3 — real cross-process CAS concurrency", () => {
  it("yields exactly one active task across many concurrent worker processes", async () => {
    // Pre-create schema + meta so workers open an initialized DB.
    openTaskStore({ tenantId: "tenant-a", storeRoot: root }).close();

    const WORKERS = 10;
    const ATTEMPTS = 12; // 120 real cross-process write races on one tuple
    const runs = Array.from({ length: WORKERS }, () =>
      runWorker("cas-worker.ts", [
        "tenant-a",
        root,
        "conv-1",
        "每天监控竞品价格并汇报",
        "1",
        String(ATTEMPTS),
      ]),
    );
    const outputs = await Promise.all(runs);

    const totals = outputs.reduce(
      (acc, out) => {
        const line = out.trim().split("\n").filter(Boolean).at(-1) ?? "{}";
        const r = JSON.parse(line) as {
          attempted: number;
          succeeded: number;
          failed: number;
          created: number;
        };
        return {
          attempted: acc.attempted + r.attempted,
          succeeded: acc.succeeded + r.succeeded,
          failed: acc.failed + r.failed,
          created: acc.created + r.created,
        };
      },
      { attempted: 0, succeeded: 0, failed: 0, created: 0 },
    );

    // Every concurrent request must converge (no silent failures); exactly one creates.
    expect(totals.attempted).toBeGreaterThanOrEqual(100);
    expect(totals.succeeded).toBe(totals.attempted); // all converged, none dropped
    expect(totals.failed).toBe(0); // no unrecovered contention failures
    expect(totals.created).toBe(1); // exactly one winner across all processes

    const store = openTaskStore({ tenantId: "tenant-a", storeRoot: root });
    expect(store.countTasksByLifecycle("active")).toBe(1);
    store.close();
  }, 30_000);
});

describe("B7 — real crash injection (SIGKILL mid-transaction)", () => {
  it("recovers with no partial row and the committed row intact after a killed writer", async () => {
    // Commit a baseline candidate, then close.
    const store = openTaskStore({ tenantId: "tenant-a", storeRoot: root });
    store.createCandidateIfAbsent({
      conversationId: "conv-1",
      sourceMessageId: "committed",
      decisionVersion: "v1",
      detection: { detected: true, signals: {} as never, confidence: "high", reasons: [] },
      qualification: { kind: "chat", reasons: [] },
      ttlMs: 9_999_999,
    });
    store.close();

    // Child opens BEGIN IMMEDIATE + uncommitted INSERT, signals READY, then hangs.
    const child = spawnWorker("crash-worker.ts", [dbPathFor("tenant-a"), "abandoned"]);
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("worker did not signal READY")), 20_000);
      child.stdout?.on("data", (d) => {
        buf += String(d);
        if (buf.includes("READY")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("error", reject);
    });

    // Kill mid-transaction and wait for the process to actually exit.
    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
      child.kill("SIGKILL");
    });

    // Reopen: WAL recovery must drop the uncommitted row, keep the committed one.
    const reopened = openTaskStore({ tenantId: "tenant-a", storeRoot: root });
    expect(
      reopened.getCandidate({
        conversationId: "conv-1",
        sourceMessageId: "abandoned",
        decisionVersion: "v1",
      }),
    ).toBeNull();
    expect(
      reopened.getCandidate({
        conversationId: "conv-1",
        sourceMessageId: "committed",
        decisionVersion: "v1",
      }),
    ).not.toBeNull();
    reopened.close();
  }, 30_000);
});

describe("P0-A / P1 — force-off and controlled reopen are durable + shared across processes", () => {
  it("a child force-off is seen by the parent; a child controlled reopen is seen by the parent", async () => {
    // Child A force-disables activation; the parent (separate process) sees it.
    await runWorker("cp-worker.ts", ["forceOff", root, "degrade-from-child"]);
    const afterForceOff = new SqliteActivationControlPlane({
      storeRoot: root,
      minReopenIntervalMs: 0,
    });
    expect(afterForceOff.isForcedOff()).toBe(true);
    afterForceOff.close();

    // A separate child performs the controlled reopen; the parent observes it,
    // including the recorded operator id (durable + shared).
    await runWorker("cp-worker.ts", ["reopen", root, "op-child"]);
    const afterReopen = new SqliteActivationControlPlane({
      storeRoot: root,
      minReopenIntervalMs: 0,
    });
    expect(afterReopen.isForcedOff()).toBe(false);
    expect(afterReopen.snapshot().lastReopenActor).toBe("op-child");
    afterReopen.close();
  }, 30_000);
});
