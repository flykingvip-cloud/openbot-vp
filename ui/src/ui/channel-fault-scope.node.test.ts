import { describe, expect, it } from "vitest";
import {
  channelFaultMessage,
  collectChannelFaults,
  detachChannelConfigFault,
  selectVisibleHostError,
} from "./channel-fault-scope.ts";
import { resolveGatewayChatBanner } from "./gateway-connection-phase.ts";
import type { ChannelsStatusSnapshot } from "./types.ts";

function snapshot(): ChannelsStatusSnapshot {
  return {
    ts: 1,
    channelOrder: ["telegram", "wecom"],
    channelLabels: { telegram: "Telegram", wecom: "WeCom" },
    channels: {
      telegram: { configured: true, running: false, lastError: null },
      wecom: { configured: true, running: true, connected: true },
    },
    channelAccounts: {
      telegram: [
        {
          accountId: "default",
          configured: true,
          running: false,
          connected: false,
          lastError: "telegram polling stopped",
        },
      ],
      wecom: [
        {
          accountId: "default",
          configured: true,
          running: true,
          connected: true,
          lastError: null,
        },
      ],
    },
    channelDefaultAccountId: { telegram: "default", wecom: "default" },
  };
}

describe("channel fault scope", () => {
  it("keeps one stopped channel on that channel and off the gateway banner", () => {
    const faults = collectChannelFaults(snapshot());
    expect(faults).toEqual([
      { channelId: "telegram", accountId: "default", message: "telegram polling stopped" },
    ]);
    expect(channelFaultMessage(snapshot(), "telegram")).toBe("telegram polling stopped");
    expect(channelFaultMessage(snapshot(), "wecom")).toBeNull();

    const banner = resolveGatewayChatBanner({ connected: true, phase: "connected" });
    expect(banner).toEqual({ kind: "hidden" });
    expect(
      selectVisibleHostError({
        lastError: "telegram polling stopped",
        channelsError: null,
        snapshot: snapshot(),
      }),
    ).toBeNull();
    expect(
      selectVisibleHostError({
        lastError: "channels.status failed",
        channelsError: "channels.status failed",
        snapshot: snapshot(),
      }),
    ).toBeNull();
  });

  it("keeps a real gateway error visible and uses unreachable copy when the process is down", () => {
    expect(
      selectVisibleHostError({
        lastError: "disconnected (1006): no reason",
        channelsError: "telegram polling stopped",
        snapshot: snapshot(),
      }),
    ).toBe("disconnected (1006): no reason");
    expect(resolveGatewayChatBanner({ connected: false, phase: "unreachable" })).toEqual({
      kind: "status",
      messageKey: "chat.gatewayUnreachable",
    });
    expect(resolveGatewayChatBanner({ connected: false, phase: "reconnecting" })).toEqual({
      kind: "status",
      messageKey: "chat.reconnecting",
    });
  });

  it("moves a channel config save failure off host.lastError", () => {
    expect(
      detachChannelConfigFault({
        priorHostError: null,
        nextHostError: "config.set rejected",
      }),
    ).toEqual({ hostError: null, channelFault: "config.set rejected" });
    expect(
      detachChannelConfigFault({
        priorHostError: "disconnected (1006): no reason",
        nextHostError: null,
      }),
    ).toEqual({ hostError: "disconnected (1006): no reason", channelFault: null });
  });
});
