import type { CanonicalUnitIntervalScore } from "./types.js";

const IEEE754_HEX = /^[0-9a-f]{16}$/;

export type InvalidScore = { ok: false; error: "invalid_score" };

/** Reject non-finite, NaN, Infinity, -0, and values outside [0, 1] before hex. */
export function encodeUnitIntervalScore(
  value: unknown,
): { ok: true; score: CanonicalUnitIntervalScore } | InvalidScore {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0)) {
    return { ok: false, error: "invalid_score" };
  }
  if (value < 0 || value > 1) {
    return { ok: false, error: "invalid_score" };
  }
  const buf = Buffer.alloc(8);
  buf.writeDoubleBE(value, 0);
  return { ok: true, score: { ieee754Hex: buf.toString("hex") } };
}

export function hexToFloat64(ieee754Hex: string): number {
  if (!IEEE754_HEX.test(ieee754Hex)) {
    throw new Error("invalid_score");
  }
  return Buffer.from(ieee754Hex, "hex").readDoubleBE(0);
}

export function isIeee754Hex(value: unknown): value is string {
  return typeof value === "string" && IEEE754_HEX.test(value);
}
