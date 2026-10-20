import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../../config/config.js";
import {
  buildConfiguredChannelCapabilityDescriptors,
  channelCapabilityId,
} from "./channel-capability-source.js";

describe("buildConfiguredChannelCapabilityDescriptors", () => {
  it("returns no capabilities when no channels are configured", () => {
    const cfg = { channels: {} } as unknown as OpenBotConfig;
    // Explicit empty env avoids env-based channel detection false positives.
    expect(buildConfiguredChannelCapabilityDescriptors(cfg, {})).toEqual([]);
  });

  it("surfaces a configured channel as a real (non-sample) granted capability", () => {
    const cfg = {
      channels: { slack: { botToken: "xoxb-test" } },
    } as unknown as OpenBotConfig;
    const descriptors = buildConfiguredChannelCapabilityDescriptors(cfg, {});
    const slack = descriptors.find((item) => item.id === channelCapabilityId("slack"));
    expect(slack).toBeDefined();
    expect(slack?.isSample).toBe(false);
    expect(slack?.accessState).toBe("granted");
    expect(slack?.sourceSystems).toContain("Slack");
    // Unconfigured channels are not surfaced.
    expect(descriptors.find((item) => item.id === channelCapabilityId("telegram"))).toBeUndefined();
  });
});
