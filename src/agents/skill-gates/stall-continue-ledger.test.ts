import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { EXECUTION_STALL_CONTINUE_LIMIT } from "../execution-stall-continue.js";
import {
  canStallContinue,
  claimStallContinue,
  readStallContinueUsed,
  STALL_CONTINUE_EXHAUSTED_REASON,
  stallContinueLedgerCycleDir,
} from "./stall-continue-ledger.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CLAIM_WORKER = path.join(import.meta.dirname, "__fixtures__/stall-continue-claim-worker.mjs");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempLedger(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-stall-ledger-"));
  tempDirs.push(dir);
  return dir;
}

describe("stall-continue durable ledger", () => {
  it(`claims at most ${EXECUTION_STALL_CONTINUE_LIMIT} continues then exhausts with stop reason`, () => {
    const ledgerDir = tempLedger();
    const sessionKey = "agent:main:sess-a";
    const quotaCycleId = "task-cycle-a";

    const first = claimStallContinue({ ledgerDir, sessionKey, quotaCycleId, nowMs: 1 });
    expect(first.allowed).toBe(true);
    expect(first.continuesUsed).toBe(1);
    expect(first.exhausted).toBe(false);

    const second = claimStallContinue({ ledgerDir, sessionKey, quotaCycleId, nowMs: 2 });
    expect(second.allowed).toBe(true);
    expect(second.continuesUsed).toBe(2);
    expect(second.exhausted).toBe(true);
    expect(second.stopReason).toBe(STALL_CONTINUE_EXHAUSTED_REASON);

    const third = claimStallContinue({ ledgerDir, sessionKey, quotaCycleId, nowMs: 3 });
    expect(third.allowed).toBe(false);
    expect(third.exhausted).toBe(true);
    expect(third.stopReason).toBe(STALL_CONTINUE_EXHAUSTED_REASON);
    expect(third.continuesUsed).toBe(EXECUTION_STALL_CONTINUE_LIMIT);
    expect(canStallContinue({ ledgerDir, sessionKey, quotaCycleId })).toBe(false);
  });

  it("task lifecycle: same task restart shares quota; new task gets independent quota", () => {
    const ledgerDir = tempLedger();
    const sessionKey = "agent:main:chat-1";
    const taskA = "task-aaa";
    const taskB = "task-bbb";

    expect(claimStallContinue({ ledgerDir, sessionKey, quotaCycleId: taskA }).allowed).toBe(true);
    expect(claimStallContinue({ ledgerDir, sessionKey, quotaCycleId: taskA }).allowed).toBe(true);
    expect(claimStallContinue({ ledgerDir, sessionKey, quotaCycleId: taskA }).allowed).toBe(false);

    // Same task retry/restart still exhausted.
    expect(
      claimStallContinue({ ledgerDir, sessionKey, quotaCycleId: taskA, nowMs: 99 }).allowed,
    ).toBe(false);

    // New task in the same chat session gets a fresh ≤2 quota.
    const b1 = claimStallContinue({ ledgerDir, sessionKey, quotaCycleId: taskB, nowMs: 100 });
    expect(b1.allowed).toBe(true);
    expect(b1.continuesUsed).toBe(1);
    expect(readStallContinueUsed({ ledgerDir, sessionKey, quotaCycleId: taskA })).toBe(
      EXECUTION_STALL_CONTINUE_LIMIT,
    );
    expect(readStallContinueUsed({ ledgerDir, sessionKey, quotaCycleId: taskB })).toBe(1);
  });

  it("resume cannot swap quotaCycleId to bypass an exhausted task", () => {
    const ledgerDir = tempLedger();
    const sessionKey = "agent:main:swap";
    const taskA = "task-original";
    const forgedFresh = "task-forged-fresh";

    expect(claimStallContinue({ ledgerDir, sessionKey, quotaCycleId: taskA }).allowed).toBe(true);
    expect(claimStallContinue({ ledgerDir, sessionKey, quotaCycleId: taskA }).allowed).toBe(true);

    // Claiming under a different cycle does not refill taskA — A stays exhausted.
    expect(claimStallContinue({ ledgerDir, sessionKey, quotaCycleId: forgedFresh }).allowed).toBe(
      true,
    );
    expect(claimStallContinue({ ledgerDir, sessionKey, quotaCycleId: taskA }).allowed).toBe(false);
    expect(readStallContinueUsed({ ledgerDir, sessionKey, quotaCycleId: taskA })).toBe(
      EXECUTION_STALL_CONTINUE_LIMIT,
    );
  });

  it("fail-closes when quotaCycleId is missing", () => {
    const ledgerDir = tempLedger();
    const denied = claimStallContinue({
      ledgerDir,
      sessionKey: "s",
      quotaCycleId: "  ",
    });
    expect(denied.allowed).toBe(false);
    expect(denied.stopReason).toBe(STALL_CONTINUE_EXHAUSTED_REASON);
  });

  it("isolates counters per sessionKey under the same cycle id", () => {
    const ledgerDir = tempLedger();
    const cycle = "task-shared-name";
    expect(
      claimStallContinue({ ledgerDir, sessionKey: "s1", quotaCycleId: cycle }).continuesUsed,
    ).toBe(1);
    expect(
      claimStallContinue({ ledgerDir, sessionKey: "s2", quotaCycleId: cycle }).continuesUsed,
    ).toBe(1);
    expect(readStallContinueUsed({ ledgerDir, sessionKey: "s1", quotaCycleId: cycle })).toBe(1);
    expect(readStallContinueUsed({ ledgerDir, sessionKey: "s2", quotaCycleId: cycle })).toBe(1);
  });
});

describe("stall-continue real multi-process + exit-restart", () => {
  function runClaimWorker(env: Record<string, string>) {
    return execFileAsync(process.execPath, ["--import", "tsx", CLAIM_WORKER], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      timeout: 60_000,
    });
  }

  it("real child-process concurrency: 8 workers cannot exceed ≤2 (O_EXCL)", async () => {
    const ledgerDir = tempLedger();
    const sessionKey = "agent:main:xproc-race";
    const quotaCycleId = "task-xproc";
    const workers = 8;
    const results = await Promise.all(
      Array.from({ length: workers }, (_, i) =>
        runClaimWorker({
          OPENBOT_STALL_LEDGER_DIR: ledgerDir,
          OPENBOT_STALL_SESSION_KEY: sessionKey,
          OPENBOT_STALL_QUOTA_CYCLE_ID: quotaCycleId,
          OPENBOT_STALL_NOW_MS: String(1000 + i),
          OPENBOT_STALL_WORKER_ID: `w${i}`,
        }),
      ),
    );

    const lines = results.flatMap((row) =>
      row.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const ok = lines.filter((l) => l.startsWith("claim-ok:"));
    const fail = lines.filter((l) => l.startsWith("claim-fail:"));
    expect(ok).toHaveLength(EXECUTION_STALL_CONTINUE_LIMIT);
    expect(fail).toHaveLength(workers - EXECUTION_STALL_CONTINUE_LIMIT);
    expect(readStallContinueUsed({ ledgerDir, sessionKey, quotaCycleId })).toBe(
      EXECUTION_STALL_CONTINUE_LIMIT,
    );
    const slots = ok
      .map((line) => {
        const m = /slot:(\d+)/.exec(line);
        return m ? Number(m[1]) : NaN;
      })
      .toSorted((a, b) => a - b);
    expect(slots).toEqual([1, 2]);
  }, 90_000);

  it("process exit then restart: child exhausts ≤2, parent process still denied", async () => {
    const ledgerDir = tempLedger();
    const sessionKey = "agent:main:xproc-restart";
    const quotaCycleId = "task-restart";

    // Child process claims both slots then exits (separate V8 isolate).
    await runClaimWorker({
      OPENBOT_STALL_LEDGER_DIR: ledgerDir,
      OPENBOT_STALL_SESSION_KEY: sessionKey,
      OPENBOT_STALL_QUOTA_CYCLE_ID: quotaCycleId,
      OPENBOT_STALL_NOW_MS: "1",
      OPENBOT_STALL_WORKER_ID: "boot-1",
    });
    await runClaimWorker({
      OPENBOT_STALL_LEDGER_DIR: ledgerDir,
      OPENBOT_STALL_SESSION_KEY: sessionKey,
      OPENBOT_STALL_QUOTA_CYCLE_ID: quotaCycleId,
      OPENBOT_STALL_NOW_MS: "2",
      OPENBOT_STALL_WORKER_ID: "boot-2",
    });

    // Parent (this vitest process) recounts from disk only — no in-memory carry.
    expect(readStallContinueUsed({ ledgerDir, sessionKey, quotaCycleId })).toBe(
      EXECUTION_STALL_CONTINUE_LIMIT,
    );
    const afterRestart = claimStallContinue({ ledgerDir, sessionKey, quotaCycleId, nowMs: 3 });
    expect(afterRestart.allowed).toBe(false);
    expect(afterRestart.stopReason).toBe(STALL_CONTINUE_EXHAUSTED_REASON);

    // A third child after exit is also denied.
    const third = await runClaimWorker({
      OPENBOT_STALL_LEDGER_DIR: ledgerDir,
      OPENBOT_STALL_SESSION_KEY: sessionKey,
      OPENBOT_STALL_QUOTA_CYCLE_ID: quotaCycleId,
      OPENBOT_STALL_NOW_MS: "4",
      OPENBOT_STALL_WORKER_ID: "post-restart",
    });
    expect(third.stdout).toContain("claim-fail:");
    expect(third.stdout).toContain(STALL_CONTINUE_EXHAUSTED_REASON);

    const cycleDir = stallContinueLedgerCycleDir(ledgerDir, sessionKey, quotaCycleId);
    expect(fs.existsSync(path.join(cycleDir, "continue-1.json"))).toBe(true);
    expect(fs.existsSync(path.join(cycleDir, "continue-2.json"))).toBe(true);
  }, 90_000);
});
