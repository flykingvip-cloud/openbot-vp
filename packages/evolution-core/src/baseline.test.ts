import { describe, expect, it } from "vitest";
import { classifyBaselineCapture } from "./baseline.js";
import { workingDnaMetricSet } from "./metrics.js";

const metrics = workingDnaMetricSet();

describe("baseline capture classification", () => {
  it("marks an empty capture as missing", () => {
    expect(
      classifyBaselineCapture({
        experiment: {
          experimentId: "exp-1",
          primaryMetric: metrics.primary,
          guardrailMetrics: metrics.guardrails,
        },
        samples: [],
      }).status,
    ).toBe("missing");
  });

  it("marks a capture without critical guardrails as incomplete", () => {
    const capture = classifyBaselineCapture({
      experiment: {
        experimentId: "exp-1",
        primaryMetric: metrics.primary,
        guardrailMetrics: metrics.guardrails,
      },
      samples: [{ metricId: "task_success_rate", value: 0.7, sampleSize: 40, windowRef: "w" }],
    });
    expect(capture.status).toBe("incomplete");
    expect(capture.missingCriticalGuardrails).toContain("security_violations");
  });

  it("freezes a complete primary plus critical guardrail capture", () => {
    const capture = classifyBaselineCapture({
      experiment: {
        experimentId: "exp-1",
        primaryMetric: metrics.primary,
        guardrailMetrics: metrics.guardrails,
      },
      samples: [
        { metricId: "task_success_rate", value: 0.7, sampleSize: 40, windowRef: "w" },
        { metricId: "security_violations", value: 0, sampleSize: 40, windowRef: "w" },
        { metricId: "cross_tenant_contamination", value: 0, sampleSize: 40, windowRef: "w" },
      ],
    });
    expect(capture.status).toBe("frozen");
    expect(capture.primaryPresent).toBe(true);
    expect(capture.missingCriticalGuardrails).toEqual([]);
  });
});
