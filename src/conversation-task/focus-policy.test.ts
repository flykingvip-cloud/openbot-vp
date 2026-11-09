import { describe, expect, it } from "vitest";
import * as policy from "../agent-runtime/policy/index.js";
import {
  HEARTBEAT_FORBIDDEN_ACTIONS,
  MAX_FOCUS_SLOTS,
  MAX_PARKED_SLOTS,
  decideWake,
  evaluateWakeEligibility,
  isHeartbeatActionAllowed,
} from "./focus-policy.js";

describe("EA focus policy (P0 acceptance)", () => {
  it("EA-I4 / EA-B2: slots are 1 focus + 3 parked, not a task cardinality cap", () => {
    expect(MAX_FOCUS_SLOTS).toBe(1);
    expect(MAX_PARKED_SLOTS).toBe(3);
    expect(policy.MAX_PARKED_TASKS).toBe(3);
    expect(policy).not.toHaveProperty("MAX_PARKED_SLOTS");
  });

  it("separates heartbeat eligibility from task creation and replanning", () => {
    expect(
      evaluateWakeEligibility({
        trigger: "heartbeat",
        incomingCreatesIdentity: true,
        incomingTaskId: "task-new",
      }),
    ).toEqual({
      eligible: false,
      decision: { action: "reject_identity_create", trigger: "heartbeat" },
    });
    expect(evaluateWakeEligibility({ trigger: "heartbeat" })).toEqual({
      eligible: false,
      decision: { action: "ignore_heartbeat" },
    });
    expect(evaluateWakeEligibility({ trigger: "heartbeat", incomingTaskId: "cron:job" })).toEqual({
      eligible: true,
      incomingTaskId: "cron:job",
    });
    expect(isHeartbeatActionAllowed("create_identity")).toBe(false);
    expect(isHeartbeatActionAllowed("replan")).toBe(false);
    expect(isHeartbeatActionAllowed("write_completion")).toBe(false);
    expect(HEARTBEAT_FORBIDDEN_ACTIONS).toEqual(["create_identity", "write_completion", "replan"]);
  });

  it("EA-I1 / EA-B4: cron and heartbeat cannot mint a ConversationTask identity", () => {
    expect(
      decideWake({
        trigger: "cron",
        snapshot: { parkedTaskIds: [] },
        incomingCreatesIdentity: true,
        incomingTaskId: "task-new",
      }),
    ).toEqual({ action: "reject_identity_create", trigger: "cron" });
    expect(
      decideWake({
        trigger: "heartbeat",
        snapshot: { parkedTaskIds: [] },
        incomingCreatesIdentity: true,
        incomingTaskId: "task-new",
      }),
    ).toEqual({ action: "reject_identity_create", trigger: "heartbeat" });
  });

  it("EA-B5: heartbeat without a task is patrol-only", () => {
    expect(
      decideWake({
        trigger: "heartbeat",
        snapshot: { parkedTaskIds: [] },
      }),
    ).toEqual({ action: "ignore_heartbeat" });
    expect(isHeartbeatActionAllowed("create_identity")).toBe(false);
    expect(isHeartbeatActionAllowed("write_completion")).toBe(false);
    expect(isHeartbeatActionAllowed("replan")).toBe(false);
    expect(HEARTBEAT_FORBIDDEN_ACTIONS).toHaveLength(3);
    expect(isHeartbeatActionAllowed("patrol")).toBe(true);
  });

  it("acquires focus when the slot is empty", () => {
    expect(
      decideWake({
        trigger: "cron",
        snapshot: { parkedTaskIds: [] },
        incomingTaskId: "task-123",
      }),
    ).toEqual({ action: "acquire_focus", taskId: "task-123" });
  });

  it("continues the same focused task without asking", () => {
    expect(
      decideWake({
        trigger: "user_message",
        snapshot: { focusTaskId: "task-123", parkedTaskIds: [] },
        incomingTaskId: "task-123",
      }),
    ).toEqual({ action: "acquire_focus", taskId: "task-123" });
  });

  it("EA-B1: a new user goal while FOCUS is occupied parks the current task without asking", () => {
    expect(
      decideWake({
        trigger: "user_message",
        snapshot: { focusTaskId: "task-price", parkedTaskIds: [] },
        incomingTaskId: "task-research",
      }),
    ).toEqual({
      action: "park_current_and_switch",
      currentFocusId: "task-price",
      incomingTaskId: "task-research",
      parkedCount: 1,
    });
  });

  it("a fourth user switch drops the oldest parked id", () => {
    expect(
      decideWake({
        trigger: "user_message",
        snapshot: { focusTaskId: "task-focus", parkedTaskIds: ["p1", "p2", "p3"] },
        incomingTaskId: "task-new",
      }),
    ).toEqual({
      action: "park_current_and_switch",
      currentFocusId: "task-focus",
      incomingTaskId: "task-new",
      parkedCount: 3,
      droppedTaskId: "p1",
    });
  });

  it("EA-B4: cron wake parks when FOCUS is occupied and a slot remains", () => {
    expect(
      decideWake({
        trigger: "cron",
        snapshot: { focusTaskId: "task-research", parkedTaskIds: ["task-a"] },
        incomingTaskId: "task-price",
      }),
    ).toEqual({ action: "park", taskId: "task-price", parkedCount: 2 });
  });

  it("EA-B2: a fourth automatic park drops the oldest and keeps three", () => {
    for (const trigger of [
      "cron",
      "heartbeat",
      "retry",
      "external_event",
      "approval_resolved",
    ] as const) {
      expect(
        decideWake({
          trigger,
          snapshot: {
            focusTaskId: "task-focus",
            parkedTaskIds: ["p1", "p2", "p3"],
            parkedTitles: ["最早的报告", "中", "新"],
            parkedWorkspacePaths: [["/tmp/oldest.md"], [], ["/tmp/new.md"]],
          },
          incomingTaskId: "task-price",
        }),
      ).toEqual({
        action: "park",
        taskId: "task-price",
        parkedCount: 3,
        droppedTaskId: "p1",
        droppedTitle: "最早的报告",
        droppedPaths: ["/tmp/oldest.md"],
      });
    }
  });

  it("resume of a parked task parks the unfinished current task instead of asking", () => {
    expect(
      decideWake({
        trigger: "resume",
        snapshot: {
          focusTaskId: "focus-skill-list",
          parkedTaskIds: ["parked-article"],
        },
        incomingTaskId: "parked-article",
      }),
    ).toEqual({
      action: "park_current_and_switch",
      currentFocusId: "focus-skill-list",
      incomingTaskId: "parked-article",
      parkedCount: 2,
    });
  });

  it("does not treat an already-parked cron wake as a fourth slot", () => {
    expect(
      decideWake({
        trigger: "cron",
        snapshot: {
          focusTaskId: "task-focus",
          parkedTaskIds: ["p1", "p2", "task-price"],
        },
        incomingTaskId: "task-price",
      }),
    ).toEqual({ action: "park", taskId: "task-price", parkedCount: 3 });
  });
});
