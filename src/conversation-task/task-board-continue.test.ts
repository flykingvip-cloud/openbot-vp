import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedSessionTaskBoard, type SessionTaskBoard } from "./session-task-board.js";
import {
  insertLatestTaskDeferringCurrent,
  emptySessionTaskBoard,
  applyIncomingUserMessage,
} from "./session-task-board.js";
import {
  claimTaskBoardContinue,
  decideTaskBoardContinue,
  isExplicitHumanGateWait,
  resetTaskBoardContinueLedgerForTest,
  scheduleTaskBoardContinueWake,
  TASK_BOARD_CONTINUE_MAX_PER_TASK,
} from "./task-board-continue.js";

function tempSessionFile(): string {
  return path.join(
    os.tmpdir(),
    `task-board-continue-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`,
  );
}

function unfinishedBoard(taskId = "task-abc", focusRevision = 1): SessionTaskBoard {
  return {
    current: {
      taskId,
      title: "请给我pdf",
      goalText: "请给我pdf，你要制作pdf",
      unfinished: true,
      stop: { summary: "未完成：请给我pdf", workspacePaths: ["/tmp/ws"] },
      createdAtMs: 1,
    },
    parked: [],
    focusRevision,
  };
}

afterEach(() => {
  resetTaskBoardContinueLedgerForTest();
});

describe("isExplicitHumanGateWait", () => {
  it("treats permanent_block and true_fork as gates", () => {
    expect(
      isExplicitHumanGateWait(
        "[turn_completion state=permanent_block reason=need_pay degradation=none required_user_action=pay]",
      ),
    ).toBe(true);
    expect(isExplicitHumanGateWait("[turn_completion state=true_fork options=A|B]")).toBe(true);
  });

  it("does not treat soft draft confirm as a gate", () => {
    expect(isExplicitHumanGateWait("要不要推到草稿箱？请确认一下。")).toBe(false);
  });

  it("treats waiting_confirmation / payment as gates", () => {
    expect(isExplicitHumanGateWait("状态：waiting_confirmation，请确认计划")).toBe(true);
    expect(isExplicitHumanGateWait("请扫码支付后再继续")).toBe(true);
  });
});

describe("decideTaskBoardContinue", () => {
  it("schedules when unfinished and not a human gate", () => {
    const sessionFile = tempSessionFile();
    seedSessionTaskBoard(sessionFile, unfinishedBoard());
    const decision = decideTaskBoardContinue({
      sessionFile,
      assistantText:
        "[turn_completion state=delivered path=deliverables/turn-completion-degraded.md]",
    });
    expect(decision.action).toBe("schedule");
    if (decision.action === "schedule") {
      expect(decision.wakeRecorded).toBe(true);
      expect(decision.reason).toBe("task_board_continue");
      expect(decision.taskId).toBe("task-abc");
      expect(decision.prompt).toContain("Internal task-board continue:");
      expect(decision.prompt).toContain("task-abc");
    }
    try {
      fs.unlinkSync(`${sessionFile}.task-board.json`);
    } catch {
      /* best-effort cleanup */
    }
  });

  it("skips human gate even when unfinished", () => {
    const sessionFile = tempSessionFile();
    seedSessionTaskBoard(sessionFile, unfinishedBoard());
    const decision = decideTaskBoardContinue({
      sessionFile,
      assistantText:
        "[turn_completion state=permanent_block reason=x degradation=y required_user_action=z]",
    });
    expect(decision).toMatchObject({
      action: "skip",
      reason: "human_gate",
      wakeRecorded: false,
    });
  });

  it("skips when board has no unfinished current", () => {
    const sessionFile = tempSessionFile();
    seedSessionTaskBoard(sessionFile, emptySessionTaskBoard());
    expect(decideTaskBoardContinue({ sessionFile, assistantText: "done for now" })).toMatchObject({
      action: "skip",
      reason: "no_unfinished_current",
    });
  });

  it("skips heartbeat and toolsDisabled", () => {
    expect(
      decideTaskBoardContinue({ isHeartbeat: true, sessionFile: "/x", assistantText: "a" }),
    ).toMatchObject({ reason: "heartbeat" });
    expect(
      decideTaskBoardContinue({ toolsDisabled: true, sessionFile: "/x", assistantText: "a" }),
    ).toMatchObject({ reason: "tools_disabled" });
  });

  it("skips when current.wakeSuppress is set", () => {
    const sessionFile = tempSessionFile();
    const board = unfinishedBoard("task-suppress");
    board.current!.wakeSuppress = true;
    seedSessionTaskBoard(sessionFile, board);
    expect(
      decideTaskBoardContinue({
        sessionFile,
        assistantText: "still unfinished, no human gate",
      }),
    ).toMatchObject({
      action: "skip",
      reason: "wake_suppress",
      wakeRecorded: false,
      taskId: "task-suppress",
    });
  });

  it("caps chained continues per task", () => {
    const sessionFile = tempSessionFile();
    seedSessionTaskBoard(sessionFile, unfinishedBoard("task-cap"));
    const nowMs = 1_000_000;
    for (let i = 0; i < TASK_BOARD_CONTINUE_MAX_PER_TASK; i += 1) {
      const d = scheduleTaskBoardContinueWake({
        sessionFile,
        assistantText: "still working",
        nowMs: nowMs + i,
        armTimer: false,
        enqueue: () => true,
      });
      expect(d.action).toBe("schedule");
    }
    const blocked = decideTaskBoardContinue({
      sessionFile,
      assistantText: "still working",
      nowMs: nowMs + 10,
    });
    expect(blocked).toMatchObject({
      action: "skip",
      reason: "continue_cap",
      taskId: "task-cap",
    });
  });

  it("schedules LATEST current and never the deferred parked prior", () => {
    const sessionFile = tempSessionFile();
    const board: SessionTaskBoard = {
      current: {
        taskId: "task-novel-latest",
        title: "调律第七章",
        goalText: "请继续写《调律》小说第七章",
        unfinished: true,
        stop: { summary: "未完成：调律第七章", workspacePaths: ["/tmp/ch07.md"] },
        createdAtMs: 2,
      },
      parked: [
        {
          taskId: "task-c8d289281767",
          title: "你帮我制作一个贪吃蛇的小游戏",
          goalText: "你帮我制作一个贪吃蛇的小游戏",
          unfinished: true,
          stop: { summary: "未完成：贪吃蛇", workspacePaths: ["/tmp/snake.html"] },
          createdAtMs: 1,
          parkedAtMs: 2,
          wakeSuppress: true,
          parkReason: "interrupt_insert",
        },
      ],
      focusRevision: 2,
    };
    seedSessionTaskBoard(sessionFile, board);
    const decision = decideTaskBoardContinue({
      sessionFile,
      assistantText: "chapter draft ready for next beat",
    });
    expect(decision.action).toBe("schedule");
    if (decision.action === "schedule") {
      expect(decision.taskId).toBe("task-novel-latest");
      expect(decision.prompt).toContain("task-novel-latest");
      expect(decision.prompt).not.toContain("task-c8d289281767");
    }
    try {
      fs.unlinkSync(`${sessionFile}.task-board.json`);
    } catch {
      /* best-effort cleanup */
    }
  });
});

describe("scheduleTaskBoardContinueWake", () => {
  it("arms a timer and enqueues with observability fields", () => {
    const sessionFile = tempSessionFile();
    seedSessionTaskBoard(sessionFile, unfinishedBoard("task-timer"));
    const enqueue = vi.fn(() => true);
    const timers: Array<{ ms: number; fn: () => void }> = [];
    const decision = scheduleTaskBoardContinueWake({
      sessionFile,
      assistantText: "empty shell pptx, degraded",
      delayMs: 50,
      enqueue,
      setTimer: ((fn: () => void, ms: number) => {
        timers.push({ ms, fn: fn as () => void });
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout,
    });
    expect(decision.action).toBe("schedule");
    expect(decision.wakeRecorded).toBe(true);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(50);
    timers[0]?.fn();
    expect(enqueue).toHaveBeenCalledOnce();
    const call = enqueue.mock.calls[0] as unknown as [string, string] | undefined;
    expect(call?.[0]).toContain("Internal task-board continue:");
    expect(call?.[1]).toMatch(/^task-board-continue:task-timer:r\d+:/);
  });
});

describe("board-latest v2 C2 continue ticket / AC13", () => {
  it("schedules with taskId + focusRevision ticket", () => {
    const sessionFile = tempSessionFile();
    seedSessionTaskBoard(sessionFile, unfinishedBoard("task-rev", 5));
    const decision = decideTaskBoardContinue({
      sessionFile,
      assistantText: "still working",
    });
    expect(decision.action).toBe("schedule");
    if (decision.action === "schedule") {
      expect(decision.focusRevision).toBe(5);
      expect(decision.ticket).toEqual({
        taskId: "task-rev",
        focusRevision: 5,
        prompt: decision.prompt,
      });
    }
  });

  it("AC13: A queued then insert B → claim A rejects", () => {
    const sessionFile = tempSessionFile();
    const started = applyIncomingUserMessage({
      board: emptySessionTaskBoard(),
      incomingText: "你帮我制作一个贪吃蛇的小游戏",
      nowMs: 1,
    });
    seedSessionTaskBoard(sessionFile, started.board);
    const decision = decideTaskBoardContinue({
      sessionFile,
      assistantText: "snake draft in progress",
    });
    expect(decision.action).toBe("schedule");
    if (decision.action !== "schedule") {
      throw new Error("expected schedule");
    }
    const ticket = decision.ticket;
    const inserted = insertLatestTaskDeferringCurrent({
      board: started.board,
      goalText: "请继续写《调律》小说第七章，六时启闸，并验收交付",
      nowMs: 2,
    });
    seedSessionTaskBoard(sessionFile, inserted.board);
    expect(inserted.board.focusRevision).toBeGreaterThan(ticket.focusRevision);
    const claimed = claimTaskBoardContinue({
      sessionFile,
      taskId: ticket.taskId,
      focusRevision: ticket.focusRevision,
    });
    expect(claimed.ok).toBe(false);
    if (!claimed.ok) {
      expect(["revision_mismatch", "task_id_mismatch"]).toContain(claimed.reason);
    }
    expect(inserted.board.current?.taskId).toBe(inserted.taskId);
    expect(inserted.board.current?.unfinished).toBe(true);
  });

  it("claim rejects tombstoned taskId", () => {
    const sessionFile = tempSessionFile();
    const board = unfinishedBoard("task-dead", 3);
    board.tombstones = [{ taskId: "task-dead", closedAtMs: 1, title: "dead" }];
    seedSessionTaskBoard(sessionFile, board);
    const claimed = claimTaskBoardContinue({
      sessionFile,
      taskId: "task-dead",
      focusRevision: 3,
    });
    expect(claimed.ok).toBe(false);
    if (!claimed.ok) {
      expect(claimed.reason).toBe("tombstoned");
    }
  });

  it("AC13 timer path: claim rejects stale ticket and does not enqueue", () => {
    const sessionFile = tempSessionFile();
    seedSessionTaskBoard(sessionFile, unfinishedBoard("task-stale", 1));
    const enqueue = vi.fn(() => true);
    const timers: Array<{ ms: number; fn: () => void }> = [];
    const decision = scheduleTaskBoardContinueWake({
      sessionFile,
      assistantText: "working",
      delayMs: 10,
      enqueue,
      setTimer: ((fn: () => void, ms: number) => {
        timers.push({ ms, fn: fn as () => void });
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout,
    });
    expect(decision.action).toBe("schedule");
    // Switch focus before timer fires
    const switched = insertLatestTaskDeferringCurrent({
      board: unfinishedBoard("task-stale", 1),
      goalText: "现在改做供应商合同审查",
      nowMs: 9,
    });
    seedSessionTaskBoard(sessionFile, switched.board);
    timers[0]?.fn();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
