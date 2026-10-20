import fs from "node:fs";
import { resolveStateDir } from "../../config/paths.js";
import {
  getOrCreateFileDataGovernanceCatalogStore,
  type DataGovernanceCatalogStore,
} from "./catalog-store.js";
import {
  isCognitiveRecommendationAuth,
  type CognitiveRecommendationAuth,
} from "./cognitive-recommendation-auth.js";
import {
  computeCognitiveRecommendationFingerprint,
  createCognitiveRecommendationReceiptUnique,
  deleteCognitiveRecommendationReceiptFile,
  getCognitiveRecommendationReceipt,
  listCognitiveRecommendationReceiptFiles,
  parseCognitiveRecommendationReceipt,
  persistCognitiveRecommendationReceipt,
} from "./cognitive-recommendation-store.js";
import { encodeUnitIntervalScore } from "./cognitive-score.js";
import { CATALOG_FIELD_LIMITS } from "./limits.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import type {
  CatalogRecord,
  CognitiveProvenanceNodeType,
  CognitiveProvenanceRef,
  CognitiveRecommendationDecision,
  CognitiveRecommendationReceipt,
  OwnershipPrincipal,
} from "./types.js";
import { assertOwnershipProofMatches } from "./write-gate.js";

const RECOMMENDATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const ALLOWED_KEYS = new Set([
  "recommendationId",
  "candidateId",
  "sourceResourceIds",
  "policyVersion",
  "admissionScore",
  "retrievalScore",
  "promotionScore",
  "scoreAlgorithmVersion",
  "producerModelRef",
  "decision",
  "reasonCode",
  "provenanceRef",
  "auth",
  "stateDir",
  "catalog",
]);

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "atom",
  "claim",
  "body",
  "embedding",
  "embeddings",
  "vector",
  "vectors",
  "vectorBlob",
  "chainOfThought",
  "cot",
  "hiddenCot",
  "credentials",
  "secret",
  "password",
  "apiKey",
  "sourceEventIds",
  "evidenceRefs",
]);

const DECISIONS = new Set<CognitiveRecommendationDecision>([
  "recommend_admit",
  "recommend_deny",
  "recommend_defer",
  "propose_archive",
  "propose_forget",
  "propose_purge",
]);

const PROVENANCE_NODE_TYPES = new Set<CognitiveProvenanceNodeType>([
  "MemoryAtom",
  "EventSkeleton",
  "Entity",
  "Scenario",
  "Problem",
  "Evidence",
]);

const ADMIT_BLOCKED_LIFECYCLES = new Set([
  "purged",
  "deletion_pending",
  "recovery_required",
  "quarantined",
]);

export type RecordCognitiveRecommendationParams = {
  recommendationId: string;
  candidateId: string;
  sourceResourceIds: string[];
  policyVersion: string;
  admissionScore: number;
  retrievalScore: number;
  promotionScore: number;
  scoreAlgorithmVersion: string;
  producerModelRef: string;
  decision: CognitiveRecommendationDecision;
  reasonCode: string;
  provenanceRef?: CognitiveProvenanceRef;
  auth: CognitiveRecommendationAuth;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
};

export type CognitiveRecommendationDenied = {
  ok: false;
  error:
    | "field_not_writable"
    | "forbidden_payload"
    | "invalid_score"
    | "invalid_score_metadata"
    | "missing_field"
    | "invalid_recommendation_field"
    | "source_not_found"
    | "acl_denied"
    | "classification_denied"
    | "lifecycle_denied"
    | "idempotent_mismatch"
    | "actor_not_authorized";
};

export type CognitiveRecommendationResult =
  | { ok: true; receipt: CognitiveRecommendationReceipt; created: boolean }
  | CognitiveRecommendationDenied;

function catalogFor(params: {
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
}): DataGovernanceCatalogStore {
  if (params.catalog) {
    return params.catalog;
  }
  return getOrCreateFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(params.stateDir ?? resolveStateDir()),
  });
}

function boundedString(value: unknown, max = CATALOG_FIELD_LIMITS.bindingIdMax): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    return null;
  }
  return trimmed;
}

function hasForbiddenPayload(value: unknown, skip: ReadonlySet<string>): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasForbiddenPayload(entry, skip));
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (skip.has(key)) {
      continue;
    }
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      return true;
    }
    if (hasForbiddenPayload(nested, skip)) {
      return true;
    }
  }
  return false;
}

function parseProvenanceRef(
  value: unknown,
): CognitiveProvenanceRef | CognitiveRecommendationDenied {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "invalid_recommendation_field" };
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (
      key !== "schemaPackage" &&
      key !== "nodeType" &&
      key !== "objectId" &&
      key !== "version" &&
      key !== "provenanceHash"
    ) {
      return { ok: false, error: "field_not_writable" };
    }
  }
  const objectId = boundedString(raw.objectId);
  const provenanceHash = boundedString(raw.provenanceHash);
  if (
    raw.schemaPackage !== "cogniweave-sdk" ||
    typeof raw.nodeType !== "string" ||
    !PROVENANCE_NODE_TYPES.has(raw.nodeType as CognitiveProvenanceNodeType) ||
    !objectId ||
    !provenanceHash ||
    typeof raw.version !== "number" ||
    !Number.isInteger(raw.version) ||
    raw.version < 1
  ) {
    return { ok: false, error: "invalid_recommendation_field" };
  }
  return {
    schemaPackage: "cogniweave-sdk",
    nodeType: raw.nodeType as CognitiveProvenanceNodeType,
    objectId,
    version: raw.version,
    provenanceHash,
  };
}

function authorizeSource(
  record: CatalogRecord,
  auth: CognitiveRecommendationAuth,
): CognitiveRecommendationDenied | null {
  if (record.envelope.tenantId !== auth.callerTenantId) {
    return { ok: false, error: "acl_denied" };
  }
  try {
    assertOwnershipProofMatches(record, auth.ownershipProof);
  } catch {
    return { ok: false, error: "acl_denied" };
  }
  return null;
}

async function resolveAuthority(params: {
  sourceResourceIds: string[];
  auth: CognitiveRecommendationAuth;
  decision: CognitiveRecommendationDecision;
  catalog: DataGovernanceCatalogStore;
}): Promise<
  | { ok: true; tenantId: string | null; owner: OwnershipPrincipal; sources: CatalogRecord[] }
  | CognitiveRecommendationDenied
> {
  const sources: CatalogRecord[] = [];
  for (const resourceId of params.sourceResourceIds) {
    const record = await params.catalog.get(resourceId);
    if (!record) {
      return { ok: false, error: "source_not_found" };
    }
    const denied = authorizeSource(record, params.auth);
    if (denied) {
      return denied;
    }
    sources.push(record);
  }
  if (params.decision === "recommend_admit") {
    for (const source of sources) {
      if (ADMIT_BLOCKED_LIFECYCLES.has(source.envelope.lifecycleState)) {
        return { ok: false, error: "lifecycle_denied" };
      }
      if (params.auth.actor.kind === "user" && source.envelope.classification === "restricted") {
        return { ok: false, error: "classification_denied" };
      }
    }
  }
  return {
    ok: true,
    tenantId: params.auth.callerTenantId,
    owner: params.auth.ownershipProof.owner,
    sources,
  };
}

/**
 * Shadow-mode admission: unique-create a recommendation receipt.
 * Tenant, owner, and executedBy come from Gateway-authenticated auth, not the wire.
 */
export async function recordCognitiveRecommendation(
  params: RecordCognitiveRecommendationParams,
): Promise<CognitiveRecommendationResult> {
  const raw = params as unknown as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, error: "field_not_writable" };
    }
  }
  if (hasForbiddenPayload(raw, new Set(["catalog", "auth"]))) {
    return { ok: false, error: "forbidden_payload" };
  }
  if (!isCognitiveRecommendationAuth(params.auth)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const recommendationId = boundedString(
    params.recommendationId,
    CATALOG_FIELD_LIMITS.resourceIdMax,
  );
  const candidateId = boundedString(params.candidateId, CATALOG_FIELD_LIMITS.resourceIdMax);
  const policyVersion = boundedString(params.policyVersion);
  const reasonCode = boundedString(params.reasonCode);
  const scoreAlgorithmVersion = boundedString(params.scoreAlgorithmVersion);
  const producerModelRef = boundedString(params.producerModelRef);
  if (!recommendationId || !candidateId || !policyVersion || !reasonCode) {
    return { ok: false, error: "missing_field" };
  }
  if (!scoreAlgorithmVersion || !producerModelRef) {
    return { ok: false, error: "invalid_score_metadata" };
  }
  if (!DECISIONS.has(params.decision)) {
    return { ok: false, error: "invalid_recommendation_field" };
  }
  if (!Array.isArray(params.sourceResourceIds)) {
    return { ok: false, error: "invalid_recommendation_field" };
  }
  const sourceResourceIds: string[] = [];
  for (const id of params.sourceResourceIds) {
    const parsed = boundedString(id, CATALOG_FIELD_LIMITS.resourceIdMax);
    if (!parsed) {
      return { ok: false, error: "invalid_recommendation_field" };
    }
    sourceResourceIds.push(parsed);
  }
  sourceResourceIds.sort();
  let provenanceRef: CognitiveProvenanceRef | undefined;
  if (params.provenanceRef !== undefined) {
    const parsed = parseProvenanceRef(params.provenanceRef);
    if ("ok" in parsed && !parsed.ok) {
      return parsed;
    }
    provenanceRef = parsed as CognitiveProvenanceRef;
  }
  const admissionScore = encodeUnitIntervalScore(params.admissionScore);
  const retrievalScore = encodeUnitIntervalScore(params.retrievalScore);
  const promotionScore = encodeUnitIntervalScore(params.promotionScore);
  if (!admissionScore.ok || !retrievalScore.ok || !promotionScore.ok) {
    return { ok: false, error: "invalid_score" };
  }
  const catalog = catalogFor(params);
  const authority = await resolveAuthority({
    sourceResourceIds,
    auth: params.auth,
    decision: params.decision,
    catalog,
  });
  if (!authority.ok) {
    return authority;
  }
  const requestFingerprint = computeCognitiveRecommendationFingerprint({
    tenantId: authority.tenantId,
    owner: authority.owner,
    candidateId,
    sourceResourceIds,
    policyVersion,
    decision: params.decision,
    reasonCode,
    admissionIeee754Hex: admissionScore.score.ieee754Hex,
    retrievalIeee754Hex: retrievalScore.score.ieee754Hex,
    promotionIeee754Hex: promotionScore.score.ieee754Hex,
    scoreAlgorithmVersion,
    producerModelRef,
    provenanceRef: provenanceRef ?? null,
  });
  const createdMs = Date.now();
  const createdAt = new Date(createdMs).toISOString();
  const receipt: CognitiveRecommendationReceipt = {
    recommendationId,
    candidateId,
    tenantId: authority.tenantId,
    owner: authority.owner,
    sourceResourceIds,
    policyVersion,
    scoreInputs: {
      admissionScore: { ieee754Hex: admissionScore.score.ieee754Hex },
      retrievalScore: { ieee754Hex: retrievalScore.score.ieee754Hex },
      promotionScore: { ieee754Hex: promotionScore.score.ieee754Hex },
      scoreAlgorithmVersion,
      producerModelRef,
    },
    decision: params.decision,
    reasonCode,
    requestedBy: params.auth.requestedBy,
    executedBy: params.auth.actor,
    requestFingerprint,
    ...(provenanceRef ? { provenanceRef } : {}),
    createdAt,
    expiresAt: new Date(createdMs + RECOMMENDATION_TTL_MS).toISOString(),
    status: "open",
  };
  const unique = await createCognitiveRecommendationReceiptUnique({
    receipt,
    stateDir: params.stateDir,
  });
  if (!unique.ok) {
    return { ok: false, error: "idempotent_mismatch" };
  }
  return unique;
}

export async function getCognitiveRecommendation(params: {
  recommendationId: string;
  tenantId: string | null;
  owner: OwnershipPrincipal;
  stateDir?: string;
  now?: Date;
}): Promise<CognitiveRecommendationReceipt | null> {
  const receipt = getCognitiveRecommendationReceipt(params);
  if (!receipt) {
    return null;
  }
  const now = params.now ?? new Date();
  if (receipt.status === "open" && Date.parse(receipt.expiresAt) <= now.getTime()) {
    const expired: CognitiveRecommendationReceipt = { ...receipt, status: "expired" };
    await persistCognitiveRecommendationReceipt({ receipt: expired, stateDir: params.stateDir });
    return expired;
  }
  return receipt;
}

/** Deletes expired receipt files only. Never writes Catalog or opens P2 ops. */
export async function cleanupExpiredCognitiveRecommendations(params: {
  tenantId: string | null;
  owner: OwnershipPrincipal;
  stateDir?: string;
  now?: Date;
}): Promise<{ deleted: number }> {
  const now = params.now ?? new Date();
  let deleted = 0;
  for (const file of listCognitiveRecommendationReceiptFiles(params)) {
    let parsed: CognitiveRecommendationReceipt | null = null;
    try {
      parsed = parseCognitiveRecommendationReceipt(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      continue;
    }
    if (!parsed) {
      continue;
    }
    if (Date.parse(parsed.expiresAt) > now.getTime() && parsed.status !== "expired") {
      continue;
    }
    if (
      deleteCognitiveRecommendationReceiptFile({
        recommendationId: parsed.recommendationId,
        tenantId: params.tenantId,
        owner: params.owner,
        stateDir: params.stateDir,
      })
    ) {
      deleted += 1;
    }
  }
  return { deleted };
}
