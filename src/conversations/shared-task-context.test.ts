import { describe, expect, it } from "vitest";
import {
  activeApprovedDecisions,
  approveSharedDecision,
  emptySharedTaskContext,
  fitSharedTaskContextToBudget,
  InMemorySharedTaskContextStore,
  proposeSharedDecision,
  SharedTaskContextConcurrencyError,
  supersedeSharedDecision,
} from "./shared-task-context.js";
import { buildSharedTaskSystemPromptAddition } from "./shared-task-inject.js";

describe("CL-P3 Shared Task Context", () => {
  it("proposes without inject; approve with evidence injects; supersede drops old", () => {
    const base = emptySharedTaskContext({
      conversationId: "c1",
      groupId: "g1",
      updatedBy: "u1",
    });
    const proposed = proposeSharedDecision({
      context: base,
      text: "Use freeze window",
      decisionId: "d1",
      updatedBy: "u1",
    });
    expect(proposed.approvedDecisions[0]?.status).toBe("PROPOSED");
    expect(activeApprovedDecisions(proposed)).toHaveLength(0);

    let addition = buildSharedTaskSystemPromptAddition({ context: proposed });
    expect(addition ?? "").not.toContain("Use freeze window");

    const approved = approveSharedDecision({
      context: proposed,
      decisionId: "d1",
      evidenceRefs: ["msrc_1"],
      updatedBy: "u1",
    });
    expect(activeApprovedDecisions(approved)).toHaveLength(1);
    addition = buildSharedTaskSystemPromptAddition({ context: approved });
    expect(addition).toContain("Use freeze window");

    const superseded = supersedeSharedDecision({
      context: approved,
      previousDecisionId: "d1",
      newText: "Use staged rollout instead",
      evidenceRefs: ["msrc_2"],
      newDecisionId: "d2",
      updatedBy: "u1",
    });
    const active = activeApprovedDecisions(superseded);
    expect(active).toHaveLength(1);
    expect(active[0]?.text).toContain("staged rollout");
    addition = buildSharedTaskSystemPromptAddition({ context: superseded });
    expect(addition).toContain("staged rollout");
    expect(addition).not.toContain("Use freeze window");
  });

  it("rejects approve without evidence", () => {
    const base = emptySharedTaskContext({
      conversationId: "c1",
      groupId: "g1",
      updatedBy: "u1",
    });
    const proposed = proposeSharedDecision({
      context: base,
      text: "Secret plan",
      decisionId: "d1",
      updatedBy: "u1",
    });
    expect(() =>
      approveSharedDecision({
        context: proposed,
        decisionId: "d1",
        evidenceRefs: [],
        updatedBy: "u1",
      }),
    ).toThrow(/evidence/i);
  });

  it("strips private markers from mission", async () => {
    const store = new InMemorySharedTaskContextStore();
    const base = emptySharedTaskContext({
      conversationId: "c1",
      groupId: "g1",
      updatedBy: "u1",
    });
    const saved = await store.save({
      ...base,
      revision: 1,
      mission: "Plan with chain-of-thought details",
      hardConstraints: [{ text: "No PII", evidenceRefs: ["e1"] }],
    });
    expect(saved.mission).toContain("[redacted]");
    expect(saved.mission).not.toMatch(/chain-of-thought/i);
  });

  it("enforces revision concurrency", async () => {
    const store = new InMemorySharedTaskContextStore();
    const base = emptySharedTaskContext({
      conversationId: "c1",
      groupId: "g1",
      updatedBy: "u1",
    });
    await store.save({ ...base, revision: 1, mission: "a" }, 0);
    await expect(store.save({ ...base, revision: 2, mission: "b" }, 0)).rejects.toBeInstanceOf(
      SharedTaskContextConcurrencyError,
    );
  });

  it("fits injection under token budget", () => {
    const fitted = fitSharedTaskContextToBudget({
      context: {
        ...emptySharedTaskContext({
          conversationId: "c1",
          groupId: "g1",
          updatedBy: "u1",
        }),
        mission: "M".repeat(200),
        currentPhase: "build",
        approvedDecisions: [
          {
            decisionId: "d1",
            text: "D".repeat(200),
            status: "APPROVED",
            evidenceRefs: ["e1"],
          },
        ],
        hardConstraints: [{ text: "C".repeat(200), evidenceRefs: ["e2"] }],
      },
      maxTokens: 40,
      estimateTokens: (t) => Math.ceil(t.length / 4),
    });
    expect(fitted.truncated).toBe(true);
    expect(fitted.text.length).toBeGreaterThan(0);
  });
});
