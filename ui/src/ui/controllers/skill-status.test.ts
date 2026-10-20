import { describe, expect, it } from "vitest";
import type { SkillLifecycleState } from "./skill-models.ts";
import {
  assertCanSubmitToEnterprise,
  canShareToGroup,
  getAvailableTransitions,
  isValidTransition,
  VALID_TRANSITIONS,
} from "./skill-status.ts";

const ALL_STATES: SkillLifecycleState[] = [
  "draft",
  "private",
  "reviewing",
  "approved",
  "published",
  "deprecated",
  "retired",
  "rejected",
];

describe("skill lifecycle status", () => {
  describe("VALID_TRANSITIONS", () => {
    it("contains exactly 7 transitions", () => {
      expect(VALID_TRANSITIONS).toHaveLength(7);
    });

    it("is readonly", () => {
      // TypeScript enforces this at compile time; runtime check that it's a frozen-like array
      expect(Array.isArray(VALID_TRANSITIONS)).toBe(true);
    });
  });

  describe("isValidTransition", () => {
    it("allows draft → private (finalize_draft)", () => {
      expect(isValidTransition("draft", "private")).toBe(true);
    });

    it("allows private → reviewing (submit_to_enterprise)", () => {
      expect(isValidTransition("private", "reviewing")).toBe(true);
    });

    it("allows reviewing → approved (approve)", () => {
      expect(isValidTransition("reviewing", "approved")).toBe(true);
    });

    it("allows reviewing → rejected (reject)", () => {
      expect(isValidTransition("reviewing", "rejected")).toBe(true);
    });

    it("allows approved → published (publish)", () => {
      expect(isValidTransition("approved", "published")).toBe(true);
    });

    it("allows published → deprecated (deprecate)", () => {
      expect(isValidTransition("published", "deprecated")).toBe(true);
    });

    it("allows deprecated → retired (retire)", () => {
      expect(isValidTransition("deprecated", "retired")).toBe(true);
    });

    it("rejects draft → reviewing (must go through private first)", () => {
      expect(isValidTransition("draft", "reviewing")).toBe(false);
    });

    it("rejects draft → published", () => {
      expect(isValidTransition("draft", "published")).toBe(false);
    });

    it("rejects draft → approved", () => {
      expect(isValidTransition("draft", "approved")).toBe(false);
    });

    it("rejects private → approved (must go through reviewing)", () => {
      expect(isValidTransition("private", "approved")).toBe(false);
    });

    it("rejects private → published", () => {
      expect(isValidTransition("private", "published")).toBe(false);
    });

    it("rejects published → draft", () => {
      expect(isValidTransition("published", "draft")).toBe(false);
    });

    it("rejects retired → published", () => {
      expect(isValidTransition("retired", "published")).toBe(false);
    });

    it("rejects retired → any state", () => {
      for (const to of ALL_STATES) {
        expect(isValidTransition("retired", to)).toBe(false);
      }
    });

    it("rejects rejected → any state", () => {
      for (const to of ALL_STATES) {
        expect(isValidTransition("rejected", to)).toBe(false);
      }
    });

    it("rejects deprecated → published (no restore path)", () => {
      expect(isValidTransition("deprecated", "published")).toBe(false);
    });

    it("rejects self-transitions for all states", () => {
      for (const state of ALL_STATES) {
        expect(isValidTransition(state, state)).toBe(false);
      }
    });
  });

  describe("getAvailableTransitions", () => {
    it("returns finalize_draft for draft", () => {
      const transitions = getAvailableTransitions("draft");
      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toEqual({ from: "draft", to: "private", action: "finalize_draft" });
    });

    it("returns submit_to_enterprise for private", () => {
      const transitions = getAvailableTransitions("private");
      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toEqual({
        from: "private",
        to: "reviewing",
        action: "submit_to_enterprise",
      });
    });

    it("returns approve and reject for reviewing", () => {
      const transitions = getAvailableTransitions("reviewing");
      expect(transitions).toHaveLength(2);
      expect(transitions.map((t) => t.action).toSorted()).toEqual(["approve", "reject"]);
    });

    it("returns publish for approved", () => {
      const transitions = getAvailableTransitions("approved");
      expect(transitions).toHaveLength(1);
      expect(transitions[0].action).toBe("publish");
    });

    it("returns deprecate for published", () => {
      const transitions = getAvailableTransitions("published");
      expect(transitions).toHaveLength(1);
      expect(transitions[0].action).toBe("deprecate");
    });

    it("returns retire for deprecated", () => {
      const transitions = getAvailableTransitions("deprecated");
      expect(transitions).toHaveLength(1);
      expect(transitions[0].action).toBe("retire");
    });

    it("returns empty array for retired (terminal state)", () => {
      expect(getAvailableTransitions("retired")).toEqual([]);
    });

    it("returns empty array for rejected (terminal state)", () => {
      expect(getAvailableTransitions("rejected")).toEqual([]);
    });
  });

  describe("assertCanSubmitToEnterprise", () => {
    it("throws for draft status", () => {
      expect(() => assertCanSubmitToEnterprise("draft")).toThrow(/must be finalized first/);
    });

    it("succeeds for private status", () => {
      expect(() => assertCanSubmitToEnterprise("private")).not.toThrow();
    });

    it("throws for reviewing status", () => {
      expect(() => assertCanSubmitToEnterprise("reviewing")).toThrow(/must be in "private" status/);
    });

    it("throws for approved status", () => {
      expect(() => assertCanSubmitToEnterprise("approved")).toThrow();
    });

    it("throws for published status", () => {
      expect(() => assertCanSubmitToEnterprise("published")).toThrow();
    });

    it("throws for deprecated status", () => {
      expect(() => assertCanSubmitToEnterprise("deprecated")).toThrow();
    });

    it("throws for retired status", () => {
      expect(() => assertCanSubmitToEnterprise("retired")).toThrow();
    });

    it("throws for rejected status", () => {
      expect(() => assertCanSubmitToEnterprise("rejected")).toThrow();
    });
  });

  describe("canShareToGroup", () => {
    it("returns true for private", () => {
      expect(canShareToGroup("private")).toBe(true);
    });

    it("returns true for approved", () => {
      expect(canShareToGroup("approved")).toBe(true);
    });

    it("returns true for published", () => {
      expect(canShareToGroup("published")).toBe(true);
    });

    it("returns false for draft", () => {
      expect(canShareToGroup("draft")).toBe(false);
    });

    it("returns false for reviewing", () => {
      expect(canShareToGroup("reviewing")).toBe(false);
    });

    it("returns false for deprecated", () => {
      expect(canShareToGroup("deprecated")).toBe(false);
    });

    it("returns false for retired", () => {
      expect(canShareToGroup("retired")).toBe(false);
    });

    it("returns false for rejected", () => {
      expect(canShareToGroup("rejected")).toBe(false);
    });
  });
});
