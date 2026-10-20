import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({ gateway: { trustedProxies: ["127.0.0.1"] } })),
}));

import { resolveClientIpFromRequest } from "./client-ip.js";

function request(headers: Record<string, string>, remoteAddress: string): IncomingMessage {
  return { headers, socket: { remoteAddress } } as IncomingMessage;
}

describe("resolveClientIpFromRequest", () => {
  it("ignores spoofed forwarded headers from an untrusted socket", () => {
    expect(
      resolveClientIpFromRequest(
        request({ "x-forwarded-for": "10.1.1.8", "x-real-ip": "10.1.1.8" }, "203.0.113.9"),
      ),
    ).toBe("203.0.113.9");
  });

  it("uses the forwarded client when the socket is a trusted proxy", () => {
    expect(
      resolveClientIpFromRequest(
        request({ "x-forwarded-for": "10.1.1.8, 127.0.0.1" }, "127.0.0.1"),
      ),
    ).toBe("10.1.1.8");
  });
});
