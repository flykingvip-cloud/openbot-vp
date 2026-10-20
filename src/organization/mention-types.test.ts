import { describe, expect, it } from "vitest";
import {
  isIntentSuggestion,
  isMentionMetadata,
  isMentionState,
  isValidMentionIntent,
} from "./mention-types.js";

describe("mention type guards", () => {
  it("validates MentionMetadata shape and numeric bounds", () => {
    expect(
      isMentionMetadata({
        mention_id: "mention-1",
        agentId: "agent-a",
        displayName: "Agent A",
        offset: 0,
        length: 8,
      }),
    ).toBe(true);

    expect(
      isMentionMetadata({
        mention_id: "mention-1",
        agentId: "agent-a",
        displayName: "Agent A",
        offset: -1,
        length: 8,
      }),
    ).toBe(false);
  });

  it("validates MentionState lifecycle records", () => {
    expect(
      isMentionState({
        mention_id: "mention-1",
        source_message_id: "message-1",
        source_agent_id: "agent-a",
        target_agent_id: "agent-b",
        organization_id: "org-1",
        acknowledged: false,
        responded: false,
        resolved: false,
        created_at: "2026-05-12T00:00:00.000Z",
        updated_at: "2026-05-12T00:00:00.000Z",
      }),
    ).toBe(true);

    expect(
      isMentionState({
        mention_id: "mention-1",
        acknowledged: false,
      }),
    ).toBe(false);
  });

  it("validates mention intent values", () => {
    expect(isValidMentionIntent("task_assignment")).toBe(true);
    expect(isValidMentionIntent("auto_execute")).toBe(false);
  });

  it("validates intent suggestions and confidence range", () => {
    expect(
      isIntentSuggestion({
        intent: "review_request",
        confidence: 0.8,
        reasoning: "review keyword",
      }),
    ).toBe(true);

    expect(
      isIntentSuggestion({
        intent: "review_request",
        confidence: 1.2,
      }),
    ).toBe(false);
  });
});
