import { describe, expect, it } from "vitest";
import { en } from "../i18n/locales/en.ts";
import { zh_CN } from "../i18n/locales/zh-CN.ts";
import {
  advanceTransientGatewayClose,
  GATEWAY_RECONNECTING_CLOSE_BUDGET,
  resolveGatewayChatBanner,
} from "./gateway-connection-phase.ts";

describe("gateway connection phase", () => {
  it("keeps a 1006-before-hello banner off chat.disconnected", () => {
    const banner = resolveGatewayChatBanner({ connected: false, phase: "reconnecting" });
    expect(banner).toEqual({ kind: "status", messageKey: "chat.reconnecting" });
    if (banner.kind === "status") {
      expect(banner.messageKey).not.toBe("chat.disconnected");
    }
  });

  it("upgrades to gateway unreachable after the close budget and not a loading state", () => {
    let attempt = 0;
    let phase: "reconnecting" | "unreachable" = "reconnecting";
    for (let i = 0; i < GATEWAY_RECONNECTING_CLOSE_BUDGET; i++) {
      const next = advanceTransientGatewayClose(attempt);
      attempt = next.reconnectAttempt;
      phase = next.phase;
      expect(phase).toBe("reconnecting");
    }
    const exhausted = advanceTransientGatewayClose(attempt);
    expect(exhausted.phase).toBe("unreachable");
    const banner = resolveGatewayChatBanner({
      connected: false,
      phase: exhausted.phase,
    });
    expect(banner).toEqual({ kind: "status", messageKey: "chat.gatewayUnreachable" });
  });

  it("keeps auth-blocked closes on the sticky disconnected banner", () => {
    const banner = resolveGatewayChatBanner({ connected: false, phase: "blocked" });
    expect(banner).toEqual({ kind: "status", messageKey: "chat.disconnected" });
    expect(banner).not.toEqual({ kind: "status", messageKey: "chat.reconnecting" });
  });

  it("clears the banner after hello", () => {
    expect(resolveGatewayChatBanner({ connected: true, phase: "connected" })).toEqual({
      kind: "hidden",
    });
  });

  it("ships reconnect copy in en and zh-CN distinct from the sticky disconnect line", () => {
    for (const locale of [en, zh_CN]) {
      const chat = locale.chat as Record<string, string>;
      expect(chat.reconnecting.length).toBeGreaterThan(0);
      expect(chat.gatewayUnreachable.length).toBeGreaterThan(0);
      expect(chat.retryConnection.length).toBeGreaterThan(0);
      expect(chat.connecting.length).toBeGreaterThan(0);
      expect(chat.reconnecting).not.toBe(chat.disconnected);
      expect(chat.gatewayUnreachable).not.toBe(chat.disconnected);
    }
    const enChat = en.chat as Record<string, string>;
    const zhChat = zh_CN.chat as Record<string, string>;
    expect(enChat.reconnecting).not.toBe(zhChat.reconnecting);
    expect(enChat.gatewayUnreachable).not.toBe(zhChat.gatewayUnreachable);
  });
});
