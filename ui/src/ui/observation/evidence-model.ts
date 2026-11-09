import type { readExecutorTechnicalEvidence } from "../../../../src/observation/executor-technical-evidence.js";
type TechnicalEvidence = Extract<
  ReturnType<typeof readExecutorTechnicalEvidence>,
  { ok: true }
>["technicalEvidence"];
import type { projectExecutionEvidence } from "../../../../src/observation/execution-projection.js";
import type { assembleObservationSamples } from "../../../../src/observation/sample-assembler.js";
export type EvidenceProjection = Omit<
  ReturnType<typeof assembleObservationSamples>,
  "evidenceLookupWindow"
> & {
  evidenceLookupWindow?: ReturnType<typeof assembleObservationSamples>["evidenceLookupWindow"];
  executorTechnicalEvidence?: TechnicalEvidence;
  executionSource?: ReturnType<typeof projectExecutionEvidence>["executionSource"];
};
export function evidenceModel(projection: EvidenceProjection | null) {
  const supported =
    projection === null || (projection.schemaVersion === 1 && projection.metricDictVersion === 1);
  const data = supported ? projection : null;
  return {
    samples: data?.samples ?? [],
    technical: data?.executorTechnicalEvidence ?? null,
    executionSource: data?.executionSource ?? null,
    projectedAt: data?.projectedAt ?? null,
    watermark: data?.sourceWatermark ?? null,
    coverage: data?.coverage ?? null,
    window: data?.window ?? null,
    evidenceLookupWindow: data?.evidenceLookupWindow ?? null,
    metricDictVersion: data?.metricDictVersion ?? null,
    unavailableReason: supported ? null : "不支持的证据或指标字典版本",
  };
}
export function evidenceTime(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "未知"
    : new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(value) + " Asia/Shanghai";
}
