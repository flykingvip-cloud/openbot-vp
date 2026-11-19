import { afterEach, expect, it, vi } from "vitest";
import {
  DEFAULT_INTERACTION_RESOURCE_WAIT_MS,
  INTERACTION_BLOCKED_RECEIPT_MS,
  INTERACTION_BLOCKED_RECEIPT_MARGIN_MS,
  INTERACTION_MODEL_FAILURE_TEXT,
  INTERACTION_QUEUE_TIMEOUT_TEXT,
  INTERACTION_RESOURCE_WAIT_ENV,
  INTERACTION_TIMEOUT_TEXT,
  classifyInteractionFailure,
  createInteractionResourceBudget,
  formatInteractionFailureReply,
  isInteractionUserAbort,
  resolveInteractionResourceWaitMs,
} from "./index.js";

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
  expect(budget.remainingQueueWaitMs(0)).toBe(
    INTERACTION_BLOCKED_RECEIPT_MS - INTERACTION_BLOCKED_RECEIPT_MARGIN_MS,
  );
  expect(budget.remainingMs(0)).toBe(15_000);
  expect(budget.remainingQueueWaitMs(14_500)).toBe(500);
  expect(budget.remainingQueueWaitMs(15_000)).toBe(0);
});

it("classifies empty, timeout, queue, and model failures into visible replies", () => {
  expect(
    classifyInteractionFailure(
      Object.assign(new Error("timeout"), {
        interactionPhase: "interpretation",
        reason: "timeout",
      }),
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
  expect(formatInteractionFailureReply(new Error("provider 502"))).toBe(
    INTERACTION_MODEL_FAILURE_TEXT,
  );
  expect(formatInteractionFailureReply(new Error(INTERACTION_QUEUE_TIMEOUT_TEXT))).toBe(
    INTERACTION_QUEUE_TIMEOUT_TEXT,
  );
});

it("does not treat a timeout abort as a user cancel", () => {
  expect(
    classifyInteractionFailure(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    ),
  ).toBe("timeout");
  expect(
    isInteractionUserAbort(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    ),
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

it("releases deadline timers and abort listeners after successful output", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const { raceVisibleInteraction } = await import("./interaction-resource-wait.js");
  await expect(
    raceVisibleInteraction(Promise.resolve("answer"), {
      signal: controller.signal,
      remainingMs: 15_000,
    }),
  ).resolves.toBe("answer");
  expect(vi.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

it("does not describe empty model output as a timeout", () => {
  expect(
    formatInteractionFailureReply(new Error("本轮未取得有效的交互决定，没有启动或修改任务。")),
  ).toContain("模型未返回有效的交互决定");
});

it("releases deadline timers and abort listeners after model failure", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const { raceVisibleInteraction } = await import("./interaction-resource-wait.js");
  await expect(
    raceVisibleInteraction(Promise.reject(new Error("provider failed")), {
      signal: controller.signal,
      remainingMs: 15_000,
    }),
  ).rejects.toThrow("provider failed");
  expect(vi.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

it("removes the pending deadline after an explicit user cancellation", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const { raceVisibleInteraction } = await import("./interaction-resource-wait.js");
  const pending = raceVisibleInteraction(new Promise<never>(() => {}), {
    signal: controller.signal,
    remainingMs: 15_000,
  });
  const rejected = expect(pending).rejects.toThrow("cancelled");
  controller.abort(new DOMException("cancelled", "AbortError"));
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
