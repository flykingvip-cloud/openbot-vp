import type { Task } from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import { compileEffectiveCollaborationPolicy } from "./policy-compiler.js";
import {
  applyTaskHandoff,
  HandoffContractRequiredError,
  asGovernedTask,
  assertTaskMayComplete,
  InvalidTaskHandoffError,
  MissingTaskDeliverableError,
  normalizeTaskHandoff,
  resolveBlockedAgentIdsFromHandoffs,
  seedTaskResponsibility,
} from "./task-runtime.js";

const discussion = compileEffectiveCollaborationPolicy({
  collaborationMode: "discussion_driven",
});
const taskDriven = compileEffectiveCollaborationPolicy({
  collaborationMode: "task_driven",
  finalDecisionMode: "human_required",
});

function task(overrides?: Partial<Task>): Task {
  return {
    taskId: "task-2",
    groupId: "grp_product",
    title: "Prepare rollout review",
    status: "ready",
    createdAtMs: 12,
    updatedAtMs: 12,
    ...overrides,
  };
}

describe("task responsibility and handoff", () => {
  it("can nominate a task owner without changing the standing coordinator", () => {
    const responsibility = seedTaskResponsibility({
      task: task(),
      effective: discussion,
      nominatedOwnerId: "bot-writer",
      coordinatorBotId: "bot-coord",
    });
    expect(responsibility.owner).toBe("bot-writer");
    expect(responsibility.coordinator).toBe("bot-coord");
  });

  it("lists handoff targets with remaining work as blocked speakers", () => {
    expect(
      resolveBlockedAgentIdsFromHandoffs([
        {
          taskId: "task-2",
          from: "bot-a",
          to: "bot-b",
          reason: "need_specialist",
          completedArtifacts: [],
          remainingWork: "Finish the checklist",
          assumptions: [],
          blockers: [],
          acceptanceCriteria: ["done"],
        },
      ]),
    ).toEqual(["bot-b"]);
  });

  it("does not seed the UI actor as owner when the live task has no graph", () => {
    const responsibility = seedTaskResponsibility({
      task: task(),
      effective: discussion,
      actor: "operator-1",
    });
    expect(responsibility.owner).toBe("group");
    expect(responsibility.executors).toEqual(["operator-1"]);
    expect(responsibility.decisionAuthority).toBe("human");
  });

  it("seeds owner from createdBy instead of the UI actor", () => {
    const responsibility = seedTaskResponsibility({
      task: task({ createdBy: "owner-1" }),
      effective: discussion,
      actor: "operator-1",
    });
    expect(responsibility.owner).toBe("owner-1");
    expect(responsibility.executors).toEqual(["owner-1"]);
  });

  it("refuses applyTaskHandoff shortcut for executor handoff (T09-B1)", () => {
    const current = asGovernedTask(
      task({ ownerMemberId: "owner-1", assignedMemberIds: ["bot-a"] }),
    );
    const responsibility = seedTaskResponsibility({
      task: current,
      effective: taskDriven,
    });
    expect(() =>
      applyTaskHandoff({
        task: current,
        responsibility,
        handoff: normalizeTaskHandoff({
          taskId: current.taskId,
          from: "bot-a",
          to: "bot-b",
          reason: "need_specialist",
          remainingWork: "Finish the checklist",
          acceptanceCriteria: ["checklist reviewed"],
          completedArtifacts: ["draft.md"],
          assumptions: ["scope unchanged"],
          blockers: [],
        }),
      }),
    ).toThrow(HandoffContractRequiredError);
    expect(responsibility.owner).toBe("owner-1");
    expect(responsibility.executors).toEqual(["bot-a"]);
  });

  it("rejects a chat-history-style handoff without acceptance criteria", () => {
    expect(() =>
      normalizeTaskHandoff({
        taskId: "task-2",
        from: "bot-a",
        to: "bot-b",
        reason: "your turn",
        remainingWork: "continue",
        acceptanceCriteria: [],
      }),
    ).toThrow(InvalidTaskHandoffError);
  });

  it("blocks task_driven completion without a submitted deliverable", () => {
    expect(() =>
      assertTaskMayComplete({
        task: asGovernedTask(task({ status: "in_progress" })),
        effective: taskDriven,
        actor: { type: "human", id: "operator-1" },
        deliverables: [{ taskId: "task-2", status: "draft" }],
      }),
    ).toThrow(MissingTaskDeliverableError);
  });

  it("allows discussion completion without a deliverable", () => {
    expect(() =>
      assertTaskMayComplete({
        task: asGovernedTask(task({ status: "in_progress" })),
        effective: discussion,
        actor: { type: "human", id: "operator-1" },
        deliverables: [],
      }),
    ).not.toThrow();
  });

  it("blocks a bot from completing a task_driven item when humans must confirm", () => {
    expect(() =>
      assertTaskMayComplete({
        task: asGovernedTask(task({ status: "in_progress" })),
        effective: taskDriven,
        actor: { type: "bot", id: "bot-a" },
        deliverables: [{ taskId: "task-2", status: "submitted" }],
      }),
    ).toThrow(/human confirmation/);
  });
});
