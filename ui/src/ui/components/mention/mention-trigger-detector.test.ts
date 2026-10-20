import { describe, expect, it } from "vitest";
import {
  createMentionTriggerDetector,
  isValidTriggerPosition,
} from "./mention-trigger-detector.js";

describe("MentionTriggerDetector", () => {
  it("activates at the start of a message", () => {
    const detector = createMentionTriggerDetector();
    const state = detector.onInputChange("@alice", "@alice".length);

    expect(state).toMatchObject({
      active: true,
      query: "alice",
      triggerOffset: 0,
      caretPosition: { top: 0, left: 0 },
    });
  });

  it("activates after whitespace and in the middle of prose", () => {
    const detector = createMentionTriggerDetector();

    expect(detector.onInputChange("hello @alice", "hello @alice".length)).toMatchObject({
      query: "alice",
      triggerOffset: 6,
    });
    expect(detector.onInputChange("ping@alice", "ping@alice".length)).toMatchObject({
      query: "alice",
      triggerOffset: 4,
    });
  });

  it("does not activate inside inline code", () => {
    const detector = createMentionTriggerDetector();
    const text = "please check `@alice`";

    expect(detector.onInputChange(text, text.indexOf("@alice") + "@alice".length)).toBeNull();
    expect(isValidTriggerPosition(text, text.indexOf("@alice"))).toBe(false);
  });

  it("does not activate inside fenced code blocks", () => {
    const detector = createMentionTriggerDetector();
    const text = "before\n```ts\n@alice\n```\nafter";

    expect(detector.onInputChange(text, text.indexOf("@alice") + "@alice".length)).toBeNull();
    expect(isValidTriggerPosition(text, text.indexOf("@alice"))).toBe(false);
  });

  it("activates after inline and fenced code has closed", () => {
    const detector = createMentionTriggerDetector();
    const inline = "`code` @alice";
    const fenced = "```\ncode\n```\n@alice";

    expect(detector.onInputChange(inline, inline.length)).toMatchObject({
      query: "alice",
      triggerOffset: 7,
    });
    expect(detector.onInputChange(fenced, fenced.length)).toMatchObject({
      query: "alice",
      triggerOffset: fenced.lastIndexOf("@"),
    });
  });

  it("closes when the trigger character is deleted", () => {
    const detector = createMentionTriggerDetector();

    expect(detector.onInputChange("@alice", 1)).toMatchObject({ query: "" });
    expect(detector.onInputChange("alice", 0)).toBeNull();
  });

  it("stays dismissed for the current trigger until a new trigger is typed", () => {
    const detector = createMentionTriggerDetector();

    expect(detector.onInputChange("@alice", 1)).toMatchObject({ triggerOffset: 0 });
    detector.dismiss();
    expect(detector.onInputChange("@alice", "@alice".length)).toBeNull();

    expect(detector.onInputChange("@alice @bob", "@alice @bob".length)).toMatchObject({
      query: "bob",
      triggerOffset: 7,
    });
  });

  it("ignores completed mention-like spans once whitespace follows the query", () => {
    const detector = createMentionTriggerDetector();

    expect(detector.onInputChange("@alice hello", "@alice hello".length)).toBeNull();
  });

  it("clamps invalid cursor positions to the input bounds", () => {
    const detector = createMentionTriggerDetector();

    expect(detector.onInputChange("@alice", Number.NaN)).toMatchObject({
      query: "alice",
      triggerOffset: 0,
    });
    expect(detector.onInputChange("@alice", -10)).toBeNull();
  });
});
