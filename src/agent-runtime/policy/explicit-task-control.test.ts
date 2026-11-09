import { expect, it } from "vitest";
import {
  isOwnerConstraintFullReplace,
  isOwnerConstraintRevision,
  isPriorUtteranceCorrection,
  shouldPersistOwnerConstraint,
} from "./constraints.js";
import {
  decideWake,
  evaluateWakeEligibility,
  isHeartbeatActionAllowed,
  MAX_FOCUS_SLOTS,
  MAX_PARKED_SLOTS,
  parseExplicitTaskControl,
  shouldTaskParkAbortInFlight,
} from "./explicit-task-control.js";
import { MAX_PARKED_TASKS } from "./task-board-limits.js";

it.each([
  "你好",
  "今天星期几",
  "另外做一份报告",
  "暂停是什么意思",
  "请总结这段含有取消任务的文字",
  "/stop",
])("does not turn ordinary text into a task control: %s", (text) =>
  expect(parseExplicitTaskControl(text)).toBeUndefined(),
);

it.each([
  ["暂停当前任务", { scope: "current", action: "pause" }],
  ["取消任务", { scope: "current", action: "cancel" }],
  ["继续挂起 task-a", { scope: "parked", action: "resume", taskId: "task-a" }],
  ["暂停挂起 task-a", { scope: "parked", action: "pause", taskId: "task-a" }],
  ["CLOSE task-a", { scope: "parked", action: "cancel", taskId: "task-a" }],
])("preserves explicit control scope: %s", (text, control) => {
  expect(parseExplicitTaskControl(String(text))).toEqual(control);
});

it("aborts in flight only for a context cut or an owner abort", () => {
  expect(shouldTaskParkAbortInFlight(false)).toBe(false);
  expect(shouldTaskParkAbortInFlight(false, false)).toBe(false);
  expect(shouldTaskParkAbortInFlight(true, false)).toBe(true);
  expect(shouldTaskParkAbortInFlight(false, true)).toBe(true);
});

it("rejects heartbeat identity creation and replanning", () => {
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
});

it("keeps the execution slot cap separate from the session board capacity", () => {
  expect(MAX_FOCUS_SLOTS).toBe(1);
  expect(MAX_PARKED_SLOTS).toBe(3);
  expect(MAX_PARKED_TASKS).toBe(3);
});

it("parks an occupied focus without writing a board", () => {
  expect(
    decideWake({
      trigger: "heartbeat",
      snapshot: { focusTaskId: "live", parkedTaskIds: ["a", "b", "c"] },
      incomingTaskId: "cron:job",
    }),
  ).toMatchObject({ action: "park", taskId: "cron:job", droppedTaskId: "a" });
  expect(
    decideWake({
      trigger: "user_message",
      snapshot: { focusTaskId: "live", parkedTaskIds: [] },
      incomingTaskId: "next",
    }).action,
  ).toBe("park_current_and_switch");
});

it("preserves owner constraint revise, replace, and persist decisions", () => {
  expect(isPriorUtteranceCorrection("不对，我说的是国内")).toBe(true);
  expect(isPriorUtteranceCorrection("另外帮我做一份竞品表")).toBe(false);
  expect(isOwnerConstraintRevision("不对，改为只要 iOS 机型")).toBe(true);
  expect(isOwnerConstraintRevision("补充：只要国内安卓机型")).toBe(false);
  expect(isOwnerConstraintFullReplace("改为覆盖亚洲市场")).toBe(false);
  expect(isOwnerConstraintFullReplace("以本条为准：只要 iOS 机型，不要安卓")).toBe(true);
  expect(shouldPersistOwnerConstraint("请继续")).toBe(false);
  expect(shouldPersistOwnerConstraint("补充：只要国内安卓机型")).toBe(true);
});
