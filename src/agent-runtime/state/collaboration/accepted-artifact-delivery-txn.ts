import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../../config/config.js";
import { deliverOutboundPayloads, type OutboundSendDeps } from "../../../infra/outbound/deliver.js";
import {
  ackDelivery,
  failDelivery,
  moveToFailed,
  resolveDeliveryQueueDir,
  type QueuedDelivery,
} from "../../../infra/outbound/delivery-queue.js";
import { confirmedDeliveryMessageIds } from "../../../shared/delivery-receipt.js";
import {
  evaluateAcceptedArtifactOutboundAuthorization,
  evaluateMemberArtifactDeliveryEligibility,
  memberArtifactDeliveryKeyMaterial,
  normalizeDeliveryTarget,
  type MemberArtifactDeliveryIdentity,
  type NormalizedDeliveryTarget,
  type ServerOutboundAuthFacts,
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
  /** Durable association after the staged suffix is renamed. Not an outbound queue entry. */
  | "associated"
  /** Real delivery-queue json exists and queueId is set. Not used before that. */
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
  authorization: "authorization_pending" | "allow";
  bridgeSendStarted: boolean;
  externalEffect: DeliveryExternalEffect;
  retryable: boolean;
  /** Null until a delivery-queue id is stored. Never a caller-supplied grant. */
  queueId: string | null;
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
  "associated",
  "queued",
  "delivered",
  "unknown",
  "blocked",
  "failed_retryable",
]);

type IntentRead =
  | { status: "missing" }
  | { status: "ok"; intent: MemberArtifactDeliveryIntent }
  | { status: "unreadable"; reason: "intent_corrupt" | "intent_unreadable" };

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

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTarget(value: unknown): value is NormalizedDeliveryTarget {
  if (!value || typeof value !== "object") {
    return false;
  }
  const target = value as NormalizedDeliveryTarget;
  return (
    nonEmpty(target.channel) &&
    nonEmpty(target.to) &&
    (target.accountId === null || typeof target.accountId === "string")
  );
}

function isFixedNonSend(parsed: MemberArtifactDeliveryIntent): boolean {
  if (parsed.scope !== "member_artifact") {
    return false;
  }
  if (parsed.queueId !== null && !nonEmpty(parsed.queueId)) {
    return false;
  }
  const preSend =
    parsed.phase === "authorization_pending" ||
    parsed.phase === "staged" ||
    parsed.phase === "associated";
  if (preSend) {
    return (
      parsed.authorization === "authorization_pending" &&
      parsed.queueId === null &&
      !parsed.bridgeSendStarted &&
      parsed.externalEffect === "none" &&
      !parsed.retryable &&
      parsed.receiptMessageIds === null
    );
  }
  if (parsed.phase === "queued") {
    return (
      parsed.authorization === "allow" &&
      nonEmpty(parsed.queueId) &&
      parsed.externalEffect === "none" &&
      !parsed.retryable &&
      parsed.receiptMessageIds === null
    );
  }
  if (parsed.phase === "failed_retryable") {
    return (
      parsed.authorization === "allow" &&
      nonEmpty(parsed.queueId) &&
      parsed.bridgeSendStarted &&
      parsed.externalEffect === "none" &&
      parsed.retryable &&
      parsed.receiptMessageIds === null
    );
  }
  if (parsed.phase === "unknown") {
    return (
      parsed.bridgeSendStarted &&
      parsed.externalEffect === "unknown" &&
      !parsed.retryable &&
      nonEmpty(parsed.queueId)
    );
  }
  if (parsed.phase === "delivered") {
    return (
      parsed.externalEffect === "acknowledged" &&
      !parsed.retryable &&
      nonEmpty(parsed.queueId) &&
      Array.isArray(parsed.receiptMessageIds) &&
      parsed.receiptMessageIds.length > 0 &&
      parsed.receiptMessageIds.every((id) => nonEmpty(id))
    );
  }
  return (
    parsed.phase === "blocked" &&
    !parsed.retryable &&
    parsed.externalEffect === "none" &&
    !parsed.bridgeSendStarted
  );
}

function intentMatchesKey(parsed: MemberArtifactDeliveryIntent): boolean {
  const target = normalizeDeliveryTarget(parsed.normalizedTarget);
  if (
    !target ||
    target.channel !== parsed.normalizedTarget.channel ||
    target.to !== parsed.normalizedTarget.to ||
    target.accountId !== parsed.normalizedTarget.accountId
  ) {
    return false;
  }
  const material = memberArtifactDeliveryKeyMaterial(
    {
      tenantId: parsed.tenantId,
      groupId: parsed.groupId,
      taskId: parsed.taskId,
      itemId: parsed.itemId,
      actorId: parsed.actorId,
      scope: "member_artifact",
      boardStatus: "accepted",
      acceptedSubmissionId: parsed.acceptedSubmissionId,
      acceptedArtifactVersion: parsed.acceptedArtifactVersion,
      linkedDeliverableId: parsed.linkedDeliverableId,
      linkedDeliverableVersion: parsed.linkedDeliverableVersion,
      linkedContentSha256: parsed.linkedContentSha256,
      target,
    },
    target,
  );
  return createHash("sha256").update(material, "utf8").digest("hex") === parsed.keyHash;
}

function isIntent(value: unknown, keyHash: string): value is MemberArtifactDeliveryIntent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const parsed = value as MemberArtifactDeliveryIntent;
  if (parsed.version !== 1 || parsed.keyHash !== keyHash || !RECOGNIZED.has(parsed.phase)) {
    return false;
  }
  if (
    !nonEmpty(parsed.tenantId) ||
    !nonEmpty(parsed.groupId) ||
    !nonEmpty(parsed.taskId) ||
    !nonEmpty(parsed.itemId) ||
    !nonEmpty(parsed.actorId) ||
    !nonEmpty(parsed.acceptedSubmissionId) ||
    !nonEmpty(parsed.acceptedArtifactVersion) ||
    !nonEmpty(parsed.linkedDeliverableId) ||
    !nonEmpty(parsed.linkedContentSha256) ||
    !nonEmpty(parsed.stagedName) ||
    typeof parsed.linkedDeliverableVersion !== "number" ||
    !Number.isFinite(parsed.linkedDeliverableVersion) ||
    parsed.linkedDeliverableVersion <= 0 ||
    typeof parsed.createdAtMs !== "number" ||
    typeof parsed.updatedAtMs !== "number" ||
    !isTarget(parsed.normalizedTarget) ||
    !isFixedNonSend(parsed) ||
    !intentMatchesKey(parsed)
  ) {
    return false;
  }
  return true;
}

/** ENOENT is the only missing intent. Corrupt and IO errors must not be rebuilt. */
async function readIntent(rootDir: string, keyHash: string): Promise<IntentRead> {
  let raw: string;
  try {
    raw = await fs.readFile(intentPath(rootDir, keyHash), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { status: "missing" };
    }
    return { status: "unreadable", reason: "intent_unreadable" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isIntent(parsed, keyHash)) {
      return { status: "unreadable", reason: "intent_corrupt" };
    }
    return { status: "ok", intent: parsed };
  } catch {
    return { status: "unreadable", reason: "intent_corrupt" };
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
    const read = await readIntent(params.rootDir, keyHash);
    if (read.status === "unreadable") {
      return { ok: false, reason: read.reason };
    }
    const existing = read.status === "ok" ? read.intent : null;
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
    const read = await readIntent(params.rootDir, keyHash);
    if (read.status === "unreadable") {
      return { ok: false, reason: read.reason };
    }
    if (read.status === "missing") {
      return { ok: false, reason: "intent_missing" };
    }
    const existing = read.intent;
    if (existing.phase !== "staged" && existing.phase !== "associated") {
      return { ok: true, intent: existing, created: false };
    }
    const from = stagedPath(params.rootDir, keyHash);
    const to = associatedPath(params.rootDir, keyHash);
    const source = await readStagedBody(from);
    const destBefore = await readStagedBody(to);
    if (source?.keyHash === keyHash) {
      await fs.rename(from, to);
    } else if (destBefore?.keyHash !== keyHash) {
      return { ok: false, reason: "association_files_missing" };
    }
    const dest = await readStagedBody(to);
    if (dest?.keyHash !== keyHash) {
      return { ok: false, reason: "association_files_missing" };
    }
    if (existing.phase === "associated" && existing.stagedName === path.basename(to)) {
      return { ok: true, intent: existing, created: false };
    }
    const retained: MemberArtifactDeliveryIntent = {
      ...existing,
      phase: "associated",
      stagedName: path.basename(to),
      queueId: null,
      updatedAtMs: nowMs,
    };
    await writeJsonDurable(intentPath(params.rootDir, keyHash), retained);
    return { ok: true, intent: retained, created: false };
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
    const read = await readIntent(params.rootDir, keyHash);
    if (read.status === "unreadable") {
      return { ok: false, reason: read.reason };
    }
    const intent = read.status === "ok" ? read.intent : null;
    if (intent && intent.phase !== "authorization_pending" && intent.phase !== "staged") {
      if (intent.phase === "associated") {
        const retained = await readStagedBody(associatedPath(params.rootDir, keyHash));
        if (retained?.keyHash !== keyHash) {
          return { ok: false, reason: "association_file_missing" };
        }
      }
      return { ok: true, keyHash, completedFromIntent: false };
    }
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

function queueStagedName(keyHash: string): string {
  return `bridge-${keyHash}.bridge-staged`;
}

async function writeQueueBody(filePath: string, entry: QueuedDelivery): Promise<void> {
  await writeJsonDurable(filePath, entry);
}

export async function publishMemberArtifactDelivery(params: {
  rootDir: string;
  queueStateDir: string;
  identity: MemberArtifactDeliveryIdentity;
  contentSha256: string;
  payloadText: string;
  authFacts: ServerOutboundAuthFacts;
  nowMs?: number;
}): Promise<AssociationCommitResult> {
  const keyHash = deliveryKeyHash(params.identity);
  const target = normalizeDeliveryTarget(params.identity.target);
  if (!keyHash || !target) {
    return { ok: false, reason: "target_required" };
  }
  const nowMs = params.nowMs ?? Date.now();
  return withDirectoryLock(params.rootDir, keyHash, async () => {
    const read = await readIntent(params.rootDir, keyHash);
    if (read.status === "unreadable") {
      return { ok: false, reason: read.reason };
    }
    if (read.status === "missing" || read.intent.phase !== "associated") {
      if (read.status === "ok" && read.intent.phase === "queued") {
        return { ok: true, intent: read.intent, created: false };
      }
      return { ok: false, reason: read.status === "missing" ? "intent_missing" : "not_associated" };
    }
    const existing = read.intent;
    if (compact(params.contentSha256).toLowerCase() !== existing.linkedContentSha256) {
      const blocked: MemberArtifactDeliveryIntent = {
        ...existing,
        phase: "blocked",
        updatedAtMs: nowMs,
      };
      await writeJsonDurable(intentPath(params.rootDir, keyHash), blocked);
      return { ok: false, reason: "content_hash_mismatch" };
    }
    const auth = evaluateAcceptedArtifactOutboundAuthorization({
      actorId: existing.actorId,
      normalizedTarget: existing.normalizedTarget,
      facts: params.authFacts,
    });
    if (auth.outcome === "authorization_pending") {
      return { ok: false, reason: auth.reason };
    }
    if (auth.outcome === "deny") {
      const blocked: MemberArtifactDeliveryIntent = {
        ...existing,
        phase: "blocked",
        updatedAtMs: nowMs,
      };
      await writeJsonDurable(intentPath(params.rootDir, keyHash), blocked);
      return { ok: false, reason: auth.reason };
    }
    const queueDir = resolveDeliveryQueueDir(params.queueStateDir);
    await fs.mkdir(queueDir, { recursive: true });
    const staged = path.join(queueDir, queueStagedName(keyHash));
    let queueId = existing.queueId;
    if (!queueId) {
      const created = await exclusiveCreate(staged);
      if (created === "exists") {
        const prior = JSON.parse(await fs.readFile(staged, "utf8")) as QueuedDelivery;
        queueId = prior.id;
      } else {
        queueId = randomUUID();
      }
      const hidden: QueuedDelivery = {
        id: queueId,
        enqueuedAt: nowMs,
        retryCount: 0,
        channel: "telegram",
        to: existing.normalizedTarget.to,
        accountId: existing.normalizedTarget.accountId ?? undefined,
        payloads: [{ text: params.payloadText }],
        bridgeMarker: true,
        associationReady: false,
        bridgeKeyHash: keyHash,
        bridgeContentSha256: existing.linkedContentSha256,
      };
      await writeQueueBody(staged, hidden);
      const withId: MemberArtifactDeliveryIntent = {
        ...existing,
        queueId,
        updatedAtMs: nowMs,
      };
      await writeJsonDurable(intentPath(params.rootDir, keyHash), withId);
    }
    const visible = path.join(queueDir, `${queueId}.json`);
    const ready: QueuedDelivery = {
      id: queueId,
      enqueuedAt: nowMs,
      retryCount: 0,
      channel: "telegram",
      to: existing.normalizedTarget.to,
      accountId: existing.normalizedTarget.accountId ?? undefined,
      payloads: [{ text: params.payloadText }],
      bridgeMarker: true,
      associationReady: true,
      bridgeKeyHash: keyHash,
      bridgeContentSha256: existing.linkedContentSha256,
    };
    await writeQueueBody(visible, ready);
    await fs.rm(staged, { force: true });
    const queued: MemberArtifactDeliveryIntent = {
      ...existing,
      phase: "queued",
      authorization: "allow",
      queueId,
      bridgeSendStarted: false,
      externalEffect: "none",
      retryable: false,
      receiptMessageIds: null,
      updatedAtMs: nowMs,
    };
    await writeJsonDurable(intentPath(params.rootDir, keyHash), queued);
    return { ok: true, intent: queued, created: false };
  });
}

export async function recoverMemberArtifactBridgeDelivery(params: {
  rootDir: string;
  queueStateDir: string;
  entry: QueuedDelivery;
  authFacts: ServerOutboundAuthFacts;
  cfg: OpenBotConfig;
  deps: OutboundSendDeps;
  beforeReceipt?: () => Promise<void>;
}): Promise<"recovered" | "failed" | "deferred"> {
  const keyHash = params.entry.bridgeKeyHash;
  if (!keyHash || params.entry.associationReady !== true) {
    return "deferred";
  }
  return withDirectoryLock(params.rootDir, keyHash, async () => {
    const read = await readIntent(params.rootDir, keyHash);
    if (read.status !== "ok") {
      return "failed";
    }
    const existing = read.intent;
    if (existing.queueId !== params.entry.id) {
      return "deferred";
    }
    if (
      existing.phase === "delivered" ||
      existing.phase === "unknown" ||
      existing.phase === "blocked"
    ) {
      return "deferred";
    }
    if (existing.bridgeSendStarted && existing.externalEffect === "unknown") {
      return "deferred";
    }
    const auth = evaluateAcceptedArtifactOutboundAuthorization({
      actorId: existing.actorId,
      normalizedTarget: existing.normalizedTarget,
      facts: params.authFacts,
    });
    if (auth.outcome === "authorization_pending") {
      return "deferred";
    }
    if (auth.outcome === "deny") {
      const blocked: MemberArtifactDeliveryIntent = {
        ...existing,
        phase: "blocked",
        bridgeSendStarted: false,
        externalEffect: "none",
        retryable: false,
        updatedAtMs: Date.now(),
      };
      await writeJsonDurable(intentPath(params.rootDir, keyHash), blocked);
      await moveToFailed(params.entry.id, params.queueStateDir);
      return "failed";
    }
    if (params.entry.bridgeContentSha256 !== existing.linkedContentSha256) {
      const blocked: MemberArtifactDeliveryIntent = {
        ...existing,
        phase: "blocked",
        updatedAtMs: Date.now(),
      };
      await writeJsonDurable(intentPath(params.rootDir, keyHash), blocked);
      await moveToFailed(params.entry.id, params.queueStateDir);
      return "failed";
    }
    const started: MemberArtifactDeliveryIntent = {
      ...existing,
      bridgeSendStarted: true,
      externalEffect: "none",
      retryable: false,
      updatedAtMs: Date.now(),
    };
    await writeJsonDurable(intentPath(params.rootDir, keyHash), started);
    let receipts: unknown;
    try {
      receipts = await deliverOutboundPayloads({
        cfg: params.cfg,
        channel: params.entry.channel,
        to: params.entry.to,
        accountId: params.entry.accountId,
        payloads: params.entry.payloads,
        deps: params.deps,
        skipQueue: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable: MemberArtifactDeliveryIntent = {
        ...started,
        phase: "failed_retryable",
        bridgeSendStarted: true,
        externalEffect: "none",
        retryable: true,
        updatedAtMs: Date.now(),
      };
      await writeJsonDurable(intentPath(params.rootDir, keyHash), retryable);
      await failDelivery(params.entry.id, message, params.queueStateDir);
      return "failed";
    }
    const messageIds = confirmedDeliveryMessageIds(receipts);
    if (!messageIds) {
      const unknown: MemberArtifactDeliveryIntent = {
        ...started,
        phase: "unknown",
        bridgeSendStarted: true,
        externalEffect: "unknown",
        retryable: false,
        updatedAtMs: Date.now(),
      };
      await writeJsonDurable(intentPath(params.rootDir, keyHash), unknown);
      await moveToFailed(params.entry.id, params.queueStateDir);
      return "failed";
    }
    try {
      await params.beforeReceipt?.();
      const delivered: MemberArtifactDeliveryIntent = {
        ...started,
        phase: "delivered",
        authorization: "allow",
        externalEffect: "acknowledged",
        retryable: false,
        receiptMessageIds: messageIds,
        updatedAtMs: Date.now(),
      };
      await writeJsonDurable(intentPath(params.rootDir, keyHash), delivered);
    } catch {
      const unknown: MemberArtifactDeliveryIntent = {
        ...started,
        phase: "unknown",
        externalEffect: "unknown",
        retryable: false,
        updatedAtMs: Date.now(),
      };
      try {
        await writeJsonDurable(intentPath(params.rootDir, keyHash), unknown);
      } catch {
        // Receipt and unknown both failed. Still do not ack.
      }
      await moveToFailed(params.entry.id, params.queueStateDir);
      return "failed";
    }
    await ackDelivery(params.entry.id, params.queueStateDir);
    return "recovered";
  });
}
