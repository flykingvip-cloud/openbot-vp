import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  recordAsyncWaitJobIntent,
  resetAsyncWaitJobIndexForTests,
  transitionAsyncWaitJobIntent,
} from "./async-wait-job.js";
import {
  claimFollowupRecoveryForResume,
  markFollowupRecoveryClaimEnqueued,
  recordBlockedFollowupDelivery,
} from "./blocked-followup-delivery.js";
import {
  assertFencingGenerationMatch,
  assertMonotonicFencingGeneration,
  nextFencingGeneration,
  StaleFencingGenerationError,
} from "./fencing.js";
import {
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  StaleSessionTaskBoardWriteError,
  writeSessionTaskBoard,
} from "./task-board-file.js";
import {
  commitToolOperationWriteIntent,
  executeClaimedToolOperation,
  readToolOperation,
  reconcileClaimedToolOperation,
  withToolOperationAdmission,
} from "./tool-operation.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  resetAsyncWaitJobIndexForTests();
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("storage-level fencingGeneration guard", () => {
  it("validates matching and monotonic fencing generations", () => {
    expect(() =>
      assertFencingGenerationMatch({ expectedGeneration: 2, currentGeneration: 2 }),
    ).not.toThrow();
    expect(() =>
      assertFencingGenerationMatch({
        expectedGeneration: undefined,
        currentGeneration: 0,
        allowBootstrapWhenZero: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertFencingGenerationMatch({ expectedGeneration: 1, currentGeneration: 2, resource: "r" }),
    ).toThrow(StaleFencingGenerationError);
    expect(() =>
      assertMonotonicFencingGeneration({ currentGeneration: 3, nextGeneration: 2, resource: "r" }),
    ).toThrow(StaleFencingGenerationError);
    expect(nextFencingGeneration(undefined)).toBe(1);
    expect(nextFencingGeneration(4)).toBe(5);
  });

  it("rejects stale writers on session task board write and mutate", async () => {
    const dir = await makeTempDir("fence-board-");
    const sessionFile = path.join(dir, "session.jsonl");
    await fs.writeFile(sessionFile, "");

    mutateSessionTaskBoard(sessionFile, () => ({
      board: emptySessionTaskBoard(),
      value: undefined,
    }));
    const gen1 = readSessionTaskBoard(sessionFile);
    expect(gen1.writeEpoch).toBe(1);

    mutateSessionTaskBoard(sessionFile, (live) => ({ board: live, value: undefined }), {
      expectedWriteEpoch: 1,
    });
    const gen2 = readSessionTaskBoard(sessionFile);
    expect(gen2.writeEpoch).toBe(2);

    expect(() => writeSessionTaskBoard(sessionFile, gen1)).toThrow(StaleSessionTaskBoardWriteError);
    expect(() => writeSessionTaskBoard(sessionFile, gen1)).toThrow(StaleFencingGenerationError);
    expect(() =>
      mutateSessionTaskBoard(sessionFile, (live) => ({ board: live, value: undefined }), {
        expectedWriteEpoch: 1,
      }),
    ).toThrow(StaleSessionTaskBoardWriteError);
  });

  it("rejects stale expectedFencingGeneration and claimGeneration regression on async-wait-job", async () => {
    const dir = await makeTempDir("fence-wait-");
    const sessionFile = path.join(dir, "session.jsonl");
    await fs.writeFile(sessionFile, "");

    const created = recordAsyncWaitJobIntent({
      jobId: "job-1",
      sessionKey: "agent:main:main",
      sessionFile,
      taskId: "task-1",
      executionAttempt: "attempt-1",
      deliverableVersion: "v1",
      startedAt: 1000,
    });
    expect(created?.fencingGeneration).toBe(0);

    const bumped = transitionAsyncWaitJobIntent(
      sessionFile,
      "job-1",
      (current) =>
        current
          ? {
              ...current,
              recovery: {
                stage: "claimed",
                claimGeneration: 2,
                claimToken: "tok-2",
              },
            }
          : undefined,
      { expectedFencingGeneration: 0 },
    );
    expect(bumped?.fencingGeneration).toBe(2);

    expect(() =>
      transitionAsyncWaitJobIntent(sessionFile, "job-1", (current) => current, {
        expectedFencingGeneration: 1,
      }),
    ).toThrow(StaleFencingGenerationError);

    expect(() =>
      transitionAsyncWaitJobIntent(sessionFile, "job-1", (current) =>
        current
          ? {
              ...current,
              recovery: {
                stage: "claimed",
                claimGeneration: 1,
                claimToken: "stale-tok",
              },
            }
          : undefined,
      ),
    ).toThrow(StaleFencingGenerationError);
  });

  it("rejects stale expectedFencingGeneration on blocked-followup-delivery mutations", async () => {
    const dir = await makeTempDir("fence-followup-");
    const record = await recordBlockedFollowupDelivery({
      persistRoot: dir,
      sessionKey: "agent:main:main",
      jobId: "job-f1",
      taskId: "task-f1",
      destination: "recoverable_wait",
      reason: "missing_evidence",
      error: "waiting",
      missingItems: [],
      retryCap: 3,
      resume: {
        deliveryOnly: false,
        payloads: [{ text: "hello" }],
      },
    });
    expect(record.fencingGeneration).toBe(1);

    const claimed = await claimFollowupRecoveryForResume({
      persistRoot: dir,
      record,
    });
    expect(claimed).toMatchObject({ ok: true });
    if (!claimed.ok) {
      throw new Error("expected claim ok");
    }
    expect(claimed.record.fencingGeneration).toBe(2);

    await expect(
      markFollowupRecoveryClaimEnqueued({
        persistRoot: dir,
        record: claimed.record,
        claimToken: claimed.claimToken,
        expectedFencingGeneration: 1,
      }),
    ).rejects.toThrow(StaleFencingGenerationError);

    const enqueued = await markFollowupRecoveryClaimEnqueued({
      persistRoot: dir,
      record: claimed.record,
      claimToken: claimed.claimToken,
      expectedFencingGeneration: 2,
    });
    expect(enqueued.fencingGeneration).toBe(3);
  });

  it("rejects stale expectedFencingGeneration on tool-operation execution and reconciliation", async () => {
    const dir = await makeTempDir("fence-op-");
    const file = path.join(dir, "op.result");

    await expect(
      withToolOperationAdmission("scope-1", () =>
        executeClaimedToolOperation({
          file,
          operationId: "op-1",
          expectedFencingGeneration: 1,
          run: () => ({ details: { status: "ok" } }),
        }),
      ),
    ).rejects.toThrow(StaleFencingGenerationError);

    const res = await withToolOperationAdmission("scope-1", () =>
      executeClaimedToolOperation({
        file,
        operationId: "op-1",
        expectedFencingGeneration: 0,
        run: async () => {
          await commitToolOperationWriteIntent();
          return { details: { status: "result_unknown" } };
        },
      }),
    );
    expect(res).toEqual({ details: { status: "result_unknown" } });

    const persisted = await readToolOperation(file);
    expect(persisted?.fencingGeneration).toBe(1);

    await expect(
      reconcileClaimedToolOperation({
        file,
        operationId: "op-1",
        expectedFencingGeneration: 0,
        query: async () => ({ kind: "confirmed", evidenceId: "ev-1", result: { ok: true } }),
      }),
    ).rejects.toThrow(StaleFencingGenerationError);
  });
});
