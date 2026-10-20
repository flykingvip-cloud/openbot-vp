import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPersistentStageDStore } from "./item7-stage-d-persistent-store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "__fixtures__");

function workerArgv(workerFile: string, args: string[]): string[] {
  const workerPath = path.join(FIXTURES, workerFile);
  const underBun = Boolean((process as unknown as { versions?: { bun?: string } }).versions?.bun);
  return underBun ? [workerPath, ...args] : ["--import", "tsx", workerPath, ...args];
}

function runWorker(workerFile: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, workerArgv(workerFile, args), {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d) => (out += String(d)));
    child.stderr?.on("data", (d) => (err += String(d)));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`worker ${code}: ${err}`)),
    );
  });
}

function lastJson(out: string): {
  acquired?: boolean;
  reason?: string;
  action?: string;
  blocked?: boolean;
} {
  const line = out.trim().split("\n").filter(Boolean).at(-1) ?? "{}";
  return JSON.parse(line);
}

let stateDir: string;
beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-d-xproc-"));
});
afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("Stage D persistent store — real cross-process fencing", () => {
  it("only ONE of many concurrent processes acquires the same fence", async () => {
    const fence = "memory-sync:ws:tenant-a:user:user-1:asset:race";
    const N = 8;
    const outputs = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        runWorker("stage-d-fence-worker.ts", [stateDir, fence, `op-${i}`, `tok-${i}`, "acquire"]),
      ),
    );
    const acquired = outputs.map(lastJson).filter((r) => r.acquired === true);
    const denied = outputs.map(lastJson).filter((r) => r.acquired === false);
    expect(acquired.length).toBe(1); // exactly one winner across all processes
    expect(denied.length).toBe(N - 1);
    for (const d of denied) {
      expect(d.reason).toBe("concurrent");
    }
    // The parent observes the single durable held record.
    const store = createPersistentStageDStore({ stateDir });
    expect(store.heldRecord(fence)?.state).toBe("acquired");
  }, 30_000);

  it("a completion written by a child process replays in a fresh parent store (restart)", async () => {
    const fence = "memory-sync:ws:tenant-a:user:user-1:asset:complete";
    const out = await runWorker("stage-d-fence-worker.ts", [
      stateDir,
      fence,
      "op-complete",
      "tok-c",
      "complete",
    ]);
    expect(lastJson(out).acquired).toBe(true);
    // Fresh store instance = restart; the durable completion is still replayable.
    const reopened = createPersistentStageDStore({ stateDir });
    const record = reopened.completedRecord("op-complete");
    expect(record?.operationId).toBe("op-complete");
    expect(record?.sourceResourceId).toBe("ws:tenant-a:user:user-1:asset:complete");
  }, 30_000);

  it("a recovery_required block written by a child still blocks a fresh parent store (restart)", async () => {
    const fence = "memory-sync:ws:tenant-a:user:user-1:asset:recover";
    const out = await runWorker("stage-d-fence-worker.ts", [
      stateDir,
      fence,
      "op-recover",
      "tok-r",
      "recover",
    ]);
    expect(lastJson(out).blocked).toBe(true);
    const reopened = createPersistentStageDStore({ stateDir });
    expect(reopened.isRecoveryBlocked(fence)).toBe(true);
    expect(reopened.tryAcquire(fence, "op-new", "tok-new")).toEqual({
      acquired: false,
      reason: "concurrent",
    });
  }, 30_000);
});
