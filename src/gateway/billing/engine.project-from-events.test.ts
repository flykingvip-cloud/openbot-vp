// @vitest-environment node
// Feature: cost-budget-billing
// 事件→投影按用户归因：projectFromEvents 必须忠实保留 userId/agentId/orgSeatId，
// 使事件日志（设计中的唯一真相）可支撑「总费用 → Seat/Usage → 用户」归因（R9.1 / R18 / R21）。

import { describe, expect, it } from "vitest";
import { projectFromEvents } from "./engine.ts";
import type { BillingDomainEvent, UsageReportedEvent } from "./types.ts";

function usageEvent(
  overrides: Partial<UsageReportedEvent> & { eventId: string },
): UsageReportedEvent {
  return {
    type: "usage.reported",
    enterpriseId: "ent-1",
    userId: "user-a",
    key: "ai_token",
    quantity: 100,
    occurredAt: "2026-03-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("projectFromEvents 按用户归因", () => {
  it("从事件重建的用量记录保留 userId / agentId / orgSeatId", () => {
    const events: BillingDomainEvent[] = [
      usageEvent({ eventId: "e1", userId: "user-a", agentId: "agent-x", orgSeatId: "seat-1" }),
      usageEvent({ eventId: "e2", userId: "user-b" }),
    ];
    const { usage } = projectFromEvents(events, "ent-1");
    expect(usage).toHaveLength(2);
    const byEvent = new Map(usage.map((rec) => [rec.eventId, rec]));
    expect(byEvent.get("e1")?.userId).toBe("user-a");
    expect(byEvent.get("e1")?.agentId).toBe("agent-x");
    expect(byEvent.get("e1")?.orgSeatId).toBe("seat-1");
    expect(byEvent.get("e2")?.userId).toBe("user-b");
    // 未提供归因可选字段时不应臆造。
    expect(byEvent.get("e2")?.agentId).toBeUndefined();
    expect(byEvent.get("e2")?.orgSeatId).toBeUndefined();
  });

  it("按 eventId 去重时保留首条（含其 userId）", () => {
    const events: BillingDomainEvent[] = [
      usageEvent({ eventId: "dup", userId: "user-first" }),
      usageEvent({ eventId: "dup", userId: "user-second" }),
    ];
    const { usage } = projectFromEvents(events, "ent-1");
    expect(usage).toHaveLength(1);
    expect(usage[0]?.userId).toBe("user-first");
  });

  it("旧日志缺 userId 时回退空串而非抛错（向后兼容）", () => {
    // 模拟改造前已落盘的事件（无 userId 字段）。
    const legacy = {
      type: "usage.reported",
      enterpriseId: "ent-1",
      eventId: "legacy-1",
      key: "ai_token",
      quantity: 10,
      occurredAt: "2026-03-10T00:00:00.000Z",
    } as unknown as BillingDomainEvent;
    const { usage } = projectFromEvents([legacy], "ent-1");
    expect(usage).toHaveLength(1);
    expect(usage[0]?.userId).toBe("");
  });

  it("仅投影目标租户的事件", () => {
    const events: BillingDomainEvent[] = [
      usageEvent({ eventId: "e1", enterpriseId: "ent-1", userId: "user-a" }),
      usageEvent({ eventId: "e2", enterpriseId: "ent-2", userId: "user-z" }),
    ];
    const { usage } = projectFromEvents(events, "ent-1");
    expect(usage.map((rec) => rec.eventId)).toEqual(["e1"]);
  });
});
