import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { BExecutionServer } from "./b-server.js";
import { isolationProfile } from "./config.js";
import { mintLease } from "./lease.js";
import {
  FileExecStore,
  injectTornPersistForTest,
  STORE_LOCK_SOCK_NAME,
  type ExecStoreSnapshot,
} from "./store.js";
import {
  MAX_REQUEST_BODY_BYTES,
  TEST_SUBJECT,
  TEST_TENANT,
  getFreePort,
  inlineJsonInput,
  uniqueIdempotencyKey,
} from "./test-helpers.js";
import type { ExecTaskRecord } from "./types.js";

const execFileAsync = promisify(execFile);
const workerPath = fileURLToPath(new URL("./store-lock-worker.ts", import.meta.url));
const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function sampleTask(taskId: string): ExecTaskRecord {
  const now = new Date(1_700_000_000_000).toISOString();
  return {
    taskId,
    toolCallId: `tool-${taskId}`,
    tenantId: TEST_TENANT,
    subject: TEST_SUBJECT,
    kind: "echo",
    idempotencyKey: uniqueIdempotencyKey(),
    intentCanonical: "{}",
    state: "accepted",
    input: inlineJsonInput({ lock: true }),
    createdAt: now,
    updatedAt: now,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    idempotencyExpiresAtMs: 1_700_086_400_000,
    artifacts: [],
    stateVersion: 1,
  };
}

async function waitForFile(path: string, timeoutMs = 8000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${path}`);
}

function spawnWorker(dir: string, readyPath: string, resultPath: string, mode: string) {
  return spawn(
    process.execPath,
    ["--import", "tsx", workerPath, dir, readyPath, resultPath, mode],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function waitExit(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
}

describe("cross-process single-writer lock and persist recovery", () => {
  it("records the local filesystem under test and refuses untested network FS use", async () => {
    const dir = await tempDir("exec-lock-fs-");
    const { stdout: dfOut } = await execFileAsync("df", ["-T", dir]);
    const { stdout: mntOut } = await execFileAsync("findmnt", [
      "-T",
      dir,
      "-o",
      "TARGET,FSTYPE,SOURCE",
    ]);
    const combined = `${dfOut}\n${mntOut}`;
    expect(combined).toMatch(/ext4|xfs|btrfs|overlay|tmpfs|virtiofs|9p|fuse/);
    expect(combined.toLowerCase()).not.toMatch(/\bnfs\b/);
    expect(combined.toLowerCase()).not.toMatch(/\bcifs\b|\bsmb\b/);
    // The fence is documented as local-POSIX only in FileExecStore.
  });

  it("allows only one of two OS processes to become the writer of the same directory", async () => {
    const dir = await tempDir("exec-lock-race-");
    const firstReady = join(dir, "first.ready");
    const firstResult = join(dir, "first.result");
    const secondReady = join(dir, "second.ready");
    const secondResult = join(dir, "second.result");
    const first = spawnWorker(dir, firstReady, firstResult, "hold");
    await waitForFile(firstReady);
    const firstPayload = JSON.parse(await readFile(firstResult, "utf8")) as { ok: boolean };
    expect(firstPayload.ok).toBe(true);
    const second = spawnWorker(dir, secondReady, secondResult, "acquire-once");
    await waitForFile(secondReady);
    const secondPayload = JSON.parse(await readFile(secondResult, "utf8")) as {
      ok: boolean;
      error?: string;
    };
    expect(secondPayload.ok).toBe(false);
    expect(secondPayload.error).toMatch(/another process already holds this store/);
    first.kill("SIGTERM");
    second.kill("SIGTERM");
    await Promise.all([waitExit(first), waitExit(second)]);
  });

  it("recovers the lock after the holder is SIGKILL'd and does not steal a live holder sock", async () => {
    const dir = await tempDir("exec-lock-kill-");
    const readyPath = join(dir, "holder.ready");
    const resultPath = join(dir, "holder.result");
    const holder = spawnWorker(dir, readyPath, resultPath, "hold");
    await waitForFile(readyPath);
    const holderPid = JSON.parse(await readFile(resultPath, "utf8")) as { pid: number };
    const stealReady = join(dir, "steal.ready");
    const stealResult = join(dir, "steal.result");
    const stealer = spawnWorker(dir, stealReady, stealResult, "acquire-once");
    await waitForFile(stealReady);
    const stealPayload = JSON.parse(await readFile(stealResult, "utf8")) as { ok: boolean };
    expect(stealPayload.ok).toBe(false);
    stealer.kill("SIGTERM");
    holder.kill("SIGKILL");
    await Promise.all([waitExit(stealer), waitExit(holder)]);
    const recoverReady = join(dir, "recover.ready");
    const recoverResult = join(dir, "recover.result");
    const recovered = spawnWorker(dir, recoverReady, recoverResult, "hold");
    await waitForFile(recoverReady);
    const recoverPayload = JSON.parse(await readFile(recoverResult, "utf8")) as { ok: boolean };
    expect(recoverPayload.ok).toBe(true);
    expect(holderPid.pid).toBeTypeOf("number");
    recovered.kill("SIGTERM");
    await waitExit(recovered);
  });

  it("releases the lock on stop and on a failed start so a new process can open the store", async () => {
    const dir = await tempDir("exec-lock-start-");
    const port = await getFreePort();
    const { createServer } = await import("node:net");
    const occupied = createServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(port, "127.0.0.1", () => resolve());
    });
    const store = new FileExecStore(dir);
    await store.load();
    const server = new BExecutionServer({
      config: isolationProfile({ port }),
      store,
      maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
    });
    await expect(server.start()).rejects.toThrow();
    const again = new FileExecStore(dir);
    await again.load();
    await again.close();
    occupied.close();

    const okPort = await getFreePort();
    const liveStore = new FileExecStore(dir);
    const live = new BExecutionServer({
      config: isolationProfile({ port: okPort }),
      store: liveStore,
      maxRequestBodyBytes: MAX_REQUEST_BODY_BYTES,
    });
    await live.start();
    const minted = mintLease({
      subject: TEST_SUBJECT,
      nowMs: Date.now(),
      ttlMs: 60_000,
      tenantId: TEST_TENANT,
    });
    await live.registerLease(minted.record);
    await live.stop();
    const afterStop = new FileExecStore(dir);
    await afterStop.load();
    expect(afterStop.data().leases[minted.record.hash]).toBeDefined();
    await afterStop.close();
  });

  it("recovers a torn mid-write persist through the documented test helper, not a clean close", async () => {
    const dir = await tempDir("exec-lock-torn-");
    const store = new FileExecStore(dir);
    await store.load();
    const first = sampleTask("task-torn-1");
    await store.upsertTask(first);
    const committed = structuredClone(store.data());
    const newer = structuredClone(committed);
    const second = sampleTask("task-torn-2");
    second.stateVersion = 1;
    newer.tasks[second.taskId] = second;
    await store.close();

    await injectTornPersistForTest(dir, {
      tornControlContents: '{"tasks":{"task-torn-1":',
      completeTmpSnapshot: newer,
    });
    const recovered = new FileExecStore(dir);
    await recovered.load();
    expect(recovered.getTask("task-torn-1")?.taskId).toBe("task-torn-1");
    expect(recovered.getTask("task-torn-2")?.taskId).toBe("task-torn-2");
    await recovered.close();

    const dir2 = await tempDir("exec-lock-torn-keep-");
    const keep = new FileExecStore(dir2);
    await keep.load();
    await keep.upsertTask(sampleTask("task-keep"));
    const good = structuredClone(keep.data());
    await keep.close();
    const staleTmp: ExecStoreSnapshot = structuredClone(good);
    staleTmp.tasks["should-not-appear"] = sampleTask("should-not-appear");
    await injectTornPersistForTest(dir2, {
      completeTmpSnapshot: staleTmp,
    });
    const reopened = new FileExecStore(dir2);
    await reopened.load();
    expect(reopened.getTask("task-keep")).toBeDefined();
    expect(reopened.getTask("should-not-appear")).toBeUndefined();
    await reopened.close();
  });

  it("treats incrementProbe as diagnostic-only and does not mix a failed probe persist into task success", async () => {
    const dir = await tempDir("exec-lock-probe-");
    const store = new FileExecStore(dir);
    try {
      await store.load();
      const task = sampleTask("task-probe-1");
      await store.upsertTask(task);
      expect(store.getProbe("probe-1")).toBe(0);
      store.failNextPersist(1);
      await expect(store.incrementProbe("probe-1")).rejects.toThrow(/injected persist failure/);
      expect(store.getProbe("probe-1")).toBe(0);
      expect(store.getTask(task.taskId)?.state).toBe("accepted");
      expect(store.getTask(task.taskId)?.stateVersion).toBe(1);

      task.sideEffectApplied = true;
      store.failNextPersist(1);
      await expect(store.commitTaskAndDiagnosticProbe(task, "probe-1")).rejects.toThrow(
        /injected persist failure/,
      );
      expect(store.getProbe("probe-1")).toBe(0);
      expect(store.getTask(task.taskId)?.sideEffectApplied).toBeUndefined();
      expect(store.getTask(task.taskId)?.state).toBe("accepted");

      const live = store.getTask(task.taskId);
      if (!live) {
        throw new Error("expected task");
      }
      live.sideEffectApplied = true;
      const count = await store.commitTaskAndDiagnosticProbe(live, "probe-1");
      expect(count).toBe(1);
      expect(store.getProbe("probe-1")).toBe(1);
      expect(store.getTask(task.taskId)?.sideEffectApplied).toBe(true);
      expect(store.getTask(task.taskId)?.state).toBe("accepted");
    } finally {
      await store.close();
    }
  });

  it("exposes the lock socket name used by the local-POSIX fence", () => {
    expect(STORE_LOCK_SOCK_NAME).toBe("store.lock.sock");
  });
});
