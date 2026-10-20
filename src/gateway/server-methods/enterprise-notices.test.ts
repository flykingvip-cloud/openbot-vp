// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const scopeState = vi.hoisted(() => ({
  // null → simulate requireEnterpriseScope responding with its own error + returning null.
  current: null as { enterpriseId: string; isEnterpriseAdmin: boolean } | null,
}));
const budgetState = vi.hoisted(() => ({ current: null as { level: string } | null }));
const overAllocState = vi.hoisted(() => ({ current: null as { status: string } | null }));
const creditsState = vi.hoisted(() => ({
  current: null as { monthlyCredits: number; creditsRemaining: number } | null,
}));
const offlineState = vi.hoisted(() => ({
  current: [] as Array<{ channelId: string; accountId: string; reason: string }>,
}));

const requireEnterpriseScopeMock = vi.hoisted(() =>
  vi.fn(
    async (
      _client: unknown,
      respond: (ok: boolean, payload?: unknown, error?: unknown) => void,
    ) => {
      if (!scopeState.current) {
        respond(false, undefined, { code: "INVALID_REQUEST", message: "no tenant resolved" });
        return null;
      }
      return scopeState.current;
    },
  ),
);
const computeBudgetStatusMock = vi.hoisted(() => vi.fn(async () => budgetState.current));
const getOverAllocationStateMock = vi.hoisted(() => vi.fn(async () => overAllocState.current));
const resolveTenantCreditsStatusMock = vi.hoisted(() => vi.fn(async () => creditsState.current));
const resolveTenantOfflineChannelsMock = vi.hoisted(() => vi.fn(async () => offlineState.current));

vi.mock("./billing-helpers.js", () => ({ requireEnterpriseScope: requireEnterpriseScopeMock }));
vi.mock("../billing/runtime.js", () => ({ computeBudgetStatus: computeBudgetStatusMock }));
vi.mock("../billing/over-allocation-store.js", () => ({
  getOverAllocationState: getOverAllocationStateMock,
}));
vi.mock("../billing/record-credit-usage.js", () => ({
  resolveTenantCreditsStatus: resolveTenantCreditsStatusMock,
}));
vi.mock("../workbench/tenant-channel-health.js", () => ({
  resolveTenantOfflineChannels: resolveTenantOfflineChannelsMock,
}));

const { enterpriseNoticesHandlers } = await import("./enterprise-notices.js");

async function invoke(): Promise<{
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
}> {
  const handler = enterpriseNoticesHandlers["enterprise.notices.list"] as
    | GatewayRequestHandler
    | undefined;
  if (!handler) {
    throw new Error("missing handler enterprise.notices.list");
  }
  let response: {
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: { message?: string };
  } | null = null;
  await handler({
    req: { type: "req", id: "test", method: "enterprise.notices.list", params: {} },
    params: {},
    client: { connect: {} as never, user: "admin@example.com" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as { message?: string } | undefined,
      };
    },
    context: {
      getRuntimeSnapshot: () => ({ channels: {}, channelAccounts: {} }),
    } as unknown as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error("handler did not respond");
  }
  return response;
}

describe("enterprise.notices.list RPC", () => {
  beforeEach(() => {
    scopeState.current = null;
    budgetState.current = null;
    overAllocState.current = null;
    creditsState.current = null;
    offlineState.current = [];
    for (const m of [
      requireEnterpriseScopeMock,
      computeBudgetStatusMock,
      getOverAllocationStateMock,
      resolveTenantCreditsStatusMock,
      resolveTenantOfflineChannelsMock,
    ]) {
      m.mockClear();
    }
  });

  it("propagates the tenant-resolution error when no enterprise scope resolves", async () => {
    scopeState.current = null;
    const result = await invoke();
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("no tenant resolved");
    // Must not touch any billing/channel source without a resolved tenant.
    expect(computeBudgetStatusMock).not.toHaveBeenCalled();
  });

  it("rejects a non-admin enterprise member (employees never see admin notices)", async () => {
    scopeState.current = { enterpriseId: "tenant-a", isEnterpriseAdmin: false };
    const result = await invoke();
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("enterprise admin");
    // Gated before any billing/channel work.
    expect(computeBudgetStatusMock).not.toHaveBeenCalled();
    expect(resolveTenantOfflineChannelsMock).not.toHaveBeenCalled();
  });

  it("aggregates billing + channel alerts for an enterprise admin", async () => {
    scopeState.current = { enterpriseId: "tenant-a", isEnterpriseAdmin: true };
    budgetState.current = { level: "exceeded" };
    overAllocState.current = { status: "over_allocated" };
    creditsState.current = { monthlyCredits: 100, creditsRemaining: 0 };
    offlineState.current = [
      { channelId: "telegram", accountId: "default", reason: "disconnected" },
    ];
    const result = await invoke();
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      billingCount: 3, // budget + over-allocation + credits
      channelOfflineCount: 1,
      totalCount: 4,
    });
    expect(computeBudgetStatusMock).toHaveBeenCalledWith("tenant-a", expect.any(Date));
    expect(resolveTenantOfflineChannelsMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty projection for an admin with no alerts", async () => {
    scopeState.current = { enterpriseId: "tenant-a", isEnterpriseAdmin: true };
    budgetState.current = { level: "ok" };
    overAllocState.current = { status: "normal" };
    const result = await invoke();
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({
      totalCount: 0,
      billingCount: 0,
      channelOfflineCount: 0,
      items: [],
    });
  });
});
