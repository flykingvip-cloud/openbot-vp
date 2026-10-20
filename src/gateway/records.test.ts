import { describe, expect, it } from "vitest";
import {
  exactMember,
  isRecord,
  looseRecordOrEmpty,
  numberValue,
  recordOrEmpty,
  recordOrNull,
  stringValue,
} from "./records.js";

describe("gateway records", () => {
  it("isRecord rejects null and arrays", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  it("recordOrNull and recordOrEmpty drop arrays", () => {
    expect(recordOrNull({ a: 1 })).toEqual({ a: 1 });
    expect(recordOrNull([])).toBeNull();
    expect(recordOrNull(null)).toBeNull();
    expect(recordOrEmpty({ a: 1 })).toEqual({ a: 1 });
    expect(recordOrEmpty([])).toEqual({});
    expect(recordOrEmpty(undefined)).toEqual({});
  });

  it("looseRecordOrEmpty keeps arrays", () => {
    const items = ["a"];
    expect(looseRecordOrEmpty(items)).toBe(items);
    expect(looseRecordOrEmpty(null)).toEqual({});
    expect(looseRecordOrEmpty("x")).toEqual({});
  });

  it("stringValue trims and drops blanks", () => {
    expect(stringValue("  ok  ")).toBe("ok");
    expect(stringValue("   ")).toBeNull();
    expect(stringValue(1)).toBeNull();
  });

  it("numberValue keeps finite numbers", () => {
    expect(numberValue(1.5)).toBe(1.5);
    expect(numberValue(Number.NaN)).toBeNull();
    expect(numberValue("1")).toBeNull();
  });

  it("exactMember does not trim", () => {
    expect(exactMember("销售", ["销售", "HR"] as const)).toBe("销售");
    expect(exactMember(" 销售 ", ["销售", "HR"] as const)).toBeNull();
    expect(exactMember("nope", ["销售"] as const)).toBeNull();
    expect(exactMember(1, ["销售"] as const)).toBeNull();
  });
});
