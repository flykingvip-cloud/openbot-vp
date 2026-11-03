/**
 * Slice 3 — failing cases first (context / constraint semantics).
 * Must stay green after fix; no second controller / reply_lane.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveMidTaskAsideDisposition } from "../auto-reply/reply/mid-task-aside.js";
import {
  activeConstraintTexts,
  appendSameTaskConstraint,
  applyIncomingUserMessage,
  buildResumePrompt,
  commitSameTaskConstraint,
  emptySessionTaskBoard,
  readSessionTaskBoard,
  seedSessionTaskBoard,
  type SessionTaskBoard,
} from "./session-task-board.js";
import { classifyTurnRelation } from "./turn-relation.js";

function baseBoard(overrides?: Partial<SessionTaskBoard["current"]>): SessionTaskBoard {
  const board = emptySessionTaskBoard();
  board.focusRevision = 1;
  board.writeEpoch = 1;
  board.current = {
    taskId: "task-a",
    title: "手机调研",
    goalText: "调研国内手机市场并写报告",
    unfinished: true,
    stop: { summary: "正在抓取评测站点", workspacePaths: [] },
    createdAtMs: Date.now(),
    ...overrides,
  };
  return board;
}

describe("slice3 constraint context — red then green", () => {
  let tmpDir = "";
  let sessionFile = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "slice3-ctx-"));
    sessionFile = path.join(tmpDir, "session.jsonl");
    fs.writeFileSync(sessionFile, "", "utf8");
    seedSessionTaskBoard(sessionFile, baseBoard());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("goal/constraint queries do not write constraints", () => {
    const before = readSessionTaskBoard(sessionFile);
    const goalAsk = resolveMidTaskAsideDisposition({
      prompt: "当前任务目标是什么",
      board: before,
    });
    expect(goalAsk.kind).toBe("board_readonly");

    // applyIncoming must also refuse to persist query as amend constraint
    const afterGoal = applyIncomingUserMessage({
      board: before,
      incomingText: "当前任务目标是什么",
    });
    expect(activeConstraintTexts(afterGoal.board.current).length).toBe(0);

    const constrAsk = resolveMidTaskAsideDisposition({
      prompt: "有效约束有哪些",
      board: before,
    });
    expect(constrAsk.kind).toBe("board_readonly");
    const afterConstr = applyIncomingUserMessage({
      board: before,
      incomingText: "有效约束有哪些",
    });
    expect(activeConstraintTexts(afterConstr.board.current).length).toBe(0);

    // File path: commit must also refuse query text
    expect(
      commitSameTaskConstraint({
        sessionFile,
        constraintText: "有效约束有哪些",
        expectedTaskId: "task-a",
      }),
    ).toBe(false);
    expect(activeConstraintTexts(readSessionTaskBoard(sessionFile).current).length).toBe(0);
  });

  it("bare 「继续」 is not recorded as a business constraint", () => {
    // Turn relation may still be amend (continue current work) — but must not persist.
    expect(classifyTurnRelation("请继续", "调研国内手机市场并写报告")).toBe("amend");
    expect(classifyTurnRelation("继续", "调研国内手机市场并写报告")).toBe("amend");

    const result = applyIncomingUserMessage({
      board: readSessionTaskBoard(sessionFile),
      incomingText: "请继续",
    });
    expect(activeConstraintTexts(result.board.current).length).toBe(0);

    expect(
      commitSameTaskConstraint({
        sessionFile,
        constraintText: "继续",
        expectedTaskId: "task-a",
      }),
    ).toBe(false);
    expect(activeConstraintTexts(readSessionTaskBoard(sessionFile).current).length).toBe(0);
  });

  it("local revision keeps unrelated prior constraints active", () => {
    let board = appendSameTaskConstraint({
      board: readSessionTaskBoard(sessionFile),
      constraintText: "补充：只用公开资料",
    });
    board = appendSameTaskConstraint({
      board,
      constraintText: "补充：不超过十页",
    });
    board = appendSameTaskConstraint({
      board,
      constraintText: "补充：覆盖欧洲市场",
    });
    board = appendSameTaskConstraint({
      board,
      constraintText: "改为覆盖亚洲市场",
    });
    const active = activeConstraintTexts(board.current);
    expect(active.some((t) => t.includes("只用公开资料"))).toBe(true);
    expect(active.some((t) => t.includes("不超过十页"))).toBe(true);
    expect(active.some((t) => t.includes("覆盖欧洲市场"))).toBe(true);
    expect(active.some((t) => t.includes("覆盖亚洲市场"))).toBe(true);
    const prompt = buildResumePrompt(board.current!);
    expect(prompt).toMatch(/仅覆盖.*冲突/);
    expect(prompt).toContain("只用公开资料");
    expect(prompt).toContain("覆盖亚洲市场");
  });

  it("explicit full replace supersedes prior active constraints", () => {
    let board = appendSameTaskConstraint({
      board: readSessionTaskBoard(sessionFile),
      constraintText: "补充：只要国内安卓机型",
    });
    board = appendSameTaskConstraint({
      board,
      constraintText: "补充：不超过十页",
    });
    board = appendSameTaskConstraint({
      board,
      constraintText: "以本条为准：只要 iOS 机型，不要安卓",
    });
    const active = activeConstraintTexts(board.current);
    expect(active.some((t) => t.includes("只要国内安卓机型"))).toBe(false);
    expect(active.some((t) => t.includes("不超过十页"))).toBe(false);
    expect(active.some((t) => t.includes("只要 iOS 机型"))).toBe(true);
    const all = board.current?.effectiveConstraints ?? [];
    expect(all.length).toBeGreaterThanOrEqual(3);
    const prompt = buildResumePrompt(board.current!);
    expect(prompt).toContain("只要 iOS 机型");
    expect(prompt).not.toMatch(/有效约束[\s\S]*只要国内安卓机型/);
  });

  it("fuzzy correction keeps ordered originals and notes conflict coverage", () => {
    let board = appendSameTaskConstraint({
      board: readSessionTaskBoard(sessionFile),
      constraintText: "补充：只要国内安卓机型",
    });
    board = appendSameTaskConstraint({
      board,
      constraintText: "不对，改为只要 iOS 机型，不要安卓",
    });
    const active = activeConstraintTexts(board.current);
    expect(active.some((t) => t.includes("只要国内安卓机型"))).toBe(true);
    expect(active.some((t) => t.includes("只要 iOS 机型"))).toBe(true);
    const prompt = buildResumePrompt(board.current!);
    expect(prompt).toMatch(/仅覆盖.*冲突/);
    expect(prompt).toContain("只要国内安卓机型");
    expect(prompt).toContain("只要 iOS 机型");
  });

  it("long constraint critical tail survives resume/retry via full records", () => {
    const LONG =
      "补充：只要国内安卓机型，并且本次调研的关键限制条件必须完整保留；下列限制必须出现在第四十八个字符之后才能生效——禁止引用任何海外评测站点的份额数据";
    const TAIL = "禁止引用任何海外评测站点的份额数据";
    expect(LONG.indexOf(TAIL)).toBeGreaterThan(47);

    const board = appendSameTaskConstraint({
      board: readSessionTaskBoard(sessionFile),
      constraintText: LONG,
    });
    seedSessionTaskBoard(sessionFile, board);

    const reloaded = readSessionTaskBoard(sessionFile);
    expect(activeConstraintTexts(reloaded.current).join("\n")).toContain(TAIL);
    expect(buildResumePrompt(reloaded.current!)).toContain(TAIL);

    // Retry same text is idempotent (no duplicate), still retains tail
    const again = appendSameTaskConstraint({
      board: reloaded,
      constraintText: LONG,
    });
    expect(activeConstraintTexts(again.current).filter((t) => t.includes(TAIL)).length).toBe(1);
  });

  it("task A constraint does not write onto switched task B", () => {
    const switched = emptySessionTaskBoard();
    switched.focusRevision = 2;
    switched.writeEpoch = 2;
    switched.current = {
      taskId: "task-b",
      title: "合同审查",
      goalText: "审查供应商合同",
      unfinished: true,
      stop: { summary: "新焦点", workspacePaths: [] },
      createdAtMs: Date.now(),
    };
    seedSessionTaskBoard(sessionFile, switched);

    const ok = commitSameTaskConstraint({
      sessionFile,
      constraintText: "补充：只要国内安卓机型——这是给 A 的",
      expectedTaskId: "task-a",
    });
    expect(ok).toBe(false);
    const board = readSessionTaskBoard(sessionFile);
    expect(board.current?.taskId).toBe("task-b");
    expect(JSON.stringify(board)).not.toContain("只要国内安卓机型");
  });

  it("commitSameTaskConstraint refuses when expectedWriteEpoch is stale", () => {
    const board = readSessionTaskBoard(sessionFile);
    const epoch = board.writeEpoch ?? 0;

    // Simulate concurrent writer bumping epoch after our read.
    const concurrent = {
      ...board,
      writeEpoch: epoch,
      current: {
        ...board.current!,
        stop: { summary: "concurrent stop", workspacePaths: [] },
      },
    };
    // Directly bump epoch as if another writer committed.
    seedSessionTaskBoard(sessionFile, {
      ...concurrent,
      writeEpoch: epoch, // seedSessionTaskBoard itself bumps; capture after
    });
    const afterConcurrent = readSessionTaskBoard(sessionFile);
    expect(afterConcurrent.writeEpoch ?? 0).toBeGreaterThan(epoch);

    // Now a stale commit with expectedTaskId still A but stale epoch path:
    // commit reads fresh board (task still A) — CAS is internal.
    // Force race by monkeypatching: read once, external write, then commit's mutate.
    // Practical proof: two sequential commits with intervening writeEpoch bump inside commit.
    const ok1 = commitSameTaskConstraint({
      sessionFile,
      constraintText: "补充：第一条约束",
      expectedTaskId: "task-a",
    });
    expect(ok1).toBe(true);

    // Intercept: after commitSameTaskConstraint starts it re-checks epoch.
    // Use the exported compare helper path — second writer with stale expectedWriteEpoch fails.
    const stale = commitSameTaskConstraint({
      sessionFile,
      constraintText: "补充：陈旧写入",
      expectedTaskId: "task-a",
      expectedWriteEpoch: 1, // deliberately stale
    });
    expect(stale).toBe(false);
    expect(
      activeConstraintTexts(readSessionTaskBoard(sessionFile).current).join("\n"),
    ).not.toContain("陈旧写入");
  });
});
