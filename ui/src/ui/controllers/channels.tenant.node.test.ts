// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { loadChannels } from "./channels.ts";

describe("loadChannels tenant scope", () => {
  it("forwards tenantId to channels.status", async () => {
    const request = vi.fn(async () => ({
      ts: Date.now(),
      channelOrder: ["telegram"],
      channelLabels: {},
      channelMeta: [],
      channelAccounts: {},
      channelDefaultAccountId: {},
    }));
    const state = {
      client: { request },
      connected: true,
      channelsLoading: false,
      channelsSnapshot: null,
      channelsError: null,
      channelsLastSuccess: null,
    };
    await loadChannels(state as never, true, { tenantId: "tenant-a" });
    expect(request).toHaveBeenCalledWith(
      "channels.status",
      expect.objectContaining({ probe: true, tenantId: "tenant-a" }),
    );
  });
});
