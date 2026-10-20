import { describe, expect, it } from "vitest";
import {
  dismissCollaborationOptionalSuggestion,
  handleCollaborationOptionalSuggestionEvent,
  resolveActiveCollaborationOptionalSuggestions,
} from "./collaboration-optional-suggestions.ts";

describe("collaboration optional suggestions controller", () => {
  it("stores suggestion for active session", () => {
    const state = {
      sessionKey: "space:alpha",
      collaborationOptionalSuggestions: [],
    };
    handleCollaborationOptionalSuggestionEvent(state, {
      roundId: "round-1",
      sessionKey: "space:alpha",
      agentId: "bot-market",
      agentName: "市场助手",
      title: "可选补充",
      body: "如需渠道策略我可以协助。",
      recordedAtMs: 1,
    });
    expect(resolveActiveCollaborationOptionalSuggestions(state)).toHaveLength(1);
  });

  it("dismisses suggestion by id", () => {
    const state = {
      sessionKey: "space:alpha",
      collaborationOptionalSuggestions: [
        {
          id: "round-1:bot-market:1",
          roundId: "round-1",
          sessionKey: "space:alpha",
          agentId: "bot-market",
          agentName: "市场助手",
          title: "可选补充",
          body: "body",
          recordedAtMs: 1,
        },
      ],
    };
    dismissCollaborationOptionalSuggestion(state, "round-1:bot-market:1");
    expect(resolveActiveCollaborationOptionalSuggestions(state)).toHaveLength(0);
  });
});
