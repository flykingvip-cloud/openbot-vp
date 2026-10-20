import { describe, expect, it } from "vitest";
import { estimateTokensFromText, planContextBudget } from "./context-budget.js";
import {
  buildRuleProjection,
  computeProjectionDedupKey,
  InMemoryProjectionStore,
  refreshConversationProjection,
} from "./projection.js";

describe("CL-P2-01 context budget planner", () => {
  it("uses model window dynamically and never assumes fixed 8k", () => {
    const small = planContextBudget({
      modelContextTokens: 16_000,
      mandatoryPolicyTokens: 1_000,
      currentInputTokens: 500,
      recentTurnsTokens: 20_000,
    });
    const large = planContextBudget({
      modelContextTokens: 128_000,
      mandatoryPolicyTokens: 1_000,
      currentInputTokens: 500,
      recentTurnsTokens: 20_000,
    });
    expect(small.modelContextTokens).toBe(16_000);
    expect(large.modelContextTokens).toBe(128_000);
    expect(large.availableInputBudget).toBeGreaterThan(small.availableInputBudget);
    expect(large.trace.recentTurnsAllocated).toBeGreaterThan(small.trace.recentTurnsAllocated);
  });

  it("never drops mandatory policy or silently discards current input overflow", () => {
    const plan = planContextBudget({
      modelContextTokens: 8_000,
      outputReserveTokens: 2_000,
      toolProtocolReserveTokens: 1_000,
      mandatoryPolicyTokens: 3_000,
      currentInputTokens: 5_000,
    });
    // available = 8000 - 2000 - 1000 - 3000 = 2000 < 5000 input
    expect(plan.overflow).toBe(true);
    expect(plan.overflowReason).toBe("current_input_exceeds_available_budget");
    const mandatory = plan.slices.find((s) => s.kind === "mandatory_policy");
    expect(mandatory?.allocatedTokens).toBe(3_000);
    expect(mandatory?.truncated).toBe(false);
    const input = plan.slices.find((s) => s.kind === "current_input");
    expect(input?.truncated).toBe(true);
    expect(plan.trace.truncatedKinds).toContain("current_input");
  });

  it("caps optional memory and recent turns within shares", () => {
    const plan = planContextBudget({
      modelContextTokens: 100_000,
      outputReserveTokens: 10_000,
      toolProtocolReserveTokens: 5_000,
      mandatoryPolicyTokens: 5_000,
      currentInputTokens: 2_000,
      approvedTaskContextTokens: 50_000,
      recentTurnsTokens: 50_000,
      runtimeSummaryTokens: 20_000,
      retrievedMemoryTokens: 20_000,
    });
    // available after mandatory = 100k - 10k - 5k - 5k = 80k; after input 78k
    expect(plan.trace.memoryAllocated).toBeLessThanOrEqual(Math.floor(78_000 * 0.1) + 1);
    expect(plan.trace.approvedTaskAllocated).toBeLessThanOrEqual(Math.floor(78_000 * 0.2) + 1);
    expect(plan.overflow).toBe(false);
  });

  it("estimates tokens without empty-string zero division", () => {
    expect(estimateTokensFromText("")).toBe(0);
    expect(estimateTokensFromText("abcd")).toBe(1);
    expect(estimateTokensFromText("a".repeat(40))).toBe(10);
  });
});

describe("CL-P2-02 conversation projection", () => {
  it("builds rule projection with evidence-backed context only", () => {
    const projection = buildRuleProjection({
      conversationId: "conv_1",
      participants: ["u1"],
      userTexts: [
        "Please ship the report by Friday. Order ORD-99881 costs $12,500.",
        "We decided: use the new API only. Todo: notify finance.",
      ],
      assistantTexts: ["Acknowledged the Friday deadline."],
      sources: [
        {
          sourceIdentityId: "msrc_1",
          bindingId: "b1",
          sessionId: "s1",
          firstTurnId: "t1",
          lastTurnId: "t2",
          sourceChecksum: "abc",
        },
      ],
    });
    expect(projection.generatedBy.kind).toBe("RULE");
    expect(projection.shortSummary.toLowerCase()).toMatch(/friday|ship|report/);
    expect(projection.importantContext.length).toBeGreaterThan(0);
    expect(projection.importantContext.every((c) => c.evidenceRefs.includes("msrc_1"))).toBe(true);
    expect(projection.pendingTasks.length).toBeGreaterThan(0);
    expect(
      projection.decisions.every((d) => d.status !== "APPROVED" || d.evidenceRefs.length > 0),
    ).toBe(true);
  });

  it("never leaves APPROVED decisions without evidence", () => {
    const projection = buildRuleProjection({
      conversationId: "conv_no_src",
      participants: [],
      userTexts: ["We decided: delete all logs permanently."],
      sources: [],
    });
    expect(projection.decisions.every((d) => d.status !== "APPROVED")).toBe(true);
  });

  it("skips regeneration when source fingerprints unchanged", async () => {
    const store = new InMemoryProjectionStore();
    const input = {
      conversationId: "conv_2",
      participants: ["u1"],
      userTexts: ["Goal A"],
      sources: [
        {
          sourceIdentityId: "msrc_a",
          bindingId: "b1",
          sessionId: "s1",
          firstTurnId: "t1",
          lastTurnId: "t1",
          sourceChecksum: "c1",
        },
      ],
    };
    const first = await refreshConversationProjection({ store, input });
    expect(first.skipped).toBe(false);
    const second = await refreshConversationProjection({ store, input });
    expect(second.skipped).toBe(true);
    expect(second.projection.revision).toBe(first.projection.revision);

    const keyA = computeProjectionDedupKey({
      conversationId: "conv_2",
      sourceFingerprints: ["msrc_a:c1"],
    });
    const keyB = computeProjectionDedupKey({
      conversationId: "conv_2",
      sourceFingerprints: ["msrc_a:c2"],
    });
    expect(keyA).not.toBe(keyB);
  });
});
