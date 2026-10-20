import { describe, expect, it } from "vitest";
import { asStringArray, isRecord, nonEmptyString } from "./json-values.js";

describe("json value readers", () => {
  it("accepts object bags, including arrays, and rejects nullish or primitive values", () => {
    // Arrays stay records. Gateway isRecord (#1248) rejects them; do not align this.
    expect(isRecord({ id: "evt" })).toBe(true);
    expect(isRecord([])).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("evt")).toBe(false);
  });

  it("treats blank strings as empty and keeps surrounding text", () => {
    expect(nonEmptyString("  goal  ")).toBe(true);
    expect(nonEmptyString("   ")).toBe(false);
    expect(nonEmptyString(1)).toBe(false);
  });

  it("keeps only string entries from a list", () => {
    expect(asStringArray(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(asStringArray("a")).toEqual([]);
  });
});
