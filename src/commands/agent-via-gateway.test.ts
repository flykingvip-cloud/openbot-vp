import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(),
  randomIdempotencyKey: () => "idem-1",
}));
vi.mock("./agent.js", () => ({
  agentCommand: vi.fn(),
}));

import type { OpenBotConfig } from "../config/config.js";
import * as configModule from "../config/config.js";
import { callGateway } from "../gateway/call.js";
import type { RuntimeEnv } from "../runtime.js";
import { agentCliCommand } from "./agent-via-gateway.js";
import { agentCommand } from "./agent.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

const configSpy = vi.spyOn(configModule, "loadConfig");

function mockConfig(storePath: string, overrides?: Partial<OpenBotConfig>) {
  configSpy.mockReturnValue({
    agents: {
      defaults: {
        timeoutSeconds: 600,
        ...overrides?.agents?.defaults,
      },
    },
    session: {
      store: storePath,
      mainKey: "main",
      ...overrides?.session,
    },
    gateway: overrides?.gateway,
  });
}

async function withTempStore(
  fn: (ctx: { dir: string; store: string }) => Promise<void>,
  overrides?: Partial<OpenBotConfig>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-agent-cli-"));
  const store = path.join(dir, "sessions.json");
  mockConfig(store, overrides);
  try {
    await fn({ dir, store });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function mockGatewaySuccessReply(text = "hello") {
  vi.mocked(callGateway).mockResolvedValue({
    runId: "idem-1",
    status: "ok",
    result: {
      payloads: [{ text }],
      meta: { stub: true },
    },
  });
}

function mockLocalAgentReply(text = "local") {
  vi.mocked(agentCommand).mockImplementationOnce(async (_opts, rt) => {
    rt?.log?.(text);
    return {
      payloads: [{ text }],
      meta: { durationMs: 1, agentMeta: { sessionId: "s", provider: "p", model: "m" } },
    } as unknown as Awaited<ReturnType<typeof agentCommand>>;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agentCliCommand", () => {
  it("uses a timer-safe max gateway timeout when --timeout is 0", async () => {
    await withTempStore(async () => {
      mockGatewaySuccessReply();

      await agentCliCommand({ message: "hi", to: "+1555", timeout: "0" }, runtime);

      expect(callGateway).toHaveBeenCalledTimes(1);
      const request = vi.mocked(callGateway).mock.calls[0]?.[0] as { timeoutMs?: number };
      expect(request.timeoutMs).toBe(2_147_000_000);
    });
  });

  it("uses gateway by default", async () => {
    await withTempStore(async () => {
      mockGatewaySuccessReply();

      const result = (await agentCliCommand({ message: "hi", to: "+1555" }, runtime)) as {
        result?: { meta?: { executionChainProvenance?: Array<Record<string, unknown>> } };
      };

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(agentCommand).not.toHaveBeenCalled();
      expect(runtime.log).toHaveBeenCalledWith("hello");
      expect(result.result?.meta?.executionChainProvenance?.[0]).toMatchObject({
        kind: "gateway_fallback",
        initial_path: "gateway",
        fallback: { attempted: false, owner: "agent-cli", target: "none", retry_count: 0 },
        terminal_path: "gateway",
      });
    });
  });

  it("falls back to embedded agent when gateway fails", async () => {
    await withTempStore(async () => {
      vi.mocked(callGateway).mockRejectedValue(new Error("gateway not connected"));
      mockLocalAgentReply();

      const result = (await agentCliCommand({ message: "hi", to: "+1555" }, runtime)) as {
        meta?: { executionChainProvenance?: Array<Record<string, unknown>> };
      };

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(runtime.log).toHaveBeenCalledWith("local");
      expect(runtime.error).toHaveBeenCalledWith(
        expect.stringContaining('{"kind":"gateway_fallback"'),
      );
      expect(result.meta?.executionChainProvenance?.[0]).toMatchObject({
        kind: "gateway_fallback",
        initial_path: "gateway",
        initial_failure: { class: "gateway_unavailable" },
        fallback: {
          attempted: true,
          owner: "agent-cli",
          target: "embedded-agent",
          retry_count: 1,
        },
        terminal_path: "embedded",
        tenant_fail_closed_unchanged: true,
      });
    });
  });

  it("records tenant_context_unresolved provenance without changing fail-closed semantics", async () => {
    await withTempStore(async () => {
      vi.mocked(callGateway).mockRejectedValue(
        new Error(
          "GatewayClientRequestError: TenantContextError: tenant context required but the session has none: code=unresolved_tenant",
        ),
      );
      mockLocalAgentReply();

      const result = (await agentCliCommand(
        { message: "hi", agent: undefined, sessionId: "audit-1", to: "+1555" },
        runtime,
      )) as {
        meta?: { executionChainProvenance?: Array<Record<string, unknown>> };
      };

      expect(callGateway).toHaveBeenCalledTimes(1);
      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(result.meta?.executionChainProvenance?.[0]).toMatchObject({
        kind: "gateway_fallback",
        initial_path: "gateway",
        initial_failure: {
          class: "tenant_context_unresolved",
          code: "unresolved_tenant",
        },
        fallback: { attempted: true, owner: "agent-cli", target: "embedded-agent", retry_count: 1 },
        context_preserved: { session_id: "audit-1" },
        terminal_path: "embedded",
        tenant_fail_closed_unchanged: true,
      });
    });
  });

  it("skips gateway when --local is set", async () => {
    await withTempStore(async () => {
      mockLocalAgentReply();

      await agentCliCommand(
        {
          message: "hi",
          to: "+1555",
          local: true,
        },
        runtime,
      );

      expect(callGateway).not.toHaveBeenCalled();
      expect(agentCommand).toHaveBeenCalledTimes(1);
      expect(runtime.log).toHaveBeenCalledWith("local");
    });
  });

  it("stamps entry E3 on both embedded paths (--local and the gateway-failure fallback)", async () => {
    await withTempStore(async () => {
      mockLocalAgentReply();
      await agentCliCommand({ message: "hi", to: "+1555", local: true }, runtime);

      vi.mocked(callGateway).mockRejectedValue(new Error("gateway not connected"));
      mockLocalAgentReply();
      await agentCliCommand({ message: "hi", to: "+1555" }, runtime);

      expect(agentCommand).toHaveBeenCalledTimes(2);
      expect(vi.mocked(agentCommand).mock.calls.map(([opts]) => opts.governanceEntry)).toEqual([
        "E3",
        "E3",
      ]);
    });
  });
});
