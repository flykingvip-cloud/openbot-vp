// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  looksLikeOpaqueDeliverableCreatorId,
  resolveMemberDisplayLabel,
  resolvePrimaryCreatorDisplayName,
} from "./creator-display.js";

describe("creator display helpers", () => {
  it("detects opaque creator ids", () => {
    expect(looksLikeOpaqueDeliverableCreatorId("bot-2")).toBe(true);
    expect(looksLikeOpaqueDeliverableCreatorId("main")).toBe(true);
    expect(looksLikeOpaqueDeliverableCreatorId("Alice Chen")).toBe(false);
  });

  it("resolves member display labels from roster", () => {
    const members = [
      {
        memberId: "m-bot",
        memberKind: "bot" as const,
        agentId: "bot-2",
        name: "销售助手",
        governanceRole: "member" as const,
        status: "active" as const,
        updatedAtMs: Date.now(),
      },
    ];
    expect(resolveMemberDisplayLabel("bot-2", members)).toBe("销售助手");
    expect(resolvePrimaryCreatorDisplayName(["bot-2"], members)).toBe("销售助手");
  });

  it("falls back to collaboration group title when creator ids are opaque", () => {
    expect(resolvePrimaryCreatorDisplayName(["bot-9"], [], { groupTitle: "Alpha Team" })).toBe(
      "Alpha Team",
    );
  });

  it("matches collaboration members case-insensitively", () => {
    const members = [
      {
        memberId: "m-bot",
        memberKind: "bot" as const,
        agentId: "Bot-2",
        name: "销售助手",
        governanceRole: "member" as const,
        status: "active" as const,
        updatedAtMs: Date.now(),
      },
    ];
    expect(resolveMemberDisplayLabel("bot-2", members)).toBe("销售助手");
  });
});
