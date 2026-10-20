/**
 * Probe against a real local HTTP server (not vi.mock of probe internals).
 * Proves wire protocol + credential headers without claiming production upstream.
 * Private/loopback requires explicit ssrfPolicy.allowPrivateNetwork.
 */
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeEnterpriseModelConnection } from "./probe.js";

let server: http.Server;
let baseUrl = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer sk-live-test-")) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid api key" } }));
      return;
    }
    if (req.method === "GET" && (req.url === "/v1/models" || req.url === "/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: [
            { id: "gpt-test-1", object: "model" },
            { id: "gpt-test-2", object: "model" },
          ],
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("failed to bind probe test server");
  }
  baseUrl = `http://127.0.0.1:${addr.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe("probeEnterpriseModelConnection http (local server)", () => {
  it("blocks loopback by default (SSRF fail-closed)", async () => {
    const result = await probeEnterpriseModelConnection({
      providerType: "openai-compatible",
      protocol: "openai-completions",
      baseUrl,
      secret: { apiKey: "sk-live-test-ok" },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("ENTERPRISE_MODEL_FORBIDDEN");
  });

  it("verifies OpenAI-compatible /models when private network is explicitly allowed", async () => {
    const result = await probeEnterpriseModelConnection({
      providerType: "openai-compatible",
      protocol: "openai-completions",
      baseUrl,
      secret: { apiKey: "sk-live-test-ok" },
      ssrfPolicy: { allowPrivateNetwork: true },
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe("OK");
    expect(result.discoveredModels.map((m) => m.upstreamModelId)).toEqual([
      "gpt-test-1",
      "gpt-test-2",
    ]);
  });

  it("classifies invalid credential from real HTTP 401", async () => {
    const result = await probeEnterpriseModelConnection({
      providerType: "openai-compatible",
      protocol: "openai-completions",
      baseUrl,
      secret: { apiKey: "sk-wrong" },
      ssrfPolicy: { allowPrivateNetwork: true },
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("ENTERPRISE_MODEL_INVALID_CREDENTIAL");
  });
});
