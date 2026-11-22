import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { resumeInterpretedCurrentTask } from "../../gateway/server-methods/chat-resume-parked-recheck.js";
import { routeInteraction } from "../command/route-interaction.js";
import { sessionTaskState } from "../state/index.js";
import { admitSessionExecution } from "./execution-admission.js";

it("keeps the same admitted task across repeated status/continue turns and only switches for an explicit new goal", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "same-task-control-"));
  const file = path.join(root, "session.jsonl");
  fs.writeFileSync(file, "");
  try {
    const initial = await admitSessionExecution(
      file,
      {
        requestId: "initial",
        expectedFocusRevision: 0,
        expectedWriteEpoch: 0,
        proposal: {
          lifecycle: "long_task",
          goal: "Create verified PPT",
          acceptance: ["Verified slide sources"],
        },
      },
      async () => true,
    );
    if (initial.kind !== "accepted") {
      throw Error("initial admission");
    }
    const id = initial.binding.taskId;
    for (const [index, action] of (
      ["status", "continue", "status", "continue"] as const
    ).entries()) {
      const board = sessionTaskState.read(file);
      const captured = {
        requestId: `followup-${index}`,
        expectedFocusRevision: board.focusRevision,
        expectedWriteEpoch: board.writeEpoch ?? 0,
        expectedTaskId: id,
      };
      const target = { taskId: id, revision: String(board.writeEpoch ?? 0) };
      const authorize = vi.fn(async () => true);
      const commit = vi.fn();
      const routed = await routeInteraction(
        {
          message:
            action === "status"
              ? "Where are we with the slides?"
              : "Carry on with the presentation already authorized",
          taskTarget: target,
          context: [],
        },
        captured,
        {
          inference: { infer: async () => ({ kind: "task_control", target, action }) },
          admission: { authorize, commit },
        },
      );
      expect(routed.kind).toBe("task_proposal");
      expect(authorize).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      if (routed.kind !== "task_proposal") {
        throw Error("unexpected route");
      }
      if (action === "status") {
        const before = fs.readFileSync(file + ".task-board.json", "utf8");
        expect(
          sessionTaskState.applyInteractionProposal({
            sessionFile: file,
            ...captured,
            decision: routed.decision,
          }),
        ).toMatchObject({ kind: "applied", abort: false });
        expect(fs.readFileSync(file + ".task-board.json", "utf8")).toBe(before);
      } else {
        expect(
          resumeInterpretedCurrentTask({
            scopeKind: "personal",
            userId: "owner",
            sessionKey: "agent:main:employee:owner",
            sessionFile: file,
            request: { taskId: id, action: "continue", ...captured },
            recheckInputs: {
              accessAuthorized: true,
              clientIdentityOk: true,
              sendPolicy: "allow",
              stopActive: false,
            },
          }),
        ).toMatchObject({ kind: "accepted", binding: { taskId: id } });
      }
      const after = sessionTaskState.read(file);
      expect(after.current?.taskId).toBe(id);
      expect(after.current?.acceptanceCriteria).toEqual(["Verified slide sources"]);
      expect(after.parked).toEqual([]);
    }
    const board = sessionTaskState.read(file);
    const next = await admitSessionExecution(
      file,
      {
        requestId: "new-independent",
        expectedFocusRevision: board.focusRevision,
        expectedWriteEpoch: board.writeEpoch ?? 0,
        expectedTaskId: id,
        proposal: {
          lifecycle: "long_task",
          goal: "Independent invoice analysis",
          acceptance: ["Invoice reconciliation"],
        },
      },
      async () => true,
    );
    expect(next.kind).toBe("accepted");
    expect(sessionTaskState.read(file).current?.taskId).not.toBe(id);
    expect(sessionTaskState.read(file).parked[0]?.taskId).toBe(id);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it.each(["continue", "status"] as const)(
  "rejects an unbound or stale %s interpretation before admission",
  async (action) => {
    const target = { taskId: "current", revision: "5" };
    const commit = vi.fn();
    const authorize = vi.fn();
    await expect(
      routeInteraction(
        { message: "same work", taskTarget: target, context: [] },
        { requestId: "request", expectedFocusRevision: 1, expectedWriteEpoch: 5 },
        {
          inference: {
            infer: async () => ({
              kind: "task_control",
              target: { taskId: "old", revision: "4" },
              action,
            }),
          },
          admission: { authorize, commit },
        },
      ),
    ).rejects.toThrow("not bound");
    expect(commit).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  },
);
