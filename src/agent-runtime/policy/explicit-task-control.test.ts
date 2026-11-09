import { expect, it } from "vitest";
import {
  evaluateWakeEligibility,
  isHeartbeatActionAllowed,
  parseExplicitTaskControl,
  shouldTaskParkAbortInFlight,
} from "./explicit-task-control.js";

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
