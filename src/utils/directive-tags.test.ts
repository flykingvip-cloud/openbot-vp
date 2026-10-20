import { describe, expect, test } from "vitest";
import {
  stripCapabilityGapMarkersForStream,
  stripInlineDirectiveTagsForDisplay,
  stripInlineDirectiveTagsFromMessageForDisplay,
} from "./directive-tags.js";

describe("stripInlineDirectiveTagsForDisplay", () => {
  test("removes reply and audio directives", () => {
    const input = "hello [[reply_to_current]] world [[reply_to:abc-123]] [[audio_as_voice]]";
    const result = stripInlineDirectiveTagsForDisplay(input);
    expect(result.changed).toBe(true);
    expect(result.text).toBe("hello  world  ");
  });

  test("removes capability_gap markers", () => {
    const input = "Cannot help. [[capability_gap:tool:pdf_ocr]] Thanks.";
    const result = stripInlineDirectiveTagsForDisplay(input);
    expect(result.changed).toBe(true);
    expect(result.text).not.toContain("capability_gap");
    expect(result.text).toContain("Cannot help.");
  });

  test("holds back partial capability_gap markers across stream chunks", () => {
    const mid = stripCapabilityGapMarkersForStream("hello [[capability_gap:skill");
    expect(mid.holdback.startsWith("[[")).toBe(true);
    expect(mid.text).toBe("hello ");
    const done = stripCapabilityGapMarkersForStream(`${mid.holdback}:pdf]] world`);
    expect(done.holdback).toBe("");
    expect(done.text).not.toContain("capability_gap");
    expect(done.text).toContain("world");
  });

  test("supports whitespace variants", () => {
    const input = "[[ reply_to : 123 ]]ok[[ audio_as_voice ]]";
    const result = stripInlineDirectiveTagsForDisplay(input);
    expect(result.changed).toBe(true);
    expect(result.text).toBe("ok");
  });

  test("does not mutate plain text", () => {
    const input = "  keep leading and trailing whitespace  ";
    const result = stripInlineDirectiveTagsForDisplay(input);
    expect(result.changed).toBe(false);
    expect(result.text).toBe(input);
  });

  test("keeps English planning text when the user asked in English", () => {
    const input = "I'll start by looking at my workspace to see what's there.";
    const result = stripInlineDirectiveTagsForDisplay(input, "en");
    expect(result.changed).toBe(false);
    expect(result.text).toBe(input);
  });
});

describe("stripInlineDirectiveTagsFromMessageForDisplay", () => {
  test("strips inline directives from text content blocks", () => {
    const input = {
      role: "assistant",
      content: [{ type: "text", text: "hello [[reply_to_current]] world [[audio_as_voice]]" }],
    };
    const result = stripInlineDirectiveTagsFromMessageForDisplay(input);
    expect(result).toBeDefined();
    expect(result?.content).toEqual([{ type: "text", text: "world" }]);
  });

  test("preserves empty-string text when directives are entire content", () => {
    const input = {
      role: "assistant",
      content: [{ type: "text", text: "[[reply_to_current]]" }],
    };
    const result = stripInlineDirectiveTagsFromMessageForDisplay(input);
    expect(result).toBeDefined();
    expect(result?.content).toEqual([{ type: "text", text: "" }]);
  });

  test("returns original message when content is not an array", () => {
    const input = {
      role: "assistant",
      content: "plain text",
    };
    const result = stripInlineDirectiveTagsFromMessageForDisplay(input);
    expect(result).toEqual(input);
  });

  test("strips English CoT scratchpad from type:text and string content", () => {
    const cot = "Let me try exec to read the skill outside my sandbox.";
    const arrayResult = stripInlineDirectiveTagsFromMessageForDisplay({
      role: "assistant",
      content: [{ type: "text", text: cot }],
    });
    expect(arrayResult?.content).toEqual([{ type: "text", text: "" }]);
    const stringResult = stripInlineDirectiveTagsFromMessageForDisplay({
      role: "assistant",
      content: cot,
      text: cot,
    });
    expect(stringResult?.content).toBe("");
    expect(stringResult?.text).toBe("");
  });

  test("keeps type:thinking process text", () => {
    const input = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Let me try exec to read the skill outside my sandbox." },
      ],
    };
    const result = stripInlineDirectiveTagsFromMessageForDisplay(input);
    expect(result).toEqual(input);
  });
});
