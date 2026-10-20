import { afterEach, describe, expect, it } from "vitest";
import {
  detectExplicitCollabKnowledgeRecoveryIntent,
  formatCollaborationKnowledgeRecoveryHint,
  isCollaborationExplicitKnowledgeRecoveryEnabled,
} from "./collab-knowledge-recovery.js";

describe("collab knowledge recovery", () => {
  afterEach(() => {
    delete process.env.OPENBOT_COLLAB_EXPLICIT_KNOWLEDGE_RECOVERY;
  });

  it("defaults off", () => {
    expect(isCollaborationExplicitKnowledgeRecoveryEnabled()).toBe(false);
    expect(isCollaborationExplicitKnowledgeRecoveryEnabled({})).toBe(false);
  });

  it("enables via config or env", () => {
    expect(
      isCollaborationExplicitKnowledgeRecoveryEnabled({
        collaboration: { explicitKnowledgeRecovery: true },
      }),
    ).toBe(true);
    process.env.OPENBOT_COLLAB_EXPLICIT_KNOWLEDGE_RECOVERY = "1";
    expect(isCollaborationExplicitKnowledgeRecoveryEnabled()).toBe(true);
  });

  it("detects recovery phrases and rejects unrelated chat", () => {
    expect(detectExplicitCollabKnowledgeRecoveryIntent("按前面约定继续做")).toBe(true);
    expect(detectExplicitCollabKnowledgeRecoveryIntent("继续上次任务")).toBe(true);
    expect(detectExplicitCollabKnowledgeRecoveryIntent("as previously agreed")).toBe(true);
    expect(detectExplicitCollabKnowledgeRecoveryIntent("今天天气怎么样")).toBe(false);
    expect(detectExplicitCollabKnowledgeRecoveryIntent("继续")).toBe(false);
  });

  it("hint mentions promote boundary", () => {
    expect(formatCollaborationKnowledgeRecoveryHint()).toContain("promote");
  });
});
