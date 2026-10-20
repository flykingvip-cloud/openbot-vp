import { describe, expect, it } from "vitest";
import { resolveSecondaryTakeoverBot } from "./secondary-takeover.js";

const botA = {
  agentId: "bot-a",
  name: "Bot A",
  sessionKey: "agent:bot-a:main:space:alpha",
  updatedAt: 1,
};
const botB = {
  agentId: "bot-b",
  name: "Bot B",
  sessionKey: "agent:bot-b:main:space:alpha",
  updatedAt: 2,
};

describe("resolveSecondaryTakeoverBot", () => {
  it("picks the next already-selected bot and does not invent a new one", () => {
    expect(
      resolveSecondaryTakeoverBot({ timedOutAgentId: "bot-a", selected: [botA, botB] })?.agentId,
    ).toBe("bot-b");
    expect(resolveSecondaryTakeoverBot({ timedOutAgentId: "bot-a", selected: [botA] })).toBeNull();
  });
});
