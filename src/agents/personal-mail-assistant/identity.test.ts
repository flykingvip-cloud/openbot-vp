import { describe, expect, it } from "vitest";
import { buildPersonalMailAssistantAgentId, isPersonalMailAssistantAgent } from "./identity.js";

describe("personal mail assistant identity", () => {
  it("builds stable agent id from owner", () => {
    const a = buildPersonalMailAssistantAgentId("user@example.com");
    const b = buildPersonalMailAssistantAgentId("user@example.com");
    expect(a).toBe(b);
    expect(isPersonalMailAssistantAgent(a)).toBe(true);
  });
});
