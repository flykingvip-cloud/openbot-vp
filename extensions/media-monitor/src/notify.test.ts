import { beforeEach, describe, expect, it, vi } from "vitest";

const deliverOutboundPayloads = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/media-monitor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/media-monitor")>();
  return {
    ...actual,
    deliverOutboundPayloads,
  };
});

import { sendOutboxNotification } from "./notify.js";
import type { NotificationOutboxRow } from "./types.js";

function sampleRow(overrides: Partial<NotificationOutboxRow> = {}): NotificationOutboxRow {
  return {
    id: "out_1",
    eventId: "evt_1",
    targetId: "tgt_1",
    tenantId: "default",
    agentId: "main",
    channel: "wecom",
    destination: "user_abc",
    status: "pending",
    attempts: 0,
    nextAttemptAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    body: "media-monitor: new content",
    ...overrides,
  };
}

describe("media-monitor notify", () => {
  beforeEach(() => {
    deliverOutboundPayloads.mockReset();
    deliverOutboundPayloads.mockResolvedValue([{ messageId: "m1" }]);
  });

  it("uses runtime helper when available", async () => {
    const sendMessageTelegram = vi.fn().mockResolvedValue({ ok: true });
    const result = await sendOutboxNotification({
      api: {
        runtime: { channel: { telegram: { sendMessageTelegram } } },
        config: {},
      } as never,
      row: sampleRow({ channel: "telegram", destination: "@chat" }),
    });
    expect(result).toEqual({ ok: true });
    expect(sendMessageTelegram).toHaveBeenCalledWith("@chat", "media-monitor: new content", {});
    expect(deliverOutboundPayloads).not.toHaveBeenCalled();
  });

  it("falls back to deliverOutboundPayloads for wecom", async () => {
    const cfg = { channels: { wecom: { enabled: true } } };
    const result = await sendOutboxNotification({
      api: {
        runtime: { channel: {} },
        config: cfg,
      } as never,
      row: sampleRow(),
    });
    expect(result).toEqual({ ok: true });
    expect(deliverOutboundPayloads).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg,
        channel: "wecom",
        to: "user_abc",
        payloads: [{ text: "media-monitor: new content" }],
        skipQueue: true,
      }),
    );
  });

  it("fails when neither runtime helper nor config is available", async () => {
    const result = await sendOutboxNotification({
      api: {
        runtime: { channel: {} },
      } as never,
      row: sampleRow(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/config unavailable|runtime unavailable/i);
    }
  });
});
