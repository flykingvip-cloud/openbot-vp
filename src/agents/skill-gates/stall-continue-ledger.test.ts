import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXECUTION_STALL_CONTINUE_LIMIT } from "../execution-stall-continue.js";
import {
  canStallContinue,
  claimStallContinue,
  readStallContinueUsed,
  STALL_CONTINUE_EXHAUSTED_REASON,
  stallContinueLedgerSessionDir,
} from "./stall-continue-ledger.js";

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

    const first = claimStallContinue({ ledgerDir, sessionKey, nowMs: 1 });
    expect(first.allowed).toBe(true);
    expect(first.continuesUsed).toBe(1);
    expect(first.exhausted).toBe(false);

    const second = claimStallContinue({ ledgerDir, sessionKey, nowMs: 2 });
    expect(second.allowed).toBe(true);
    expect(second.continuesUsed).toBe(2);
    expect(second.exhausted).toBe(true);
    expect(second.stopReason).toBe(STALL_CONTINUE_EXHAUSTED_REASON);

    const third = claimStallContinue({ ledgerDir, sessionKey, nowMs: 3 });
    expect(third.allowed).toBe(false);
    expect(third.exhausted).toBe(true);
    expect(third.stopReason).toBe(STALL_CONTINUE_EXHAUSTED_REASON);
    expect(third.continuesUsed).toBe(EXECUTION_STALL_CONTINUE_LIMIT);
    expect(canStallContinue({ ledgerDir, sessionKey })).toBe(false);
  });

  it("survives process restart: recount from filesystem, cannot bypass ≤2", () => {
    const ledgerDir = tempLedger();
    const sessionKey = "agent:main:restart";

    expect(claimStallContinue({ ledgerDir, sessionKey }).allowed).toBe(true);
    expect(claimStallContinue({ ledgerDir, sessionKey }).allowed).toBe(true);

    // Simulate restart: drop all in-memory state; only ledgerDir on disk remains.
    const usedAfterRestart = readStallContinueUsed({ ledgerDir, sessionKey });
    expect(usedAfterRestart).toBe(EXECUTION_STALL_CONTINUE_LIMIT);
    expect(canStallContinue({ ledgerDir, sessionKey })).toBe(false);

    const afterRestart = claimStallContinue({ ledgerDir, sessionKey });
    expect(afterRestart.allowed).toBe(false);
    expect(afterRestart.stopReason).toBe(STALL_CONTINUE_EXHAUSTED_REASON);

    // Slots are real files under the session digest dir.
    const sessionDir = stallContinueLedgerSessionDir(ledgerDir, sessionKey);
    expect(fs.existsSync(path.join(sessionDir, "continue-1.json"))).toBe(true);
    expect(fs.existsSync(path.join(sessionDir, "continue-2.json"))).toBe(true);
  });

  it("concurrency: overlapping claims cannot exceed the limit (wx slots)", async () => {
    const ledgerDir = tempLedger();
    const sessionKey = "agent:main:race";

    const workers = 8;
    const results = await Promise.all(
      Array.from({ length: workers }, (_, i) =>
        Promise.resolve().then(() =>
          claimStallContinue({ ledgerDir, sessionKey, nowMs: 1000 + i }),
        ),
      ),
    );

    const allowed = results.filter((row) => row.allowed);
    const denied = results.filter((row) => !row.allowed);
    expect(allowed.length).toBe(EXECUTION_STALL_CONTINUE_LIMIT);
    expect(denied.length).toBe(workers - EXECUTION_STALL_CONTINUE_LIMIT);
    expect(readStallContinueUsed({ ledgerDir, sessionKey })).toBe(EXECUTION_STALL_CONTINUE_LIMIT);
    expect(denied.every((row) => row.stopReason === STALL_CONTINUE_EXHAUSTED_REASON)).toBe(true);

    // Claimed slots are unique 1..limit
    const slots = allowed.map((row) => row.claimedSlot).toSorted((a, b) => (a ?? 0) - (b ?? 0));
    expect(slots).toEqual([1, 2]);
  });

  it("isolates counters per sessionKey", () => {
    const ledgerDir = tempLedger();
    expect(claimStallContinue({ ledgerDir, sessionKey: "s1" }).continuesUsed).toBe(1);
    expect(claimStallContinue({ ledgerDir, sessionKey: "s2" }).continuesUsed).toBe(1);
    expect(readStallContinueUsed({ ledgerDir, sessionKey: "s1" })).toBe(1);
    expect(readStallContinueUsed({ ledgerDir, sessionKey: "s2" })).toBe(1);
  });
});
