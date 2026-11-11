import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { hostBoundTaskTarget } from "../../command/host-task-target.js";
import type { SessionTaskBoard } from "../../contracts/task.js";
import { activeConstraintTexts } from "../../policy/index.js";
import {
  readSessionTaskBoard,
  seedSessionTaskBoard,
  sessionTaskBoardPath,
} from "../repository/task-board-file.js";
import { commitInteractionTaskProposal } from "./interaction-proposal.js";
import { recordCheckedTaskCompletion } from "./task-completion.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function setup(extra: Partial<SessionTaskBoard> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-revision-"));
  dirs.push(dir);
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, "");
  seedSessionTaskBoard(file, {
    parked: [],
    focusRevision: 1,
    writeEpoch: 1,
    resetGeneration: 0,
    current: {
      taskId: "task",
      title: "Report",
      goalText: "Create report",
      unfinished: false,
      deliverableChecked: true,
      executionAttempt: "old-run",
      deliverableVersion: "old-version",
      admittedGeneration: 0,
      createdAtMs: 1,
      acceptanceCriteria: ["Evidence required"],
      stop: { summary: "Complete", workspacePaths: ["report.md"] },
    },
    ...extra,
  });
  return file;
}
function revise(file: string) {
  const b = readSessionTaskBoard(file);
  return commitInteractionTaskProposal({
    sessionFile: file,
    expectedFocusRevision: b.focusRevision,
    expectedWriteEpoch: b.writeEpoch ?? 0,
    decision: {
      kind: "task_change",
      target: { taskId: "task", revision: String(b.writeEpoch ?? 0) },
      text: "Revise for managers",
      mode: "revise",
    },
  });
}
it("keeps a completed current target addressable and opens a new attempt only after a bound revision", () => {
  const file = setup();
  expect(hostBoundTaskTarget(readSessionTaskBoard(file))).toEqual({
    taskId: "task",
    revision: "1",
  });
  expect(revise(file).kind).toBe("applied");
  const task = readSessionTaskBoard(file).current!;
  expect(task).toMatchObject({
    taskId: "task",
    unfinished: true,
    deliverableChecked: false,
    acceptanceCriteria: ["Evidence required"],
  });
  expect(task.executionAttempt).toBeUndefined();
  expect(task.deliverableVersion).toBeUndefined();
  expect(activeConstraintTexts(task)).toContain("Revise for managers");
  expect(
    recordCheckedTaskCompletion({
      sessionFile: file,
      closed: true,
      binding: { taskId: "task", executionAttempt: "old-run", deliverableVersion: "old-version" },
      appendNotice: false,
    }).persisted,
  ).toBe(false);
  expect(readSessionTaskBoard(file).current?.unfinished).toBe(true);
});
it.each(["cancelled", "reset"] as const)("never revives a %s target", (kind) => {
  const file = setup(
    kind === "cancelled"
      ? { tombstones: [{ taskId: "task", closedAtMs: 2 }] }
      : { resetGeneration: 1 },
  );
  const before = fs.readFileSync(sessionTaskBoardPath(file), "utf8");
  expect(hostBoundTaskTarget(readSessionTaskBoard(file))).toBeUndefined();
  expect(revise(file).kind).toBe("rejected");
  expect(fs.readFileSync(sessionTaskBoardPath(file), "utf8")).toBe(before);
});

it("rejects stale revision replay without changing the reopened task", () => {
  const file = setup();
  const before = readSessionTaskBoard(file);
  expect(revise(file).kind).toBe("applied");
  const bytes = fs.readFileSync(sessionTaskBoardPath(file), "utf8");
  expect(
    commitInteractionTaskProposal({
      sessionFile: file,
      expectedFocusRevision: before.focusRevision,
      expectedWriteEpoch: before.writeEpoch ?? 0,
      decision: {
        kind: "task_change",
        target: { taskId: "task", revision: String(before.writeEpoch ?? 0) },
        text: "stale replay",
      },
    }).kind,
  ).toBe("rejected");
  expect(fs.readFileSync(sessionTaskBoardPath(file), "utf8")).toBe(bytes);
});
it("does not treat completed control as revision or silently resume a paused task", () => {
  const file = setup();
  const b = readSessionTaskBoard(file);
  expect(
    commitInteractionTaskProposal({
      sessionFile: file,
      expectedFocusRevision: b.focusRevision,
      expectedWriteEpoch: b.writeEpoch ?? 0,
      decision: {
        kind: "task_control",
        target: { taskId: "task", revision: String(b.writeEpoch ?? 0) },
        action: "pause",
      },
    }).kind,
  ).toBe("rejected");
  const current = readSessionTaskBoard(file).current!;
  seedSessionTaskBoard(file, {
    ...b,
    current: { ...current, unfinished: true, wakeSuppress: true },
  });
  expect(revise(file).kind).toBe("applied");
  expect(readSessionTaskBoard(file).current?.wakeSuppress).toBe(true);
});
