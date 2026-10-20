import { describe, expect, it } from "vitest";
import {
  CONVERSATION_TASK_SAMPLES,
  SAMPLE_CATEGORIES,
  samplesByCategory,
  type SampleCategory,
} from "./dataset.js";
import { QUALIFICATION_KINDS, SIDE_EFFECT_CLASSES, workTypeForQualification } from "./types.js";

describe("conversation-task dataset integrity", () => {
  it("has unique sample ids", () => {
    const ids = CONVERSATION_TASK_SAMPLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses valid qualification kinds and side-effect classes", () => {
    for (const sample of CONVERSATION_TASK_SAMPLES) {
      expect(QUALIFICATION_KINDS).toContain(sample.goldQualification);
      expect(SIDE_EFFECT_CLASSES).toContain(sample.goldSideEffect);
    }
  });

  it("keeps qualification/work-type mapping consistent", () => {
    for (const sample of CONVERSATION_TASK_SAMPLES) {
      const workType = workTypeForQualification(sample.goldQualification);
      if (sample.goldQualification === "needs_clarification") {
        expect(workType).toBeUndefined();
      } else {
        expect(workType).toBeDefined();
      }
    }
  });

  it("covers every required scenario category", () => {
    const required: SampleCategory[] = [
      "ordinary_qa",
      "short_action",
      "reminder",
      "scheduled_action",
      "long_running",
      "wait_no_escalation",
      "revision_intent",
      "side_effect_authorization",
      "duplicate_idempotency",
      "model_completion_claim",
      "fuzzy_negative",
    ];
    const byCat = samplesByCategory();
    for (const category of required) {
      expect(SAMPLE_CATEGORIES).toContain(category);
      expect((byCat.get(category) ?? []).length).toBeGreaterThan(0);
    }
  });

  it("marks true long-running samples as surviving the first round", () => {
    for (const sample of CONVERSATION_TASK_SAMPLES) {
      if (sample.goldQualification === "long_running_candidate") {
        expect(sample.goldSurvivesFirstRound).toBe(true);
      }
    }
  });

  it("has at least two duplicate-delivery samples sharing one message id", () => {
    const dups = samplesByCategory().get("duplicate_idempotency") ?? [];
    expect(dups.length).toBeGreaterThanOrEqual(2);
    const messageIds = new Set(dups.map((s) => s.input.messageId));
    expect(messageIds.size).toBe(1);
  });

  it("keeps message ids unique outside the duplicate-idempotency category", () => {
    const nonDup = CONVERSATION_TASK_SAMPLES.filter((s) => s.category !== "duplicate_idempotency");
    const messageIds = nonDup.map((s) => s.input.messageId);
    expect(new Set(messageIds).size).toBe(messageIds.length);
  });

  it("carries a CT7 matched pair (same kind with/without side effect)", () => {
    const withWrite = CONVERSATION_TASK_SAMPLES.find((s) => s.id === "ct-auth-02");
    const withoutSideEffect = CONVERSATION_TASK_SAMPLES.find((s) => s.id === "ct-auth-03");
    expect(withWrite?.goldQualification).toBe(withoutSideEffect?.goldQualification);
    expect(withWrite?.goldSideEffect).toBe("external_write");
    expect(withoutSideEffect?.goldSideEffect).toBe("none");
  });

  it("only annotates fuzzy misses as detector misses", () => {
    for (const sample of CONVERSATION_TASK_SAMPLES) {
      if (sample.expectedDetectorMiss) {
        expect(sample.category).toBe("fuzzy_negative");
      }
    }
  });
});
