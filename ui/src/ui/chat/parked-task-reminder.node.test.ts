// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  clearParkedReminderDismissState,
  dismissParkedReminder,
  isParkedReminderDismissed,
  parseParkedTaskReminder,
  parseParkedWakeTaskId,
} from "./parked-task-reminder.ts";

describe("parked-task-reminder", () => {
  it("parses the post-completion reminder task id and title", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: [
            "[PARKED_TASK_REMINDER]",
            "前任务：「调研」",
            "任务 ID：`task-1`",
            "停在：未完成：调研",
          ].join("\n"),
        },
      ],
    };
    expect(parseParkedTaskReminder(message)).toEqual({
      taskId: "task-1",
      title: "调研",
      stopSummary: "未完成：调研",
    });
  });

  it("parses the heartbeat wake key as a park task id", () => {
    const message = {
      role: "assistant",
      content: [{ type: "text", text: "唤醒：`exec-event`" }],
    };
    expect(parseParkedWakeTaskId(message)).toBe("exec-event");
  });

  it("tracks local dismiss so pause can hide the card", () => {
    clearParkedReminderDismissState();
    expect(isParkedReminderDismissed("k1")).toBe(false);
    dismissParkedReminder("k1");
    expect(isParkedReminderDismissed("k1")).toBe(true);
    clearParkedReminderDismissState();
  });
});
