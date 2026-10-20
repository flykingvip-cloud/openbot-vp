/**
 * Runtime Projection 事件总线 — 统一的跨层事件传播机制。
 *
 * 架构作用：
 * 三层架构中所有"Runtime → Enterprise / Employee"的状态变更（健康、生命周期、
 * 绑定增删）都通过本事件总线投递。下游层订阅事件并各自更新视图。
 *
 * 事件方向规约（参考 design.md "Projection Architecture"）：
 *   ┌──────────────────────────────────────┐
 *   │ Source               Direction       │
 *   ├──────────────────────────────────────┤
 *   │ "platform"     ─→  ["enterprise",     │
 *   │                      "employee"]      │
 *   │ "enterprise"   ─→  ["platform"]       │
 *   │ "employee"     ─→  ["platform"]       │
 *   └──────────────────────────────────────┘
 *
 * 失败传播策略：
 *   - 同步 listener 抛错 → 入重试队列；不阻塞其他 listener
 *   - 重试队列采用指数退避（1s / 4s / 16s / 64s），最多 5 次后丢弃并告警
 *
 * 设计准则：
 * - 事件载荷类型化（discriminated union by `eventType`），杜绝魔法字符串
 * - 事件不可变（payload deep-frozen 在 publish 时）
 * - 总线本身为纯函数 + 可变 state，不依赖宿主 timer，便于测试时注入虚拟时钟
 */

import type { BindingState, RuntimeHealth, RuntimeLifecycle } from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────
// 事件类型（discriminated union）
// ─────────────────────────────────────────────────────────────────────────

export type EventSource = "platform" | "enterprise" | "employee";

/**
 * Runtime → 下游的 Projection 事件。
 *
 * `runtime.health.changed`         健康状态变更
 * `runtime.lifecycle.changed`      生命周期变更（含 deprecated/archived 触发通知）
 * `runtime.binding.created`        新建绑定（典型来源：企业端"安装到机器人"）
 * `runtime.binding.deleted`        删除绑定
 * `runtime.binding.state-changed`  绑定状态变更（含 disabled）
 *
 * 反向事件（Enterprise → Runtime）：
 * `enterprise.uninstall.requested` 企业端请求卸载
 * `enterprise.deprecate.requested` 企业端标记"已不适合继续推广"
 * `enterprise.install.requested`   企业端"安装到机器人"
 *
 * Capability Center → Runtime：
 * `capability.retired`             能力被标记为 retired，需级联禁用所有 binding
 */
export type RuntimeProjectionEvent =
  | {
      eventType: "runtime.health.changed";
      source: EventSource;
      timestamp: number;
      payload: {
        runtimeAgentId: string;
        capabilityId: string | null;
        bindingId: string | null;
        fromHealth: RuntimeHealth;
        toHealth: RuntimeHealth;
      };
    }
  | {
      eventType: "runtime.lifecycle.changed";
      source: EventSource;
      timestamp: number;
      payload: {
        runtimeAgentId: string;
        fromLifecycle: RuntimeLifecycle;
        toLifecycle: RuntimeLifecycle;
        triggersDownstreamNotification: boolean;
      };
    }
  | {
      eventType: "runtime.binding.created";
      source: EventSource;
      timestamp: number;
      payload: {
        bindingId: string;
        runtimeAgentId: string;
        capabilityId: string;
        capabilityVersion: string;
      };
    }
  | {
      eventType: "runtime.binding.deleted";
      source: EventSource;
      timestamp: number;
      payload: {
        bindingId: string;
        runtimeAgentId: string;
        capabilityId: string;
      };
    }
  | {
      eventType: "runtime.binding.state-changed";
      source: EventSource;
      timestamp: number;
      payload: {
        bindingId: string;
        runtimeAgentId: string;
        capabilityId: string;
        fromState: BindingState;
        toState: BindingState;
      };
    }
  | {
      eventType: "enterprise.install.requested";
      source: "enterprise";
      timestamp: number;
      payload: {
        runtimeAgentId: string;
        capabilityId: string;
        capabilityVersion: string;
        triggeredBy: "admin-push" | "employee-self-install";
      };
    }
  | {
      eventType: "enterprise.uninstall.requested";
      source: "enterprise";
      timestamp: number;
      payload: {
        bindingId: string;
        runtimeAgentId: string;
      };
    }
  | {
      eventType: "enterprise.deprecate.requested";
      source: "enterprise";
      timestamp: number;
      payload: {
        bindingId: string;
        capabilityId: string;
      };
    }
  | {
      eventType: "capability.retired";
      source: "platform";
      timestamp: number;
      payload: {
        capabilityId: string;
      };
    };

export type RuntimeEventType = RuntimeProjectionEvent["eventType"];

// ─────────────────────────────────────────────────────────────────────────
// 监听器与重试
// ─────────────────────────────────────────────────────────────────────────

export type EventListener<T extends RuntimeEventType = RuntimeEventType> = (
  event: Extract<RuntimeProjectionEvent, { eventType: T }>,
) => void | Promise<void>;

type ListenerEntry = {
  /** 监听者订阅的事件类型；"*" 表示监听所有事件。 */
  eventType: RuntimeEventType | "*";
  listener: (event: RuntimeProjectionEvent) => void | Promise<void>;
};

type RetryEntry = {
  event: RuntimeProjectionEvent;
  listener: ListenerEntry;
  attempts: number;
  scheduledAt: number;
};

const MAX_RETRY_ATTEMPTS = 5;
/** 指数退避序列（ms）：1s, 4s, 16s, 64s, 256s。 */
const BACKOFF_MS = [1_000, 4_000, 16_000, 64_000, 256_000] as const;

// ─────────────────────────────────────────────────────────────────────────
// 总线状态
// ─────────────────────────────────────────────────────────────────────────

export type RuntimeEventBus = {
  /** 已注册的监听器。 */
  readonly listeners: ListenerEntry[];
  /** 事件总线的全局历史（最多 200 条，主要用于审计与调试）。 */
  history: RuntimeProjectionEvent[];
  /** 失败重试队列。 */
  retryQueue: RetryEntry[];
  /** 死信队列：超过最大重试次数的失败事件。 */
  deadLetterQueue: RetryEntry[];
};

const HISTORY_LIMIT = 200;

export function createRuntimeEventBus(): RuntimeEventBus {
  return {
    listeners: [],
    history: [],
    retryQueue: [],
    deadLetterQueue: [],
  };
}

/** 注册监听器；返回 unsubscribe 函数。 */
export function subscribe<T extends RuntimeEventType>(
  bus: RuntimeEventBus,
  eventType: T | "*",
  listener: EventListener<T>,
): () => void {
  const entry: ListenerEntry = {
    eventType,
    listener: listener as (event: RuntimeProjectionEvent) => void | Promise<void>,
  };
  // listeners 是 readonly 属性，但底层数组本身可 push（与 enterprise 模块同风格）
  bus.listeners.push(entry);
  return () => {
    const arr = bus.listeners;
    const idx = arr.indexOf(entry);
    if (idx >= 0) {
      arr.splice(idx, 1);
    }
  };
}

/**
 * 发布事件。
 *
 * - 事件被深度冻结后写入历史
 * - 同步遍历所有匹配监听器；任一监听器抛错都不会阻止其他监听器执行
 * - 抛错的监听器进入重试队列，由调用方驱动 `processRetryQueue` 重投递
 */
export function publish(bus: RuntimeEventBus, event: RuntimeProjectionEvent): void {
  const frozen: RuntimeProjectionEvent = Object.freeze({
    ...event,
    payload: Object.freeze({ ...(event.payload as Record<string, unknown>) }),
  }) as RuntimeProjectionEvent;
  bus.history = [frozen, ...bus.history].slice(0, HISTORY_LIMIT);

  for (const entry of bus.listeners) {
    if (entry.eventType !== "*" && entry.eventType !== frozen.eventType) {
      continue;
    }
    try {
      const result = entry.listener(frozen);
      if (result && typeof result.then === "function") {
        result.catch((err) => {
          enqueueRetry(bus, frozen, entry, err);
        });
      }
    } catch (err) {
      enqueueRetry(bus, frozen, entry, err);
    }
  }
}

function enqueueRetry(
  bus: RuntimeEventBus,
  event: RuntimeProjectionEvent,
  listener: ListenerEntry,
  _err: unknown,
): void {
  bus.retryQueue.push({
    event,
    listener,
    attempts: 1,
    scheduledAt: Date.now() + BACKOFF_MS[0],
  });
}

/**
 * 处理重试队列：调用方在合适时机（typically 周期性 timer）调用本函数。
 *
 * @param bus  事件总线
 * @param now  当前时间（毫秒），便于测试注入虚拟时钟
 * @returns    本次实际重投递的事件数量
 */
export function processRetryQueue(bus: RuntimeEventBus, now: number = Date.now()): number {
  if (bus.retryQueue.length === 0) {
    return 0;
  }
  const due: RetryEntry[] = [];
  const remaining: RetryEntry[] = [];
  for (const entry of bus.retryQueue) {
    if (entry.scheduledAt <= now) {
      due.push(entry);
    } else {
      remaining.push(entry);
    }
  }
  bus.retryQueue = remaining;

  let processed = 0;
  for (const entry of due) {
    try {
      const result = entry.listener.listener(entry.event);
      if (result && typeof result.then === "function") {
        result.catch(() => requeueOrDead(bus, entry));
      }
      processed += 1;
    } catch {
      requeueOrDead(bus, entry);
    }
  }
  return processed;
}

function requeueOrDead(bus: RuntimeEventBus, entry: RetryEntry): void {
  const nextAttempts = entry.attempts + 1;
  if (nextAttempts > MAX_RETRY_ATTEMPTS) {
    bus.deadLetterQueue.push({ ...entry, attempts: nextAttempts });
    return;
  }
  const backoffIndex = Math.min(nextAttempts - 1, BACKOFF_MS.length - 1);
  bus.retryQueue.push({
    event: entry.event,
    listener: entry.listener,
    attempts: nextAttempts,
    scheduledAt: Date.now() + BACKOFF_MS[backoffIndex],
  });
}

/** 清空总线（仅供测试 / 重置使用）。 */
export function resetEventBus(bus: RuntimeEventBus): void {
  bus.listeners.length = 0;
  bus.history = [];
  bus.retryQueue = [];
  bus.deadLetterQueue = [];
}
