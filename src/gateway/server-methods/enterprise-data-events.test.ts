// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { TriggerAgentFn } from "../enterprise-data/enterprise-data-event-bus.js";
import {
  normalizeEnterpriseDataEventStore,
  upsertEventSubscription,
} from "../enterprise-data/enterprise-data-event-store.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const resolveBillingScopeMock = vi.hoisted(() => vi.fn());

vi.mock("../billing/scope.js", () => ({
  resolveBillingScope: resolveBillingScopeMock,
}));

vi.mock("../protocol/index.js", () => ({
  ErrorCodes: { INVALID_REQUEST: "INVALID_REQUEST" },
  errorShape: (code: string, message: string, extra?: { code?: string }) => ({
    code,
    message,
    ...extra,
  }),
}));

const { createEnterpriseDataEventHandlers } = await import("./enterprise-data-events.js");

const tenantId = "tenant-acme";
const nowIso = "2026-07-12T12:00:00.000Z";
const adminScope = {
  enterpriseId: tenantId,
  user: { id: "emp-admin-001" },
  membership: null,
  isEnterpriseAdmin: true,
  permissions: new Set(["operator"]),
};
const memberScope = { ...adminScope, isEnterpriseAdmin: false };

function makeHarness() {
  const store = normalizeEnterpriseDataEventStore(null);
  // Seed a subscription so an order event dispatches to agent-sales.
  upsertEventSubscription({
    store,
    tenantId,
    nowIso,
    subscription: { targetAgentId: "agent-sales", objectKind: "order", enabled: true },
  });
  const triggerCalls: string[] = [];
  const triggerAgent: TriggerAgentFn = async (params) => {
    triggerCalls.push(params.targetAgentId);
    return { status: "accepted", runId: "run-1" };
  };
  const handlers = createEnterpriseDataEventHandlers({
    loadStore: async () => store,
    withStore: async (run) => run(store),
    triggerAgent,
    now: () => nowIso,
  });
  return { store, handlers, triggerCalls };
}

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; code?: string };
};

async function invoke(
  handlers: ReturnType<typeof createEnterpriseDataEventHandlers>,
  method: string,
  params: Record<string, unknown> = {},
  options: { admin?: boolean } = {},
): Promise<InvokeResult> {
  const handler = handlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  resolveBillingScopeMock.mockImplementation(async () =>
    options.admin === false ? memberScope : adminScope,
  );
  let response: InvokeResult | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "admin@acme.test" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as { message?: string; code?: string } | undefined,
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

describe("enterprise-data event handlers", () => {
  it("ingests an event and triggers the matched subscription's agent", async () => {
    const harness = makeHarness();
    const response = await invoke(harness.handlers, "enterprise-data.events.ingest", {
      sourceId: "erp-sap",
      eventType: "created",
      objectKind: "order",
      externalId: "order-1",
      title: "新订单",
    });
    expect(response.ok).toBe(true);
    expect(response.payload?.deduped).toBe(false);
    const dispatch = response.payload?.dispatch as { matched: number };
    expect(dispatch.matched).toBe(1);
    expect(harness.triggerCalls).toEqual(["agent-sales"]);
  });

  it("lists ingested events for the tenant", async () => {
    const harness = makeHarness();
    await invoke(harness.handlers, "enterprise-data.events.ingest", {
      sourceId: "erp-sap",
      eventType: "created",
      objectKind: "order",
      externalId: "order-1",
      title: "新订单",
    });
    const response = await invoke(harness.handlers, "enterprise-data.events.list", {});
    expect(response.ok).toBe(true);
    const events = response.payload?.events as Array<{ objectKind?: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]?.objectKind).toBe("order");
  });

  it("supports subscription upsert → list → delete", async () => {
    const harness = makeHarness();
    const upserted = await invoke(harness.handlers, "enterprise-data.event-subscriptions.upsert", {
      targetAgentId: "agent-cs",
      objectKind: "customer",
    });
    expect(upserted.ok).toBe(true);
    const upsertedPayload = upserted.payload as { subscription: { subscriptionId: string } };
    const subscriptionId = upsertedPayload.subscription.subscriptionId;

    const listed = await invoke(harness.handlers, "enterprise-data.event-subscriptions.list", {});
    const listedPayload = listed.payload as { subscriptions: Array<{ subscriptionId: string }> };
    const ids = listedPayload.subscriptions.map((subscription) => subscription.subscriptionId);
    expect(ids).toContain(subscriptionId);

    const deleted = await invoke(harness.handlers, "enterprise-data.event-subscriptions.delete", {
      subscriptionId,
    });
    expect(deleted.ok).toBe(true);
  });

  it("rejects ingest without a sourceId", async () => {
    const harness = makeHarness();
    const response = await invoke(harness.handlers, "enterprise-data.events.ingest", {
      title: "no source",
    });
    expect(response.ok).toBe(false);
  });

  it("rejects a non-admin member", async () => {
    const harness = makeHarness();
    const response = await invoke(
      harness.handlers,
      "enterprise-data.events.list",
      {},
      { admin: false },
    );
    expect(response.ok).toBe(false);
  });
});
