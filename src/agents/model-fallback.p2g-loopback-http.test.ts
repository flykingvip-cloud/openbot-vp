/**
 * P2-G labeled loopback HTTP: AOR preferred order drives the first outbound call,
 * and that call performs a real HTTP POST to a local stub server.
 * Not a claim of production Live provider / public network.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/types.js";
import { selectModelOrderWithinEffectiveSet } from "../gateway/model-entitlement/aor-selection.js";
import { runWithModelFallback } from "./model-fallback.js";

describe("P2-G selection→outbound loopback HTTP (labeled network mock)", () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (!server) {
      return;
    }
    const closing = server;
    server = null;
    await new Promise<void>((resolve, reject) =>
      closing.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("cheapest primary hits loopback provider stub first", async () => {
    const hits: string[] = [];
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(Buffer.from(c)));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        hits.push(`${req.method} ${req.url} ${body}`);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, labeled: "loopback-provider-mock" }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;

    const catalog = [
      {
        ref: { provider: "loopback-proxy", id: "cheap" },
        cost: { inputPerMtok: 0.1, outputPerMtok: 0.2 },
        taskTypeScores: { coding: 0.4 },
      },
      {
        ref: { provider: "loopback-proxy", id: "premium" },
        cost: { inputPerMtok: 10, outputPerMtok: 20 },
        taskTypeScores: { coding: 0.95 },
      },
    ];
    const effective = ["loopback-proxy/premium", "loopback-proxy/cheap"];
    const selection = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: effective,
      aorExecution: {
        taskTypeId: "default",
        selectorStrategy: "cheapest",
        evaluatorMode: "content",
      },
      catalog,
    });
    expect(selection.orderedModelIds[0]).toBe("loopback-proxy/cheap");

    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "loopback-proxy/premium",
            fallbacks: ["loopback-proxy/cheap"],
          },
        },
      },
      models: {
        providers: {
          "loopback-proxy": {
            baseUrl: base,
            api: "openai-completions",
            models: [{ id: "cheap" }, { id: "premium" }],
          },
        },
      },
    } as unknown as OpenBotConfig;

    const calls: string[] = [];
    const result = await runWithModelFallback({
      cfg,
      provider: "loopback-proxy",
      model: "premium",
      preferredModelOrder: selection.orderedModelIds,
      run: async (provider, model) => {
        calls.push(`${provider}/${model}`);
        const response = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            provider,
            labeled: "loopback-provider-mock-not-production-live",
          }),
        });
        if (!response.ok) {
          throw new Error(`stub ${response.status}`);
        }
        return { provider, model, text: "ok" };
      },
    });

    expect(calls[0]).toBe("loopback-proxy/cheap");
    expect(result.result.provider).toBe("loopback-proxy");
    expect(result.result.model).toBe("cheap");
    expect(hits.some((h) => h.includes("cheap") && h.includes("POST"))).toBe(true);
  });
});
