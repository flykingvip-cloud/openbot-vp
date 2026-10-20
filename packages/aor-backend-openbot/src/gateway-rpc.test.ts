import { describe, expect, it } from "vitest";
import { FakeGatewayRpcTransport, OpenBotGatewayRpcClient } from "./gateway-rpc.js";

describe("OpenBotGatewayRpcClient", () => {
  it("forwards modelFallbacks on a single agent RPC (native OpenBot chain)", async () => {
    const transport = new FakeGatewayRpcTransport({
      "sessions.patch": () => ({}),
      agent: () => ({ runId: "run-native" }),
      "agent.wait": () => ({ status: "ok" }),
      "chat.history": () => ({
        messages: [{ role: "assistant", content: "native fallback path" }],
      }),
    });

    const client = new OpenBotGatewayRpcClient({ transport });
    const res = await client.chat({
      model: { provider: "openai", id: "gpt-5.4" },
      fallbackModels: [{ provider: "anthropic", id: "claude-opus-4-6" }],
      prompt: "hello",
      sessionKey: "sess-native",
    });

    expect(res.text).toBe("native fallback path");
    const agentCalls = client.callLog.filter((c) => c.method === "agent");
    expect(agentCalls).toHaveLength(1);
    expect(agentCalls[0]?.params).toMatchObject({
      modelFallbacks: ["anthropic/claude-opus-4-6"],
    });
    const patchCalls = client.callLog.filter((c) => c.method === "sessions.patch");
    expect(patchCalls).toHaveLength(1);
  });

  it("throws when agent.wait returns error", async () => {
    const transport = new FakeGatewayRpcTransport({
      "sessions.patch": () => ({}),
      agent: () => ({ runId: "r1" }),
      "agent.wait": () => ({ status: "error", error: "down" }),
      "chat.history": () => ({ messages: [] }),
    });
    const client = new OpenBotGatewayRpcClient({ transport });
    await expect(
      client.chat({
        model: { provider: "openai", id: "gpt-5.4" },
        prompt: "x",
      }),
    ).rejects.toThrow(/down/);
  });
});
