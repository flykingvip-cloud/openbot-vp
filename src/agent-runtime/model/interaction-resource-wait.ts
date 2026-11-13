/**
 * Explicit interaction resource budget. Reuses the existing commercial-queue
 * bound and never grants extra concurrency or skips authorization.
 */
import { resolveCommercialRunQueueMaxWaitMs } from "../../gateway/billing/agent-run-queue.js";

export const INTERACTION_RESOURCE_WAIT_ENV = "OPENBOT_INTERACTION_RESOURCE_WAIT_MS";

export function resolveInteractionResourceWaitMs(opts?: {
  overrideMs?: number;
  /** Do not exceed this ceiling (typically the host agent timeout). */
  capMs?: number;
  nowMs?: number;
}): number {
  const override = finitePositive(opts?.overrideMs);
  const fromEnv = finitePositive(Number.parseInt(process.env[INTERACTION_RESOURCE_WAIT_ENV] ?? "", 10));
  const resolved = override ?? fromEnv ?? resolveCommercialRunQueueMaxWaitMs();
  const cap = finitePositive(opts?.capMs);
  return Math.max(1, cap === undefined ? resolved : Math.min(resolved, cap));
}

export function createInteractionResourceBudget(opts?: {
  overrideMs?: number;
  capMs?: number;
  nowMs?: number;
}) {
  const budgetMs = resolveInteractionResourceWaitMs(opts);
  const startedMs = opts?.nowMs ?? Date.now();
  return {
    budgetMs,
    remainingMs(nowMs = Date.now()): number {
      return Math.max(1, budgetMs - Math.max(0, nowMs - startedMs));
    },
  };
}

export const INTERACTION_TIMEOUT_TEXT =
  "本轮交互在时限内没有得到有效输出，没有启动或修改任务。本轮请求已结束，不会自动补做。";
export const INTERACTION_MODEL_FAILURE_TEXT =
  "本轮交互未能完成（模型或服务失败），没有启动或修改任务。本轮请求已结束，不会自动补做。";
export const INTERACTION_QUEUE_TIMEOUT_TEXT =
  "交互资源等待已达上限，本轮没有启动或修改任务。请稍后重试。";
export const INTERACTION_RECORD_UNAVAILABLE_TEXT =
  "记录暂不可用，不能视为已耐久保存；恢复后将按原请求身份对账。";
export const CHAT_TURN_ERROR_UNCONFIRMED_TEXT =
  "本轮出现错误，是否已发生业务动作需要按原请求身份核对，不能视为已完成。";

export type InteractionFailureKind = "timeout" | "empty" | "model" | "queue_timeout" | "other";

export function isInteractionUserAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String(error.name) : "";
  const message = error instanceof Error ? error.message : "";
  return (
    name === "AbortError" &&
    !/timeout/i.test(message) &&
    !("interactionPhase" in error && (error as { interactionPhase?: string }).interactionPhase)
  );
}

export function classifyInteractionFailure(error: unknown): InteractionFailureKind {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const reason =
    error && typeof error === "object" && "reason" in error
      ? String((error as { reason?: unknown }).reason ?? "")
      : "";
  if (
    reason === "CONCURRENCY_QUEUE_TIMEOUT" ||
    message.includes("并发排队超时") ||
    message.includes("交互资源等待已达上限")
  ) {
    return "queue_timeout";
  }
  if (
    reason === "timeout" ||
    message === "timeout" ||
    /timed? ?out/i.test(message) ||
    message.includes("本轮交互在时限内没有得到有效输出") ||
    message.includes("本轮未取得有效的交互决定")
  ) {
    return message.includes("本轮未取得有效的交互决定") ? "empty" : "timeout";
  }
  if (
    /^(?:Invalid interaction|Interaction did not return a final decision|Interaction requires finite|Interaction target is not bound)/.test(
      message,
    )
  ) {
    return "other";
  }
  return "model";
}

export function formatInteractionFailureReply(error: unknown): string {
  const kind = classifyInteractionFailure(error);
  if (kind === "queue_timeout") {
    const message = error instanceof Error ? error.message.trim() : "";
    return message || INTERACTION_QUEUE_TIMEOUT_TEXT;
  }
  if (kind === "timeout" || kind === "empty") {
    return INTERACTION_TIMEOUT_TEXT;
  }
  return INTERACTION_MODEL_FAILURE_TEXT;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}
