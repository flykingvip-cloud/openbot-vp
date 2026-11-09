import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { EvidenceProjection } from "./evidence-model.ts";
import { renderObservationEvidence } from "./evidence-panel.ts";
describe("evidence panel", () => {
  it("shows independent layers and clears evidence when input is revoked", () => {
    const container = document.createElement("div");
    const projection: EvidenceProjection = {
      schemaVersion: 1,
      metricDictVersion: 1,
      projectedAt: 123,
      sourceWatermark: null,
      executorTechnicalEvidence: {
        schemaVersion: 1,
        layer: "technical",
        state: "unknown",
        reasons: ["executor_read_failed"],
        calls: [],
        associations: [],
        runTotalCost: null,
        improvementEligible: false,
      },
      executionSource: {
        scopeWatermark: {
          state: "unknown",
          trackingEpoch: null,
          trackingStartedAt: null,
          priorHistory: "unknown",
          ingestSequence: null,
          expiredCount: null,
          capacityEvictedCount: null,
          retainedFromSequence: null,
          retainedToSequence: null,
          retainedFromOccurredAt: null,
          retainedToOccurredAt: null,
        },
        processId: "11111111-1111-4111-8111-111111111111",
        epoch: "22222222-2222-4222-8222-222222222222",
        retention: "process_memory",
        capacity: 1000,
        ttlMs: 900000,
        evictedCount: null,
        discardedThrough: null,
        sourceWatermark: null,
        reasons: ["retention_continuity_unknown"],
      },
      window: { from: 0, to: 200 },
      evidenceLookupWindow: { from: -1000, to: 200 },
      coverage: {
        attemptedCount: 1,
        fullyLinkedCount: 0,
        invalidCount: 0,
        link: 0,
        events: { state: "unknown", reason: "source_event_denominator_unavailable" },
        fields: { state: "unknown", reason: "required_field_denominator_unavailable" },
        reasons: [],
      },
      samples: [
        {
          sampleId: "sample-secret-id",
          qualification: "execution_only",
          improvementEligible: false,
          improvementReasons: ["missing_outcome"],
          reasons: ["missing_outcome", "outside_cohort_window"],
          provenance: ["seed"],
          outcome: null,
          executionRefs: [],
          evidence: {
            resource: "unknown",
            technical: "unknown",
            execution: "partial",
            business: "unknown",
          },
          evidenceReasons: {
            resource: [],
            technical: [],
            execution: [],
            business: ["missing_outcome"],
          },
          attributedCost: null,
        },
      ],
    };
    render(renderObservationEvidence(projection), container);
    for (const label of [
      "执行器技术调用",
      "运行总成本：未知",
      "executor_read_failed",
      "资源健康",
      "技术调用",
      "任务执行",
      "业务结果",
      "execution_only",
      "seed",
      "非生产",
      "可归属成本：未知",
      "Asia/Shanghai",
      "cohort统计窗口",
      "支持证据检索窗口",
      "不计入该窗口统计",
      "process_memory",
      "900000",
      "22222222-2222-4222-8222-222222222222",
      "retention_continuity_unknown",
      "关联回执不等于执行事件",
    ]) {
      expect(container.textContent).toContain(label);
    }
    expect(container.querySelectorAll("button,form,input")).toHaveLength(0);
    render(renderObservationEvidence(null), container);
    expect(container.querySelector("article")).toBeNull();
    expect(container.textContent).not.toContain("seed");
    expect(container.textContent).toContain("无可用授权证据");
  });

  it("renders multiple injected candidates, window/source distinction and attribution gaps then clears", () => {
    const container = document.createElement("div");
    const projection: EvidenceProjection = {
      schemaVersion: 1,
      metricDictVersion: 1,
      samples: [],
      projectedAt: 100,
      sourceWatermark: null,
      window: { from: 0, to: 100 },
      coverage: {
        attemptedCount: 0,
        fullyLinkedCount: 0,
        invalidCount: 0,
        link: null,
        events: { state: "unknown", reason: "missing" },
        fields: { state: "unknown", reason: "missing" },
        reasons: [],
      },
      executorTechnicalEvidence: {
        schemaVersion: 1,
        layer: "technical",
        state: "partial",
        completeness: "partial",
        sourceCompleteness: {
          overall: "complete",
          callChain: "complete",
          costAttribution: "complete",
        },
        sourceWatermark: 200,
        retention: {
          policy: "bounded_file_log",
          maxCallFiles: 64,
          durableAcrossRestart: true,
          completeHistory: false,
        },
        reasons: ["window_filtered", "source_watermark_is_not_window_coverage"],
        runTotalCost: null,
        improvementEligible: false,
        calls: ["one", "two"].map((id) => ({
          callId: id,
          evidenceId: "ev-" + id,
          runId: "run",
          candidateAttemptId: "candidate-" + id,
          attemptKind: "fallback_candidate",
          provider: "isolated",
          model: "fake",
          status: "completed",
          startedAt: 1,
          completedAt: 2,
          observedAt: 2,
          provenance: "injected",
          collector: "test",
          usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 },
          usageAggregation: "per_call",
        })),
        associations: [
          {
            callId: "one",
            callEvidenceId: "ev-one",
            runId: "run",
            candidateAttemptId: "candidate-one",
            taskAttemptId: "task-attempt",
            finalOutcomeVersion: 2,
            chargeOutcomeVersion: 1,
            completeness: "partial",
            budgetDisposition: "absent",
            budgetChargeReasons: ["charge_unknown"],
            committedAttribution: { status: "unknown", amount: null, usageFingerprint: null },
            callEstimate: null,
          },
        ],
        attributionGaps: [
          {
            runId: "run",
            taskAttemptId: "task-attempt",
            finalOutcomeVersion: 2,
            budgetDisposition: "absent",
            reasons: ["missing_call_identity"],
          },
        ],
      },
    };
    render(renderObservationEvidence(projection), container);
    const technical = container.querySelector('[aria-label="执行器技术调用证据"]')!;
    for (const label of [
      "candidate-one",
      "candidate-two",
      "task-attempt",
      "injected",
      "不作为生产验证",
      "window_filtered",
      "源完整性：complete",
      "当前窗口完整性：partial",
      "不等于窗口覆盖",
      "missing_call_identity",
      "charge_unknown",
      "运行总成本：未知",
    ]) {
      expect(technical.textContent).toContain(label);
    }
    expect(technical.querySelectorAll("article")).toHaveLength(2);
    render(renderObservationEvidence(null), container);
    expect(container.textContent).not.toContain("candidate-one");
    expect(container.textContent).not.toContain("missing_call_identity");
    expect(container.querySelectorAll("article")).toHaveLength(0);
  });
});
