/**
 * 进程内域事件分发器（持久 + 至少一次投递）。
 *
 * 可靠性模型（见 design.md）：
 * - `publish` 先把事件 append 到持久事件日志（落盘），再尝试投递；
 * - consumer 抛错 → 事件标记 failed 留在日志，不丢；
 * - `replayPending` 重放 pending/failed 事件（消费须幂等）。
 *
 * fire-and-forget 仅作通知加速层；真相与可恢复性由事件日志保证。
 */

import { enterBillingReplay, leaveBillingReplay } from "./billing-replay-coalesce.js";
import {
  appendEventLog,
  commitEventStatuses,
  listEvents,
  markEventStatus,
  type EventStatusUpdate,
} from "./event-log-store.js";
import type { BillingDomainEvent, DurableEvent, DurableEventStatus } from "./types.js";

export type BillingEventHandler = (event: DurableEvent) => void | Promise<void>;

export type ReplayPendingOptions = {
  /** Only replay this tenant. Dashboard must set this so one overview does not drain every tenant. */
  enterpriseId?: string;
  /** Stop before delivering another event once this many have been delivered. */
  maxEvents?: number;
  /** Stop before starting another event once this many milliseconds have elapsed. */
  deadlineMs?: number;
  /** Give up on a single delivery that has not settled. The in-flight delivery is left running. */
  perEventMs?: number;
};

export type ReplayPendingResult = {
  replayed: number;
  truncated: boolean;
  timedOutEvents: number;
};

function deliverWithin(delivery: Promise<void>, ms: number): Promise<"ok" | "timeout"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    delivery.then(
      () => {
        clearTimeout(timer);
        resolve("ok");
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class BillingEventBus {
  private handlers = new Set<BillingEventHandler>();

  /** 订阅消费者，返回取消订阅函数。 */
  on(handler: BillingEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** 发布事件：先持久化（落盘）再投递（at-least-once）。 */
  async publish(event: BillingDomainEvent, storePath?: string): Promise<DurableEvent> {
    const durable = await appendEventLog(event, storePath);
    // 已成功投递的幂等命中：崩溃重试不得再次执行消费者
    if (durable.status === "done") {
      return durable;
    }
    await this.deliver(durable, storePath);
    return durable;
  }

  /** 投递单条事件给所有消费者；任一消费者抛错则标记 failed（留待重放）。 */
  private async deliver(durable: DurableEvent, storePath?: string): Promise<void> {
    if (durable.status === "done") {
      return;
    }
    const status = await this.runHandlers(durable);
    await markEventStatus(durable.seq, status, storePath);
  }

  /** Run consumers without loading or rewriting the durable log. */
  private async runHandlers(durable: DurableEvent): Promise<DurableEventStatus> {
    if (durable.status === "done") {
      return "done";
    }
    let ok = true;
    for (const handler of this.handlers) {
      try {
        await handler(durable);
      } catch {
        ok = false;
      }
    }
    return ok ? "done" : "failed";
  }

  /**
   * 重放 pending/failed 事件（幂等消费）。
   * settle 可全量重放。dashboard 读路径必须传 deadlineMs / maxEvents，
   * 否则失败事件积压会让请求一直不返回。
   */
  async replayPending(
    storePath?: string,
    opts?: ReplayPendingOptions,
  ): Promise<ReplayPendingResult> {
    const fetchLimit = opts?.maxEvents != null ? opts.maxEvents + 1 : undefined;
    const fetched = await listEvents(
      {
        status: ["pending", "failed"],
        ...(opts?.enterpriseId ? { enterpriseId: opts.enterpriseId } : {}),
        ...(fetchLimit != null ? { limit: fetchLimit } : {}),
      },
      storePath,
    );
    const pending = opts?.maxEvents != null ? fetched.slice(0, opts.maxEvents) : fetched;
    const started = Date.now();
    let replayed = 0;
    let timedOutEvents = 0;
    let truncated = opts?.maxEvents != null && fetched.length > opts.maxEvents;
    const updates: EventStatusUpdate[] = [];
    // One snapshot recompute per enterprise for this replay, and one log write
    // at the end. Per-event reload of the full events array is what filled the heap.
    enterBillingReplay();
    try {
      for (const durable of pending) {
        const elapsed = Date.now() - started;
        if (opts?.deadlineMs != null && elapsed >= opts.deadlineMs) {
          truncated = true;
          break;
        }
        const remaining =
          opts?.deadlineMs != null ? opts.deadlineMs - elapsed : Number.POSITIVE_INFINITY;
        const perEvent =
          opts?.perEventMs != null ? Math.min(opts.perEventMs, remaining) : remaining;
        if (Number.isFinite(perEvent)) {
          const pendingStatus = this.runHandlers(durable);
          const outcome = await deliverWithin(
            pendingStatus.then(() => undefined),
            perEvent,
          );
          if (outcome === "timeout") {
            timedOutEvents += 1;
            truncated = true;
            // Delivery is still running; persist that one outcome when it settles.
            void pendingStatus.then((status) => markEventStatus(durable.seq, status, storePath));
            break;
          }
          updates.push({ seq: durable.seq, status: await pendingStatus });
        } else {
          const status = await this.runHandlers(durable);
          updates.push({ seq: durable.seq, status });
        }
        replayed += 1;
      }
    } finally {
      try {
        await commitEventStatuses(updates, storePath);
      } finally {
        leaveBillingReplay();
      }
    }
    return { replayed, truncated, timedOutEvents };
  }

  /** 测试辅助：清空消费者。 */
  __clearHandlersForTest(): void {
    this.handlers.clear();
  }
}

/** 进程内单例。 */
export const billingEventBus = new BillingEventBus();
