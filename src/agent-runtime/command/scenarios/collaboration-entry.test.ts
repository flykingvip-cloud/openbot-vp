import { describe, expect, it } from "vitest";
import {
  isCollaborationGroupRuntimeSession,
  resolveCollaborationGroupIdForRun,
  shouldUseCollaborationRuntimeAssembly,
} from "./collaboration-entry.js";

describe("existing collaboration scenario evidence", () => {
  it("does not infer collaboration from round marker without a group", () => {
    expect(shouldUseCollaborationRuntimeAssembly({ collaborationRoundInvoked: true })).toBe(false);
    expect(
      shouldUseCollaborationRuntimeAssembly({
        collaborationRoundInvoked: true,
        collaborationGroupId: " g ",
      }),
    ).toBe(true);
  });
  it("matches existing scoped group metadata without assigning permissions", () => {
    expect(
      isCollaborationGroupRuntimeSession({ groupId: "g", sessionEntry: { space: " g " } }),
    ).toBe(true);
    expect(
      isCollaborationGroupRuntimeSession({ groupId: "g", sessionEntry: { groupId: "other" } }),
    ).toBe(false);
  });
  it("preserves explicit, session-key and profile resolution precedence", () => {
    const sessionEntry = {
      collaborationGroupProfile: { groupId: " profile " },
      groupId: "entry",
      space: "space",
    };
    expect(
      resolveCollaborationGroupIdForRun({
        collaborationGroupId: " explicit ",
        groupSessionId: "key",
        sessionEntry,
      }),
    ).toBe("explicit");
    expect(resolveCollaborationGroupIdForRun({ groupSessionId: " key ", sessionEntry })).toBe(
      "key",
    );
    expect(resolveCollaborationGroupIdForRun({ sessionEntry })).toBe("profile");
    expect(resolveCollaborationGroupIdForRun({})).toBeUndefined();
  });
});
