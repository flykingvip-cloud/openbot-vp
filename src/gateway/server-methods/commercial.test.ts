// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-commerce-handlers-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../billing/scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../billing/scope.js")>();
  return {
    ...actual,
    resolveBillingScope: vi.fn(async () => ({
      enterpriseId: "ent-commerce",
      user: { id: "user-1" },
      membership: null,
      isEnterpriseAdmin: true,
      permissions: new Set([actual.USAGE_BUDGET_PERMISSION]),
    })),
  };
});

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({ models: { providers: {} } }),
}));

const { platformPlansHandlers } = await import("./platform-plans.js");
const { commercialOrdersHandlers } = await import("./commercial-orders.js");
const { commercialPaymentsHandlers } = await import("./commercial-payments.js");
const { subscriptionsHandlers } = await import("./subscriptions.js");
const { createSalesLead } = await import("../billing/sales-leads-store.js");

const allHandlers = {
  ...platformPlansHandlers,
  ...commercialOrdersHandlers,
  ...commercialPaymentsHandlers,
  ...subscriptionsHandlers,
};

type HandlerError = { code?: string; message?: string };

async function invoke(method: string, params: Record<string, unknown> = {}) {
  let ok = false;
  let payload: unknown;
  let error: HandlerError | undefined;
  const handler = allHandlers[method as keyof typeof allHandlers];
  if (!handler) {
    throw new Error(`missing handler: ${method}`);
  }
  const opts = {
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "admin@example.com" },
    isWebchatConnect: () => false,
    respond: (success: boolean, result?: unknown, err?: HandlerError) => {
      ok = success;
      payload = result;
      error = err;
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  } satisfies GatewayRequestHandlerOptions;
  await handler(opts);
  return { ok, payload, error };
}

describe("subscription-commerce handlers", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("subscribe via commerce creates pending order and subscription", async () => {
    const planRes = await invoke("platform-plans.create", {
      name: "Starter",
      billingCycle: "monthly",
      basePriceCents: 9900,
      seatQuota: { viewer: 10 },
      botQuota: 3,
    });
    expect(planRes.ok).toBe(true);
    const planId = (planRes.payload as { planId: string }).planId;

    const subRes = await invoke("subscriptions.subscribe", {
      planId,
      enterpriseId: "ent-commerce",
    });
    expect(subRes.ok).toBe(true);
    const body = subRes.payload as {
      commerce: boolean;
      order: { status: string; amountCents: number };
      payment: { status: string } | null;
      autoPaid: boolean;
    };
    expect(body.commerce).toBe(true);
    expect(body.order.status).toBe("pending_payment");
    expect(body.order.amountCents).toBe(9900);
    expect(body.payment?.status).toBe("pending");
    expect(body.autoPaid).toBe(false);
  });

  it("manual confirm activates subscription once", async () => {
    const planRes = await invoke("platform-plans.create", {
      name: "Professional",
      billingCycle: "monthly",
      basePriceCents: 49900,
      seatQuota: { viewer: 30 },
      botQuota: 10,
    });
    const planId = (planRes.payload as { planId: string }).planId;
    const subRes = await invoke("subscriptions.subscribe", {
      planId,
      enterpriseId: "ent-commerce",
    });
    const paymentId = (subRes.payload as { payment: { id: string } }).payment.id;

    const confirm1 = await invoke("payments.confirm-manual", {
      paymentId,
      requestId: "req-1",
    });
    expect(confirm1.ok).toBe(true);
    expect(
      (confirm1.payload as { fulfillment: { subscription: { status: string } } }).fulfillment
        .subscription.status,
    ).toBe("active");

    const confirm2 = await invoke("payments.confirm-manual", {
      paymentId,
      requestId: "req-1",
    });
    expect(confirm2.ok).toBe(true);
    expect((confirm2.payload as { deduped: boolean }).deduped).toBe(true);
  });

  it("platform-commerce.from-lead creates pending order linked to lead", async () => {
    const planRes = await invoke("platform-plans.create", {
      name: "Enterprise",
      billingCycle: "annual",
      basePriceCents: 500_000,
      seatQuota: { viewer: 100 },
      botQuota: 20,
    });
    const planId = (planRes.payload as { planId: string }).planId;
    const lead = await createSalesLead({
      planId,
      company: "Acme Corp",
      contact: "Alice",
      phone: "13800000000",
    });

    const fromLead = await invoke("platform-commerce.from-lead", {
      leadId: lead.id,
      enterpriseId: "ent-b2b",
      planId,
      amountCents: 480_000,
    });
    expect(fromLead.ok).toBe(true);
    const body = fromLead.payload as {
      lead: { id: string };
      order: { status: string; amountCents: number; salesLeadId?: string };
      payment: { status: string } | null;
    };
    expect(body.lead.id).toBe(lead.id);
    expect(body.order.status).toBe("pending_payment");
    expect(body.order.amountCents).toBe(480_000);
    expect(body.order.salesLeadId).toBe(lead.id);
    expect(body.payment?.status).toBe("pending");
  });
});
