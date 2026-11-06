import { describe, expect, it, vi } from "vitest";
import type {
  GatewayRequestHandlerOptions,
  GatewayClient,
} from "../gateway/server-methods/types.js";
import { createObservationQueryHandlers, OBSERVATION_QUERY_METHOD } from "./query-gateway.js";
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
