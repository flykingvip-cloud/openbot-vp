import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { canonicalizeCognitiveJsonValue } from "./cognitive-mutation-store.js";
import { isIeee754Hex } from "./cognitive-score.js";
import { resolveCognitiveRecommendationRoot } from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type {
  ActorRef,
  CognitiveProvenanceRef,
  CognitiveRecommendationDecision,
  CognitiveRecommendationReceipt,
  OwnershipPrincipal,
} from "./types.js";

const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 20;
const LOCK_MAX_ATTEMPTS = 250;

const DECISIONS = new Set<CognitiveRecommendationDecision>([
  "recommend_admit",
  "recommend_deny",
  "recommend_defer",
  "propose_archive",
  "propose_forget",
  "propose_purge",
]);

function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withExclusiveLockAsync(lockPath: string, fn: () => void): Promise<void> {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, "utf8");
        fn();
        return;
      } finally {
        fs.closeSync(fd);
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced unlock
      }
      await sleepAsync(LOCK_RETRY_MS);
    }
  }
  throw new Error("cognitive_recommendation_lock_timeout");
}

function sanitizeToken(value: string): string {
  return assertSafeRecoveryReceiptToken(value, "operationId");
}

/** tenantId, or personal/<ownerUserId> when tenantId is null. */
export function recommendationTenantPartition(
  tenantId: string | null,
  owner: OwnershipPrincipal,
): string {
  if (tenantId && tenantId.trim()) {
    return sanitizeToken(tenantId.trim());
  }
  if (owner.kind !== "user") {
    throw new Error("invalid_recommendation_partition");
  }
  return path.join("personal", sanitizeToken(owner.userId));
}

function resolveRecommendationPath(params: {
  recommendationId: string;
  tenantId: string | null;
  owner: OwnershipPrincipal;
  stateDir?: string;
}): string {
  const recommendationId = sanitizeToken(params.recommendationId);
  const partition = recommendationTenantPartition(params.tenantId, params.owner);
  const root = path.resolve(
    resolveCognitiveRecommendationRoot(params.stateDir ?? resolveStateDir()),
  );
  const dest = path.resolve(root, partition, `${recommendationId}.json`);
  const rel = path.relative(root, dest);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid_cognitive_recommendation_path");
  }
  return dest;
}

function writeDurable(dest: string, receipt: CognitiveRecommendationReceipt): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, dest);
}

function isOwner(value: unknown): value is OwnershipPrincipal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const owner = value as OwnershipPrincipal;
  if (owner.kind === "user") {
    return typeof owner.userId === "string";
  }
  if (owner.kind === "position") {
    return typeof owner.seatId === "string";
  }
  if (owner.kind === "group") {
    return typeof owner.groupId === "string";
  }
  if (owner.kind === "system") {
    return typeof owner.systemId === "string";
  }
  return false;
}

function isActor(value: unknown): value is ActorRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actor = value as ActorRef;
  if (actor.kind === "user") {
    return typeof actor.userId === "string";
  }
  if (actor.kind === "operator") {
    return typeof actor.operatorId === "string";
  }
  if (actor.kind === "worker") {
    return typeof actor.workerId === "string";
  }
  if (actor.kind === "system") {
    return typeof actor.systemId === "string";
  }
  return false;
}

function isProvenanceRef(value: unknown): value is CognitiveProvenanceRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const ref = value as CognitiveProvenanceRef;
  return (
    ref.schemaPackage === "cogniweave-sdk" &&
    typeof ref.nodeType === "string" &&
    typeof ref.objectId === "string" &&
    typeof ref.version === "number" &&
    Number.isFinite(ref.version) &&
    typeof ref.provenanceHash === "string"
  );
}

export function parseCognitiveRecommendationReceipt(
  raw: unknown,
): CognitiveRecommendationReceipt | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const r = raw as CognitiveRecommendationReceipt;
  if (
    typeof r.recommendationId !== "string" ||
    typeof r.candidateId !== "string" ||
    typeof r.requestFingerprint !== "string" ||
    typeof r.policyVersion !== "string" ||
    typeof r.reasonCode !== "string" ||
    typeof r.createdAt !== "string" ||
    typeof r.expiresAt !== "string" ||
    (r.tenantId !== null && typeof r.tenantId !== "string") ||
    !isOwner(r.owner) ||
    !Array.isArray(r.sourceResourceIds) ||
    !r.sourceResourceIds.every((id) => typeof id === "string") ||
    !r.scoreInputs ||
    typeof r.scoreInputs !== "object" ||
    !isIeee754Hex(r.scoreInputs.admissionScore?.ieee754Hex) ||
    !isIeee754Hex(r.scoreInputs.retrievalScore?.ieee754Hex) ||
    !isIeee754Hex(r.scoreInputs.promotionScore?.ieee754Hex) ||
    typeof r.scoreInputs.scoreAlgorithmVersion !== "string" ||
    typeof r.scoreInputs.producerModelRef !== "string" ||
    !DECISIONS.has(r.decision) ||
    !isActor(r.requestedBy) ||
    !isActor(r.executedBy) ||
    (r.status !== "open" && r.status !== "expired" && r.status !== "superseded")
  ) {
    return null;
  }
  if (r.provenanceRef !== undefined && !isProvenanceRef(r.provenanceRef)) {
    return null;
  }
  if (
    Object.hasOwn(r.scoreInputs.admissionScore, "value") ||
    Object.hasOwn(r.scoreInputs.retrievalScore, "value") ||
    Object.hasOwn(r.scoreInputs.promotionScore, "value")
  ) {
    return null;
  }
  return r;
}

export function computeCognitiveRecommendationFingerprint(input: {
  tenantId: string | null;
  owner: OwnershipPrincipal;
  candidateId: string;
  sourceResourceIds: string[];
  policyVersion: string;
  decision: CognitiveRecommendationDecision;
  reasonCode: string;
  admissionIeee754Hex: string;
  retrievalIeee754Hex: string;
  promotionIeee754Hex: string;
  scoreAlgorithmVersion: string;
  producerModelRef: string;
  provenanceRef: CognitiveProvenanceRef | null;
}): string {
  const payload = canonicalizeCognitiveJsonValue({
    candidateId: input.candidateId,
    decision: input.decision,
    owner: input.owner,
    policyVersion: input.policyVersion,
    producerModelRef: input.producerModelRef,
    provenanceRef: input.provenanceRef,
    reasonCode: input.reasonCode,
    scoreAlgorithmVersion: input.scoreAlgorithmVersion,
    scoreInputs: {
      admissionScore: { ieee754Hex: input.admissionIeee754Hex },
      promotionScore: { ieee754Hex: input.promotionIeee754Hex },
      retrievalScore: { ieee754Hex: input.retrievalIeee754Hex },
    },
    sourceResourceIds: [...input.sourceResourceIds].toSorted(),
    tenantId: input.tenantId,
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function getCognitiveRecommendationReceipt(params: {
  recommendationId: string;
  tenantId: string | null;
  owner: OwnershipPrincipal;
  stateDir?: string;
}): CognitiveRecommendationReceipt | null {
  const dest = resolveRecommendationPath(params);
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return parseCognitiveRecommendationReceipt(JSON.parse(fs.readFileSync(dest, "utf8")));
  } catch {
    return null;
  }
}

export type CreateCognitiveRecommendationUniqueResult =
  | { ok: true; receipt: CognitiveRecommendationReceipt; created: boolean }
  | { ok: false; conflict: "idempotent_mismatch" };

export async function createCognitiveRecommendationReceiptUnique(params: {
  receipt: CognitiveRecommendationReceipt;
  stateDir?: string;
}): Promise<CreateCognitiveRecommendationUniqueResult> {
  const dest = resolveRecommendationPath({
    recommendationId: params.receipt.recommendationId,
    tenantId: params.receipt.tenantId,
    owner: params.receipt.owner,
    stateDir: params.stateDir,
  });
  const lockPath = `${dest}.lock`;
  let result: CreateCognitiveRecommendationUniqueResult | null = null;
  await withExclusiveLockAsync(lockPath, () => {
    if (fs.existsSync(dest)) {
      const existing = parseCognitiveRecommendationReceipt(
        JSON.parse(fs.readFileSync(dest, "utf8")),
      );
      if (!existing) {
        throw new Error("cognitive_recommendation_receipt_corrupt");
      }
      if (existing.requestFingerprint !== params.receipt.requestFingerprint) {
        result = { ok: false, conflict: "idempotent_mismatch" };
        return;
      }
      result = { ok: true, receipt: existing, created: false };
      return;
    }
    writeDurable(dest, params.receipt);
    result = { ok: true, receipt: params.receipt, created: true };
  });
  if (!result) {
    throw new Error("cognitive_recommendation_create_failed");
  }
  return result;
}

export async function persistCognitiveRecommendationReceipt(params: {
  receipt: CognitiveRecommendationReceipt;
  stateDir?: string;
}): Promise<void> {
  const dest = resolveRecommendationPath({
    recommendationId: params.receipt.recommendationId,
    tenantId: params.receipt.tenantId,
    owner: params.receipt.owner,
    stateDir: params.stateDir,
  });
  const lockPath = `${dest}.lock`;
  await withExclusiveLockAsync(lockPath, () => {
    writeDurable(dest, params.receipt);
  });
}

export function deleteCognitiveRecommendationReceiptFile(params: {
  recommendationId: string;
  tenantId: string | null;
  owner: OwnershipPrincipal;
  stateDir?: string;
}): boolean {
  const dest = resolveRecommendationPath(params);
  if (!fs.existsSync(dest)) {
    return false;
  }
  fs.unlinkSync(dest);
  return true;
}

export function listCognitiveRecommendationReceiptFiles(params: {
  tenantId: string | null;
  owner: OwnershipPrincipal;
  stateDir?: string;
}): string[] {
  const partition = recommendationTenantPartition(params.tenantId, params.owner);
  const root = path.resolve(
    resolveCognitiveRecommendationRoot(params.stateDir ?? resolveStateDir()),
  );
  const dir = path.resolve(root, partition);
  const rel = path.relative(root, dir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid_cognitive_recommendation_path");
  }
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(dir, name));
}
