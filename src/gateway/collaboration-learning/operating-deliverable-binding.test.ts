import type { Deliverable, Task } from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import {
  CURRENT_TASK_NO_FORMAL_DELIVERABLE,
  projectOperatingDeliverableBinding,
  selectActiveDeliverable,
  selectDeliverableForCurrentTask,
  summarizeActiveContext,
} from "./shared.js";

function task(patch: Partial<Task> & Pick<Task, "taskId" | "status">): Task {
  return {
    groupId: "g1",
    title: patch.taskId,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...patch,
  };
}

function deliverable(
  patch: Partial<Deliverable> & Pick<Deliverable, "deliverableId" | "status">,
): Deliverable {
  return {
    groupId: "g1",
    title: patch.deliverableId,
    version: 1,
    createdAtMs: 1,
    updatedAtMs: 1,
    ...patch,
  };
}

describe("operating deliverable binding", () => {
  it("does not reuse a newer historical deliverable for the current task", () => {
    const historical = deliverable({
      deliverableId: "del-td-8eb334b143d72e41-f41d562f",
      taskId: "F4-20261029-uxp0",
      status: "submitted",
      updatedAtMs: 9_000,
    });
    const currentTaskId = "d2t-1a878cb6fbef8cd92109834f";
    expect(selectActiveDeliverable([historical])?.deliverableId).toBe(historical.deliverableId);
    expect(selectDeliverableForCurrentTask([historical], currentTaskId)).toBeUndefined();

    const binding = projectOperatingDeliverableBinding({
      tasks: [task({ taskId: currentTaskId, status: "ready", updatedAtMs: 10 })],
      deliverables: [historical],
    });
    expect(binding.task?.taskId).toBe(currentTaskId);
    expect(binding.currentDeliverableId).toBeNull();
    expect(binding.noFormalDeliverable).toBe(true);
    expect(binding.phase).toBe("explore");
    const summary = summarizeActiveContext({
      phase: binding.phase,
      taskId: currentTaskId,
      deliverableId: binding.currentDeliverableId,
      noFormalDeliverableForCurrentTask: binding.noFormalDeliverable,
    });
    expect(summary).toContain(CURRENT_TASK_NO_FORMAL_DELIVERABLE);
    expect(summary).not.toContain(historical.deliverableId);
  });

  it("keeps a deliverable only when its taskId is the active task", () => {
    const currentTaskId = "d2t-current";
    const historical = deliverable({
      deliverableId: "del-old",
      taskId: "F4-old",
      status: "approved",
      updatedAtMs: 50,
    });
    const current = deliverable({
      deliverableId: "del-current",
      taskId: currentTaskId,
      status: "draft",
      updatedAtMs: 5,
    });
    const unbound = deliverable({
      deliverableId: "del-unbound",
      status: "submitted",
      updatedAtMs: 80,
    });
    const binding = projectOperatingDeliverableBinding({
      tasks: [task({ taskId: currentTaskId, status: "in_progress", updatedAtMs: 3 })],
      deliverables: [historical, unbound, current],
    });
    expect(binding.currentDeliverableId).toBe("del-current");
    expect(binding.noFormalDeliverable).toBe(false);
    expect(binding.phase).toBe("deliver");
  });

  it("ignores archived rows and a deliverable with a blank taskId", () => {
    const currentTaskId = "d2t-current";
    const binding = projectOperatingDeliverableBinding({
      tasks: [task({ taskId: currentTaskId, status: "ready" })],
      deliverables: [
        deliverable({
          deliverableId: "del-archived",
          taskId: currentTaskId,
          status: "archived",
          updatedAtMs: 20,
        }),
        deliverable({
          deliverableId: "del-blank",
          taskId: "  ",
          status: "submitted",
          updatedAtMs: 30,
        }),
      ],
    });
    expect(binding.currentDeliverableId).toBeNull();
    expect(binding.noFormalDeliverable).toBe(true);
  });

  it("without an active task still uses the unscoped active deliverable", () => {
    const row = deliverable({
      deliverableId: "del-only",
      taskId: "task-done",
      status: "approved",
      updatedAtMs: 4,
    });
    const binding = projectOperatingDeliverableBinding({
      tasks: [task({ taskId: "task-done", status: "completed", updatedAtMs: 4 })],
      deliverables: [row],
    });
    expect(binding.task).toBeUndefined();
    expect(binding.currentDeliverableId).toBe("del-only");
    expect(binding.noFormalDeliverable).toBe(false);
  });
});
