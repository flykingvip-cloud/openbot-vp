import { describe, expect, it } from "vitest";
import { isPeerOutboundSurfaceMessage, omitPeerOutboundSurfaces } from "./peer-outbound.js";

describe("peer outbound surfaces", () => {
  it("drops durable sent envelopes from agent history", () => {
    const outbound = {
      role: "assistant",
      content: [{ type: "text", text: "请准备明天的会议资料" }],
      sentTo: [{ label: "大白管家", agentId: "steward" }],
      openclawPeerOutbound: true,
    };
    expect(isPeerOutboundSurfaceMessage(outbound)).toBe(true);
    expect(
      omitPeerOutboundSurfaces([
        { role: "user", content: "hi" },
        outbound,
        { role: "assistant", content: [{ type: "text", text: "已回复。" }] },
      ]),
    ).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "已回复。" }] },
    ]);
  });
});
