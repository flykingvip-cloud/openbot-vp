import type { DatabaseSync } from "node:sqlite";
import { readChunkText } from "../chunk-governance-store.js";
import { extractClaimsFromText } from "../claims/claim-extractor.js";
import { upsertClaimsForChunk } from "../claims/claim-store.js";
import { runClaimConflictDetection } from "./claim-conflict-detector.js";

export type ClaimExtractionResult = {
  chunksProcessed: number;
  claimsExtracted: number;
};

export function runClaimExtraction(params: {
  db: DatabaseSync;
  kbId: string;
  chunkIds: string[];
}): ClaimExtractionResult {
  let chunksProcessed = 0;
  let claimsExtracted = 0;
  for (const chunkId of params.chunkIds) {
    const text = readChunkText(params.db, chunkId);
    if (!text) {
      continue;
    }
    const claims = extractClaimsFromText(text);
    if (claims.length === 0) {
      continue;
    }
    claimsExtracted += upsertClaimsForChunk({
      db: params.db,
      kbId: params.kbId,
      chunkId,
      claims,
    });
    chunksProcessed += 1;
  }
  if (claimsExtracted > 0) {
    runClaimConflictDetection({ db: params.db, kbId: params.kbId });
  }
  return { chunksProcessed, claimsExtracted };
}
