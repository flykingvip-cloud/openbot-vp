import { describe, expect, it, vi } from "vitest";
import type {
  GatewayRequestHandlerOptions,
  GatewayClient,
} from "../gateway/server-methods/types.js";
import { createObservationQueryHandlers, OBSERVATION_QUERY_METHOD } from "./query-gateway.js";
const { intents } = vi.hoisted(() => ({
  intents: vi.fn(async () => ({ ok: true, state: "unknown", items: [], detail: null })),
}));
vi.mock("./action-intent-query.js", () => ({ queryActionIntents: intents }));
const { query } = vi.hoisted(() => ({
  query: vi.fn(() => ({ ok: true, samples: [{ provenance: ["unknown"] }] })),
}));
vi.mock("./query.js", () => ({ queryObservation: query }));
const client = (scopes = ["operator.read"]): GatewayClient => ({
  platformUserId: "alice",
  sessionDomain: "enterprise",
  connect: { scopes } as GatewayClient["connect"],
});
const params = { agentId: "bot", taskId: "task", outcomeVersion: 1, from: 1, to: 2 };
const invoke = async (
  handler: ReturnType<typeof createObservationQueryHandlers>[string],
  c: GatewayClient | null,
  p = params,
) => {
  const respond = vi.fn();
  await handler({ client: c, params: p, respond } as unknown as GatewayRequestHandlerOptions);
  return respond;
};
describe("observation query gateway", () => {
  it("queries intents only on explicit request and rejects scope injection", async () => {
    intents.mockClear();
    const handler = createObservationQueryHandlers({
      authDeps: { resolveMembership: async () => ({ tenantId: "tenant", userId: "alice" }) },
      loadConfig: () => ({}),
      now: () => 3,
    })[OBSERVATION_QUERY_METHOD];
    await invoke(handler, client());
    expect(intents).not.toHaveBeenCalled();
    const list = await invoke(handler, client(), {
      ...params,
      actionIntents: { limit: 10 },
    } as typeof params);
    expect(list.mock.calls[0][1].actionIntents.state).toBe("unknown");
    expect(intents).toHaveBeenLastCalledWith(
      expect.objectContaining({
        caller: { subjectRef: "subject:alice", tenantId: "tenant" },
        limit: 10,
      }),
      expect.anything(),
    );
    await invoke(handler, client(), {
      ...params,
      actionIntents: { intentId: "intent", revision: 0 },
    } as typeof params);
    expect(intents).toHaveBeenLastCalledWith(
      expect.objectContaining({ intentId: "intent", revision: 0 }),
      expect.anything(),
    );
    for (const actionIntents of [
      null,
      [],
      { scope: "fake" },
      { tenantId: "fake" },
      { limit: 0 },
      { revision: 1 },
      { intentId: "intent", cursor: "x" },
    ]) {
      expect(
        (await invoke(handler, client(), { ...params, actionIntents } as typeof params)).mock
          .calls[0][0],
      ).toBe(false);
    }
  });
  it("rechecks membership after the asynchronous intent read", async () => {
    const membership = vi
      .fn()
      .mockResolvedValueOnce({ tenantId: "tenant", userId: "alice" })
      .mockRejectedValueOnce(new Error("revoked"));
    const handler = createObservationQueryHandlers({
      authDeps: { resolveMembership: membership },
      loadConfig: () => ({}),
      now: () => 3,
    })[OBSERVATION_QUERY_METHOD];
    expect(
      (await invoke(handler, client(), { ...params, actionIntents: {} } as typeof params)).mock
        .calls[0][0],
    ).toBe(false);
    expect(membership).toHaveBeenCalledTimes(2);
  });
  it("uses trusted membership and preserves unknown provenance", async () => {
    const handler = createObservationQueryHandlers({
      authDeps: { resolveMembership: async () => ({ tenantId: "tenant", userId: "alice" }) },
      loadConfig: () => ({}),
      now: () => 3,
    })[OBSERVATION_QUERY_METHOD];
    const response = await invoke(handler, client());
    expect(response.mock.calls[0][0]).toBe(true);
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({
        caller: { subjectRef: "subject:alice", tenantId: "tenant" },
        projectedAt: 3,
      }),
    );
    expect(response.mock.calls[0][1].samples[0].provenance).toEqual(["unknown"]);
  });
  it("rejects missing identity, read permission, forged fields and bad parameters", async () => {
    const handler = createObservationQueryHandlers({
      authDeps: { resolveMembership: async () => ({ tenantId: "tenant", userId: "alice" }) },
      loadConfig: () => ({}),
    })[OBSERVATION_QUERY_METHOD];
    expect((await invoke(handler, null)).mock.calls[0][0]).toBe(false);
    expect((await invoke(handler, client(["operator.write"]))).mock.calls[0][0]).toBe(false);
    for (const extra of [
      { tenantId: "fake" },
      { subjectRef: "fake" },
      { provenance: "live" },
      { executions: [] },
      { outcomeVersion: 0 },
      { from: "1" },
    ]) {
      expect(
        (await invoke(handler, client(), { ...params, ...extra } as typeof params)).mock
          .calls[0][0],
      ).toBe(false);
    }
  });
  it("validates explicit lookup windows and rejects nested extra parameters", async () => {
    const handler = createObservationQueryHandlers({
      authDeps: { resolveMembership: async () => ({ tenantId: "tenant", userId: "alice" }) },
      loadConfig: () => ({}),
      now: () => 3,
    })[OBSERVATION_QUERY_METHOD];
    expect(
      (
        await invoke(handler, client(), {
          ...params,
          evidenceLookupWindow: { from: 0, to: 3 },
        } as typeof params)
      ).mock.calls[0][0],
    ).toBe(true);
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ evidenceLookupWindow: { from: 0, to: 3 }, from: 1, to: 2 }),
    );
    for (const lookup of [
      null,
      [],
      {},
      { from: 2, to: 3 },
      { from: 0, to: 1 },
      { from: 0, to: 4 },
      { from: -31 * 86400000, to: 3 },
      { from: 0, to: 3, tenantId: "fake" },
      { from: "0", to: 3 },
      { from: NaN, to: 3 },
    ]) {
      expect(
        (
          await invoke(handler, client(), {
            ...params,
            evidenceLookupWindow: lookup,
          } as typeof params)
        ).mock.calls[0][0],
      ).toBe(false);
    }
  });
  it("rechecks membership and fails closed after revocation", async () => {
    const membership = vi
      .fn()
      .mockResolvedValueOnce({ tenantId: "tenant", userId: "alice" })
      .mockRejectedValueOnce(new Error("revoked"));
    const handler = createObservationQueryHandlers({
      authDeps: { resolveMembership: membership },
      loadConfig: () => ({}),
    })[OBSERVATION_QUERY_METHOD];
    expect((await invoke(handler, client())).mock.calls[0][0]).toBe(true);
    expect((await invoke(handler, client())).mock.calls[0][0]).toBe(false);
    expect(membership).toHaveBeenCalledTimes(2);
  });
});
