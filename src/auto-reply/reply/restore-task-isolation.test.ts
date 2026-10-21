import { describe, expect, it } from "vitest";
import {
  RESTORE_OPEN_TASKS_FENCE_END,
  RESTORE_OPEN_TASKS_FENCE_START,
  isolateLegacyRestoreTranscriptText,
  isRestoreTaskIsolationMessage,
  reconcileRestoreTaskPointersReadOnly,
  restoreTaskIsolationStamp,
  stripRestorePendingReviewFences,
  toRestoreTaskIsolationPayload,
} from "./restore-task-isolation.js";

describe("restore task pointer reconciliation", () => {
  it("does not close an active row when the artifact file exists", () => {
    const result = reconcileRestoreTaskPointersReadOnly({
      taskContextId: "task_live",
      taskLedger: [
        { id: "task_live", status: "active", title: "当前主线", artifacts: ["art_live"] },
        { id: "task_old", status: "active", title: "缺关系旧任务", artifacts: ["art_old"] },
        { id: "task_done", status: "done", title: "已完成", artifacts: [] },
      ],
      artifactLedger: [
        { id: "art_live", title: "current.md", task_id: "task_live", state: "active" },
        { id: "art_old", title: "old-deliverable.md", task_id: "task_old", state: "active" },
        { id: "art_orphan", title: "orphan.md", state: "active" },
      ],
      checkpointOpenTasks: ["缺关系旧任务", "请生成 ghost-bleed.md"],
      fileExistsByArtifactKey: {
        "old-deliverable.md": true,
        art_old: true,
        "orphan.md": true,
        "current.md": true,
      },
    });

    expect(result.currentTaskId).toBe("task_live");
    expect(result.autoClosedTaskIds).toEqual([]);
    expect(result.preservedActiveTaskIds).toEqual(["task_live", "task_old"]);
    expect(result.pendingReview).toEqual(
      expect.arrayContaining([
        { kind: "checkpoint_open_task", label: "缺关系旧任务" },
        { kind: "checkpoint_open_task", label: "请生成 ghost-bleed.md" },
        { kind: "unbound_ledger", label: "缺关系旧任务", taskId: "task_old" },
        {
          kind: "missing_relationship",
          label: "old-deliverable.md",
          taskId: "task_old",
          filePresent: true,
        },
        { kind: "missing_relationship", label: "orphan.md", filePresent: true },
      ]),
    );
    expect(result.pendingReview.some((item) => item.taskId === "task_live")).toBe(false);
    expect(toRestoreTaskIsolationPayload(result)).toEqual({
      currentTaskId: "task_live",
      pendingReviewCount: result.pendingReview.length,
      autoClosedTaskIds: [],
    });
  });

  it("leaves an unbound session without adopting checkpoint open tasks", () => {
    const result = reconcileRestoreTaskPointersReadOnly({
      taskContextId: "task_missing",
      taskLedger: [{ id: "task_old", status: "active", title: "旧任务", artifacts: [] }],
      artifactLedger: [],
      checkpointOpenTasks: ["旧任务"],
    });
    expect(result.currentTaskId).toBeUndefined();
    expect(result.autoClosedTaskIds).toEqual([]);
    expect(result.preservedActiveTaskIds).toEqual(["task_old"]);
    expect(result.pendingReview.map((item) => item.kind)).toEqual([
      "checkpoint_open_task",
      "unbound_ledger",
    ]);
  });
});

describe("legacy restore text isolation", () => {
  it("fences open tasks without removing them from the compatibility text", () => {
    const fenced = isolateLegacyRestoreTranscriptText(
      [
        "Checkpoint restored.",
        "Summary: 当前摘要",
        "Open tasks: 缺关系旧任务, 请生成 ghost-bleed.md",
      ].join("\n"),
    );
    expect(fenced).toContain("Open tasks: 缺关系旧任务, 请生成 ghost-bleed.md");
    expect(fenced).toContain(RESTORE_OPEN_TASKS_FENCE_START);
    expect(fenced).toContain(RESTORE_OPEN_TASKS_FENCE_END);
    expect(stripRestorePendingReviewFences(fenced)).not.toContain("ghost-bleed.md");
    expect(stripRestorePendingReviewFences(fenced)).toContain("当前摘要");
  });

  it("treats a stamped or fenced receipt as off the task main line", () => {
    const stamp = restoreTaskIsolationStamp(["请生成 ghost-bleed.md"]);
    expect(stamp.mainline).toBe(false);
    const stamped = {
      role: "assistant",
      content: [{ type: "text", text: "Checkpoint restored.\nOpen tasks: 请生成 ghost-bleed.md" }],
      openclawRestoreTaskIsolation: stamp,
    };
    expect(isRestoreTaskIsolationMessage(stamped)).toBe(true);
    expect(isRestoreTaskIsolationMessage({ message: stamped })).toBe(true);
    expect(
      isRestoreTaskIsolationMessage({
        role: "assistant",
        content: [
          {
            type: "text",
            text: `${RESTORE_OPEN_TASKS_FENCE_START}\nOpen tasks: ghost\n${RESTORE_OPEN_TASKS_FENCE_END}`,
          },
        ],
      }),
    ).toBe(true);
    expect(
      isRestoreTaskIsolationMessage({
        role: "assistant",
        content: [{ type: "text", text: "当前主线还在继续。" }],
      }),
    ).toBe(false);
  });
});
