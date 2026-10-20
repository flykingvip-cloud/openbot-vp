import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeGatewayRpcTransport, USAGE_INGEST_REPORT_METHOD } from "@openbot/aor-backend-openbot";
import type {
  BackendCapability,
  BackendEvent,
  BackendRunResult,
  ExecutionBackend,
  PlannedStep,
  RunHandle,
} from "@openbot/aor-core";
import {
  defaultModelCatalog,
  createPersistentBanditFeedbackStore,
  readBanditPersistedState,
} from "@openbot/aor-core";
import { describe, expect, it, vi } from "vitest";
import { AorClient, createGatewayRpcClient, resolveToolsHttpBaseUrl } from "./client.js";

class StubBackend implements ExecutionBackend {
  readonly id = "stub";
  seenModelIds: string[] = [];
  constructor(private readonly text: string) {}
  capabilities(): Promise<BackendCapability> {
    return Promise.resolve({ models: defaultModelCatalog().map((m) => m.ref) });
  }
  run(step: PlannedStep): Promise<RunHandle> {
    this.seenModelIds.push(step.model.id);
    return Promise.resolve({ runId: "1" });
  }
  async *stream(): AsyncIterable<BackendEvent> {
    yield { kind: "lifecycle", phase: "end" };
  }
  wait(): Promise<BackendRunResult> {
    return Promise.resolve({
      text: this.text,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.005 },
    });
  }
  abort(): Promise<void> {
    return Promise.resolve();
  }
}

describe("AorClient", () => {
  it("runs a code review end to end", async () => {
    const backend = new StubBackend("- bug: x\n- suggest: y\n- fix: z");
    const client = new AorClient({ backend });
    const result = await client
      .agent({ goal: "review this repository and suggest improvements" })
      .run({ strategy: "best_quality" });

    expect(result.taskType).toBe("coding.review");
    expect(result.selection.model.id).toBe("claude-opus-4-6");
    expect(result.evaluation?.score).toBeGreaterThan(0.6);
  });

  it("honors the cheapest strategy", async () => {
    const backend = new StubBackend("a concise summary");
    const client = new AorClient({ backend });
    const result = await client
      .agent({ goal: "summarize this text" })
      .run({ strategy: "cheapest", referenceInput: "x".repeat(500) });

    expect(result.taskType).toBe("summarization");
    expect(result.selection.model.id).toBe("gpt-5.4-mini");
  });

  it("reports billing via usage-ingest.report when reportBilling is set", async () => {
    const transport = new FakeGatewayRpcTransport({
      [USAGE_INGEST_REPORT_METHOD]: () => ({ recorded: true }),
    });
    const backend = new StubBackend("ok");
    const client = new AorClient({ backend, billingTransport: transport });
    await client
      .agent({ goal: "summarize this" })
      .run({ reportBilling: true, billingRunId: "run-x" });
    expect(transport.calls.some((c) => c.method === USAGE_INGEST_REPORT_METHOD)).toBe(true);
  });

  it("forwards agentId into usage-ingest payloads via tenant", async () => {
    const transport = new FakeGatewayRpcTransport({
      [USAGE_INGEST_REPORT_METHOD]: () => ({ recorded: true }),
    });
    const backend = new StubBackend("ok");
    const client = new AorClient({
      backend,
      billingTransport: transport,
      defaultAgentId: "bot-aor",
    });
    await client.agent({ goal: "summarize this" }).run({
      reportBilling: true,
      billingRunId: "run-agent",
      tenant: { userId: "user-1", tenantId: "ent-1" },
    });
    const ingestCalls = transport.calls.filter((c) => c.method === USAGE_INGEST_REPORT_METHOD);
    expect(ingestCalls.length).toBeGreaterThan(0);
    expect(ingestCalls.every((c) => (c.params as { agentId?: string }).agentId === "bot-aor")).toBe(
      true,
    );
  });

  it("persists bandit arms when feedback uses PersistentBanditFeedbackStore", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aor-client-bandit-"));
    const statePath = join(dir, "bandit.json");
    try {
      const backend = new StubBackend("- bug: x\n- suggest: y\n- fix: z");
      const client = new AorClient({
        backend,
        feedback: createPersistentBanditFeedbackStore(statePath),
        defaultStrategy: "bandit",
      });
      await client.agent({ goal: "review repo", type: "coding.review" }).run();
      const state = readBanditPersistedState(statePath);
      expect(state?.arms && Object.keys(state.arms).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("createGatewayRpcClient prefixes auto session key with tenantId", async () => {
    const transport = new FakeGatewayRpcTransport({
      "sessions.patch": () => ({}),
      agent: () => ({ runId: "r1" }),
      "agent.wait": () => ({ status: "ok" }),
      "chat.history": () => ({
        messages: [{ role: "assistant", content: "rpc ok" }],
      }),
    });
    const client = createGatewayRpcClient(transport);
    await client.agent({ goal: "summarize this text" }).run({
      tenant: { tenantId: "acme", userId: "u1" },
      runId: "run-fixed",
    });
    const patch = transport.calls.find((c) => c.method === "sessions.patch");
    expect(patch?.params).toMatchObject({ key: "acme:aor:run-fixed" });
  });

  it("createGatewayRpcClient uses the Gateway RPC agent path", async () => {
    const transport = new FakeGatewayRpcTransport({
      "sessions.patch": () => ({}),
      agent: () => ({ runId: "r1" }),
      "agent.wait": () => ({ status: "ok" }),
      "chat.history": () => ({
        messages: [{ role: "assistant", content: "rpc ok" }],
      }),
    });
    const client = createGatewayRpcClient(transport);
    const result = await client
      .agent({ goal: "summarize this text" })
      .run({ strategy: "cheapest" });
    expect(result.output.text).toBe("rpc ok");
    expect(transport.calls.some((c) => c.method === "agent")).toBe(true);
  });

  it("resolveToolsHttpBaseUrl ignores non-HTTP baseUrl (e.g. legacy rpc:// placeholder)", () => {
    expect(resolveToolsHttpBaseUrl({ baseUrl: "rpc://openbot-gateway" })).toBe(
      "http://127.0.0.1:18789",
    );
    expect(
      resolveToolsHttpBaseUrl({
        baseUrl: "rpc://openbot-gateway",
        toolsBaseUrl: "http://gateway.test:9999",
      }),
    ).toBe("http://gateway.test:9999");
  });

  it("createGatewayRpcClient runs lobster.pipeline via HTTP /tools/invoke", async () => {
    const transport = new FakeGatewayRpcTransport({});
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: { ok: true, status: "ok", output: ["lobster step done"] },
      }),
    }));
    const client = createGatewayRpcClient(transport, {
      toolsBaseUrl: "http://127.0.0.1:18789",
      toolsFetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client
      .agent({
        goal: "run triage pipeline",
        type: "lobster.pipeline",
        params: { pipeline: "triage.lobster" },
      })
      .run();

    expect(result.taskType).toBe("lobster.pipeline");
    expect(result.output.text).toContain("lobster step done");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toBe("http://127.0.0.1:18789/tools/invoke");
    const body = JSON.parse(String(calls[0][1].body));
    expect(body.tool).toBe("lobster");
    expect(body.args.pipeline).toBe("triage.lobster");
    expect(transport.calls.some((c) => c.method === "agent")).toBe(false);
  });

  it("createGatewayRpcClient runs plugin.tool via HTTP /tools/invoke by default", async () => {
    const transport = new FakeGatewayRpcTransport({});
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: "sessions listed" }),
    }));
    const client = createGatewayRpcClient(transport, {
      toolsFetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await client
      .agent({
        goal: "list sessions",
        type: "plugin.tool",
        params: { toolName: "sessions_list", toolAction: "json" },
      })
      .run();

    expect(result.output.text).toBe("sessions listed");
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toBe("http://127.0.0.1:18789/tools/invoke");
    expect(transport.calls).toHaveLength(0);
  });
});
