import { describe, expect, it } from "vitest";
import {
  assertRawHash,
  assertReceiptUsable,
  assertSpanInPreview,
  isReceiptUsable,
  lintRawHash,
  lintReceipt,
  lintSpanInPreview,
} from "./integrity.js";

describe("ke integrity", () => {
  it("treats consumed and partial receipts as usable", () => {
    expect(isReceiptUsable({ status: "consumed" })).toBe(true);
    expect(isReceiptUsable({ status: "partial" })).toBe(true);
    expect(lintReceipt({ status: "consumed" }).ok).toBe(true);
  });

  it("fail-closes denied, unavailable, and other statuses", () => {
    expect(lintReceipt({ status: "denied" }).ok).toBe(false);
    expect(lintReceipt({ status: "unavailable" }).ok).toBe(false);
    expect(() => assertReceiptUsable({ status: "denied" })).toThrow(/not usable/);
  });

  it("requires matching raw_hash", () => {
    expect(lintRawHash("abc", "abc").ok).toBe(true);
    expect(lintRawHash("abc", "xyz").ok).toBe(false);
    expect(lintRawHash("  ", "  ").ok).toBe(false);
    expect(() => assertRawHash("abc", "xyz")).toThrow(/mismatch/);
  });

  it("requires evidence span to be grep-able in preview", () => {
    const preview = "第一条 合同自签署日起生效。\\n第二条 保密。";
    expect(lintSpanInPreview(preview, "合同自签署日起生效").ok).toBe(true);
    expect(lintSpanInPreview(preview, "赔偿上限").ok).toBe(false);
    expect(() => assertSpanInPreview(preview, "")).toThrow(/empty/);
  });
});
