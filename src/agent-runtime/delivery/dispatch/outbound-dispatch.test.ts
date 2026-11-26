import { describe, expect, it, vi } from "vitest";
import { dispatchOutboundDelivery, isTransientOutboundDeliveryError } from "../index.js";

describe("isTransientOutboundDeliveryError", () => {
  it("classifies transient network/gateway errors as retryable", () => {
    expect(isTransientOutboundDeliveryError(new Error("gateway timeout"))).toBe(true);
    expect(isTransientOutboundDeliveryError(new Error("ECONNRESET"))).toBe(true);
  });

  it("never retries permanent channel/recipient errors", () => {
    expect(isTransientOutboundDeliveryError(new Error("unsupported channel: foo"))).toBe(false);
    expect(isTransientOutboundDeliveryError(new Error("chat not found"))).toBe(false);
  });
});

describe("dispatchOutboundDelivery", () => {
  it("returns confirmed message ids and lastMessageId on success", async () => {
    const deliver = vi.fn(async () => [
      { channel: "telegram", messageId: "msg-1" },
      { channel: "telegram", messageId: "msg-2" },
    ]);
    const result = await dispatchOutboundDelivery({
      deliver: deliver as never,
      cfg: {} as never,
      channel: "telegram",
      to: "123",
      payloads: [{ text: "hello" }],
    });
    expect(result.confirmedMessageIds).toEqual(["msg-1", "msg-2"]);
    expect(result.lastMessageId).toBe("msg-2");
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("treats unknown placeholder messageIds as unconfirmed", async () => {
    const deliver = vi.fn(async () => [{ channel: "telegram", messageId: "unknown" }]);
    const result = await dispatchOutboundDelivery({
      deliver: deliver as never,
      cfg: {} as never,
      channel: "telegram",
      to: "123",
      payloads: [{ text: "hello" }],
    });
    expect(result.confirmedMessageIds).toBeUndefined();
    expect(result.lastMessageId).toBe("unknown");
  });

  it("retries transient errors when retryTransient is enabled", async () => {
    const deliver = vi
      .fn()
      .mockRejectedValueOnce(new Error("gateway timeout"))
      .mockResolvedValueOnce([{ channel: "telegram", messageId: "msg-ok" }]);
    const onRetry = vi.fn();
    const result = await dispatchOutboundDelivery({
      deliver: deliver as never,
      cfg: {} as never,
      channel: "telegram",
      to: "123",
      payloads: [{ text: "hello" }],
      retryTransient: true,
      retryDelaysMs: [1, 2],
      onRetry,
    });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(result.confirmedMessageIds).toEqual(["msg-ok"]);
  });
});
