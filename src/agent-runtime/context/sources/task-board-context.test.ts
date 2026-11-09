import { expect, it } from "vitest";
import type { SessionTaskBoard, TrackedTask } from "../../contracts/task.js";
import { buildTaskBoardContext } from "./task-board-context.js";

function task(overrides: Partial<TrackedTask> = {}): TrackedTask {
  return {
    taskId: "accepted-a",
    title: "Report",
    goalText: "Create report",
    unfinished: true,
    createdAtMs: 1,
    stop: { summary: "Sources collected", workspacePaths: [] },
    ...overrides,
  };
}

it("does not invent a task for an empty board", () => {
  expect(buildTaskBoardContext({ parked: [], focusRevision: 0 })).toBe("");
});

it("does not present a completed task as active unfinished work", () => {
  expect(
    buildTaskBoardContext({ current: task({ unfinished: false }), parked: [], focusRevision: 1 }),
  ).toBe("");
});

it("preserves admitted criteria and full active constraints without changing state", () => {
  const longText = "public sources only ".repeat(80) + "CRITICAL_TAIL";
  const board: SessionTaskBoard = {
    current: task({
      wakeSuppress: true,
      acceptanceCriteria: ["Exact bytes"],
      acceptanceChecks: [
        {
          criterion: 0,
          validator: "artifact.text.exact.v1",
          artifact: "result.txt",
          expected: "RESULT",
        },
      ],
      effectiveConstraints: [
        { text: "obsolete", atMs: 1, kind: "supplement", superseded: true },
        { text: longText, atMs: 2, kind: "supplement" },
      ],
      stop: { summary: "Sources collected", workspacePaths: ["/tmp/private-workspace/result.txt"] },
    }),
    parked: [],
    focusRevision: 1,
  };
  const before = structuredClone(board);
  const text = buildTaskBoardContext(board);
  expect(text).toContain("CRITICAL_TAIL");
  expect(text).toContain("Exact bytes");
  expect(text).toContain("artifact.text.exact.v1");
  expect(text).toContain('"phase":"paused"');
  expect(text).not.toContain("obsolete");
  expect(text).not.toContain("/tmp/private-workspace");
  expect(board).toEqual(before);
});

it("keeps parked tasks factual without turning them into current execution", () => {
  const text = buildTaskBoardContext({ parked: [task()], focusRevision: 1 });
  expect(text).toContain('"current":null');
  expect(text).toContain('"phase":"parked"');
  expect(text).toContain("does not request execution");
});
