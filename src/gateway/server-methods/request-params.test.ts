import { describe, expect, it } from "vitest";
import { ErrorCodes } from "../protocol/index.js";
import {
  isRecord,
  nonemptyStrings,
  numberValue,
  oneOf,
  optionalString,
  requiredString,
  stringValue,
} from "./request-params.js";
import type { RespondFn } from "./types.js";

describe("request-params", () => {
  it("stringValue trims and drops blanks and non-strings", () => {
    expect(stringValue("  ok  ")).toBe("ok");
    expect(stringValue("   ")).toBeNull();
    expect(stringValue("")).toBeNull();
    expect(stringValue(1)).toBeNull();
    expect(stringValue(null)).toBeNull();
  });

  it("optionalString reads a param key", () => {
    expect(optionalString({ name: " ada " }, "name")).toBe("ada");
    expect(optionalString({}, "name")).toBeNull();
  });

  it("requiredString responds and returns null when missing", () => {
    const calls: Parameters<RespondFn>[] = [];
    const respond: RespondFn = (...args) => {
      calls.push(args);
    };
    expect(requiredString({ id: "  " }, "id", respond)).toBeNull();
    expect(calls).toEqual([
      [false, undefined, expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST })],
    ]);
    expect(calls[0]?.[2]?.message).toBe("id is required");
    expect(requiredString({ id: " abc " }, "id", respond)).toBe("abc");
  });

  it("nonemptyStrings keeps order and drops blanks", () => {
    expect(nonemptyStrings([" a ", "", "b", 1, "  ", null])).toEqual(["a", "b"]);
    expect(nonemptyStrings("nope")).toEqual([]);
    expect(nonemptyStrings(undefined)).toEqual([]);
  });

  it("oneOf trims before matching", () => {
    expect(oneOf("  group ", ["group", "position"] as const)).toBe("group");
    expect(oneOf("bot", ["group", "position"] as const)).toBeNull();
    expect(oneOf(1, ["group"] as const)).toBeNull();
  });

  it("isRecord rejects null and arrays", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });

  it("numberValue keeps finite numbers only", () => {
    expect(numberValue(0)).toBe(0);
    expect(numberValue(Number.NaN)).toBeNull();
    expect(numberValue("1")).toBeNull();
  });
});
