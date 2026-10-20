import { describe, expect, it } from "vitest";
import { classify } from "./mention-intent-classifier.js";
import type { MentionMetadata } from "./mention-types.js";
import { isIntentSuggestion } from "./mention-types.js";

function mention(offset = 0): MentionMetadata {
  return {
    mention_id: "mention-1",
    agentId: "agent-a",
    displayName: "Agent A",
    offset,
    length: 8,
  };
}

describe("IntentClassifier", () => {
  it("returns valid bounded suggestions and defaults low confidence to attention", () => {
    const suggestion = classify({
      messageText: "hello @Agent A",
      mention: mention(6),
    });

    expect(isIntentSuggestion(suggestion)).toBe(true);
    expect(suggestion).toMatchObject({
      intent: "attention",
      confidence: 0.5,
    });
  });

  it("classifies task, approval, review, notification, and handoff wording", () => {
    expect(
      classify({ messageText: "@Agent A please finish the report", mention: mention() }).intent,
    ).toBe("task_assignment");
    expect(
      classify({ messageText: "@Agent A please approve this", mention: mention() }).intent,
    ).toBe("approval_request");
    expect(classify({ messageText: "@Agent A review this PR", mention: mention() }).intent).toBe(
      "review_request",
    );
    expect(classify({ messageText: "@Agent A FYI build passed", mention: mention() }).intent).toBe(
      "notification",
    );
    expect(
      classify({ messageText: "@Agent A handoff this thread", mention: mention() }).intent,
    ).toBe("handoff");
  });
});
