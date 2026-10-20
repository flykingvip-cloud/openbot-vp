import { describe, expect, it } from "vitest";
import { isRosterAllowedGroupDiscussionBot } from "./group-discussion-roster.js";

describe("isRosterAllowedGroupDiscussionBot", () => {
  it("does not treat an empty managed-space roster as unrestricted", () => {
    const empty = new Set<string>();
    expect(
      isRosterAllowedGroupDiscussionBot({
        agentId: "main",
        activeMemberBotIds: empty,
        hasManagedSpace: true,
      }),
    ).toBe(false);
    expect(
      isRosterAllowedGroupDiscussionBot({
        agentId: "market-helper",
        activeMemberBotIds: empty,
        hasManagedSpace: true,
      }),
    ).toBe(false);
  });

  it("only admits listed members on a managed space, including steward", () => {
    const roster = new Set(["market-helper", "main"]);
    expect(
      isRosterAllowedGroupDiscussionBot({
        agentId: "market-helper",
        activeMemberBotIds: roster,
        hasManagedSpace: true,
      }),
    ).toBe(true);
    expect(
      isRosterAllowedGroupDiscussionBot({
        agentId: "main",
        activeMemberBotIds: roster,
        hasManagedSpace: true,
      }),
    ).toBe(true);
    expect(
      isRosterAllowedGroupDiscussionBot({
        agentId: "skill-bot",
        activeMemberBotIds: roster,
        hasManagedSpace: true,
      }),
    ).toBe(false);
  });

  it("never admits the builtin steward from historical sessions when not listed", () => {
    expect(
      isRosterAllowedGroupDiscussionBot({
        agentId: "main",
        activeMemberBotIds: new Set(),
        hasManagedSpace: false,
      }),
    ).toBe(false);
    expect(
      isRosterAllowedGroupDiscussionBot({
        agentId: "legacy-bot",
        activeMemberBotIds: new Set(),
        hasManagedSpace: false,
      }),
    ).toBe(true);
  });
});
