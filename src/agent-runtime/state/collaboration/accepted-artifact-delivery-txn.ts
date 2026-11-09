import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  evaluateMemberArtifactDeliveryEligibility,
  memberArtifactDeliveryKeyMaterial,
  normalizeDeliveryTarget,
  type MemberArtifactDeliveryIdentity,
  type NormalizedDeliveryTarget,
} from "../../policy/accepted-artifact-delivery.js";
import { withDirectoryLock, writeJsonDurable } from "../repository/durable-json.js";

/**
 * M1 association only. Records live under the caller root, never in
 * `delivery-queue/*.json`, so `loadPendingDeliveries` cannot send them.
 * `bridgeSendStarted` is not a permanent unknown: a later slice may mark
 * `failed_retryable` only when `externalEffect` is `none`.
 */

export type DeliveryAssociationPhase =
  | "authorization_pending"
  | "staged"
  | "queued"
  | "delivered"
  | "unknown"
  | "blocked"
  | "failed_retryable";

export type DeliveryExternalEffect = "none" | "unknown" | "acknowledged";

export type MemberArtifactDeliveryIntent = {
  version: 1;
  keyHash: string;
  tenantId: string;
  groupId: string;
  taskId: string;
  itemId: string;
  actorId: string;
  acceptedSubmissionId: string;
  acceptedArtifactVersion: string;
  linkedDeliverableId: string;
  linkedDeliverableVersion: number;
  linkedContentSha256: string;
  normalizedTarget: NormalizedDeliveryTarget;
  scope: "member_artifact";
  phase: DeliveryAssociationPhase;
  authorization: "authorization_pending";
  bridgeSendStarted: boolean;
  externalEffect: DeliveryExternalEffect;
  retryable: boolean;
  /** M1 never publishes a delivery-queue id. */
  queueId: null;
  receiptMessageIds: string[] | null;
  stagedName: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type AssociationCommitResult =
  | { ok: false; reason: string }
  | { ok: true; intent: MemberArtifactDeliveryIntent; created: boolean };

const RECOGNIZED: ReadonlySet<DeliveryAssociationPhase> = new Set([
  "authorization_pending",
  "staged",
  "queued",
  "delivered",
  "unknown",
  "blocked",
  "failed_retryable",
]);

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function deliveryKeyHash(identity: MemberArtifactDeliveryIdentity): string | null {
  const target = normalizeDeliveryTarget(identity.target);
  if (!target) {
    return null;
  }
  const material = memberArtifactDeliveryKeyMaterial(identity, target);
  return createHash("sha256").update(material, "utf8").digest("hex");
}

function intentPath(rootDir: string, keyHash: string): string {
  return path.join(rootDir, "intents", `${keyHash}.intent.json`);
}

function stagedPath(rootDir: string, keyHash: string): string {
  return path.join(rootDir, "staged", `bridge-${keyHash}.bridge-staged`);
}

function associatedPath(rootDir: string, keyHash: string): string {
  return path.join(rootDir, "staged", `bridge-${keyHash}.bridge-associated`);
}

function partialPath(rootDir: string, keyHash: string): string {
  return path.join(rootDir, "staged", `bridge-${keyHash}.bridge-partial`);
}

async function readIntent(
  rootDir: string,
  keyHash: string,
): Promise<MemberArtifactDeliveryIntent | null> {
  try {
    const raw = await fs.readFile(intentPath(rootDir, keyHash), "utf8");
    const parsed = JSON.parse(raw) as MemberArtifactDeliveryIntent;
    if (parsed?.keyHash !== keyHash || !RECOGNIZED.has(parsed.phase)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function readStagedBody(
  filePath: string,
): Promise<{ keyHash: string; complete: true } | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) {
      return null;
    }
    const parsed = JSON.parse(raw) as { keyHash?: string; complete?: boolean };
    if (parsed.complete === true && typeof parsed.keyHash === "string") {
      return { keyHash: parsed.keyHash, complete: true };
    }
    return null;
  } catch {
    return null;
  }
}

async function exclusiveCreate(filePath: string): Promise<"created" | "exists"> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    const handle = await fs.open(filePath, "wx", 0o600);
    await handle.close();
    return "created";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return "exists";
    }
    throw error;
  }
}

function buildIntent(params: {
  identity: MemberArtifactDeliveryIdentity;
  keyHash: string;
  target: NormalizedDeliveryTarget;
  nowMs: number;
  phase: DeliveryAssociationPhase;
  stagedName: string;
}): MemberArtifactDeliveryIntent {
  return {
    version: 1,
    keyHash: params.keyHash,
    tenantId: compact(params.identity.tenantId),
    groupId: compact(params.identity.groupId),
    taskId: compact(params.identity.taskId),
    itemId: compact(params.identity.itemId),
    actorId: compact(params.identity.actorId),
    acceptedSubmissionId: compact(params.identity.acceptedSubmissionId),
    acceptedArtifactVersion: compact(params.identity.acceptedArtifactVersion),
    linkedDeliverableId: compact(params.identity.linkedDeliverableId),
    linkedDeliverableVersion: params.identity.linkedDeliverableVersion ?? 0,
    linkedContentSha256: compact(params.identity.linkedContentSha256).toLowerCase(),
    normalizedTarget: params.target,
    scope: "member_artifact",
    phase: params.phase,
    authorization: "authorization_pending",
    bridgeSendStarted: false,
    externalEffect: "none",
    retryable: false,
    queueId: null,
    receiptMessageIds: null,
    stagedName: params.stagedName,
    createdAtMs: params.nowMs,
    updatedAtMs: params.nowMs,
  };
}

async function writeCompleteStaged(filePath: string, keyHash: string): Promise<void> {
  await writeJsonDurable(filePath, { version: 1, keyHash, complete: true });
}

export async function commitMemberArtifactDeliveryAssociation(params: {
  rootDir: string;
  identity: MemberArtifactDeliveryIdentity;
  nowMs?: number;
}): Promise<AssociationCommitResult> {
  const eligibility = evaluateMemberArtifactDeliveryEligibility(params.identity);
  if (eligibility.outcome === "deny") {
    return { ok: false, reason: eligibility.reason };
  }
  const target = normalizeDeliveryTarget(params.identity.target);
  const keyHash = deliveryKeyHash(params.identity);
  if (!target || !keyHash) {
    return { ok: false, reason: "target_required" };
  }
  const nowMs = params.nowMs ?? Date.now();
  return withDirectoryLock(params.rootDir, keyHash, async () => {
    const again = evaluateMemberArtifactDeliveryEligibility(params.identity);
    if (again.outcome === "deny") {
      return { ok: false, reason: again.reason };
    }
    const existing = await readIntent(params.rootDir, keyHash);
    if (existing && existing.phase !== "authorization_pending") {
      return { ok: true, intent: existing, created: false };
    }
    const staged = stagedPath(params.rootDir, keyHash);
    const intent =
      existing ??
      buildIntent({
        identity: params.identity,
        keyHash,
        target,
        nowMs,
        phase: "authorization_pending",
        stagedName: path.basename(staged),
      });
    await writeJsonDurable(intentPath(params.rootDir, keyHash), intent);
    const createdFile = await exclusiveCreate(staged);
    const body = await readStagedBody(staged);
    if (!body || body.keyHash !== keyHash) {
      if (createdFile === "exists" && body && body.keyHash !== keyHash) {
        return { ok: false, reason: "staged_key_mismatch" };
      }
      await writeCompleteStaged(staged, keyHash);
    }
    const stagedIntent: MemberArtifactDeliveryIntent = {
      ...intent,
      phase: "staged",
      stagedName: path.basename(staged),
      updatedAtMs: nowMs,
      bridgeSendStarted: false,
      externalEffect: "none",
      retryable: false,
      queueId: null,
    };
    await writeJsonDurable(intentPath(params.rootDir, keyHash), stagedIntent);
    return { ok: true, intent: stagedIntent, created: existing === null };
  });
}

/** Same key after the staged suffix is gone. Does not publish a queue `.json`. */
export async function noteAssociationRenamedAwayFromStaged(params: {
  rootDir: string;
  identity: MemberArtifactDeliveryIdentity;
  nowMs?: number;
}): Promise<AssociationCommitResult> {
  const keyHash = deliveryKeyHash(params.identity);
  if (!keyHash) {
    return { ok: false, reason: "target_required" };
  }
  const nowMs = params.nowMs ?? Date.now();
  return withDirectoryLock(params.rootDir, keyHash, async () => {
    const existing = await readIntent(params.rootDir, keyHash);
    if (!existing) {
      return { ok: false, reason: "intent_missing" };
    }
    if (existing.phase !== "staged" && existing.phase !== "queued") {
      return { ok: true, intent: existing, created: false };
    }
    const from = stagedPath(params.rootDir, keyHash);
    const to = associatedPath(params.rootDir, keyHash);
    try {
      await fs.rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
    const queued: MemberArtifactDeliveryIntent = {
      ...existing,
      phase: "queued",
      stagedName: path.basename(to),
      queueId: null,
      bridgeSendStarted: false,
      updatedAtMs: nowMs,
    };
    await writeJsonDurable(intentPath(params.rootDir, keyHash), queued);
    return { ok: true, intent: queued, created: false };
  });
}

export async function recoverPartialStagedAssociation(params: {
  rootDir: string;
  identity: MemberArtifactDeliveryIdentity;
}): Promise<
  { ok: true; keyHash: string; completedFromIntent: boolean } | { ok: false; reason: string }
> {
  const keyHash = deliveryKeyHash(params.identity);
  if (!keyHash) {
    return { ok: false, reason: "target_required" };
  }
  return withDirectoryLock(params.rootDir, keyHash, async () => {
    const staged = stagedPath(params.rootDir, keyHash);
    const body = await readStagedBody(staged);
    const intent = await readIntent(params.rootDir, keyHash);
    if (body?.keyHash === keyHash) {
      return { ok: true, keyHash, completedFromIntent: false };
    }
    if (intent) {
      await writeCompleteStaged(staged, keyHash);
      return { ok: true, keyHash, completedFromIntent: true };
    }
    try {
      await fs.rename(staged, partialPath(params.rootDir, keyHash));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
    return { ok: true, keyHash, completedFromIntent: false };
  });
}

/**
 * Records a later non-send observation on an existing key.
 * Retryable failure requires `externalEffect: "none"`.
 * Effect-unknown stays `unknown` and is not retryable.
 */
export async function recordAssociationObservation(params: {
  rootDir: string;
  identity: MemberArtifactDeliveryIdentity;
  phase: "unknown" | "failed_retryable" | "delivered";
  externalEffect: DeliveryExternalEffect;
  receiptMessageIds?: string[];
  nowMs?: number;
}): Promise<AssociationCommitResult> {
  const keyHash = deliveryKeyHash(params.identity);
  if (!keyHash) {
    return { ok: false, reason: "target_required" };
  }
  const nowMs = params.nowMs ?? Date.now();
  return withDirectoryLock(params.rootDir, keyHash, async () => {
    const existing = await readIntent(params.rootDir, keyHash);
    if (!existing) {
      return { ok: false, reason: "intent_missing" };
    }
    if (params.phase === "delivered") {
      const ids = (params.receiptMessageIds ?? [])
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      if (ids.length === 0 || params.externalEffect !== "acknowledged") {
        return { ok: false, reason: "receipt_required" };
      }
      const delivered: MemberArtifactDeliveryIntent = {
        ...existing,
        phase: "delivered",
        externalEffect: "acknowledged",
        retryable: false,
        receiptMessageIds: ids,
        updatedAtMs: nowMs,
      };
      await writeJsonDurable(intentPath(params.rootDir, keyHash), delivered);
      return { ok: true, intent: delivered, created: false };
    }
    if (params.phase === "failed_retryable") {
      if (params.externalEffect !== "none") {
        return { ok: false, reason: "retry_requires_no_external_effect" };
      }
      const retryable: MemberArtifactDeliveryIntent = {
        ...existing,
        phase: "failed_retryable",
        bridgeSendStarted: true,
        externalEffect: "none",
        retryable: true,
        updatedAtMs: nowMs,
      };
      await writeJsonDurable(intentPath(params.rootDir, keyHash), retryable);
      return { ok: true, intent: retryable, created: false };
    }
    if (params.externalEffect !== "unknown") {
      return { ok: false, reason: "unknown_requires_unknown_effect" };
    }
    const unknown: MemberArtifactDeliveryIntent = {
      ...existing,
      phase: "unknown",
      bridgeSendStarted: true,
      externalEffect: "unknown",
      retryable: false,
      updatedAtMs: nowMs,
    };
    await writeJsonDurable(intentPath(params.rootDir, keyHash), unknown);
    return { ok: true, intent: unknown, created: false };
  });
}
