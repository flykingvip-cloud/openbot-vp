import { createHash } from "node:crypto";
import { cleanKnowledgeDocumentText } from "./content-clean.js";

export type ContentVersionDelta = "unchanged" | "raw_only" | "new_semantic_version";

export function computeRawContentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function computeSemanticContentHash(rawText: string): string {
  const cleaned = cleanKnowledgeDocumentText(rawText);
  return createHash("sha256").update(cleaned, "utf8").digest("hex");
}

export function classifyContentVersionDelta(params: {
  existingRawHash: string | null;
  existingSemanticHash: string | null;
  nextRawHash: string;
  nextSemanticHash: string;
}): ContentVersionDelta {
  if (params.existingSemanticHash && params.existingSemanticHash === params.nextSemanticHash) {
    if (params.existingRawHash && params.existingRawHash !== params.nextRawHash) {
      return "raw_only";
    }
    return "unchanged";
  }
  return "new_semantic_version";
}
