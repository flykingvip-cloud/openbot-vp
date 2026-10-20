import { describe, expect, it } from "vitest";
import { CHAT_INBOUND_BASELINE_CASES } from "./chat-inbound-baseline.fixture.js";

describe("chat inbound baseline fixture", () => {
  it("covers every required lane with non-empty inputs", () => {
    const lanes = new Set(CHAT_INBOUND_BASELINE_CASES.map((item) => item.lane));
    expect([...lanes].toSorted()).toEqual(["act", "chat", "failure", "retrieve"]);
    expect(CHAT_INBOUND_BASELINE_CASES.every((item) => item.input.trim().length > 0)).toBe(true);
    expect(CHAT_INBOUND_BASELINE_CASES.map((item) => item.id)).toEqual([
      ...new Set(CHAT_INBOUND_BASELINE_CASES.map((item) => item.id)),
    ]);
  });
});
