import type { assembleObservationSamples } from "../../../../src/observation/sample-assembler.js";
export type EvidenceProjection = ReturnType<typeof assembleObservationSamples>;
export function evidenceModel(projection: EvidenceProjection | null) {
  const supported =
    projection === null || (projection.schemaVersion === 1 && projection.metricDictVersion === 1);
  const data = supported ? projection : null;
  return {
    samples: data?.samples ?? [],
    projectedAt: data?.projectedAt ?? null,
    watermark: data?.sourceWatermark ?? null,
    coverage: data?.coverage ?? null,
    window: data?.window ?? null,
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
