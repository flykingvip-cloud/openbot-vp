import { describe, expect, it } from "vitest";
import { projectSeatRulesForAgent, resolveSeatBoundAgentIds } from "./injection.js";

describe("resolveSeatBoundAgentIds", () => {
  it("unions defaults with active agent bindings and drops revoked", () => {
    expect(
      resolveSeatBoundAgentIds({
        defaultAgentAssetIds: ["bot-a", " bot-b "],
        assetBindings: [
          { assetType: "agent", assetId: "bot-c", status: "active" },
          { assetType: "memory", assetId: "mem-1", status: "active" },
          { assetType: "agent", assetId: "bot-d", status: "revoked" },
          { assetType: "agent", assetId: "bot-e", revokedAt: "2026-01-01T00:00:00.000Z" },
        ],
      }),
    ).toEqual(["bot-a", "bot-b", "bot-c"]);
  });
});

describe("projectSeatRulesForAgent", () => {
  it("injects only for bound agents", () => {
    const rules = [{ id: "1", text: "hello" }];
    expect(projectSeatRulesForAgent({ agentId: "bot-a", boundAgentIds: ["bot-a"], rules })).toEqual(
      { injected: true, rules },
    );
    expect(projectSeatRulesForAgent({ agentId: "bot-z", boundAgentIds: ["bot-a"], rules })).toEqual(
      { injected: false, rules: [] },
    );
  });
});
