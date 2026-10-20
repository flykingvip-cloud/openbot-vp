import { describe, expect, it } from "vitest";
import { assertChunkLineAnchors, assertIngestableExtract } from "./ingest-gate.js";

describe("ke ingest-gate", () => {
  it("accepts a hashed extractable document", () => {
    expect(() =>
      assertIngestableExtract({
        format: "markdown",
        cleanedText: "第一条 合同生效。",
        rawHash: "abc123",
      }),
    ).not.toThrow();
  });

  it("rejects unsupported, empty text, and missing raw_hash", () => {
    expect(() =>
      assertIngestableExtract({ format: "unsupported", cleanedText: "x", rawHash: "abc" }),
    ).toThrow(/unsupported document format/);
    expect(() =>
      assertIngestableExtract({ format: "text", cleanedText: "   ", rawHash: "abc" }),
    ).toThrow(/no extractable text/);
    expect(() =>
      assertIngestableExtract({ format: "text", cleanedText: "body", rawHash: "  " }),
    ).toThrow(/raw_hash missing/);
  });

  it("requires 1-based inclusive line anchors on chunks", () => {
    expect(() => assertChunkLineAnchors([{ startLine: 1, endLine: 3 }])).not.toThrow();
    expect(() => assertChunkLineAnchors([{ startLine: 0, endLine: 1 }])).toThrow(
      /missing line anchors/,
    );
    expect(() => assertChunkLineAnchors([{ startLine: 4, endLine: 2 }])).toThrow(
      /missing line anchors/,
    );
  });
});
