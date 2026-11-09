import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { queryCurrentTaskStatus } from "../agent-runtime/command/index.js";
import { parseExplicitTaskControl } from "../agent-runtime/policy/index.js";
import { sessionTaskState } from "../agent-runtime/state/index.js";
import { markBackgrounded, resetProcessRegistryForTests } from "../agents/bash-process-registry.js";
import { runExecProcess } from "../agents/bash-tools.exec-runtime.js";
import { peekSystemEvents, resetSystemEventsForTest } from "../infra/system-events.js";
import {
  commitSameTaskConstraint,
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
} from "./session-task-board.js";
import { claimTaskBoardContinue } from "./task-board-continue.js";

const roots: string[] = [];
afterEach(() => {
  resetProcessRegistryForTests();
  resetSystemEventsForTest();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it.each([false, true])(
  "keeps task state authoritative while a real background process exits; pause=%s",
  async (paused) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-async-"));
    roots.push(root);
    const sessionFile = path.join(root, "session.jsonl");
    fs.writeFileSync(sessionFile, "");
    const sessionKey = "agent:async-proof:main";
    mutateSessionTaskBoard(sessionFile, () => ({
      board: {
        ...emptySessionTaskBoard(),
        focusRevision: 1,
        current: {
          taskId: "task-a",
          title: "report",
          goalText: "write report",
          unfinished: true,
          createdAtMs: 1,
          stop: { summary: "waiting for process", workspacePaths: [] },
        },
      },
      value: undefined,
    }));
    const command =
      JSON.stringify(process.execPath) +
      " -e " +
      JSON.stringify('setTimeout(()=>console.log("async-result-ready"),300)');
    const run = await runExecProcess({
      command,
      workdir: root,
      env: { PATH: process.env.PATH || "" },
      usePty: false,
      warnings: [],
      maxOutput: 4096,
      pendingMaxOutput: 4096,
      notifyOnExit: true,
      sessionKey,
      timeoutSec: 5,
    });
    markBackgrounded(run.session);
    try {
      const before = readSessionTaskBoard(sessionFile);
      expect(queryCurrentTaskStatus("当前进度", () => readSessionTaskBoard(sessionFile))).toContain(
        "任务板最近记录",
      );
      expect(readSessionTaskBoard(sessionFile)).toEqual(before);
      expect(
        commitSameTaskConstraint({
          sessionFile,
          expectedTaskId: "task-a",
          constraintText: "必须保留来源链接",
        }),
      ).toBe(true);
      if (paused) {
        const control = parseExplicitTaskControl("暂停当前任务");
        if (!control) {
          throw new Error("explicit pause must parse");
        }
        const result = sessionTaskState.applyExplicitControl({
          sessionFile,
          control,
          recheck: { authOk: true, stopActive: false },
        });
        expect(result?.abortInFlight).toBe(true);
      }
      const outcome = await run.promise;
      expect(outcome.status).toBe("completed");
      expect(peekSystemEvents(sessionKey).some((text) => text.includes("async-result-ready"))).toBe(
        true,
      );
      const claim = claimTaskBoardContinue({ sessionFile, taskId: "task-a", focusRevision: 1 });
      if (paused) {
        expect(claim).toEqual({ ok: false, reason: "wake_suppress" });
      } else {
        expect(claim.ok).toBe(true);
        if (claim.ok) {
          expect(claim.prompt).toContain("必须保留来源链接");
        }
      }
      expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
    } finally {
      if (!run.session.exited) {
        run.kill();
      }
      await run.promise;
    }
  },
);
