import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { IncomingTurnResult } from "../agent-runtime/contracts/turn-result.js";
import { appendTaskConstraint } from "../agent-runtime/state/mutations/task-constraints.js";
import { createTask } from "../agent-runtime/state/mutations/task-record.js";
import { omitParkedPriorTurns } from "./focus-switch.js";
import {
  allocateTaskInstanceId,
  bindCurrentExecution,
  buildResumePrompt,
  formatTaskBoardFocusLine,
  cancelParkedTask,
  closeParkedTask,
  commitBoardMutation,
  emptySessionTaskBoard,
  evaluateCurrentTaskSend,
  commitAutomaticPark,
  finishCurrentTask,
  insertLatestTaskDeferringCurrent,
  isTaskTombstoned,
  readSessionTaskBoard,
  recordCheckedTaskCompletion,
  captureTaskCompletionBinding,
  sanitizeTaskBoardPathForPrompt,
  seedSessionTaskBoard,
  pauseParkedTask,
  resumeParkedTask,
  type SessionTaskBoard,
} from "./session-task-board.js";

const PRICE = "生成今日竞品价格检查结果，并验收至少一个竞品价格";
const RESEARCH =
  "请使用 web-research 做一次标准深度联网调研。调研问题：2026 年开源智能体平台的产品形态。";

function turn(text: string, nowMs: number, paths: string[] = []) {
  return { incomingText: text, nowMs, workspacePaths: paths };
}

// Initial state fixture only; this does not classify a message or simulate admission.
function initialTaskFixture(params: {
  board: SessionTaskBoard;
  incomingText: string;
  nowMs: number;
  workspacePaths?: string[];
  inboundRequestId?: string;
}): IncomingTurnResult {
  const current = createTask(params.incomingText, params.nowMs, params.workspacePaths ?? [], {
    inboundRequestId: params.inboundRequestId,
    entropy: params.nowMs,
  });
  return {
    board: { ...params.board, current },
    taskId: current.taskId,
    action: "continue",
    cutContext: false,
  };
}

function goal(text: string, nowMs: number, paths: string[] = []) {
  return { goalText: text, nowMs, workspacePaths: paths };
}

describe("session task tracking", () => {
  it("auto-parks a real switch, cuts context, and names both tasks", () => {
    const started = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(PRICE, 1, ["/tmp/price.md"]),
    });
    const switched = insertLatestTaskDeferringCurrent({
      board: started.board,
      ...goal(RESEARCH, 2, ["/tmp/price.md"]),
    });
    expect(switched.action).toBe("switch");
    expect(switched.cutContext).toBe(true);
    expect(switched.taskId).not.toBe(started.taskId);
    expect(switched.statusLine).toContain("已挂起");
    expect(switched.statusLine).toContain("开始");
    expect(switched.statusLine).toContain("竞品价格");
    expect(switched.board.parked).toHaveLength(1);
    expect(switched.board.parked[0]?.stop.workspacePaths).toEqual(["/tmp/price.md"]);
    const history = [
      { role: "user", content: [{ type: "text", text: PRICE }] },
      { role: "assistant", content: [{ type: "text", text: "已挂起旧任务" }] },
      { role: "user", content: [{ type: "text", text: RESEARCH }], contextCut: true },
    ];
    const kept = omitParkedPriorTurns(history);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ contextCut: true });
  });

  it("archives the oldest parked task at the cap of 3 and names its files (AC10/AC20)", () => {
    const goals = [
      ["请先生成今日竞品价格检查结果", "/work/price.md"],
      ["现在改做：整理数字人记忆长文并写一百字总结", "/work/article.md"],
      ["请先出技能来源基线清单 v1", "/work/skills.md"],
      ["请先整理本周董事会会议纪要", "/work/meeting.md"],
      ["请先起草供应商合同审查意见", "/work/contract.md"],
    ] as const;
    let board: SessionTaskBoard = emptySessionTaskBoard();
    let last = initialTaskFixture({
      board,
      ...turn(goals[0][0], 1, [goals[0][1]]),
    });
    for (let i = 1; i < goals.length; i++) {
      last = insertLatestTaskDeferringCurrent({
        board: last.board,
        ...goal(goals[i][0], i + 1, [goals[i][1]]),
      });
    }
    expect(last.action).toBe("switch");
    expect(last.board.parked).toHaveLength(3);
    expect(last.droppedTitle).toBeTruthy();
    expect(last.statusLine).toContain(`已归档最早挂起的「${last.droppedTitle}」`);
    expect(last.statusLine).toContain("/work/price.md");
    expect(last.board.parked.map((row) => row.title)).not.toContain(last.droppedTitle);
    expect(last.board.archived?.some((row) => row.title === last.droppedTitle)).toBe(true);
    expect(last.board.archived?.[0]?.archiveReason).toBe("parked_capacity");
  });

  it("resumes a parked task from its stop summary and paths, not the old transcript", () => {
    const started = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(PRICE, 1, ["/tmp/price.md"]),
    });
    const switched = insertLatestTaskDeferringCurrent({
      board: started.board,
      ...goal(RESEARCH, 2),
    });
    const parked = switched.board.parked[0];
    const resumed = resumeParkedTask({
      board: switched.board,
      taskId: parked.taskId,
      nowMs: 3,
      workspacePaths: ["/tmp/research.md"],
    });
    expect(resumed.action).toBe("resume");
    expect(resumed.cutContext).toBe(true);
    expect(resumed.taskId).toBe(parked.taskId);
    expect(resumed.restoredPrompt).toContain("停在：");
    expect(resumed.restoredPrompt).toContain("price.md");
    expect(resumed.restoredPrompt).not.toContain("/tmp/price.md");
    expect(resumed.restoredPrompt).not.toContain(RESEARCH);
    expect(resumed.board.current?.unfinished).toBe(true);
    expect(resumed.board.parked.some((row) => row.taskId === switched.taskId)).toBe(true);
    const paused = pauseParkedTask({
      board: resumed.board,
      taskId: switched.taskId,
    });
    expect(paused.action).toBe("continue");
    expect(paused.statusLine).toContain("已暂停挂起");
    expect(paused.board.parked.some((row) => row.taskId === switched.taskId)).toBe(true);
    const cancelled = cancelParkedTask({
      board: resumed.board,
      taskId: switched.taskId,
    });
    expect(cancelled.action).toBe("cancel_parked");
    expect(cancelled.cutContext).toBe(false);
    expect(cancelled.board.current?.taskId).toBe(parked.taskId);
    expect(cancelled.board.parked.some((row) => row.taskId === switched.taskId)).toBe(false);
  });

  it("lists parked tasks after a checked deliverable, and omits the list when none are parked", () => {
    const started = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(PRICE, 1_700_000_000_000, ["/tmp/price.md"]),
    });
    const switched = insertLatestTaskDeferringCurrent({
      board: started.board,
      ...goal(RESEARCH, 1_700_000_060_000),
    });
    const finished = finishCurrentTask({ board: switched.board, deliverableChecked: true });
    expect(finished.notice).toContain("当前任务已完成，交付已核对。");
    expect(finished.notice).toContain("[PARKED_TASK_REMINDER]");
    expect(finished.notice).toContain("继续挂起");
    expect(finished.notice).toContain("取消挂起");
    expect(finished.notice).toContain("停在：");
    expect(finished.notice).toContain("/tmp/price.md");
    const only = finishCurrentTask({
      board: started.board,
      deliverableChecked: true,
    });
    expect(only.notice).toBe("当前任务已完成，交付已核对。");
    expect(only.notice).not.toContain("[PARKED_TASK_REMINDER]");
  });

  it("delivers conversation_send for the current task id without owner confirmation", () => {
    const started = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(RESEARCH, 1),
    });
    const same = evaluateCurrentTaskSend({
      currentTaskId: started.taskId,
      taskId: started.taskId,
    });
    expect(same).toEqual({ action: "deliver", taskId: started.taskId, requiresOwner: false });
    const retry = evaluateCurrentTaskSend({
      currentTaskId: started.taskId,
      taskId: started.taskId,
    });
    expect(retry.taskId).toBe(started.taskId);
    expect(retry.requiresOwner).toBe(false);
  });
});

it("does not announce completion for a model claim that did not close", () => {
  const started = initialTaskFixture({
    board: emptySessionTaskBoard(),
    ...turn(PRICE, 1, ["/tmp/price.md"]),
  });
  const claimed = recordCheckedTaskCompletion({ closed: false });
  expect(claimed.notice).toBeUndefined();
  expect(claimed.persisted).toBe(false);
  expect(started.board.current?.unfinished).toBe(true);
});

it("announces a real close and a fourth automatic park drops the oldest file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-board-"));
  const sessionFile = path.join(dir, "session.jsonl");
  fs.writeFileSync(sessionFile, "", "utf8");
  const parked = ["a", "b", "c"].map((id, index) => ({
    taskId: id,
    title: id,
    goalText: id,
    unfinished: true,
    stop: { summary: `未完成：${id}`, workspacePaths: [`/tmp/${id}.md`] },
    parkedAtMs: index + 1,
    createdAtMs: index + 1,
  }));
  const board: SessionTaskBoard = {
    current: {
      taskId: "current",
      title: "当前工作",
      goalText: "当前工作",
      unfinished: true,
      stop: { summary: "未完成：当前工作", workspacePaths: ["/tmp/current.md"] },
      createdAtMs: 4,
    },
    parked: [...parked].toReversed(),
    focusRevision: 0,
  };
  seedSessionTaskBoard(sessionFile, board);
  const dropped = commitAutomaticPark({
    sessionFile,
    incomingTaskId: "cron-job-9",
    nowMs: 5,
  });
  expect(dropped?.taskId).toBe("a");
  expect(dropped?.stop.workspacePaths).toEqual(["/tmp/a.md"]);
  const stored = readSessionTaskBoard(sessionFile);
  expect(stored.parked).toHaveLength(3);
  expect(stored.parked.some((row) => row.taskId === "a")).toBe(false);
  expect(stored.parked[0]?.taskId).toBe("cron-job-9");
  const finished = recordCheckedTaskCompletion({
    sessionFile,
    closed: true,
    binding: captureTaskCompletionBinding(sessionFile),
  });
  expect(finished.persisted).toBe(true);
  expect(finished.notice).toContain("当前任务已完成，交付已核对。");
  expect(finished.notice).toContain("[PARKED_TASK_REMINDER]");
  expect(finished.notice).toContain("前任务：");
  expect(finished.notice).toContain("继续挂起");
  expect(finished.notice).toContain("取消挂起");
  expect(finished.notice).toContain("「b」");
  expect(finished.notice).toContain("cron-job-9");
  expect(fs.readFileSync(sessionFile, "utf8")).toContain("当前任务已完成，交付已核对。");
  expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(false);
  const quiet = recordCheckedTaskCompletion({ closed: false });
  expect(quiet.notice).toBeUndefined();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("parkReason / wakeSuppress", () => {
  it("stores parkReason and wakeSuppress on switch, clears on resume", () => {
    const first = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(PRICE, 1_000),
    });
    const switched = insertLatestTaskDeferringCurrent({
      board: first.board,
      ...goal(RESEARCH, 2_000),
    });
    expect(switched.action).toBe("switch");
    expect(switched.board.parked[0]?.wakeSuppress).toBe(true);
    expect(switched.board.parked[0]?.parkReason).toBe("user_switch");
    expect(switched.statusLine).toContain("已挂起");
    expect(switched.statusLine).toContain("当前任务");

    const parkedId = switched.board.parked[0]?.taskId ?? "";
    const resumed = resumeParkedTask({
      board: switched.board,
      taskId: parkedId,
      nowMs: 3_000,
    });
    expect(resumed.action).toBe("resume");
    expect(resumed.board.current?.wakeSuppress).toBe(false);
    expect(resumed.board.current?.parkReason).toBeUndefined();
  });

  it("resume re-checks auth and stop state", () => {
    const first = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(PRICE, 1_000),
    });
    const switched = insertLatestTaskDeferringCurrent({
      board: first.board,
      ...goal(RESEARCH, 2_000),
    });
    const parkedId = switched.board.parked[0]?.taskId ?? "";
    const deniedAuth = resumeParkedTask({
      board: switched.board,
      taskId: parkedId,
      nowMs: 3_000,
      recheck: { authOk: false },
    });
    expect(deniedAuth.action).toBe("continue");
    expect(deniedAuth.statusLine).toContain("授权无效");
    expect(deniedAuth.board.parked.some((row) => row.taskId === parkedId)).toBe(true);

    const deniedStop = resumeParkedTask({
      board: switched.board,
      taskId: parkedId,
      nowMs: 3_000,
      recheck: { stopActive: true },
    });
    expect(deniedStop.action).toBe("continue");
    expect(deniedStop.statusLine).toContain("已停止");
  });

  it("formatTaskBoardFocusLine reports current and parked count", () => {
    const board: SessionTaskBoard = {
      current: {
        taskId: "task-a",
        title: "A",
        goalText: "A",
        unfinished: true,
        stop: { summary: "s", workspacePaths: [] },
        createdAtMs: 1,
      },
      parked: [
        {
          taskId: "task-b",
          title: "B",
          goalText: "B",
          unfinished: true,
          stop: { summary: "s", workspacePaths: [] },
          createdAtMs: 1,
          parkedAtMs: 2,
          wakeSuppress: true,
          parkReason: "user_switch",
        },
      ],
      focusRevision: 1,
    };
    expect(formatTaskBoardFocusLine(board)).toBe("当前任务：「A」；已挂起 1 项");
  });
});

describe("board-latest task binding", () => {
  const SNAKE = "你帮我制作一个贪吃蛇的小游戏";
  const NOVEL = "请继续写《调律》小说第七章，六时启闸，并验收交付";

  it("interrupt + insert parks old unfinished and continues the LATEST task", () => {
    const started = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(SNAKE, 1, ["/tmp/snake.html"]),
    });
    expect(started.board.current?.unfinished).toBe(true);

    const inserted = insertLatestTaskDeferringCurrent({
      board: started.board,
      goalText: NOVEL,
      nowMs: 2,
      workspacePaths: ["/tmp/novel/ch07.md"],
      parkReason: "interrupt_insert",
    });
    expect(inserted.action).toBe("switch");
    expect(inserted.board.current?.goalText).toContain("调律");
    expect(inserted.board.current?.taskId).toBe(inserted.taskId);
    expect(inserted.board.current?.taskId).not.toBe(started.taskId);
    expect(inserted.board.parked).toHaveLength(1);
    expect(inserted.board.parked[0]?.taskId).toBe(started.taskId);
    expect(inserted.board.parked[0]?.wakeSuppress).toBe(true);
    expect(inserted.board.parked[0]?.parkReason).toBe("interrupt_insert");

    // Natural-language insert with 继续 + distinct work also binds LATEST.
    const viaMessage = insertLatestTaskDeferringCurrent({
      board: started.board,
      ...goal(NOVEL, 3),
    });
    expect(viaMessage.action).toBe("switch");
    expect(viaMessage.board.current?.taskId).toBe(viaMessage.taskId);
    expect(viaMessage.board.current?.taskId).not.toBe(started.taskId);
    expect(viaMessage.board.parked.some((row) => row.taskId === started.taskId)).toBe(true);
  });

  it("completing LATEST summarizes deferred unfinished and invites CONTINUE or CLOSE", () => {
    const started = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(SNAKE, 1, ["/tmp/snake.html"]),
    });
    const latest = insertLatestTaskDeferringCurrent({
      board: started.board,
      goalText: NOVEL,
      nowMs: 2,
      workspacePaths: ["/tmp/novel/ch07.md"],
    });
    const finished = finishCurrentTask({ board: latest.board, deliverableChecked: true });
    expect(finished.board.current?.unfinished).toBe(false);
    expect(finished.notice).toContain("[PARKED_TASK_REMINDER]");
    expect(finished.notice).toContain("CONTINUE");
    expect(finished.notice).toContain("CLOSE");
    expect(finished.notice).toContain("贪吃蛇");
    expect(finished.notice).toContain(started.taskId);
  });

  it("user CLOSE removes the deferred item from the board (not a continue target)", () => {
    const started = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(SNAKE, 1),
    });
    const latest = insertLatestTaskDeferringCurrent({
      board: started.board,
      goalText: NOVEL,
      nowMs: 2,
    });
    const parkedId = latest.board.parked[0]?.taskId ?? "";
    expect(parkedId).toBe(started.taskId);

    const closed = closeParkedTask({
      board: latest.board,
      taskId: parkedId,
      nowMs: 3,
    });
    expect(closed.action).toBe("cancel_parked");
    expect(closed.board.parked.some((row) => row.taskId === parkedId)).toBe(false);
    expect(closed.board.current?.taskId).toBe(latest.taskId);
    expect(closed.statusLine).toContain("已移出任务板");

    const viaAlias = closeParkedTask({
      board: latest.board,
      taskId: parkedId,
    });
    expect(viaAlias.board.parked.some((row) => row.taskId === parkedId)).toBe(false);

    const viaZh = closeParkedTask({
      board: latest.board,
      taskId: parkedId,
      nowMs: 4,
    });
    expect(viaZh.action).toBe("cancel_parked");
    expect(viaZh.board.parked).toHaveLength(0);
  });
});

describe("board-latest rules v2 C1–C6 / AC13–AC20", () => {
  const SNAKE = "你帮我制作一个贪吃蛇的小游戏";
  const NOVEL = "请继续写《调律》小说第七章，六时启闸，并验收交付";
  const RESEARCH =
    "请使用 web-research 做一次标准深度联网调研。调研问题：2026 年开源智能体平台的产品形态。";

  it("C1/AC1: insert bumps focusRevision; resume bumps; amend does not", () => {
    const started = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(SNAKE, 1),
    });
    expect(started.board.focusRevision).toBe(0);
    const inserted = insertLatestTaskDeferringCurrent({
      board: started.board,
      goalText: NOVEL,
      nowMs: 2,
    });
    expect(inserted.action).toBe("switch");
    expect(inserted.board.focusRevision).toBe(1);
    expect(inserted.focusRevision).toBe(1);
    const amended = appendTaskConstraint({
      board: inserted.board,
      constraintText: "补充一节",
      nowMs: 3,
    });
    expect(amended.focusRevision).toBe(1);
    const parkedId = inserted.board.parked[0]?.taskId ?? "";
    const resumed = resumeParkedTask({
      board: inserted.board,
      taskId: parkedId,
      nowMs: 4,
    });
    expect(resumed.action).toBe("resume");
    expect(resumed.board.focusRevision).toBe(2);
    expect(resumed.scheduleContinue).toBe(false);
  });

  it("C4/AC14: late A complete must not finish or overwrite B", () => {
    const started = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(SNAKE, 1),
    });
    const withAttempt = bindCurrentExecution({
      board: started.board,
      taskId: started.taskId,
      deliverableVersion: "v1",
      executionAttempt: "a1",
    });
    const inserted = insertLatestTaskDeferringCurrent({
      board: withAttempt,
      goalText: NOVEL,
      nowMs: 2,
    });
    expect(inserted.board.current?.taskId).not.toBe(started.taskId);
    const late = finishCurrentTask({
      board: inserted.board,
      deliverableChecked: true,
      taskId: started.taskId,
      deliverableVersion: "v1",
      executionAttempt: "a1",
    });
    expect(late.rejected).toBe(true);
    expect(late.reason).toBe("task_id_mismatch");
    expect(late.board.current?.taskId).toBe(inserted.taskId);
    expect(late.board.current?.unfinished).toBe(true);
  });

  it("C5/AC15: CLOSE tombstone blocks resume / wake resurrection", () => {
    const started = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(SNAKE, 1),
    });
    const inserted = insertLatestTaskDeferringCurrent({
      board: started.board,
      goalText: NOVEL,
      nowMs: 2,
    });
    const parkedId = inserted.board.parked[0]?.taskId ?? "";
    const closed = closeParkedTask({ board: inserted.board, taskId: parkedId, nowMs: 3 });
    expect(closed.action).toBe("cancel_parked");
    expect(isTaskTombstoned(closed.board, parkedId)).toBe(true);
    expect(closed.board.tombstones?.some((row) => row.taskId === parkedId)).toBe(true);
    const resurrect = resumeParkedTask({
      board: closed.board,
      taskId: parkedId,
      nowMs: 4,
    });
    expect(resurrect.action).toBe("continue");
    expect(resurrect.rejectedReason).toBe("tombstoned");
    expect(resurrect.board.current?.taskId).toBe(inserted.taskId);
    expect(resurrect.board.parked.some((row) => row.taskId === parkedId)).toBe(false);
  });

  it("C3/AC17: same body again = new id; same inbound retry = idempotent", () => {
    const a = allocateTaskInstanceId({ entropy: "one" });
    const b = allocateTaskInstanceId({ entropy: "two" });
    expect(a).not.toBe(b);
    const req = "inbound-req-abc";
    const first = allocateTaskInstanceId({ inboundRequestId: req });
    const retry = allocateTaskInstanceId({ inboundRequestId: req });
    expect(first).toBe(retry);
    const t1 = initialTaskFixture({
      board: emptySessionTaskBoard(),
      incomingText: SNAKE,
      nowMs: 1,
      inboundRequestId: "create-1",
    });
    const t2 = initialTaskFixture({
      board: emptySessionTaskBoard(),
      incomingText: SNAKE,
      nowMs: 2,
      inboundRequestId: "create-2",
    });
    expect(t1.taskId).not.toBe(t2.taskId);
    const again = insertLatestTaskDeferringCurrent({
      board: t1.board,
      goalText: SNAKE,
      nowMs: 3,
      inboundRequestId: "create-1",
    });
    // same inbound against already-current with that id stays continue (idempotent)
    expect(again.action).toBe("continue");
    expect(again.taskId).toBe(t1.taskId);
  });

  it("C6/AC16: concurrent insert CAS — loser gets revision_mismatch, no silent loss", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-board-cas-"));
    const sessionFile = path.join(dir, "session.jsonl");
    fs.writeFileSync(sessionFile, "", "utf8");
    const started = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(SNAKE, 1),
    });
    seedSessionTaskBoard(sessionFile, started.board);
    const rev = started.board.focusRevision;
    const first = commitBoardMutation({
      sessionFile,
      expectedRevision: rev,
      mutate: (board) =>
        insertLatestTaskDeferringCurrent({
          board,
          goalText: NOVEL,
          nowMs: 2,
        }),
    });
    expect("rejected" in first && first.rejected).toBe(false);
    if ("rejected" in first) {
      throw new Error("unexpected reject");
    }
    expect(first.action).toBe("switch");
    const second = commitBoardMutation({
      sessionFile,
      expectedRevision: rev,
      mutate: (board) =>
        insertLatestTaskDeferringCurrent({
          board,
          goalText: RESEARCH,
          nowMs: 3,
        }),
    });
    expect("rejected" in second && second.rejected).toBe(true);
    if (!("rejected" in second) || !second.rejected) {
      throw new Error("expected reject");
    }
    expect(second.reason).toBe("revision_mismatch");
    const stored = readSessionTaskBoard(sessionFile);
    expect(stored.current?.goalText).toContain("调律");
    expect(stored.parked.some((row) => row.taskId === started.taskId)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("C6/AC19: resume revoked auth/stop/budget/plan/workspace rejects; board unchanged", () => {
    const started = initialTaskFixture({
      board: emptySessionTaskBoard(),
      ...turn(SNAKE, 1),
    });
    const inserted = insertLatestTaskDeferringCurrent({
      board: started.board,
      goalText: NOVEL,
      nowMs: 2,
    });
    const parkedId = inserted.board.parked[0]?.taskId ?? "";
    const before = inserted.board.focusRevision;
    for (const recheck of [
      { authOk: false as const },
      { stopActive: true as const },
      { budgetOk: false as const },
      { planOk: false as const },
      { workspaceOk: false as const },
    ]) {
      const denied = resumeParkedTask({
        board: inserted.board,
        taskId: parkedId,
        nowMs: 3,
        recheck,
      });
      expect(denied.action).toBe("continue");
      expect(denied.board.focusRevision).toBe(before);
      expect(denied.board.current?.taskId).toBe(inserted.taskId);
      expect(denied.board.parked.some((row) => row.taskId === parkedId)).toBe(true);
      expect(denied.scheduleContinue).toBe(false);
    }
  });

  it("C1/AC18: boards with different scope do not share focus", () => {
    const a = emptySessionTaskBoard({ tenantId: "t1", userId: "u1", sessionId: "s1" });
    const b = emptySessionTaskBoard({ tenantId: "t2", userId: "u2", sessionId: "s2" });
    const startedA = initialTaskFixture({ board: a, ...turn(SNAKE, 1) });
    const startedB = initialTaskFixture({ board: b, ...turn(SNAKE, 1) });
    expect(startedA.board.scope?.tenantId).toBe("t1");
    expect(startedB.board.scope?.tenantId).toBe("t2");
    expect(startedA.taskId).not.toBe(startedB.taskId);
    const insertA = insertLatestTaskDeferringCurrent({
      board: startedA.board,
      goalText: NOVEL,
      nowMs: 2,
    });
    expect(insertA.board.focusRevision).toBe(1);
    expect(startedB.board.focusRevision).toBe(0);
    expect(startedB.board.current?.taskId).toBe(startedB.taskId);
  });
});

describe("buildResumePrompt path / task-id visibility", () => {
  it("redacts absolute tenant paths and keeps task id on a machine line only", () => {
    expect(
      sanitizeTaskBoardPathForPrompt(
        "/root/openbot-tenants/001/users/90fed/OpenBot/agents/bot-2/workspace/deliverables/a.md",
      ),
    ).toBe("deliverables/a.md");
    const prompt = buildResumePrompt({
      taskId: "task-abc",
      title: "选 A",
      goalText: "选 A",
      unfinished: true,
      createdAtMs: 1,
      stop: {
        summary: "未完成",
        workspacePaths: [
          "/root/openbot-tenants/001/users/90fed/OpenBot/agents/bot-2/workspace/x.md",
        ],
      },
    });
    expect(prompt).toContain("task_id: task-abc");
    expect(prompt).toContain("继续任务「选 A」。");
    expect(prompt).not.toMatch(/（task-abc）/);
    expect(prompt).not.toContain("/root/openbot-tenants");
    expect(prompt).toContain("文件：x.md");
  });
});
