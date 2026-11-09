import { describe, expect, it } from "vitest";
import { evidenceModel, type EvidenceProjection } from "./evidence-model.ts";
describe("evidence model", () => {
  it("does not infer a missing lookup window from the cohort", () => {
    const projection = {
      schemaVersion: 1,
      metricDictVersion: 1,
      samples: [],
      window: { from: 10, to: 20 },
    } as unknown as EvidenceProjection;
    expect(evidenceModel(projection).evidenceLookupWindow).toBeNull();
    expect(
      evidenceModel({ ...projection, evidenceLookupWindow: { from: 0, to: 20 } })
        .evidenceLookupWindow,
    ).toEqual({ from: 0, to: 20 });
  });
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
