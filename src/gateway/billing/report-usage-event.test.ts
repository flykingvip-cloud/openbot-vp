// @vitest-environment node
// Feature: cost-budget-billing — 统一用量 emit 路径（record + 按用户 publish）。

import { beforeEach, describe, expect, it, vi } from "vitest";

const recordUsage = vi.fn();
const publish = vi.fn();

vi.mock("./usage-records-store.js", () => ({
  recordUsage: (input: unknown) => recordUsage(input),
}));
vi.mock("./event-bus.js", () => ({
  billingEventBus: { publish: (event: unknown) => publish(event) },
}));

const { reportUsageEvent } = await import("./report-usage-event.js");

beforeEach(() => {
  recordUsage.mockReset();
  publish.mockReset();
});

describe("reportUsageEvent", () => {
  it("首次写入 → 记录并发布带 userId 的事件", async () => {
    recordUsage.mockResolvedValue({
      recorded: true,
      deduped: false,
      record: {
        userId: "user-1",
        occurredAt: "2026-07-01T00:00:00.000Z",
        agentId: "main",
        orgSeatId: "seat-1",
      },
    });
    const res = await reportUsageEvent({
      enterpriseId: "ent-1",
      userId: "user-1",
      eventId: "e1",
      key: "ai_token",
      quantity: 100,
      agentId: "main",
      orgSeatId: "seat-1",
    });
    expect(res).toEqual({ recorded: true, deduped: false });
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toMatchObject({
      type: "usage.reported",
      enterpriseId: "ent-1",
      userId: "user-1",
      eventId: "e1",
      key: "ai_token",
      quantity: 100,
      agentId: "main",
      orgSeatId: "seat-1",
    });
  });

  it("去重写入 → 不发布事件（at-least-once 不重复计数）", async () => {
    recordUsage.mockResolvedValue({
      recorded: false,
      deduped: true,
      record: { userId: "user-1", occurredAt: "2026-07-01T00:00:00.000Z" },
    });
    const res = await reportUsageEvent({
      enterpriseId: "ent-1",
      userId: "user-1",
      eventId: "e1",
      key: "ai_token",
      quantity: 100,
    });
    expect(res).toEqual({ recorded: false, deduped: true });
    expect(publish).not.toHaveBeenCalled();
  });

  it("事件 userId 取自落库记录（权威），而非可能不同的入参", async () => {
    recordUsage.mockResolvedValue({
      recorded: true,
      deduped: false,
      record: { userId: "canonical-user", occurredAt: "2026-07-01T00:00:00.000Z" },
    });
    await reportUsageEvent({
      enterpriseId: "ent-1",
      userId: "input-user",
      eventId: "e2",
      key: "task",
      quantity: 1,
    });
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ userId: "canonical-user" });
  });
});
