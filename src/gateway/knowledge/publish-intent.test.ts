import { describe, expect, it } from "vitest";
import {
  buildKnowledgePublishIntent,
  formatKnowledgePublishIntentExecutionSystemPrompt,
  parseKnowledgePublishIntentFromMessage,
} from "./publish-intent.js";

describe("knowledge publish intent", () => {
  it("builds handoff payload without knowledge execute semantics", () => {
    const intent = buildKnowledgePublishIntent({
      objectId: "ko-1",
      objectTitle: "产品发布稿",
      objectSummary: "面向外部渠道",
      provider: "github-personal",
      suggestedAction: "create_issue",
      channelLabel: "GitHub",
    });
    expect(intent.draftMessage).toContain("[openbot-publish-intent]");
    expect(intent.draftMessage).toContain("user_operational_identity");
    expect(intent.draftMessage).toContain("禁止调用 knowledge.publish.execute");
    expect(intent.target.provider).toBe("github-personal");
    expect(intent.executionPayload.title).toBe("产品发布稿");
  });

  it("formats agent execution system prompt from publish intent", () => {
    const intent = buildKnowledgePublishIntent({
      objectId: "ko-2",
      objectTitle: "Release notes",
      provider: "github-personal",
      suggestedAction: "create_issue",
    });
    const prompt = formatKnowledgePublishIntentExecutionSystemPrompt(intent);
    expect(prompt).toContain("then execute");
    expect(prompt).toContain("create_issue");
    expect(prompt).toContain("Do not call knowledge.publish.execute");
  });

  it("parses publish intent marker from assistant handoff message", () => {
    const intent = buildKnowledgePublishIntent({
      objectId: "ko-3",
      objectTitle: "周报",
      objectSummary: "本周进展",
      provider: "github-personal",
      suggestedAction: "create_issue",
    });
    const parsed = parseKnowledgePublishIntentFromMessage(intent.draftMessage);
    expect(parsed?.target.provider).toBe("github-personal");
    expect(parsed?.objectTitle).toBe("周报");
  });
});
