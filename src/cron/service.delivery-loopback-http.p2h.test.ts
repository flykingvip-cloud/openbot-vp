/**
 * P2-H loopback HTTP channel-adapter delivery evidence (labeled network mock).
 *
 * Proves: deliverOutboundPayloads → channel send dep → real HTTP POST to a local
 * test server, and the server observes the body. This is NOT a production Live
 * webhook / Telegram / Slack claim (SSRF guard still blocks private webhook URLs
 * on the cron webhook path). Strongest feasible without claiming fake live.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";

describe("P2-H loopback HTTP channel adapter delivery (labeled, not live prod)", () => {
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

  it("deliverOutboundPayloads posts real HTTP to loopback receiver via send dep", async () => {
    const received: Array<{ method?: string; url?: string; body: string }> = [];
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        received.push({
          method: req.method,
          url: req.url,
          body: Buffer.concat(chunks).toString("utf8"),
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const target = `http://127.0.0.1:${port}/channel-deliver`;

    const sendTelegram = async (to: string, text: string) => {
      const response = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "telegram",
          to,
          text,
          labeled: "loopback-http-mock-not-production-live",
        }),
      });
      if (!response.ok) {
        throw new Error(`loopback deliver failed: ${response.status}`);
      }
      return { messageId: "loopback-1", chatId: to };
    };

    const results = await deliverOutboundPayloads({
      cfg: { channels: { telegram: { botToken: "test-token" } } } as never,
      channel: "telegram",
      to: "chat:loopback",
      payloads: [{ text: "p2h-loopback-delivery-proof" }],
      deps: { sendTelegram },
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(received).toHaveLength(1);
    expect(received[0]?.method).toBe("POST");
    expect(received[0]?.url).toBe("/channel-deliver");
    const body = JSON.parse(received[0].body) as {
      channel: string;
      text: string;
      labeled: string;
    };
    expect(body.channel).toBe("telegram");
    expect(body.text).toContain("p2h-loopback-delivery-proof");
    expect(body.labeled).toBe("loopback-http-mock-not-production-live");
  });
});
