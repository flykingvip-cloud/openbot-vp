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
      executionSource: {
        processId: "p1",
        epoch: "epoch-test",
        retention: "process_memory",
        capacity: 1000,
        ttlMs: 900000,
        evictedCount: 0,
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
      "epoch-test",
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
});
