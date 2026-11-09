import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  GatewayRequestHandlerOptions,
  GatewayClient,
} from "../gateway/server-methods/types.js";
import { createCapacityReader } from "./capacity-reader.js";
import { createObservationQueryHandlers, OBSERVATION_QUERY_METHOD } from "./query-gateway.js";
const { compare } = vi.hoisted(() => ({
  compare: vi.fn(async (_client: unknown, request: unknown) =>
    request &&
    typeof request === "object" &&
    "baseline" in request &&
    "candidate" in request &&
    Object.keys(request).length === 2
      ? { ok: true, comparison: { status: "blocked", promotionAllowed: false } }
      : { ok: false, code: "invalid_request" },
  ),
}));
vi.mock("./metric-compare-gateway.js", () => ({ createMetricCompareGatewayHelper: () => compare }));
const { intents } = vi.hoisted(() => ({
  intents: vi.fn(async () => ({ ok: true, state: "unknown", items: [], detail: null })),
}));
vi.mock("./action-intent-query.js", () => ({ queryActionIntents: intents }));
const { query } = vi.hoisted(() => ({
  query: vi.fn(() => ({ ok: true, samples: [{ provenance: ["unknown"] }] })),
}));
vi.mock("./query.js", () => ({ queryObservationWithJournal: query }));
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
  it("rechecks membership after an asynchronous base observation read", async () => {
    const membership = vi
      .fn()
      .mockResolvedValueOnce({ tenantId: "tenant", userId: "alice" })
      .mockRejectedValueOnce(new Error("revoked"));
    const handler = createObservationQueryHandlers({
      authDeps: { resolveMembership: membership },
      loadConfig: () => ({}),
      now: () => 3,
    })[OBSERVATION_QUERY_METHOD];
    const response = await invoke(handler, client());
    expect(response.mock.calls[0][0]).toBe(false);
    expect(membership).toHaveBeenCalledTimes(2);
  });

  it("calls comparison only explicitly and rejects injected aggregates", async () => {
    compare.mockClear();
    const handler = createObservationQueryHandlers({
      authDeps: { resolveMembership: async () => ({ tenantId: "tenant", userId: "alice" }) },
      loadConfig: () => ({}),
      now: () => 3,
    })[OBSERVATION_QUERY_METHOD];
    await invoke(handler, client());
    expect(compare).not.toHaveBeenCalled();
    const comparison = {
      baseline: { refs: [], window: { from: 0, to: 1 } },
      candidate: { refs: [], window: { from: 1, to: 2 } },
    };
    const response = await invoke(handler, client(), { ...params, comparison } as typeof params);
    expect(response.mock.calls[0][0]).toBe(true);
    expect(response.mock.calls[0][1].comparison.comparison.promotionAllowed).toBe(false);
    expect(
      (
        await invoke(handler, client(), {
          ...params,
          comparison: { ...comparison, numerator: 100 },
        } as typeof params)
      ).mock.calls[0][0],
    ).toBe(false);
  });
  it("rechecks read permission after comparison before returning any combined data", async () => {
    const c = client();
    const membership = vi.fn().mockImplementation(async () => {
      if (membership.mock.calls.length > 1) {
        c.connect.scopes = ["operator.write"];
      }
      return { tenantId: "tenant", userId: "alice" };
    });
    const handler = createObservationQueryHandlers({
      authDeps: { resolveMembership: membership },
      loadConfig: () => ({}),
      now: () => 3,
    })[OBSERVATION_QUERY_METHOD];
    expect(
      (
        await invoke(handler, c, {
          ...params,
          comparison: { baseline: {}, candidate: {} },
        } as typeof params)
      ).mock.calls[0][0],
    ).toBe(false);
  });
  it("collects capacity only when explicitly true and rejects non-booleans", async () => {
    const capacityReader = vi.fn(createCapacityReader("/tmp/unused-capacity-test"));
    const handler = createObservationQueryHandlers({
      authDeps: { resolveMembership: async () => ({ tenantId: "tenant", userId: "alice" }) },
      loadConfig: () => ({}),
      now: () => 3,
      capacityReader,
    })[OBSERVATION_QUERY_METHOD];
    await invoke(handler, client());
    await invoke(handler, client(), { ...params, capacity: false } as typeof params);
    expect(capacityReader).not.toHaveBeenCalled();
    for (const capacity of [null, "true", 1, {}, []]) {
      expect(
        (await invoke(handler, client(), { ...params, capacity } as typeof params)).mock
          .calls[0][0],
      ).toBe(false);
    }
  });
  it("returns real missing/corrupt capacity sources and rejects cross-tenant access and revocation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "capacity-gateway-"));
    try {
      const agentDir = path.join(root, "agent");
      await fs.mkdir(path.join(agentDir, "task-outcomes/tips"), { recursive: true });
      await fs.mkdir(path.join(agentDir, "task-outcomes/versions"));
      const row = {
        taskId: "task",
        outcomeVersion: 1,
        scope: {
          kind: "enterprise",
          tenantId: "tenant",
          enterpriseDomainId: "domain",
          subjectRef: "subject:alice",
          authzScopeRef: "auth",
        },
        lifecycle: "closed",
        taskJudgement: "success",
        decidedAt: "2026-11-06T00:00:00Z",
        acceptance: { status: "passed" },
        delivery: { status: "delivered" },
        runs: [],
        attempts: [],
      };
      for (const name of ["tips/task.json", "versions/task__v1.json"]) {
        await fs.writeFile(path.join(agentDir, "task-outcomes", name), JSON.stringify(row));
      }
      const config = { agents: { list: [{ id: "bot", agentDir }] } };
      const options = {
        authDeps: { resolveMembership: async () => ({ tenantId: "tenant", userId: "alice" }) },
        loadConfig: () => config,
        now: () => 3,
        capacityReader: createCapacityReader(root),
      };
      const handler = createObservationQueryHandlers(options)[OBSERVATION_QUERY_METHOD];
      const request = { ...params, capacity: true } as typeof params;
      let response = await invoke(handler, client(), request);
      expect(response.mock.calls[0][0]).toBe(true);
      expect(response.mock.calls[0][1].capacity.sources.registry.state).toBe("missing");
      expect(response.mock.calls[0][1].capacity.snapshot.concurrency.remaining).toBeNull();
      await fs.writeFile(path.join(root, "openbot-agent-run-registry.json"), "{");
      response = await invoke(handler, client(), request);
      expect(response.mock.calls[0][1].capacity.sources.registry.state).toBe("corrupt");
      const foreign = createObservationQueryHandlers({
        ...options,
        authDeps: { resolveMembership: async () => ({ tenantId: "other", userId: "alice" }) },
      })[OBSERVATION_QUERY_METHOD];
      expect((await invoke(foreign, client(), request)).mock.calls[0][0]).toBe(false);
      const membership = vi
        .fn()
        .mockResolvedValueOnce({ tenantId: "tenant", userId: "alice" })
        .mockRejectedValueOnce(new Error("revoked"));
      const revoked = createObservationQueryHandlers({
        ...options,
        authDeps: { resolveMembership: membership },
      })[OBSERVATION_QUERY_METHOD];
      expect((await invoke(revoked, client(), request)).mock.calls[0][0]).toBe(false);
      expect(membership).toHaveBeenCalledTimes(2);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
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
      .mockResolvedValueOnce({ tenantId: "tenant", userId: "alice" })
      .mockRejectedValueOnce(new Error("revoked"));
    const handler = createObservationQueryHandlers({
      authDeps: { resolveMembership: membership },
      loadConfig: () => ({}),
    })[OBSERVATION_QUERY_METHOD];
    expect((await invoke(handler, client())).mock.calls[0][0]).toBe(true);
    expect((await invoke(handler, client())).mock.calls[0][0]).toBe(false);
    expect(membership).toHaveBeenCalledTimes(3);
  });
});

describe("explicit reasoning side pass on actual observation handler", () => {
  const sample = {
    sampleId: "sample",
    provenance: ["unknown"],
    evidence: {
      resource: "unknown",
      technical: "unknown",
      execution: "partial",
      business: "present",
    },
    evidenceReasons: {
      resource: ["missing"],
      technical: ["missing"],
      execution: ["missing_attempt"],
      business: [],
    },
    outcome: { taskId: "task", outcomeVersion: 1, taskJudgement: "incomplete" },
    body: "secret",
  };
  it("defaults closed and leaves the ordinary query unchanged", async () => {
    query.mockReturnValueOnce({ ok: true, samples: [sample] });
    const model = vi.fn();
    const handler = createObservationQueryHandlers({
      loadConfig: () => ({}),
      now: () => 3,
      authDeps: { resolveMembership: async () => ({ tenantId: "tenant", userId: "alice" }) },
      reasoning: { model, modelRef: "trusted" },
    })[OBSERVATION_QUERY_METHOD];
    const r = await invoke(handler, client(), {
      ...params,
      reasoning: { requested: true },
    } as typeof params);
    expect(r.mock.calls[0][1].reasoningPass.reason).toBe("reasoning_disabled");
    expect(model).not.toHaveBeenCalled();
  });
  it("uses only authorized metadata and preserves business judgement", async () => {
    query.mockReturnValueOnce({ ok: true, samples: [sample] });
    const model = vi.fn(async () => ({
      schemaVersion: 1,
      items: [
        {
          id: "hyp",
          kind: "hypothesis",
          text: "Possible gap",
          evidenceIds: ["sample:execution"],
          source: "reasoning",
          modelRef: "trusted",
        },
      ],
    }));
    const handler = createObservationQueryHandlers({
      loadConfig: () => ({}),
      now: () => 3,
      authDeps: { resolveMembership: async () => ({ tenantId: "tenant", userId: "alice" }) },
      reasoning: { enabled: true, model, modelRef: "trusted" },
    })[OBSERVATION_QUERY_METHOD];
    const r = await invoke(handler, client(), {
      ...params,
      reasoning: { requested: true },
    } as typeof params);
    expect(r.mock.calls[0][0]).toBe(true);
    expect(r.mock.calls[0][1].reasoningPass.reason).toBe("hypotheses_only");
    expect(r.mock.calls[0][1].samples[0].outcome.taskJudgement).toBe("incomplete");
    expect(JSON.stringify(model.mock.calls)).not.toContain("secret");
  });
  it("falls back unconfigured and rejects client model selection", async () => {
    query.mockReturnValueOnce({ ok: true, samples: [sample] });
    const handler = createObservationQueryHandlers({
      loadConfig: () => ({}),
      now: () => 3,
      authDeps: { resolveMembership: async () => ({ tenantId: "tenant", userId: "alice" }) },
      reasoning: { enabled: true },
    })[OBSERVATION_QUERY_METHOD];
    const r = await invoke(handler, client(), {
      ...params,
      reasoning: { requested: true },
    } as typeof params);
    expect(r.mock.calls[0][1].reasoningPass.reason).toBe("reasoning_unconfigured");
    const bad = await invoke(handler, client(), {
      ...params,
      reasoning: { requested: true, modelRef: "forged" },
    } as typeof params);
    expect(bad.mock.calls[0][0]).toBe(false);
  });
  it("discards combined response when scope is revoked during the model call", async () => {
    query.mockReturnValueOnce({ ok: true, samples: [sample] });
    const c = client();
    const handler = createObservationQueryHandlers({
      loadConfig: () => ({}),
      now: () => 3,
      authDeps: { resolveMembership: async () => ({ tenantId: "tenant", userId: "alice" }) },
      reasoning: {
        enabled: true,
        modelRef: "trusted",
        model: async () => {
          c.connect.scopes = [];
          return { schemaVersion: 1, items: [] };
        },
      },
    })[OBSERVATION_QUERY_METHOD];
    const r = await invoke(handler, c, {
      ...params,
      reasoning: { requested: true },
    } as typeof params);
    expect(r.mock.calls[0][0]).toBe(false);
    expect(r.mock.calls[0][1]).toBeUndefined();
  });
});
