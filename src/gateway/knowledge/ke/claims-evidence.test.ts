import { describe, expect, it } from "vitest";
import { lintClaimEvidence } from "./claims-evidence.js";

describe("ke claims-evidence", () => {
  it("accepts a heuristic claim with confidence and grep-able span", () => {
    const result = lintClaimEvidence({
      extraction_method: "heuristic",
      confidence: 0.9,
      evidence_span: "合同自签署日起生效",
      preview_text: "第一条 合同自签署日起生效。",
    });
    expect(result.ok).toBe(true);
    expect(result.method).toBe("heuristic");
    expect(result.violations).toEqual([]);
  });

  it("defaults omitted method to heuristic and flags missing confidence/span", () => {
    const result = lintClaimEvidence({});
    expect(result.method).toBe("heuristic");
    expect(result.violations).toEqual(["missing_confidence", "missing_span"]);
    expect(result.ok).toBe(false);
  });

  it("rejects unknown methods, out-of-range confidence, and spans not in preview", () => {
    expect(
      lintClaimEvidence({ extraction_method: "magic", confidence: 0.5, evidence_span: "a" })
        .violations,
    ).toContain("unknown_method");
    expect(lintClaimEvidence({ confidence: 1.2, evidence_span: "a" }).violations).toContain(
      "invalid_confidence",
    );
    expect(
      lintClaimEvidence({
        confidence: 0.4,
        evidence_span: "不存在的句子",
        preview_text: "原文在此",
      }).violations,
    ).toContain("span_not_in_preview");
  });
});
