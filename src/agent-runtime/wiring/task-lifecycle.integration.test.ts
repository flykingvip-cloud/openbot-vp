/** Real state integration, not real-model or group-plan acceptance. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  sessionTaskState,
  checkTaskActionBoundary,
  buildTaskBoardContinuePrompt,
} from "../state/index.js";
import { admitSessionExecution } from "./execution-admission.js";

it("keeps one task across revision, pause and resume while rejecting obsolete results", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-lifecycle-"));
  const file = path.join(root, "session.jsonl");
  fs.writeFileSync(file, "");
  try {
    const admitted = await admitSessionExecution(
      file,
      {
        requestId: "request-a",
        expectedFocusRevision: 0,
        expectedWriteEpoch: 0,
        proposal: {
          lifecycle: "long_task" as const,
          goal: "Create report",
          acceptance: ["Verified sources"],
        },
      },
      async () => true,
    );
    if (admitted.kind !== "accepted") {
      throw new Error("Admission failed");
    }
    const first = sessionTaskState.startExecution(file, admitted.binding, "attempt-a");
    if (!first) {
      throw new Error("Claim failed");
    }
    const boundary = { sessionFile: file, binding: first, constraints: first.constraints ?? [] };
    expect(checkTaskActionBoundary(boundary)).toBeUndefined();
    const propose = (kind: "task_change" | "task_control") => {
      const board = sessionTaskState.read(file);
      const target = { taskId: first.taskId, revision: String(board.writeEpoch ?? 0) };
      return sessionTaskState.applyInteractionProposal({
        sessionFile: file,
        expectedFocusRevision: board.focusRevision,
        expectedWriteEpoch: board.writeEpoch ?? 0,
        decision:
          kind === "task_change"
            ? { kind, target, text: "Include source links" }
            : { kind, target, action: "pause" },
      });
    };
    expect(propose("task_change").kind).toBe("applied");
    expect(checkTaskActionBoundary(boundary)).toBeDefined();
    expect(propose("task_control").kind).toBe("applied");
    expect(
      sessionTaskState.completeChecked({
        sessionFile: file,
        binding: first,
        closed: true,
        appendNotice: false,
      }).persisted,
    ).toBe(false);
    const paused = sessionTaskState.read(file);
    const resumed = sessionTaskState.resumeCurrent(
      file,
      {
        taskId: first.taskId,
        expectedFocusRevision: paused.focusRevision,
        expectedWriteEpoch: paused.writeEpoch ?? 0,
      },
      { authOk: true, stopActive: false },
    );
    if (resumed.kind !== "accepted") {
      throw new Error("Resume failed");
    }
    expect(resumed.acceptance).toEqual(["Verified sources"]);
    const resumedTask = sessionTaskState.read(file).current!;
    expect(buildTaskBoardContinuePrompt(resumedTask)).toContain("Verified sources");
    const next = sessionTaskState.startExecution(file, resumed.binding, "attempt-b");
    if (!next) {
      throw new Error("Resumed claim failed");
    }
    expect(next.taskId).toBe(first.taskId);
    expect(next.constraints).toContain("Include source links");
    expect(checkTaskActionBoundary(boundary)).toBeDefined();
    expect(
      sessionTaskState.completeChecked({
        sessionFile: file,
        binding: first,
        closed: true,
        appendNotice: false,
      }).persisted,
    ).toBe(false);
    expect(sessionTaskState.read(file).current?.unfinished).toBe(true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("preserves full constraints and rejects stale amendments and paused wake tickets", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-revision-"));
  const file = path.join(root, "session.jsonl");
  fs.writeFileSync(file, "");
  try {
    const admitted = await admitSessionExecution(
      file,
      {
        requestId: "long-request",
        expectedFocusRevision: 0,
        expectedWriteEpoch: 0,
        proposal: {
          lifecycle: "long_task" as const,
          goal: "Create report",
          acceptance: ["Verified sources"],
        },
      },
      async () => true,
    );
    if (admitted.kind !== "accepted") {
      throw new Error("admission");
    }
    const before = sessionTaskState.read(file);
    const longText = "Only public sources. ".repeat(80) + "CRITICAL_TAIL_NO_OUTBOUND";
    const apply = (text: string, mode: "supplement" | "revise") => {
      const board = sessionTaskState.read(file);
      return sessionTaskState.applyInteractionProposal({
        sessionFile: file,
        expectedFocusRevision: board.focusRevision,
        expectedWriteEpoch: board.writeEpoch ?? 0,
        decision: {
          kind: "task_change",
          target: { taskId: admitted.binding.taskId, revision: String(board.writeEpoch ?? 0) },
          text,
          mode,
        },
      });
    };
    expect(apply(longText, "supplement").kind).toBe("applied");
    expect(apply("Change only the report title", "revise").kind).toBe("applied");
    const changed = sessionTaskState.read(file);
    expect(buildTaskBoardContinuePrompt(changed.current!)).toContain("CRITICAL_TAIL_NO_OUTBOUND");
    expect(buildTaskBoardContinuePrompt(changed.current!)).toContain(
      "Change only the report title",
    );
    expect(
      sessionTaskState.applyInteractionProposal({
        sessionFile: file,
        expectedFocusRevision: before.focusRevision,
        expectedWriteEpoch: before.writeEpoch ?? 0,
        decision: {
          kind: "task_change",
          target: { taskId: admitted.binding.taskId, revision: String(before.writeEpoch ?? 0) },
          text: "stale constraint",
          mode: "supplement",
        },
      }),
    ).toEqual({ kind: "rejected", reason: "revision_mismatch" });
    expect(sessionTaskState.read(file)).toEqual(changed);
    const paused = sessionTaskState.applyInteractionProposal({
      sessionFile: file,
      expectedFocusRevision: changed.focusRevision,
      expectedWriteEpoch: changed.writeEpoch ?? 0,
      decision: {
        kind: "task_control",
        target: { taskId: admitted.binding.taskId, revision: String(changed.writeEpoch ?? 0) },
        action: "pause",
      },
    });
    expect(paused).toMatchObject({ kind: "applied", abort: true });
    const { claimTaskBoardContinue } = await import("../state/index.js");
    expect(
      claimTaskBoardContinue({
        sessionFile: file,
        taskId: admitted.binding.taskId,
        focusRevision: changed.focusRevision,
      }),
    ).toEqual({ ok: false, reason: "wake_suppress" });
    expect(sessionTaskState.read(file).current?.taskId).toBe(admitted.binding.taskId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
