import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { sessionTaskState } from "../state/index.js";
import { admitSessionExecution } from "./execution-admission.js";

const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })),
);
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "turn-admission-"));
  roots.push(root);
  return path.join(root, "session.jsonl");
}
const request = {
  requestId: "single-action",
  expectedFocusRevision: 0,
  expectedWriteEpoch: 0,
  proposal: { goal: "Send this one internal message", acceptance: ["Report the actual receipt"] },
};

it("admits small work by default without creating a task board", async () => {
  const file = fixture();
  const result = await admitSessionExecution(file, request, async () => true);
  expect(result.kind).toBe("accepted_turn");
  expect(fs.existsSync(`${file}.task-board.json`)).toBe(false);
  expect(sessionTaskState.read(file).current).toBeUndefined();
});

it("requires an explicit long-task classification before creating persistent focus", async () => {
  const file = fixture();
  const result = await admitSessionExecution(
    file,
    {
      ...request,
      proposal: { ...request.proposal, lifecycle: "long_task" as const },
    },
    async () => true,
  );
  expect(result.kind).toBe("accepted");
  expect(sessionTaskState.read(file).current?.goalText).toBe(request.proposal.goal);
});

it("never admits small work without authorization", async () => {
  const file = fixture();
  expect(await admitSessionExecution(file, request, async () => false)).toEqual({
    kind: "rejected",
    reason: "unauthorized",
  });
  expect(fs.existsSync(`${file}.task-board.json`)).toBe(false);
});

it("does not replace or bind an existing long task when admitting a separate small action", async () => {
  const file = fixture();
  await admitSessionExecution(
    file,
    {
      ...request,
      requestId: "long",
      proposal: {
        goal: "Research then monitor a release",
        acceptance: ["Deliver after monitoring"],
        lifecycle: "long_task" as const,
      },
    },
    async () => true,
  );
  const board = sessionTaskState.read(file);
  const bytes = fs.readFileSync(`${file}.task-board.json`);
  const result = await admitSessionExecution(
    file,
    {
      ...request,
      expectedFocusRevision: board.focusRevision,
      expectedWriteEpoch: board.writeEpoch ?? 0,
      expectedTaskId: board.current?.taskId,
    },
    async () => true,
  );
  expect(result.kind).toBe("accepted_turn");
  expect(result).not.toHaveProperty("binding");
  expect(fs.readFileSync(`${file}.task-board.json`)).toEqual(bytes);
});

it("invalidates current-turn admission when the captured task-control snapshot changes", async () => {
  const file = fixture();
  const result = await admitSessionExecution(file, request, async () => true);
  if (result.kind !== "accepted_turn") {
    throw new Error("Expected turn admission");
  }
  expect(sessionTaskState.turnAdmissionCurrent(file, result.admission)).toBe(true);
  await admitSessionExecution(
    file,
    {
      ...request,
      requestId: "long-after-admission",
      proposal: { ...request.proposal, lifecycle: "long_task" },
    },
    async () => true,
  );
  expect(sessionTaskState.turnAdmissionCurrent(file, result.admission)).toBe(false);
});

it("does not authorize small work from a corrupt board snapshot", async () => {
  const file = fixture();
  fs.writeFileSync(`${file}.task-board.json`, "{broken");
  expect(await admitSessionExecution(file, request, async () => true)).toEqual({
    kind: "rejected",
    reason: "task_mutation_unconfirmed",
  });
  expect(fs.readFileSync(`${file}.task-board.json`, "utf8")).toBe("{broken");
});
