// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildEventAgentMessage,
  dispatchEnterpriseDataEvent,
  ingestEnterpriseDataEvent,
  matchSubscriptions,
  normalizeInboundSignal,
  recordEnterpriseDataEvent,
  type TriggerAgentFn,
} from "./enterprise-data-event-bus.js";
import {
  appendEnterpriseDataEvent,
  listEnterpriseDataEvents,
  normalizeEnterpriseDataEventStore,
  upsertEventSubscription,
} from "./enterprise-data-event-store.js";
import {
  ENTERPRISE_DATA_EVENT_RETENTION_PER_TENANT,
  type EnterpriseDataEventStore,
  type EnterpriseDataEventSubscription,
} from "./enterprise-data-event-types.js";

const tenantId = "tenant-acme";
const nowIso = "2026-07-12T12:00:00.000Z";

function emptyStore(): EnterpriseDataEventStore {
  return normalizeEnterpriseDataEventStore(null);
}

function recordingTrigger(overrides?: { failFor?: string }) {
  const calls: Array<{ targetAgentId: string; sessionKey: string; message: string }> = [];
  const fn: TriggerAgentFn = async (params) => {
    calls.push({
      targetAgentId: params.targetAgentId,
      sessionKey: params.sessionKey,
      message: params.message,
    });
    if (overrides?.failFor && params.targetAgentId === overrides.failFor) {
      throw new Error("trigger boom");
    }
    return { status: "accepted", runId: `run-${calls.length}` };
  };
  return { fn, calls };
}

describe("normalizeInboundSignal", () => {
  it("trims, defaults eventType to custom, and derives a title", () => {
    const input = normalizeInboundSignal({ sourceId: " crm-salesforce ", objectKind: "customer" });
    expect(input.sourceId).toBe("crm-salesforce");
    expect(input.eventType).toBe("custom");
    expect(input.objectKind).toBe("customer");
    expect(input.title).toBe("customer custom");
  });

  it("rejects a missing sourceId and invalid enums", () => {
    expect(() => normalizeInboundSignal({})).toThrow(/sourceId/);
    expect(() => normalizeInboundSignal({ sourceId: "s", eventType: "bogus" })).toThrow(
      /eventType/,
    );
    expect(() => normalizeInboundSignal({ sourceId: "s", objectKind: "bogus" })).toThrow(
      /objectKind/,
    );
  });
});

describe("matchSubscriptions (deterministic fan-out)", () => {
  it("matches wildcard + rule subs, excludes disabled/mismatch/cross-tenant", () => {
    const store = emptyStore();
    upsertEventSubscription({
      store,
      tenantId,
      nowIso,
      subscription: { targetAgentId: "agent-sales", objectKind: "order", enabled: true },
    });
    upsertEventSubscription({
      store,
      tenantId,
      nowIso,
      subscription: { targetAgentId: "agent-all", enabled: true },
    });
    upsertEventSubscription({
      store,
      tenantId,
      nowIso,
      subscription: { targetAgentId: "agent-off", objectKind: "order", enabled: false },
    });
    upsertEventSubscription({
      store,
      tenantId,
      nowIso,
      subscription: { targetAgentId: "agent-cust", objectKind: "customer", enabled: true },
    });
    const { event } = recordEnterpriseDataEvent({
      store,
      tenantId,
      signal: { sourceId: "erp-sap", eventType: "created", objectKind: "order", title: "新订单" },
      nowIso,
    });
    const crossTenant: EnterpriseDataEventSubscription = {
      subscriptionId: "x",
      tenantId: "tenant-other",
      targetAgentId: "agent-x",
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const all = [...Object.values(store.subscriptions), crossTenant];
    const matched = matchSubscriptions(event, all)
      .map((subscription) => subscription.targetAgentId)
      .toSorted();
    expect(matched).toEqual(["agent-all", "agent-sales"]);
  });
});

describe("ingestEnterpriseDataEvent (record → match → dispatch, idempotent)", () => {
  it("appends + dispatches once, then dedupes a retry by externalId", async () => {
    const store = emptyStore();
    upsertEventSubscription({
      store,
      tenantId,
      nowIso,
      subscription: { targetAgentId: "agent-sales", objectKind: "order", enabled: true },
    });
    const trigger = recordingTrigger();
    const signal = {
      sourceId: "erp-sap",
      eventType: "created",
      objectKind: "order",
      externalId: "order-100",
      title: "新订单",
    };
    const first = await ingestEnterpriseDataEvent({
      store,
      tenantId,
      signal,
      nowIso,
      triggerAgent: trigger.fn,
    });
    expect(first.deduped).toBe(false);
    expect(first.dispatch.matched).toBe(1);
    expect(trigger.calls).toHaveLength(1);
    expect(trigger.calls[0]?.targetAgentId).toBe("agent-sales");
    // Session key targets the agent within the tenant "organization".
    expect(trigger.calls[0]?.sessionKey).toContain("agent:agent-sales:org:");

    const second = await ingestEnterpriseDataEvent({
      store,
      tenantId,
      signal: { ...signal, title: "新订单(重试)" },
      nowIso,
      triggerAgent: trigger.fn,
    });
    expect(second.deduped).toBe(true);
    expect(second.dispatch.matched).toBe(0);
    expect(second.event.eventId).toBe(first.event.eventId);
    expect(trigger.calls).toHaveLength(1); // no re-dispatch
    expect(listEnterpriseDataEvents({ store, tenantId })).toHaveLength(1);
  });
});

describe("dispatchEnterpriseDataEvent (resilience)", () => {
  it("captures a per-delivery failure without aborting the rest", async () => {
    const store = emptyStore();
    const { event } = recordEnterpriseDataEvent({
      store,
      tenantId,
      signal: { sourceId: "s", eventType: "custom", title: "t" },
      nowIso,
    });
    const subscriptions: EnterpriseDataEventSubscription[] = [
      {
        subscriptionId: "s1",
        tenantId,
        targetAgentId: "a1",
        enabled: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        subscriptionId: "s2",
        tenantId,
        targetAgentId: "a2",
        enabled: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];
    const trigger = recordingTrigger({ failFor: "a1" });
    const result = await dispatchEnterpriseDataEvent({
      event,
      subscriptions,
      triggerAgent: trigger.fn,
    });
    expect(result.matched).toBe(2);
    const byAgent = Object.fromEntries(
      result.deliveries.map((delivery) => [delivery.targetAgentId, delivery.status]),
    );
    expect(byAgent.a1).toBe("error");
    expect(byAgent.a2).toBe("accepted");
  });
});

describe("buildEventAgentMessage (metadata only + planner hint)", () => {
  it("includes the object kind and a data_capability hint, no raw values", () => {
    const store = emptyStore();
    const { event } = recordEnterpriseDataEvent({
      store,
      tenantId,
      signal: {
        sourceId: "erp-sap",
        eventType: "created",
        objectKind: "order",
        objectKey: "sales-order",
        title: "新订单",
        summary: "订单已创建",
      },
      nowIso,
    });
    const message = buildEventAgentMessage(event);
    expect(message).toContain("object_kind: order");
    expect(message).toContain("data_capability");
    expect(message).toContain("metadata only");
  });
});

describe("event log retention", () => {
  it("bounds the per-tenant event log to the retention cap", () => {
    const store = emptyStore();
    const total = ENTERPRISE_DATA_EVENT_RETENTION_PER_TENANT + 5;
    for (let index = 0; index < total; index += 1) {
      appendEnterpriseDataEvent({
        store,
        tenantId,
        event: { sourceId: "s", eventType: "custom", title: `e${index}` },
        nowIso: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      });
    }
    expect(listEnterpriseDataEvents({ store, tenantId })).toHaveLength(
      ENTERPRISE_DATA_EVENT_RETENTION_PER_TENANT,
    );
  });
});
