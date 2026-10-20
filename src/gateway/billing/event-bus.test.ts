// @vitest-environment node
// Feature: cost-budget-billing
// Task 5.1: 事件持久与重放（durable + at-least-once）

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BillingEventBus } from "./event-bus.ts";
import { listEvents } from "./event-log-store.ts";
import type { UsageReportedEvent } from "./types.ts";

let storePath: string;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-billing-events-"));
  storePath = path.join(dir, "events.json");
});

afterEach(() => {
  try {
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function usageEvent(eventId: string): UsageReportedEvent {
  return {
    type: "usage.reported",
    enterpriseId: "ent-1",
    userId: "user-1",
    eventId,
    key: "ai_token",
    quantity: 100,
    occurredAt: "2026-03-10T00:00:00.000Z",
  };
}

describe("BillingEventBus durability", () => {
  it("publish 投递成功后不把已投递行留在日志里", async () => {
    const bus = new BillingEventBus();
    let seen = 0;
    bus.on(() => {
      seen += 1;
    });
    await bus.publish(usageEvent("e1"), storePath);
    expect(seen).toBe(1);
    // 无消费者时 deliver 视为成功，已投递行在重写时删除
    const events = await listEvents({}, storePath);
    expect(events).toHaveLength(0);
  });

  it("消费者抛错 → 事件标记 failed 不丢，replayPending 可重放", async () => {
    const bus = new BillingEventBus();
    let attempts = 0;
    let failFirst = true;
    bus.on(() => {
      attempts += 1;
      if (failFirst) {
        throw new Error("consumer boom");
      }
    });

    await bus.publish(usageEvent("e1"), storePath);
    expect(attempts).toBe(1);
    let events = await listEvents({}, storePath);
    expect(events[0]?.status).toBe("failed");

    // 修复消费者后重放
    failFirst = false;
    await bus.replayPending(storePath);
    expect(attempts).toBe(2);
    events = await listEvents({}, storePath);
    expect(events).toHaveLength(0);
  });

  it("replayPending 只重放未完成事件", async () => {
    const bus = new BillingEventBus();
    const consumed: number[] = [];
    bus.on((e) => {
      consumed.push(e.seq);
    });
    await bus.publish(usageEvent("e1"), storePath); // done
    await bus.publish(usageEvent("e2"), storePath); // done
    consumed.length = 0;
    await bus.replayPending(storePath);
    // 两条都已 done，replay 不应再投递
    expect(consumed).toHaveLength(0);
  });

  it("已完成事件崩溃重试：同 eventId 再 publish 消费者只执行一次", async () => {
    const bus = new BillingEventBus();
    let invocations = 0;
    bus.on(() => {
      invocations += 1;
    });
    await bus.publish(usageEvent("same-id"), storePath);
    expect(invocations).toBe(1);
    // 崩溃后阶段机重试会再次 publish 同一 eventId（append 幂等返回 status=done）
    await bus.publish(usageEvent("same-id"), storePath);
    await bus.publish(usageEvent("same-id"), storePath);
    expect(invocations).toBe(1);
    const events = await listEvents({}, storePath);
    expect(events).toHaveLength(0);
  });

  it("seq 单调递增", async () => {
    const bus = new BillingEventBus();
    bus.on(() => {
      throw new Error("keep failed");
    });
    await bus.publish(usageEvent("e1"), storePath);
    await bus.publish(usageEvent("e2"), storePath);
    await bus.publish(usageEvent("e3"), storePath);
    const events = await listEvents({}, storePath);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("stops once maxEvents pending events have been replayed", async () => {
    const bus = new BillingEventBus();
    bus.on(() => {
      throw new Error("keep failed");
    });
    await bus.publish(usageEvent("cap-1"), storePath);
    await bus.publish(usageEvent("cap-2"), storePath);
    await bus.publish(usageEvent("cap-3"), storePath);
    bus.__clearHandlersForTest();
    const seen: number[] = [];
    bus.on((event) => {
      seen.push(event.seq);
    });
    const result = await bus.replayPending(storePath, { maxEvents: 2 });
    expect(result).toEqual({ replayed: 2, truncated: true, timedOutEvents: 0 });
    expect(seen).toHaveLength(2);
  });

  it("returns before a stuck consumer finishes when perEventMs elapses", async () => {
    const bus = new BillingEventBus();
    bus.on(() => {
      throw new Error("keep failed");
    });
    await bus.publish(usageEvent("stuck-1"), storePath);
    bus.__clearHandlersForTest();
    bus.on(() => new Promise(() => {}));
    const started = Date.now();
    const result = await bus.replayPending(storePath, { perEventMs: 40, deadlineMs: 500 });
    expect(Date.now() - started).toBeLessThan(400);
    expect(result.truncated).toBe(true);
    expect(result.timedOutEvents).toBe(1);
    expect(result.replayed).toBe(0);
  });

  it("does not rewrite the log when replay leaves failed events failed", async () => {
    const bus = new BillingEventBus();
    bus.on(() => {
      throw new Error("keep failed");
    });
    await bus.publish(usageEvent("rw-1"), storePath);
    await bus.publish(usageEvent("rw-2"), storePath);
    await bus.publish(usageEvent("rw-3"), storePath);
    const spy = vi.spyOn(fs.promises, "writeFile");
    spy.mockClear();
    await bus.replayPending(storePath);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    const events = await listEvents({}, storePath);
    expect(events.map((event) => event.status)).toEqual(["failed", "failed", "failed"]);
  });

  it("commits a successful replay of a failed backlog in one write", async () => {
    const bus = new BillingEventBus();
    bus.on(() => {
      throw new Error("keep failed");
    });
    await bus.publish(usageEvent("ok-1"), storePath);
    await bus.publish(usageEvent("ok-2"), storePath);
    bus.__clearHandlersForTest();
    bus.on(() => undefined);
    const spy = vi.spyOn(fs.promises, "writeFile");
    spy.mockClear();
    await bus.replayPending(storePath);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    const events = await listEvents({}, storePath);
    expect(events).toHaveLength(0);
  });

  it("drops delivered rows and failed rows older than 24h when the log is rewritten", async () => {
    const now = Date.now();
    const old = new Date(now - 24 * 60 * 60 * 1000 - 1000).toISOString();
    const fresh = new Date(now - 60_000).toISOString();
    const seed = (
      seq: number,
      status: "done" | "failed" | "pending",
      recordedAt: string,
      eventId: string,
    ) => ({
      seq,
      status,
      enterpriseId: "ent-1",
      recordedAt,
      event: usageEvent(eventId),
    });
    await fs.promises.writeFile(
      storePath,
      JSON.stringify({
        version: 1,
        nextSeq: 5,
        events: [
          seed(1, "done", fresh, "delivered"),
          seed(2, "failed", old, "expired-failure"),
          seed(3, "failed", fresh, "fresh-failure"),
          seed(4, "pending", old, "still-pending"),
        ],
      }),
    );
    const bus = new BillingEventBus();
    bus.on(() => {
      throw new Error("keep failed");
    });
    await bus.publish(usageEvent("trigger"), storePath);
    const events = await listEvents({}, storePath);
    expect(
      events.map((event) => event.event.type === "usage.reported" && event.event.eventId),
    ).toEqual(["fresh-failure", "still-pending", "trigger"]);
    expect(events.map((event) => event.status)).toEqual(["failed", "pending", "failed"]);
  });

  it("replay rewrites once to drop failed events older than 24h", async () => {
    const now = Date.now();
    const old = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    const fresh = new Date(now - 60_000).toISOString();
    await fs.promises.writeFile(
      storePath,
      JSON.stringify({
        version: 1,
        nextSeq: 3,
        events: [2, 1].map((seq) => ({
          seq,
          status: "failed",
          enterpriseId: "ent-1",
          recordedAt: seq === 1 ? old : fresh,
          event: usageEvent(seq === 1 ? "expired-failure" : "fresh-failure"),
        })),
      }),
    );
    const bus = new BillingEventBus();
    bus.on(() => {
      throw new Error("keep failed");
    });
    const spy = vi.spyOn(fs.promises, "writeFile");
    spy.mockClear();
    await bus.replayPending(storePath);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    const events = await listEvents({}, storePath);
    expect(events).toHaveLength(1);
    expect(events[0]?.event.type === "usage.reported" && events[0].event.eventId).toBe(
      "fresh-failure",
    );
  });

  it("coalesces one gov-llm invocation into a single failed event", async () => {
    const bus = new BillingEventBus();
    bus.on(() => {
      throw new Error("keep failed");
    });
    const gov = (eventId: string, key: string, quantity: number): UsageReportedEvent => ({
      type: "usage.reported",
      enterpriseId: "ent-1",
      userId: "governance-system",
      eventId,
      key,
      quantity,
      occurredAt: "2026-10-04T01:00:00.000Z",
      agentId: "knowledge-governance",
    });
    await bus.publish(
      gov("gov-llm:call:kb_a:call-1", "knowledge_governance_llm_call", 1),
      storePath,
    );
    await bus.publish(
      gov("gov-llm:tokens:kb_a:call-1", "knowledge_governance_llm_tokens", 80),
      storePath,
    );
    await bus.publish(gov("credit:gov-llm:kb_a:call-1", "ai_credits", 3), storePath);
    await bus.publish(gov("gov-llm:kb_b:call-1", "ai_credits", 2), storePath);
    await bus.publish(
      gov("gov-llm:tokens:kb_b:call-1", "knowledge_governance_llm_tokens", 40),
      storePath,
    );
    await bus.publish(
      gov("gov-llm:call:kb_b:call-9", "knowledge_governance_llm_call", 1),
      storePath,
    );
    const events = await listEvents({}, storePath);
    expect(events).toHaveLength(2);
    const invocation = events.find(
      (event) => event.event.type === "usage.reported" && event.event.eventId.endsWith("call-1"),
    );
    expect(invocation?.status).toBe("failed");
    expect(invocation?.event).toMatchObject({
      type: "usage.reported",
      eventId: "gov-llm:invocation:call-1",
      key: "knowledge_governance_llm",
      quantity: 120,
      governanceLlm: {
        callId: "call-1",
        knowledgeBaseIds: ["kb_a", "kb_b"],
        callQuantity: 1,
        tokenQuantity: 120,
        creditQuantity: 5,
      },
    });
    expect(events[0]?.seq).toBe(1);
    expect(events[1]?.event.type === "usage.reported" && events[1].event.eventId).toBe(
      "gov-llm:invocation:call-9",
    );
  });
});
