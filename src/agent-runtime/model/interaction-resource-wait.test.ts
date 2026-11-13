import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_INTERACTION_RESOURCE_WAIT_MS,
  INTERACTION_BLOCKED_RECEIPT_MS,
  INTERACTION_MODEL_FAILURE_TEXT,
  INTERACTION_QUEUE_TIMEOUT_TEXT,
  INTERACTION_RESOURCE_WAIT_ENV,
  INTERACTION_TIMEOUT_TEXT,
  classifyInteractionFailure,
  createInteractionResourceBudget,
  formatInteractionFailureReply,
  isInteractionUserAbort,
  resolveInteractionResourceWaitMs,
} from "./interaction-resource-wait.js";

afterEach(() => {
  vi.useRealTimers();
  delete process.env[INTERACTION_RESOURCE_WAIT_ENV];
});

it("defaults the interaction wait to 15 seconds, not the commercial-queue 120s bound, and never exceeds the host cap", () => {
  expect(DEFAULT_INTERACTION_RESOURCE_WAIT_MS).toBe(15_000);
  expect(resolveInteractionResourceWaitMs()).toBe(15_000);
  expect(resolveInteractionResourceWaitMs()).not.toBe(120_000);
  expect(resolveInteractionResourceWaitMs({ capMs: 600_000 })).toBe(15_000);
  expect(resolveInteractionResourceWaitMs({ capMs: 5_000 })).toBe(5_000);
  process.env[INTERACTION_RESOURCE_WAIT_ENV] = "2500";
  expect(resolveInteractionResourceWaitMs()).toBe(2_500);
  expect(resolveInteractionResourceWaitMs({ overrideMs: 80, capMs: 1_000 })).toBe(80);
});

it("defines remaining budget against a test clock and returns zero when exhausted", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-13T01:00:00.000Z"));
  const budget = createInteractionResourceBudget({ overrideMs: 1_000, nowMs: Date.now() });
  expect(budget.budgetMs).toBe(1_000);
  expect(budget.remainingMs(Date.now())).toBe(1_000);
  expect(budget.isExhausted()).toBe(false);
  vi.advanceTimersByTime(400);
  expect(budget.remainingMs(Date.now())).toBe(600);
  vi.advanceTimersByTime(599);
  expect(budget.remainingMs(Date.now())).toBe(1);
  expect(budget.isExhausted()).toBe(false);
  vi.advanceTimersByTime(1);
  expect(budget.remainingMs(Date.now())).toBe(0);
  expect(budget.isExhausted()).toBe(true);
  vi.advanceTimersByTime(50);
  expect(budget.remainingMs(Date.now())).toBe(0);
  expect(budget.remainingQueueWaitMs()).toBe(0);
});

it("caps slot wait at the blocked-receipt window without resetting the total deadline", () => {
  const budget = createInteractionResourceBudget({ overrideMs: 15_000, nowMs: 0 });
  expect(INTERACTION_BLOCKED_RECEIPT_MS).toBe(2_000);
  expect(budget.remainingQueueWaitMs(0)).toBe(2_000);
  expect(budget.remainingMs(0)).toBe(15_000);
  expect(budget.remainingQueueWaitMs(14_500)).toBe(500);
  expect(budget.remainingQueueWaitMs(15_000)).toBe(0);
});

it("classifies empty, timeout, queue, and model failures into visible replies", () => {
  expect(
    classifyInteractionFailure(
      Object.assign(new Error("timeout"), { interactionPhase: "interpretation", reason: "timeout" }),
    ),
  ).toBe("timeout");
  expect(
    classifyInteractionFailure(
      Object.assign(new Error("本轮未取得有效的交互决定，没有启动或修改任务。"), {
        interactionPhase: "interpretation",
        reason: "empty",
      }),
    ),
  ).toBe("empty");
  expect(
    classifyInteractionFailure(
      Object.assign(new Error("并发排队超时（已等待 1 秒）。请稍后重试或升级套餐并发。"), {
        reason: "CONCURRENCY_QUEUE_TIMEOUT",
      }),
    ),
  ).toBe("queue_timeout");
  expect(classifyInteractionFailure(new Error("provider 502"))).toBe("model");
  expect(formatInteractionFailureReply(new Error("timeout"))).toBe(INTERACTION_TIMEOUT_TEXT);
  expect(formatInteractionFailureReply(new Error("provider 502"))).toBe(INTERACTION_MODEL_FAILURE_TEXT);
  expect(formatInteractionFailureReply(new Error(INTERACTION_QUEUE_TIMEOUT_TEXT))).toBe(
    INTERACTION_QUEUE_TIMEOUT_TEXT,
  );
});

it("does not treat a timeout abort as a user cancel", () => {
  expect(
    classifyInteractionFailure(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
  ).toBe("timeout");
  expect(
    isInteractionUserAbort(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
  ).toBe(false);
  expect(isInteractionUserAbort(new DOMException("The operation was aborted.", "AbortError"))).toBe(
    true,
  );
  expect(
    isInteractionUserAbort(
      Object.assign(new DOMException("The operation was aborted due to timeout", "AbortError"), {
        interactionPhase: "interpretation",
        reason: "timeout",
      }),
    ),
  ).toBe(false);
  expect(isInteractionUserAbort(new Error("timeout"))).toBe(false);
});
