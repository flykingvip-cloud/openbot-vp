// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseKnowledgeIngestParseOptions,
  resolveChunkingFromStrategy,
} from "./ingest-parse-options.js";

describe("ingest-parse-options", () => {
  it("maps chunking strategies to hierarchical chunk sizes", () => {
    expect(resolveChunkingFromStrategy("auto")).toEqual({ tokens: 400, overlap: 80 });
    expect(resolveChunkingFromStrategy("paragraph").tokens).toBeGreaterThan(400);
    expect(resolveChunkingFromStrategy("fixed").tokens).toBeLessThan(400);
  });

  it("parses ingestOptions from RPC payloads", () => {
    expect(
      parseKnowledgeIngestParseOptions({
        chunkingStrategy: "paragraph",
        ocrEnabled: false,
      }),
    ).toEqual({
      chunkingStrategy: "paragraph",
      ocrEnabled: false,
    });
    expect(parseKnowledgeIngestParseOptions({ chunkingStrategy: "invalid" })).toBeUndefined();
  });
});
