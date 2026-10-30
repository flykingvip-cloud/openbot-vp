/**
 * P2-H loopback HTTP channel-adapter delivery evidence (labeled network mock).
 *
 * Proves: deliverOutboundPayloads → channel send dep → real HTTP POST to a local
 * test server (or undici MockAgent when bind is forbidden), and the receiver
 * observes the body. This is NOT a production Live webhook / Telegram / Slack
 * claim (SSRF guard still blocks private webhook URLs on the cron webhook path).
 * Strongest feasible without claiming fake live.
 *
 * Listen uses once('error') + timeout; EPERM/EACCES falls back to MockAgent so
 * the suite never hangs and never silently claims pass on a stuck listen.
 */
import { afterEach, describe, expect, it } from "vitest";
import { deliverOutboundPayloads } from "../infra/outbound/deliver.js";
import {
  startLoopbackHttpReceiver,
  type LoopbackHttpReceiver,
} from "../test-utils/loopback-http-receiver.js";

describe("P2-H loopback HTTP channel adapter delivery (labeled; MockAgent≠Live TCP)", () => {
  let receiver: LoopbackHttpReceiver | null = null;

  afterEach(async () => {
    if (!receiver) {
      return;
    }
    const closing = receiver;
    receiver = null;
    await closing.close();
  });

  it("deliverOutboundPayloads posts HTTP via send dep (mode=listen|mock-agent fallback; not Live)", async () => {
    receiver = await startLoopbackHttpReceiver({
      responseJson: { ok: true },
    });
    const target = `${receiver.baseUrl}/channel-deliver`;

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
    expect(["listen", "mock-agent"]).toContain(receiver.mode);
    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0]?.method).toBe("POST");
    expect(receiver.received[0]?.url).toBe("/channel-deliver");
    const body = JSON.parse(receiver.received[0].body) as {
      channel: string;
      text: string;
      labeled: string;
    };
    expect(body.channel).toBe("telegram");
    expect(body.text).toContain("p2h-loopback-delivery-proof");
    expect(body.labeled).toBe("loopback-http-mock-not-production-live");
  });

  it("mode=mock-agent: dispatch→HTTP when listen forced off (not Live TCP)", async () => {
    receiver = await startLoopbackHttpReceiver({
      forceMockAgent: true,
      responseJson: { ok: true },
    });
    expect(receiver.mode).toBe("mock-agent");
    const target = `${receiver.baseUrl}/channel-deliver`;

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
      return { messageId: "loopback-mock-1", chatId: to };
    };

    const results = await deliverOutboundPayloads({
      cfg: { channels: { telegram: { botToken: "test-token" } } } as never,
      channel: "telegram",
      to: "chat:loopback-mock",
      payloads: [{ text: "p2h-mock-agent-delivery-proof" }],
      deps: { sendTelegram },
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(receiver.received).toHaveLength(1);
    const body = JSON.parse(receiver.received[0].body) as { text: string };
    expect(body.text).toContain("p2h-mock-agent-delivery-proof");
  });
});
