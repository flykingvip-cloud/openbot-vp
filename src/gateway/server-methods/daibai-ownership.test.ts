import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  assertAgentManageable,
  resolveManageableAgentIds,
  StewardOwnershipError,
} from "./daibai-ownership.js";

const cfg: OpenBotConfig = {
  agents: { list: [{ id: "main", default: true }, { id: "agent-sales" }] },
};

describe("daibai ownership preflight", () => {
  it("resolves manageable agent ids from config", () => {
    expect(resolveManageableAgentIds(cfg)).toEqual(["main", "agent-sales"]);
  });

  it("allows a manageable agent id (normalized)", () => {
    expect(assertAgentManageable("MAIN", cfg)).toBe("main");
    expect(assertAgentManageable("agent-sales", cfg)).toBe("agent-sales");
  });

  it("rejects an agent id outside the manageable set", () => {
    expect(() => assertAgentManageable("rogue-agent", cfg)).toThrow(StewardOwnershipError);
  });

  it("rejects missing / empty agent id", () => {
    expect(() => assertAgentManageable(undefined, cfg)).toThrow(StewardOwnershipError);
    expect(() => assertAgentManageable("", cfg)).toThrow(StewardOwnershipError);
  });

  it("falls back to the default agent for an empty config", () => {
    expect(resolveManageableAgentIds({})).toEqual(["main"]);
  });
});
