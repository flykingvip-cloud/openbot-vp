import { describe, expect, it } from "vitest";
import { bindSkillToStepDraft } from "./skill-binder.js";

describe("skill binder", () => {
  it("maps a skillId to a seed step draft without IO", () => {
    const draft = bindSkillToStepDraft({ skillId: "competitor-watch" });
    expect(draft.skillId).toBe("competitor-watch");
    expect(draft.step.id).toBe("skill:competitor-watch");
    expect(draft.skillIsRecipe).toBe(true);
    expect(draft.evidenceEligible).toBe(false);
  });

  it("rejects an empty skillId", () => {
    expect(() => bindSkillToStepDraft({ skillId: "  " })).toThrowError(/ORCH8/);
  });
});
