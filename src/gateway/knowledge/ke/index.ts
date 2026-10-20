/**
 * Thin knowledge-engineering SDK.
 * Integrity/cite helpers plus ingest gate. Gardener policy stays unwired. No new RPC.
 */
export {
  assertRawHash,
  assertReceiptUsable,
  assertSpanInPreview,
  isReceiptUsable,
  lintRawHash,
  lintReceipt,
  lintSpanInPreview,
  type IntegrityLintResult,
} from "./integrity.js";
export {
  buildActiveCiteUri,
  buildDeliverableCiteUri,
  buildDocumentCiteUri,
  parseCiteUri,
  type KnowledgeCiteUri,
} from "./cite.js";
export {
  KNOWN_CLAIM_EXTRACTION_METHODS,
  lintClaimEvidence,
  type ClaimEvidenceInput,
  type ClaimEvidenceLintResult,
  type ClaimEvidenceViolation,
  type ClaimExtractionMethod,
} from "./claims-evidence.js";
export {
  GARDENER_ALLOWED_WRITES,
  GARDENER_FORBIDDEN_WRITES,
  assertGardenerRpc,
  isGardenerRawHashOverwriteForbidden,
  type GardenerDecision,
} from "./gardener-policy.js";

export {
  assertChunkLineAnchors,
  assertIngestableExtract,
  type IngestChunkAnchor,
  type IngestExtractLintInput,
} from "./ingest-gate.js";
