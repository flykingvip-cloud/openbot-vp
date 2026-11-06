import { describe, expect, it } from "vitest";
import { evidenceModel, type EvidenceProjection } from "./evidence-model.ts";
describe("evidence model", () => {
  it("clears evidence on revoked input", () => {
    expect(evidenceModel(null).samples).toEqual([]);
    expect(evidenceModel(null).coverage).toBeNull();
  });
  it("rejects unsupported schema and metric versions", () => {
    for (const versions of [
      { schemaVersion: 2, metricDictVersion: 1 },
      { schemaVersion: 1, metricDictVersion: 2 },
    ]) {
      const model = evidenceModel(versions as unknown as EvidenceProjection);
      expect(model.samples).toEqual([]);
      expect(model.coverage).toBeNull();
      expect(model.unavailableReason).toContain("不支持");
    }
  });
});
