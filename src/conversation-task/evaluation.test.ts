import { describe, expect, it } from "vitest";
import { CONVERSATION_TASK_SAMPLES } from "./dataset.js";
import { assertQualificationPure, assertSideEffectOrthogonal } from "./invariants.js";
import { evaluateDataset } from "./metrics.js";
import { qualifyTurn } from "./qualification.js";
import { evaluateTurn } from "./replay.js";

describe("dataset-driven detection + qualification", () => {
  for (const sample of CONVERSATION_TASK_SAMPLES) {
    it(`${sample.id} (${sample.category})`, () => {
      const decision = evaluateTurn(sample.input);

      // Side-effect classification always matches gold (orthogonal to duration).
      expect(decision.sideEffect).toBe(sample.goldSideEffect);

      // Qualification result must be pure-shaped.
      assertQualificationPure(decision.qualification);

      if (sample.expectedDetectorMiss) {
        // High-precision detector intentionally skips fuzzy true-L2.
        expect(decision.detection.detected).toBe(false);
        expect(decision.qualification.kind).toBe("chat");
      } else {
        expect(decision.detection.detected).toBe(sample.goldDetected);
        expect(decision.qualification.kind).toBe(sample.goldQualification);
      }
    });
  }
});

describe("shadow metrics thresholds", () => {
  const report = evaluateDataset();

  it("achieves 100% Upgrade Precision (>= 95% target)", () => {
    expect(report.upgradePrecision).toBeGreaterThanOrEqual(0.95);
    expect(report.upgradePrecision).toBe(1);
  });

  it("has zero false upgrades and zero false detections", () => {
    expect(report.detection.precision).toBe(1);
  });

  it("recovers full recall once intentional fuzzy misses are excluded", () => {
    expect(report.detection.recallExcludingIntentionalMisses).toBe(1);
    expect(report.intentionalMisses).toBe(1);
  });

  it("classifies every side effect correctly", () => {
    expect(report.sideEffectAccuracy).toBe(1);
  });

  it("only mismatches on the intentionally missed fuzzy L2 sample", () => {
    expect(report.mismatches).toEqual([
      { id: "ct-fuzzy-01", goldQualification: "long_running_candidate", predicted: "chat" },
    ]);
  });

  it("reports a survival proxy over predicted upgrades", () => {
    expect(report.taskSurvivalProxy).toBe(1);
  });
});

describe("explicit multi-step / multi-flow upgrade", () => {
  it("upgrades an explicitly named multi-step plan without monitor words", () => {
    const named = qualifyTurn({
      messageId: "wf-1",
      text: "这是一个多步骤任务：先调研竞品，再出方案，最后评审通过后落地",
    });
    expect(named.kind).toBe("long_running_candidate");
    expect(named.reasons).toContain("explicit_multi_step_workflow");
  });

  it("does not upgrade a one-run sequential or a labeled one-shot translation", () => {
    expect(qualifyTurn({ messageId: "wf-2", text: "先查一下再发给我" }).kind).toBe("short_action");
    expect(qualifyTurn({ messageId: "wf-3", text: "分三步把这段话翻译成英文" }).kind).toBe(
      "short_action",
    );
  });
});

describe("CT7 side-effect orthogonality (empirical)", () => {
  it("keeps the same kind with and without a side effect", () => {
    const withExternalWrite = qualifyTurn({ messageId: "a", text: "把这个方案同步到 CRM 里" });
    const withoutSideEffect = qualifyTurn({ messageId: "b", text: "把这个方案整理一下" });
    assertSideEffectOrthogonal(withoutSideEffect.kind, withExternalWrite.kind);
    expect(withExternalWrite.kind).toBe("short_action");

    const withBroadcast = qualifyTurn({
      messageId: "c",
      text: "整理一下发给全部销售",
      hasActiveTaskBinding: true,
    });
    const plain = qualifyTurn({ messageId: "d", text: "整理一下", hasActiveTaskBinding: true });
    assertSideEffectOrthogonal(plain.kind, withBroadcast.kind);
  });
});
