import { describe, expect, it, vi } from "vitest";
import { OpenBotToolsInvokeClient } from "./tools-invoke.js";

describe("OpenBotToolsInvokeClient", () => {
  it("POSTs to /tools/invoke with tool name and args", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { status: "ok", output: ["done"] } }),
    }));
    const client = new OpenBotToolsInvokeClient({
      baseUrl: "http://127.0.0.1:18789",
      apiKey: "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const res = await client.invoke({
      tool: "lobster",
      args: { action: "run", pipeline: "/tmp/demo.lobster" },
      sessionKey: "main",
    });

    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toBe("http://127.0.0.1:18789/tools/invoke");
    const init = calls[0][1];
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
    const body = JSON.parse(String(init.body));
    expect(body.tool).toBe("lobster");
    expect(body.args.pipeline).toBe("/tmp/demo.lobster");
  });
});
