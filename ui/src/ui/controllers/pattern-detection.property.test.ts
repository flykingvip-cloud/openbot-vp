import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLDS,
  evaluatePatternHint,
  type PatternDetectionHint,
  type PatternDetectionThresholds,
  type PatternSignal,
} from "./pattern-detection.ts";

// Feature: skill-lifecycle-asset-system, Property 23: 模式阈值生成建议
// For any 工作模式序列 p，当 p.repetitionCount >= threshold 且结构稳定性 >= 预设值时，
// 系统生成一条"检测到可复用能力"的保存建议；低于阈值则不生成。

/**
 * Validates: Requirements 2.1, 11.1, 11.2
 */

const SIGNAL_KINDS: PatternSignal["kind"][] = [
  "repeated_task",
  "stable_prompt",
  "fixed_workflow",
  "repeated_toolchain",
  "stable_io",
];

const signalKindArb = fc.constantFrom(...SIGNAL_KINDS);

const signalArb = (opts?: { minSampleCount?: number; maxSampleCount?: number }) =>
  fc.record({
    kind: signalKindArb,
    description: fc.string({ minLength: 1, maxLength: 50 }),
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    detectedAt: fc.integer({ min: 0, max: 2_000_000_000_000 }),
    sampleCount: fc.integer({
      min: opts?.minSampleCount ?? 0,
      max: opts?.maxSampleCount ?? 20,
    }),
  });

const thresholdsArb: fc.Arbitrary<PatternDetectionThresholds> = fc.record({
  minRepetitions: fc.integer({ min: 1, max: 10 }),
  minConfidence: fc.double({ min: 0.1, max: 1.0, noNaN: true }),
  minSignalCount: fc.integer({ min: 1, max: 5 }),
});

describe("pattern-detection property tests", () => {
  it("generates suggestion when all thresholds are met (Property 23 - positive)", () => {
    // Feature: skill-lifecycle-asset-system, Property 23: 模式阈值生成建议
    fc.assert(
      fc.property(thresholdsArb, (thresholds) => {
        // Construct a hint that meets all thresholds
        const signals: PatternSignal[] = Array.from(
          { length: thresholds.minSignalCount },
          (_, i) => ({
            kind: SIGNAL_KINDS[i % SIGNAL_KINDS.length],
            description: `signal-${i}`,
            confidence: thresholds.minConfidence,
            detectedAt: Date.now(),
            sampleCount: i === 0 ? thresholds.minRepetitions : 1,
          }),
        );

        const hint: PatternDetectionHint = {
          agentId: "agent-test",
          contextId: "ctx-test",
          signals,
          overallConfidence: thresholds.minConfidence,
          suggestedName: "测试能力",
          suggestedSummary: "检测到一个可复用的能力",
        };

        expect(evaluatePatternHint(hint, thresholds)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("does not generate suggestion when confidence below threshold (Property 23 - negative confidence)", () => {
    // Feature: skill-lifecycle-asset-system, Property 23: 模式阈值生成建议
    fc.assert(
      fc.property(
        thresholdsArb,
        fc.double({ min: 0, max: 0.99, noNaN: true }),
        (thresholds, confidenceRatio) => {
          // Ensure confidence is strictly below threshold
          const belowConfidence = thresholds.minConfidence * confidenceRatio;
          if (belowConfidence >= thresholds.minConfidence) {
            return; // skip edge case where ratio rounds up
          }

          const signals: PatternSignal[] = Array.from(
            { length: thresholds.minSignalCount + 2 },
            (_, i) => ({
              kind: SIGNAL_KINDS[i % SIGNAL_KINDS.length],
              description: `signal-${i}`,
              confidence: 0.9,
              detectedAt: Date.now(),
              sampleCount: thresholds.minRepetitions + 5,
            }),
          );

          const hint: PatternDetectionHint = {
            agentId: "agent-test",
            contextId: "ctx-test",
            signals,
            overallConfidence: belowConfidence,
            suggestedName: "测试能力",
            suggestedSummary: "描述",
          };

          expect(evaluatePatternHint(hint, thresholds)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("does not generate suggestion when signal count below threshold (Property 23 - negative signal count)", () => {
    // Feature: skill-lifecycle-asset-system, Property 23: 模式阈值生成建议
    fc.assert(
      fc.property(thresholdsArb, (thresholds) => {
        // Fewer signals than required
        const signalCount = Math.max(0, thresholds.minSignalCount - 1);
        const signals: PatternSignal[] = Array.from({ length: signalCount }, (_, i) => ({
          kind: SIGNAL_KINDS[i % SIGNAL_KINDS.length],
          description: `signal-${i}`,
          confidence: 0.95,
          detectedAt: Date.now(),
          sampleCount: thresholds.minRepetitions + 10,
        }));

        const hint: PatternDetectionHint = {
          agentId: "agent-test",
          contextId: "ctx-test",
          signals,
          overallConfidence: 0.99,
          suggestedName: "测试能力",
          suggestedSummary: "描述",
        };

        expect(evaluatePatternHint(hint, thresholds)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("does not generate suggestion when no signal has enough repetitions (Property 23 - negative repetitions)", () => {
    // Feature: skill-lifecycle-asset-system, Property 23: 模式阈值生成建议
    fc.assert(
      fc.property(thresholdsArb, (thresholds) => {
        // All signals have sampleCount below minRepetitions
        const belowRepetitions = Math.max(0, thresholds.minRepetitions - 1);
        const signals: PatternSignal[] = Array.from(
          { length: thresholds.minSignalCount + 2 },
          (_, i) => ({
            kind: SIGNAL_KINDS[i % SIGNAL_KINDS.length],
            description: `signal-${i}`,
            confidence: 0.95,
            detectedAt: Date.now(),
            sampleCount: belowRepetitions,
          }),
        );

        const hint: PatternDetectionHint = {
          agentId: "agent-test",
          contextId: "ctx-test",
          signals,
          overallConfidence: 0.99,
          suggestedName: "测试能力",
          suggestedSummary: "描述",
        };

        expect(evaluatePatternHint(hint, thresholds)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("evaluatePatternHint is deterministic for same inputs", () => {
    // Feature: skill-lifecycle-asset-system, Property 23: 模式阈值生成建议
    fc.assert(
      fc.property(
        fc.array(signalArb(), { minLength: 0, maxLength: 6 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (signals, overallConfidence) => {
          const hint: PatternDetectionHint = {
            agentId: "agent-test",
            contextId: "ctx-test",
            signals,
            overallConfidence,
            suggestedName: "能力",
            suggestedSummary: "描述",
          };

          const result1 = evaluatePatternHint(hint, DEFAULT_THRESHOLDS);
          const result2 = evaluatePatternHint(hint, DEFAULT_THRESHOLDS);
          expect(result1).toBe(result2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
