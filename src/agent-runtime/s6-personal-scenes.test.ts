import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeConstraintTexts,
  bindCurrentExecution,
  cancelCurrentTask,
  commitInteractionTaskProposal,
  isTaskExecutionBindingCurrent,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  recordCheckedTaskCompletion,
  sessionTaskBoardPath,
} from "../conversation-task/session-task-board.js";
import {
  persistRejectedInteractionTurn,
  readChatTurnTerminal,
  reconcileChatTurnTerminal,
} from "../gateway/chat-interaction-failure.js";
import { admittedTaskQueryContinuation } from "./command/admitted-task-query-continuation.js";
import { interactionAdmissionFact, routeInteraction } from "./command/route-interaction.js";
import { formatTaskProposalReply } from "./command/task-proposal-reply.js";
import {
  previewArtifactFromNamedFileReceipt,
  registerNamedFileReceipt,
} from "./delivery/named-file-receipt.js";
import { INTERACTION_MODEL_FAILURE_TEXT } from "./model/interaction-resource-wait.js";
import { admitSessionExecution } from "./wiring/execution-admission.js";

const dirs: string[] = [];
const savedState = process.env.OPENBOT_STATE_DIR;

afterEach(() => {
  if (savedState === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = savedState;
  }
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-s6-personal-"));
  dirs.push(dir);
  process.env.OPENBOT_STATE_DIR = dir;
  const sessionFile = path.join(dir, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  return { dir, sessionFile };
}

describe("S6 personal production-consumer scenes", () => {
  it("combines ordinary Q&A, current-turn work, mid-task query, revision receipts, cancel race, and grounded failure", async () => {
    const { dir, sessionFile } = workspace();
    const storeDir = path.join(dir, "terminals");
    const captured = { requestId: "qa-1", expectedFocusRevision: 0, expectedWriteEpoch: 0 };
    const authorize = vi.fn();
    const commit = vi.fn();
    const inferQa = vi.fn(async () => ({ kind: "reply" as const, text: "今天天气不错。" }));

    const qa = await routeInteraction({ message: "今天天气怎么样", context: [] }, captured, {
      inference: { infer: inferQa },
      admission: { authorize, commit },
    });
    expect(qa.kind).toBe("respond");
    if (qa.kind === "respond") {
      expect(qa.text).toBe("今天天气不错。");
      expect(qa.clarification).toBe(false);
    }
    expect(interactionAdmissionFact(qa)).toEqual({ admitted: false });
    expect(inferQa).toHaveBeenCalledOnce();
    expect(authorize).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(fs.existsSync(sessionTaskBoardPath(sessionFile))).toBe(false);

    const turnRequest = {
      requestId: "turn-note",
      expectedFocusRevision: 0,
      expectedWriteEpoch: 0,
      proposal: {
        lifecycle: "turn" as const,
        goal: "写一张当日备忘",
        acceptance: ["交付文件 note.txt"],
      },
    };
    const admittedTurn = await admitSessionExecution(sessionFile, turnRequest, async () => true);
    expect(admittedTurn.kind).toBe("accepted_turn");
    expect(fs.existsSync(sessionTaskBoardPath(sessionFile))).toBe(false);
    const notePath = path.join(dir, "note.txt");
    fs.writeFileSync(notePath, "当日备忘：已完成小任务。\n");
    const receipt = registerNamedFileReceipt({ workspaceDir: dir, relativePath: "note.txt" });
    expect(receipt.accessible).toBe(true);
    if (!receipt.accessible) {
      throw new Error("named file receipt missing");
    }
    const preview = previewArtifactFromNamedFileReceipt(receipt, { title: "当日备忘" });
    expect(preview.kind).toBe("file");
    expect((preview.providerMetadata as { artifactSha256?: string }).artifactSha256).toBe(
      receipt.sha256,
    );
    expect(fs.existsSync(sessionTaskBoardPath(sessionFile))).toBe(false);

    const longRequest = {
      requestId: "long-report",
      expectedFocusRevision: 0,
      expectedWriteEpoch: 0,
      proposal: {
        lifecycle: "long_task" as const,
        goal: "撰写调研报告",
        acceptance: ["可核验来源"],
      },
    };
    const admittedLong = await admitSessionExecution(sessionFile, longRequest, async () => true);
    expect(admittedLong.kind).toBe("accepted");
    if (admittedLong.kind !== "accepted") {
      throw new Error("long task was not admitted");
    }
    mutateSessionTaskBoard(sessionFile, (board) => ({
      board: bindCurrentExecution({
        board,
        taskId: admittedLong.binding.taskId,
        executionAttempt: "run-long-a",
        deliverableVersion: "v0",
      }),
      value: undefined,
    }));
    const beforeQuery = readSessionTaskBoard(sessionFile);
    const beforeBytes = fs.readFileSync(sessionTaskBoardPath(sessionFile), "utf8");
    expect(beforeQuery.current?.unfinished).toBe(true);
    expect(beforeQuery.current?.executionAttempt).toBe("run-long-a");

    let resolveHang: (() => void) | undefined;
    const hangingA = new Promise<void>((resolve) => {
      resolveHang = resolve;
    });
    const queryStarted = Date.now();
    const inferQuery = vi.fn(async () => ({
      kind: "reply" as const,
      text: "报告仍在进行，当前未改状态。",
    }));
    const midQuery = routeInteraction(
      { message: "进度如何，只读说明即可", context: [] },
      {
        requestId: "qa-during-long",
        expectedFocusRevision: beforeQuery.focusRevision,
        expectedWriteEpoch: beforeQuery.writeEpoch ?? 0,
      },
      {
        inference: { infer: inferQuery },
        admission: { authorize: vi.fn(), commit: vi.fn() },
      },
    );
    const mid = await midQuery;
    expect(Date.now() - queryStarted).toBeLessThan(2000);
    expect(hangingA).toBeInstanceOf(Promise);
    expect(mid.kind).toBe("respond");
    expect(interactionAdmissionFact(mid)).toEqual({ admitted: false });
    expect(inferQuery).toHaveBeenCalledOnce();
    expect(fs.readFileSync(sessionTaskBoardPath(sessionFile), "utf8")).toBe(beforeBytes);
    const continuation = admittedTaskQueryContinuation({
      board: readSessionTaskBoard(sessionFile),
    });
    expect(continuation).toMatchObject({
      shouldContinue: true,
      taskId: admittedLong.binding.taskId,
      reason: "continue_admitted",
    });
    resolveHang?.();
    await hangingA;
    expect(readSessionTaskBoard(sessionFile).current?.executionAttempt).toBe("run-long-a");
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);

    const live = readSessionTaskBoard(sessionFile);
    const target = {
      taskId: live.current!.taskId,
      revision: String(live.writeEpoch ?? 0),
    };
    const applied = commitInteractionTaskProposal({
      sessionFile,
      expectedFocusRevision: live.focusRevision,
      expectedWriteEpoch: live.writeEpoch ?? 0,
      decision: { kind: "task_change", target, text: "篇幅不超过三页", mode: "supplement" },
    });
    expect(applied.kind).toBe("applied");
    const appliedText = formatTaskProposalReply(
      { kind: "task_change", target, text: "篇幅不超过三页", mode: "supplement" },
      applied.kind === "applied" ? applied : { kind: "rejected", reason: "missing" },
    );
    expect(appliedText).toContain("要求已写入原任务板");
    expect(appliedText).not.toContain("未能确认旧执行已停止");
    expect(activeConstraintTexts(readSessionTaskBoard(sessionFile).current)).toContain(
      "篇幅不超过三页",
    );
    const unconfirmedText = formatTaskProposalReply(
      { kind: "task_change", target, text: "篇幅不超过三页", mode: "supplement" },
      {
        kind: "unconfirmed",
        text: "要求已写入原任务板，但未能确认旧执行已停止，本次未启动新执行。",
      },
    );
    expect(unconfirmedText).toBe("要求已写入原任务板，但未能确认旧执行已停止，本次未启动新执行。");
    expect(unconfirmedText).not.toBe(appliedText);
    const receivedOnly = formatTaskProposalReply(
      { kind: "task_change", target, text: "篇幅不超过三页", mode: "supplement" },
      { kind: "rejected", reason: "revision_mismatch" },
    );
    expect(receivedOnly).toContain("本次未修改");
    const afterRevision = readSessionTaskBoard(sessionFile);
    const oldBinding = {
      taskId: admittedLong.binding.taskId,
      executionAttempt: "run-long-a",
      deliverableVersion: "v0",
    };
    expect(isTaskExecutionBindingCurrent(sessionFile, oldBinding)).toBe(true);
    expect(activeConstraintTexts(afterRevision.current)).toContain("篇幅不超过三页");

    mutateSessionTaskBoard(sessionFile, (board) => ({
      board: cancelCurrentTask({ board, sessionFile }).board,
      value: undefined,
    }));
    expect(isTaskExecutionBindingCurrent(sessionFile, oldBinding)).toBe(false);
    const lateComplete = recordCheckedTaskCompletion({
      sessionFile,
      closed: true,
      binding: oldBinding,
    });
    expect(lateComplete.persisted).toBe(false);
    const afterCancel = readSessionTaskBoard(sessionFile);
    expect(afterCancel.current).toBeUndefined();
    expect(afterCancel.tombstones?.some((row) => row.taskId === admittedLong.binding.taskId)).toBe(
      true,
    );
    const staleResume = commitInteractionTaskProposal({
      sessionFile,
      expectedFocusRevision: afterCancel.focusRevision,
      expectedWriteEpoch: afterCancel.writeEpoch ?? 0,
      decision: {
        kind: "task_control",
        target: {
          taskId: admittedLong.binding.taskId,
          revision: String(afterCancel.writeEpoch ?? 0),
        },
        action: "resume",
      },
    });
    expect(staleResume.kind).toBe("rejected");

    const modelError = Object.assign(new Error("provider 500"), {
      interactionPhase: "interpretation",
    });
    let appends = 0;
    const failed = await persistRejectedInteractionTurn({
      error: modelError,
      runId: "fail-model",
      sessionKey: "agent:bot:main",
      storeDir,
      append: async (text, key) => {
        appends += 1;
        expect(text).toBe(INTERACTION_MODEL_FAILURE_TEXT);
        expect(key).toBe("fail-model:interaction-rejected");
        return { ok: true };
      },
    });
    expect(failed.persisted).toBe(true);
    expect(failed.text).toBe(INTERACTION_MODEL_FAILURE_TEXT);
    const terminal = readChatTurnTerminal("fail-model", storeDir, "agent:bot:main");
    expect(terminal?.businessExecution).toBe("none");
    expect(terminal?.text).toBe(INTERACTION_MODEL_FAILURE_TEXT);
    expect(terminal?.persistedToTranscript).toBe(true);
    const again = await reconcileChatTurnTerminal({
      runId: "fail-model",
      storeDir,
      sessionKey: "agent:bot:main",
      append: async () => {
        appends += 1;
        return { ok: true };
      },
    });
    expect(again.reconciled).toBe(false);
    expect(appends).toBe(1);

    const later = await routeInteraction(
      { message: "还在吗", context: [] },
      { requestId: "after-failure", expectedFocusRevision: 0, expectedWriteEpoch: 0 },
      {
        inference: { infer: async () => ({ kind: "reply" as const, text: "在，可以继续。" }) },
        admission: { authorize: vi.fn(), commit: vi.fn() },
      },
    );
    expect(later.kind).toBe("respond");
    if (later.kind === "respond") {
      expect(later.text).toBe("在，可以继续。");
    }
    expect(interactionAdmissionFact(later)).toEqual({ admitted: false });
    const stillFailed = readChatTurnTerminal("fail-model", storeDir, "agent:bot:main");
    expect(stillFailed?.text).toBe(INTERACTION_MODEL_FAILURE_TEXT);
    expect(stillFailed?.businessExecution).toBe("none");
    const afterFailure = readSessionTaskBoard(sessionFile);
    expect(afterFailure.current).toBeUndefined();
    expect(afterFailure.tombstones?.some((row) => row.taskId === admittedLong.binding.taskId)).toBe(
      true,
    );
  });
});
