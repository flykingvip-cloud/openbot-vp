// @vitest-environment node
// Feature: platform-agent-runtime-center, Task 26: Runtime Projection Event Bus
import { describe, expect, it, vi } from "vitest";
import {
  createRuntimeEventBus,
  processRetryQueue,
  publish,
  resetEventBus,
  type RuntimeProjectionEvent,
  subscribe,
} from "../event-bus.ts";

function healthEvent(): RuntimeProjectionEvent {
  return {
    eventType: "runtime.health.changed",
    source: "platform",
    timestamp: 1000,
    payload: {
      runtimeAgentId: "agent-1",
      capabilityId: null,
      bindingId: null,
      fromHealth: "healthy",
      toHealth: "degraded",
    },
  };
}

function lifecycleEvent(): RuntimeProjectionEvent {
  return {
    eventType: "runtime.lifecycle.changed",
    source: "platform",
    timestamp: 1000,
    payload: {
      runtimeAgentId: "agent-1",
      fromLifecycle: "deployed",
      toLifecycle: "deprecated",
      triggersDownstreamNotification: true,
    },
  };
}

describe("RuntimeEventBus — basic publish/subscribe", () => {
  it("delivers events to typed subscribers", () => {
    const bus = createRuntimeEventBus();
    const fn = vi.fn();
    subscribe(bus, "runtime.health.changed", fn);
    publish(bus, healthEvent());
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]?.[0]?.eventType).toBe("runtime.health.changed");
  });

  it("delivers events to wildcard subscribers", () => {
    const bus = createRuntimeEventBus();
    const fn = vi.fn();
    subscribe(bus, "*", fn);
    publish(bus, healthEvent());
    publish(bus, lifecycleEvent());
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not deliver mismatched event types to typed subscribers", () => {
    const bus = createRuntimeEventBus();
    const healthFn = vi.fn();
    const lifecycleFn = vi.fn();
    subscribe(bus, "runtime.health.changed", healthFn);
    subscribe(bus, "runtime.lifecycle.changed", lifecycleFn);
    publish(bus, healthEvent());
    expect(healthFn).toHaveBeenCalledTimes(1);
    expect(lifecycleFn).toHaveBeenCalledTimes(0);
  });

  it("unsubscribe stops further delivery", () => {
    const bus = createRuntimeEventBus();
    const fn = vi.fn();
    const off = subscribe(bus, "runtime.health.changed", fn);
    publish(bus, healthEvent());
    off();
    publish(bus, healthEvent());
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("RuntimeEventBus — listener isolation", () => {
  it("a thrown listener does not block other listeners", () => {
    const bus = createRuntimeEventBus();
    const goodA = vi.fn();
    const goodB = vi.fn();
    subscribe(bus, "runtime.health.changed", goodA);
    subscribe(bus, "runtime.health.changed", () => {
      throw new Error("boom");
    });
    subscribe(bus, "runtime.health.changed", goodB);
    publish(bus, healthEvent());
    expect(goodA).toHaveBeenCalledTimes(1);
    expect(goodB).toHaveBeenCalledTimes(1);
  });

  it("failed listener gets enqueued for retry", () => {
    const bus = createRuntimeEventBus();
    subscribe(bus, "runtime.health.changed", () => {
      throw new Error("boom");
    });
    publish(bus, healthEvent());
    expect(bus.retryQueue.length).toBe(1);
    expect(bus.retryQueue[0]?.attempts).toBe(1);
  });
});

describe("RuntimeEventBus — frozen events", () => {
  it("listeners receive frozen events", () => {
    const bus = createRuntimeEventBus();
    let observed: RuntimeProjectionEvent | null = null;
    subscribe(bus, "runtime.health.changed", (e) => {
      observed = e;
    });
    publish(bus, healthEvent());
    expect(observed).not.toBeNull();
    if (observed !== null) {
      expect(Object.isFrozen(observed)).toBe(true);
    }
  });

  it("publish does not mutate the input event reference", () => {
    const bus = createRuntimeEventBus();
    const original = healthEvent();
    publish(bus, original);
    // The input itself should remain non-frozen and unchanged.
    // Narrow to the health-changed variant to access fromHealth safely.
    if (original.eventType === "runtime.health.changed") {
      expect(original.payload.fromHealth).toBe("healthy");
    }
  });
});

describe("RuntimeEventBus — retry queue", () => {
  it("retry succeeds on second attempt and clears queue", () => {
    const bus = createRuntimeEventBus();
    let calls = 0;
    subscribe(bus, "runtime.health.changed", () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("first-attempt-fails");
      }
    });
    publish(bus, healthEvent());
    expect(bus.retryQueue.length).toBe(1);

    // 模拟后续时间 — 用未来时间戳触发重试
    const futureNow = bus.retryQueue[0].scheduledAt + 10;
    const processed = processRetryQueue(bus, futureNow);
    expect(processed).toBe(1);
    expect(bus.retryQueue.length).toBe(0);
    expect(bus.deadLetterQueue.length).toBe(0);
  });

  it("repeatedly failing listener eventually moves to dead-letter queue", () => {
    const bus = createRuntimeEventBus();
    subscribe(bus, "runtime.health.changed", () => {
      throw new Error("permanent");
    });
    publish(bus, healthEvent());

    // 强制驱动 5 次重试，每次都失败
    let now = Date.now();
    for (let i = 0; i < 6; i += 1) {
      now += 1_000_000;
      processRetryQueue(bus, now);
    }
    expect(bus.deadLetterQueue.length).toBeGreaterThan(0);
  });
});

describe("RuntimeEventBus — history", () => {
  it("records event history (most recent first)", () => {
    const bus = createRuntimeEventBus();
    publish(bus, healthEvent());
    publish(bus, lifecycleEvent());
    expect(bus.history.length).toBe(2);
    expect(bus.history[0]?.eventType).toBe("runtime.lifecycle.changed");
    expect(bus.history[1]?.eventType).toBe("runtime.health.changed");
  });

  it("caps history at 200 entries", () => {
    const bus = createRuntimeEventBus();
    for (let i = 0; i < 250; i += 1) {
      publish(bus, healthEvent());
    }
    expect(bus.history.length).toBe(200);
  });
});

describe("RuntimeEventBus — reset", () => {
  it("resetEventBus clears listeners, history, and queues", () => {
    const bus = createRuntimeEventBus();
    subscribe(bus, "runtime.health.changed", () => {
      throw new Error("boom");
    });
    publish(bus, healthEvent());
    expect(bus.listeners.length).toBe(1);
    expect(bus.history.length).toBe(1);
    expect(bus.retryQueue.length).toBe(1);

    resetEventBus(bus);
    expect(bus.listeners.length).toBe(0);
    expect(bus.history.length).toBe(0);
    expect(bus.retryQueue.length).toBe(0);
    expect(bus.deadLetterQueue.length).toBe(0);
  });
});
