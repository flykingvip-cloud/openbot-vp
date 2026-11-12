import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hostBoundTaskTarget } from "../../command/host-task-target.js";
import type { SessionTaskBoard, TrackedTask } from "../../contracts/task.js";
import { seedSessionTaskBoard, readSessionTaskBoard } from "../repository/task-board-file.js";
import { commitAdmittedSessionTask } from "./admit-task.js";
import { commitInteractionTaskProposal } from "./interaction-proposal.js";
import {
  SESSION_RESET_PARK_REASON,
  unbindCurrentTaskOnSessionReset,
} from "./session-reset-focus.js";

const dirs: string[] = [];

function tempSessionFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-reset-focus-"));
  dirs.push(dir);
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, "");
  return file;
}

function pack2Task(): TrackedTask {
  return {
    taskId: "task-db-select",
    title: "数据库选型",
    goalText: "为十人内部业务系统做数据库选型，交付 Markdown 报告与比较 CSV",
    unfinished: true,
    createdAtMs: 1,
    admittedGeneration: 0,
    stop: { summary: "未完成：数据库选型", workspacePaths: [] },
  };
}

function boardWith(current: TrackedTask | undefined): SessionTaskBoard {
  return { current, parked: [], focusRevision: 1, writeEpoch: 1, resetGeneration: 0 };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("session reset and goal binding", () => {
  it("parks the old task on /new and does not default it as the next modification target", () => {
    const sessionFile = tempSessionFile();
    seedSessionTaskBoard(sessionFile, boardWith(pack2Task()));
    const before = hostBoundTaskTarget(readSessionTaskBoard(sessionFile));
    expect(before).toEqual({ taskId: "task-db-select", revision: "1" });

    const result = unbindCurrentTaskOnSessionReset(sessionFile, 2);
    expect(result.changed).toBe(true);
    expect(result.parkedTaskId).toBe("task-db-select");
    expect(result.resetGeneration).toBe(1);

    const after = readSessionTaskBoard(sessionFile);
    expect(after.current).toBeUndefined();
    expect(hostBoundTaskTarget(after)).toBeUndefined();
    expect(after.parked[0]?.taskId).toBe("task-db-select");
    expect(after.parked[0]?.unfinished).toBe(true);
    expect(after.parked[0]?.parkReason).toBe(SESSION_RESET_PARK_REASON);
    expect(after.parked[0]?.wakeSuppress).toBe(true);
  });

  it("reproduces Pack2 → /new → Pack3: a mid-task revision does not write the old board", () => {
    const sessionFile = tempSessionFile();
    seedSessionTaskBoard(sessionFile, boardWith(pack2Task()));
    unbindCurrentTaskOnSessionReset(sessionFile, 2);

    const admitted = commitAdmittedSessionTask({
      lifecycle: "long_task",
      sessionFile,
      requestId: "pack3-guide",
      goal: "撰写企业 AI 助手使用指南，普通员工，约 2000 字，交付 MD 与 HTML",
      acceptance: ["交付文件 企业AI助手使用指南.md", "交付文件 企业AI助手使用指南.html"],
      expectedFocusRevision: readSessionTaskBoard(sessionFile).focusRevision,
      expectedWriteEpoch: readSessionTaskBoard(sessionFile).writeEpoch ?? 0,
    });
    expect(admitted.kind).toBe("accepted");
    if (admitted.kind !== "accepted") {
      return;
    }

    const live = readSessionTaskBoard(sessionFile);
    expect(live.current?.goalText).toContain("企业 AI 助手使用指南");
    expect(live.current?.admittedGeneration).toBe(1);
    const target = hostBoundTaskTarget(live);
    expect(target?.taskId).toBe(admitted.binding.taskId);
    expect(target?.taskId).not.toBe("task-db-select");

    const applied = commitInteractionTaskProposal({
      sessionFile,
      expectedFocusRevision: live.focusRevision,
      expectedWriteEpoch: live.writeEpoch ?? 0,
      decision: {
        kind: "task_change",
        target: target!,
        text: "改为部门主管，不超过 1000 字，删除娱乐场景，增加团队权限和成果审核",
        mode: "revise",
      },
    });
    expect(applied.kind).toBe("applied");

    const after = readSessionTaskBoard(sessionFile);
    expect(after.current?.taskId).toBe(admitted.binding.taskId);
    expect(after.current?.goalText).toContain("企业 AI 助手使用指南");
    const constraints = after.current?.effectiveConstraints ?? [];
    const constraintText = JSON.stringify(constraints);
    expect(constraintText).toContain("部门主管");
    expect(after.parked.some((task) => task.taskId === "task-db-select")).toBe(true);
    expect(
      after.parked.find((task) => task.taskId === "task-db-select")?.effectiveConstraints ?? [],
    ).toEqual([]);

    const rejectedOld = commitInteractionTaskProposal({
      sessionFile,
      expectedFocusRevision: after.focusRevision,
      expectedWriteEpoch: after.writeEpoch ?? 0,
      decision: {
        kind: "task_change",
        target: { taskId: "task-db-select", revision: String(after.writeEpoch ?? 0) },
        text: "禁止外部网站",
        mode: "supplement",
      },
    });
    expect(rejectedOld).toEqual({ kind: "rejected", reason: "revision_mismatch" });
  });
});
