import { describe, expect, it } from "vitest";
import { renderCollaborationMission } from "./collaboration-mission.js";

describe("collaboration mission projection", () => {
  it("omits absent or empty profile data", () => {
    expect(renderCollaborationMission()).toBeUndefined();
    expect(
      renderCollaborationMission({ displayName: " ", successCriteria: [" "] }),
    ).toBeUndefined();
  });
  it("preserves domain ordering, trimming and separators without mutating data", () => {
    const profile = {
      displayName: " Group ",
      purpose: " Purpose ",
      currentMission: " Mission ",
      collaborationMode: " discussion ",
      successCriteria: [" one ", "", "two"],
      systemInstructions: [" first ", " ", "second"],
    };
    expect(renderCollaborationMission(profile)).toBe(
      [
        "Collaboration group context:",
        "- Group: Group",
        "- Purpose: Purpose",
        "- Current mission: Mission",
        "- Collaboration mode: discussion",
        "- Success criteria: one; two",
        "- Group instructions: first | second",
      ].join("\n"),
    );
    expect(profile.successCriteria).toEqual([" one ", "", "two"]);
  });
});
