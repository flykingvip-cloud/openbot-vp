/**
 * Ingest-time integrity gate. Uses ke lint helpers. Not a new RPC.
 */
import { lintRawHash } from "./integrity.js";

export type IngestExtractLintInput = {
  format: string;
  cleanedText: string;
  rawHash: string;
};

export type IngestChunkAnchor = {
  startLine?: number;
  endLine?: number;
};

export function assertIngestableExtract(extracted: IngestExtractLintInput): void {
  if (extracted.format === "unsupported") {
    throw new Error("unsupported document format for knowledge ingest");
  }
  if (!extracted.cleanedText.trim()) {
    throw new Error("document contained no extractable text for knowledge ingest");
  }
  const hash = lintRawHash(extracted.rawHash, extracted.rawHash);
  if (!hash.ok) {
    throw new Error("document raw_hash missing for knowledge ingest");
  }
}

export function assertChunkLineAnchors(chunks: IngestChunkAnchor[]): void {
  for (const chunk of chunks) {
    const start = chunk.startLine;
    const end = chunk.endLine;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      (start ?? 0) < 1 ||
      (end ?? 0) < (start ?? 0)
    ) {
      throw new Error("knowledge ingest chunk missing line anchors");
    }
  }
}
