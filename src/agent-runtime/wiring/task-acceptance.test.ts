import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sessionTaskState } from "../state/index.js";
import { admitSessionExecution } from "./execution-admission.js";
import { evaluateBoundTaskAcceptance } from "./task-acceptance.js";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-acceptance-"));
  roots.push(root);
  const file = path.join(root, "session.jsonl");
  fs.writeFileSync(file, "");
  const admitted = await admitSessionExecution(
    file,
    {
      requestId: "request-a",
      expectedFocusRevision: 0,
      expectedWriteEpoch: 0,
      proposal: {
        goal: "Create exact file",
        acceptance: ["Exact bytes"],
        checks: [
          {
            criterion: 0,
            validator: "artifact.text.exact.v1",
            artifact: "result.txt",
            expected: "RESULT",
          },
        ],
      },
    },
    async () => true,
  );
  if (admitted.kind !== "accepted") {
    throw new Error("admission");
  }
  const binding = sessionTaskState.startExecution(file, admitted.binding, "attempt-a");
  if (!binding) {
    throw new Error("claim");
  }
  fs.writeFileSync(path.join(root, "result.txt"), "RESULT");
  return { sessionFile: file, workspaceDir: root, runId: "attempt-a", completionBinding: binding };
}
it("verifies admitted artifacts without completing or mutating the task", async () => {
  const input = await fixture();
  const before = sessionTaskState.read(input.sessionFile);
  const checked = await evaluateBoundTaskAcceptance(input);
  expect(checked?.evaluation.status).toBe("passed");
  expect(checked?.evidence[0]).toMatchObject({
    validatorId: "artifact.text.exact.v1",
    executionVersion: "attempt-a",
  });
  expect(sessionTaskState.read(input.sessionFile)).toEqual(before);
});
it("fails mismatched bytes and leaves missing artifacts pending", async () => {
  const input = await fixture();
  fs.writeFileSync(path.join(input.workspaceDir, "result.txt"), "RESULT\n");
  expect((await evaluateBoundTaskAcceptance(input))?.evaluation.status).toBe("failed");
  fs.unlinkSync(path.join(input.workspaceDir, "result.txt"));
  expect((await evaluateBoundTaskAcceptance(input))?.evaluation.status).toBe("pending");
});
it("rejects symlink escape without exposing outside bytes as evidence", async () => {
  const input = await fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-outside-"));
  roots.push(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "RESULT");
  fs.unlinkSync(path.join(input.workspaceDir, "result.txt"));
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(input.workspaceDir, "result.txt"));
  const checked = await evaluateBoundTaskAcceptance(input);
  expect(checked?.evaluation.status).toBe("pending");
  expect(checked?.evidence).toEqual([]);
});
it("invalidates evidence if the board revision changes during artifact reads", async () => {
  const input = await fixture();
  const original = sessionTaskState.read;
  let reads = 0;
  vi.spyOn(sessionTaskState, "read").mockImplementation((file) => {
    const board = original(file);
    return ++reads === 2 ? { ...board, writeEpoch: (board.writeEpoch ?? 0) + 1 } : board;
  });
  const checked = await evaluateBoundTaskAcceptance(input);
  expect(checked?.evaluation.status).toBe("pending");
  expect(checked?.evidence).toEqual([]);
});
it("does not evaluate another execution attempt", async () => {
  const input = await fixture();
  expect(await evaluateBoundTaskAcceptance({ ...input, runId: "attempt-b" })).toBeUndefined();
});
