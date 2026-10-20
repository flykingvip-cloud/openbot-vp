// @vitest-environment node
import { describe, expect, it } from "vitest";
import { pdfNeedsVisionOcr, SCANNED_PDF_MIN_TEXT_CHARS } from "./detect.js";

describe("pdfNeedsVisionOcr", () => {
  it("returns false when ocr is disabled", () => {
    expect(pdfNeedsVisionOcr("", false)).toBe(false);
    expect(pdfNeedsVisionOcr("", undefined)).toBe(false);
  });

  it("returns true for sparse text when ocr is enabled", () => {
    expect(pdfNeedsVisionOcr("", true)).toBe(true);
    expect(pdfNeedsVisionOcr("short", true)).toBe(true);
    expect(pdfNeedsVisionOcr(" ".repeat(SCANNED_PDF_MIN_TEXT_CHARS - 1), true)).toBe(true);
  });

  it("returns false for sufficiently long local text", () => {
    expect(pdfNeedsVisionOcr("x".repeat(SCANNED_PDF_MIN_TEXT_CHARS), true)).toBe(false);
  });
});
