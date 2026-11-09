import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  sessionTaskBoardPath,
} from "../../conversation-task/session-task-board.js";
import {
  recordAuthoritativeTaskStop,
  queryAuthoritativeTaskStop,
  resetAuthoritativeTaskStopsForTest,
  resumeInterpretedCurrentTask,
} from "./chat-resume-parked-recheck.js";
const roots: string[] = [];
afterEach(() => {
  resetAuthoritativeTaskStopsForTest();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-resume-current-"));
  roots.push(root);
  const sessionFile = path.join(root, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  mutateSessionTaskBoard(sessionFile, () => ({
    board: {
      ...emptySessionTaskBoard(),
      current: {
        taskId: "a",
        title: "A",
        goalText: "report",
        unfinished: true,
        wakeSuppress: true,
        createdAtMs: 1,
        stop: { summary: "paused", workspacePaths: [] },
      },
    },
    value: undefined,
  }));
  const board = readSessionTaskBoard(sessionFile);
  return {
    sessionFile,
    request: {
      taskId: "a",
      expectedFocusRevision: board.focusRevision,
      expectedWriteEpoch: board.writeEpoch ?? 0,
    },
    scopeKind: "personal" as const,
    userId: "owner",
    sessionKey: "agent:test:main",
    recheckInputs: { sendPolicy: "allow", accessAuthorized: true, clientIdentityOk: true },
  };
}
it("explicit authorized resume clears only the matching paused task stop after state CAS", () => {
  const input = fixture();
  recordAuthoritativeTaskStop({ ...input, taskId: "a" });
  recordAuthoritativeTaskStop({ ...input, taskId: "a", sessionKey: "other" });
  expect(resumeInterpretedCurrentTask(input).kind).toBe("accepted");
  expect(queryAuthoritativeTaskStop({ ...input, taskId: "a" }).state).toBe("inactive");
  expect(queryAuthoritativeTaskStop({ ...input, taskId: "a", sessionKey: "other" }).state).toBe(
    "active",
  );
  expect(readSessionTaskBoard(input.sessionFile).current?.wakeSuppress).toBe(false);
  expect(resumeInterpretedCurrentTask(input).kind).toBe("rejected");
});
it.each([
  { sendPolicy: "deny", accessAuthorized: true, clientIdentityOk: true },
  { sendPolicy: "allow", accessAuthorized: false, clientIdentityOk: true },
  { sendPolicy: "allow", accessAuthorized: true, clientIdentityOk: false },
  { sendPolicy: "allow", accessAuthorized: true, clientIdentityOk: true, stopActive: true },
  {},
])(
  "refuses incomplete or denied live checks without changing task or scoped stop: %j",
  (recheckInputs) => {
    const input = fixture();
    recordAuthoritativeTaskStop({ ...input, taskId: "a" });
    const before = fs.readFileSync(sessionTaskBoardPath(input.sessionFile), "utf8");
    expect(resumeInterpretedCurrentTask({ ...input, recheckInputs }).kind).toBe("rejected");
    expect(queryAuthoritativeTaskStop({ ...input, taskId: "a" }).state).toBe("active");
    expect(fs.readFileSync(sessionTaskBoardPath(input.sessionFile), "utf8")).toBe(before);
  },
);
it("does not clear a newer stop when the interpreted board revision is obsolete", () => {
  const input = fixture();
  recordAuthoritativeTaskStop({ ...input, taskId: "a" });
  mutateSessionTaskBoard(input.sessionFile, (board) => ({ board, value: undefined }));
  expect(resumeInterpretedCurrentTask(input).kind).toBe("rejected");
  expect(queryAuthoritativeTaskStop({ ...input, taskId: "a" }).state).toBe("active");
});
