import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  readSessionTaskBoard,
  sessionTaskBoardPath,
  mutateSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import {
  commitInteractionTaskProposal,
  activeConstraintTexts,
} from "../../conversation-task/session-task-board.js";
import { admitSessionExecution } from "./execution-admission.js";
it("applies bound semantic amendments and refuses stale control writes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-proposal-"));
  try {
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(file, "");
    await admitSessionExecution(
      file,
      {
        requestId: "a",
        expectedFocusRevision: 0,
        expectedWriteEpoch: 0,
        proposal: { goal: "报告", acceptance: ["来源"] },
      },
      async () => true,
    );
    const board = readSessionTaskBoard(file);
    const captured = {
      sessionFile: file,
      expectedFocusRevision: board.focusRevision,
      expectedWriteEpoch: board.writeEpoch ?? 0,
    };
    const target = { taskId: board.current!.taskId, revision: String(board.writeEpoch ?? 0) };
    expect(
      commitInteractionTaskProposal({
        ...captured,
        decision: { kind: "task_change", target, text: "篇幅三页" },
      }).kind,
    ).toBe("applied");
    expect(activeConstraintTexts(readSessionTaskBoard(file).current)).toContain("篇幅三页");
    const bytes = fs.readFileSync(sessionTaskBoardPath(file), "utf8");
    expect(
      commitInteractionTaskProposal({
        ...captured,
        decision: { kind: "task_control", target, action: "cancel" },
      }).kind,
    ).toBe("rejected");
    expect(fs.readFileSync(sessionTaskBoardPath(file), "utf8")).toBe(bytes);
    const live = readSessionTaskBoard(file);
    expect(
      commitInteractionTaskProposal({
        ...captured,
        expectedWriteEpoch: live.writeEpoch ?? 0,
        decision: {
          kind: "task_control",
          target: { ...target, revision: String(live.writeEpoch ?? 0) },
          action: "pause",
        },
      }).kind,
    ).toBe("applied");
    expect(readSessionTaskBoard(file).current?.wakeSuppress).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
it("admits once, persists acceptance, and rejects stale or conflicting requests without writing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "execution-admission-"));
  try {
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(file, "");
    const request = {
      requestId: "message-a",
      expectedFocusRevision: 0,
      expectedWriteEpoch: 0,
      proposal: { goal: "报告", acceptance: ["可核验来源"] },
    };
    expect(await admitSessionExecution(file, request, async () => false)).toEqual({
      kind: "rejected",
      reason: "unauthorized",
    });
    expect(fs.existsSync(sessionTaskBoardPath(file))).toBe(false);
    expect((await admitSessionExecution(file, request, async () => true)).kind).toBe("accepted");
    const board = readSessionTaskBoard(file);
    expect(board.current?.acceptanceCriteria).toEqual(request.proposal.acceptance);
    const bytes = fs.readFileSync(sessionTaskBoardPath(file), "utf8");
    expect((await admitSessionExecution(file, request, async () => true)).kind).toBe("duplicate");
    expect(fs.readFileSync(sessionTaskBoardPath(file), "utf8")).toBe(bytes);
    expect(
      (await admitSessionExecution(file, { ...request, requestId: "message-b" }, async () => true))
        .kind,
    ).toBe("rejected");
    expect(
      (
        await admitSessionExecution(
          file,
          { ...request, proposal: { ...request.proposal, goal: "changed" } },
          async () => true,
        )
      ).kind,
    ).toBe("rejected");
    expect(fs.readFileSync(sessionTaskBoardPath(file), "utf8")).toBe(bytes);
    mutateSessionTaskBoard(file, (live) => ({
      board: {
        ...live,
        current: live.current ? { ...live.current, wakeSuppress: true } : undefined,
      },
      value: undefined,
    }));
    const paused = fs.readFileSync(sessionTaskBoardPath(file), "utf8");
    expect((await admitSessionExecution(file, request, async () => true)).kind).toBe("rejected");
    expect(fs.readFileSync(sessionTaskBoardPath(file), "utf8")).toBe(paused);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
