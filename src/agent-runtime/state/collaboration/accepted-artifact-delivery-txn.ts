import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  evaluateAcceptedArtifactOutboundAuthorization,
  evaluateGroupFinalDeliveryEligibility,
  evaluateMemberArtifactDeliveryEligibility,
  memberArtifactDeliveryKeyMaterial,
  normalizeDeliveryTarget,
  type MemberArtifactDeliveryIdentity,
  type NormalizedDeliveryTarget,
  type OutboundArtifactGrant,
} from "../../policy/accepted-artifact-delivery.js";
import { withDirectoryLock, writeJsonDurable } from "../repository/durable-json.js";

/**
 * M1 association only. Records live under the caller root, never in
 * `delivery-queue/*.json`, so `loadPendingDeliveries` cannot send them.
 * `bridgeSendStarted` is not a permanent unknown: a later slice may mark
 * `failed_retryable` only when `externalEffect` is `none`.
 */

function isDeliveryScope(value: unknown): value is "member_artifact" | "group_final" {
  return value === "member_artifact" || value === "group_final";
}
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
  scope: "member_artifact" | "group_final";
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
  if (!isDeliveryScope(parsed.scope)) {
    return false;
  }
  if (parsed.queueId !== null && !nonEmpty(parsed.queueId)) {
    return false;
  }
  const unsigned = parsed.phase === "authorization_pending" || parsed.phase === "staged";
  if (unsigned) {
    return (
      parsed.authorization === "authorization_pending" &&
      parsed.queueId === null &&
      !parsed.bridgeSendStarted &&
      parsed.externalEffect === "none" &&
      !parsed.retryable &&
      parsed.receiptMessageIds === null
    );
  }
  if (parsed.phase === "associated") {
    return (
      parsed.authorization === "authorization_pending" &&
      !parsed.bridgeSendStarted &&
      parsed.externalEffect === "none" &&
      !parsed.retryable &&
      parsed.receiptMessageIds === null &&
      (parsed.queueId === null || nonEmpty(parsed.queueId))
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
      scope: parsed.scope,
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
    scope: params.identity.scope,
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

function deliveryEligibilityFor(identity: MemberArtifactDeliveryIdentity) {
  return identity.scope === "group_final"
    ? evaluateGroupFinalDeliveryEligibility(identity)
    : evaluateMemberArtifactDeliveryEligibility(identity);
}

export async function commitMemberArtifactDeliveryAssociation(params: {
  rootDir: string;
  identity: MemberArtifactDeliveryIdentity;
  nowMs?: number;
}): Promise<AssociationCommitResult> {
  const eligibility = deliveryEligibilityFor(params.identity);
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
    const again = deliveryEligibilityFor(params.identity);
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

function grantPath(authDir: string, keyHash: string): string {
  return path.join(authDir, `${keyHash}.grant.json`);
}

export async function writeServerOutboundArtifactGrant(params: {
  authDir: string;
  identity: MemberArtifactDeliveryIdentity;
  revokedAtMs?: number | null;
}): Promise<{ ok: true; keyHash: string } | { ok: false; reason: string }> {
  const keyHash = deliveryKeyHash(params.identity);
  const target = normalizeDeliveryTarget(params.identity.target);
  if (!keyHash || !target || !isDeliveryScope(params.identity.scope)) {
    return { ok: false, reason: "grant_identity_incomplete" };
  }
  const grant: OutboundArtifactGrant = {
    tenantId: compact(params.identity.tenantId),
    groupId: compact(params.identity.groupId),
    actorId: compact(params.identity.actorId),
    channel: target.channel,
    accountId: target.accountId,
    to: target.to,
    scope: params.identity.scope,
    acceptedArtifactVersion: compact(params.identity.acceptedArtifactVersion),
    linkedContentSha256: compact(params.identity.linkedContentSha256).toLowerCase(),
    revokedAtMs: params.revokedAtMs ?? null,
  };
  await writeJsonDurable(grantPath(params.authDir, keyHash), grant);
  return { ok: true, keyHash };
}

export async function readMemberArtifactDeliveryIntent(
  rootDir: string,
  keyHash: string,
): Promise<MemberArtifactDeliveryIntent | null> {
  const read = await readIntent(rootDir, keyHash);
  return read.status === "ok" ? read.intent : null;
}

/**
 * Durable grant write with revoke CAS: a revoked grant must not be overwritten by a
 * fresh non-revoked grant. Revoke and request share this lock so concurrent revoke wins.
 */
export async function writeIssuedOutboundArtifactGrant(params: {
  authDir: string;
  keyHash: string;
  grant: OutboundArtifactGrant;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  return withDirectoryLock(params.authDir, params.keyHash, async () => {
    const existing = await readServerOutboundArtifactGrant(params.authDir, params.keyHash);
    if (existing?.revokedAtMs != null && params.grant.revokedAtMs == null) {
      return { ok: false, reason: "outbound_authorization_revoked" };
    }
    await writeJsonDurable(grantPath(params.authDir, params.keyHash), params.grant);
    return { ok: true };
  });
}

export async function readServerOutboundArtifactGrant(
  authDir: string,
  keyHash: string,
): Promise<OutboundArtifactGrant | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(grantPath(authDir, keyHash), "utf8"),
    ) as OutboundArtifactGrant;
    if (!parsed || !isDeliveryScope(parsed.scope) || typeof parsed.channel !== "string") {
      return null;
    }
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    return null;
  }
}

async function mutateIntent(
  rootDir: string,
  identity: MemberArtifactDeliveryIdentity,
  mutate: (
    intent: MemberArtifactDeliveryIntent,
  ) =>
    | MemberArtifactDeliveryIntent
    | AssociationCommitResult
    | Promise<MemberArtifactDeliveryIntent | AssociationCommitResult>,
): Promise<AssociationCommitResult> {
  const keyHash = deliveryKeyHash(identity);
  if (!keyHash) {
    return { ok: false, reason: "target_required" };
  }
  return withDirectoryLock(rootDir, keyHash, async () => {
    const read = await readIntent(rootDir, keyHash);
    if (read.status === "unreadable") {
      return { ok: false, reason: read.reason };
    }
    if (read.status === "missing") {
      return { ok: false, reason: "intent_missing" };
    }
    const next = await mutate(read.intent);
    if ("ok" in next) {
      return next;
    }
    await writeJsonDurable(intentPath(rootDir, keyHash), next);
    return { ok: true, intent: next, created: false };
  });
}

/**
 * Marks effect unknown before any channel call.
 * `send` is decided inside the lock and returned unchanged.
 * The current grant is read here; a missing grant waits, a revoked grant blocks.
 */
export async function claimMemberArtifactSendUnknown(params: {
  rootDir: string;
  authDir: string;
  identity: MemberArtifactDeliveryIdentity;
  nowMs?: number;
  /** Runs inside the key lock after the intent is re-read. */
  recheck?: (intent: MemberArtifactDeliveryIntent) => Promise<"proceed" | "stop" | "block">;
}): Promise<AssociationCommitResult & { send: boolean; blocked?: boolean }> {
  const keyHash = deliveryKeyHash(params.identity);
  if (!keyHash) {
    return { ok: false, reason: "target_required", send: false };
  }
  if (!compact(params.authDir)) {
    return { ok: false, reason: "auth_dir_required", send: false };
  }
  const nowMs = params.nowMs ?? Date.now();
  return withDirectoryLock(params.rootDir, keyHash, async () => {
    const read = await readIntent(params.rootDir, keyHash);
    if (read.status === "unreadable") {
      return { ok: false, reason: read.reason, send: false };
    }
    if (read.status === "missing") {
      return { ok: false, reason: "intent_missing", send: false };
    }
    const existing = read.intent;
    const gate = params.recheck ? await params.recheck(existing) : "proceed";
    if (gate === "stop") {
      return { ok: true, intent: existing, created: false, send: false };
    }
    if (gate === "block" && existing.phase !== "delivered" && existing.phase !== "unknown") {
      const blocked: MemberArtifactDeliveryIntent = {
        ...existing,
        phase: "blocked",
        bridgeSendStarted: false,
        externalEffect: "none",
        retryable: false,
        updatedAtMs: nowMs,
      };
      await writeJsonDurable(intentPath(params.rootDir, keyHash), blocked);
      return { ok: true, intent: blocked, created: false, send: false, blocked: true };
    }
    if (
      existing.phase === "unknown" ||
      existing.phase === "delivered" ||
      existing.phase === "blocked"
    ) {
      return { ok: true, intent: existing, created: false, send: false };
    }
    const grant = await readServerOutboundArtifactGrant(params.authDir, keyHash);
    const auth = evaluateAcceptedArtifactOutboundAuthorization({
      tenantId: existing.tenantId,
      groupId: existing.groupId,
      actorId: existing.actorId,
      normalizedTarget: existing.normalizedTarget,
      acceptedArtifactVersion: existing.acceptedArtifactVersion,
      linkedContentSha256: existing.linkedContentSha256,
      grant,
    });
    if (auth.outcome === "authorization_pending") {
      return { ok: true, intent: existing, created: false, send: false };
    }
    if (auth.outcome === "deny") {
      const blocked: MemberArtifactDeliveryIntent = {
        ...existing,
        phase: "blocked",
        bridgeSendStarted: false,
        externalEffect: "none",
        retryable: false,
        updatedAtMs: nowMs,
      };
      await writeJsonDurable(intentPath(params.rootDir, keyHash), blocked);
      return { ok: true, intent: blocked, created: false, send: false, blocked: true };
    }
    const retryable =
      existing.phase === "failed_retryable" &&
      existing.externalEffect === "none" &&
      existing.retryable &&
      !existing.bridgeSendStarted;
    const fresh =
      existing.phase === "queued" &&
      !existing.bridgeSendStarted &&
      existing.externalEffect === "none";
    if (!retryable && !fresh) {
      return { ok: true, intent: existing, created: false, send: false };
    }
    const claimed: MemberArtifactDeliveryIntent = {
      ...existing,
      phase: "unknown",
      bridgeSendStarted: true,
      externalEffect: "unknown",
      retryable: false,
      updatedAtMs: nowMs,
    };
    await writeJsonDurable(intentPath(params.rootDir, keyHash), claimed);
    return { ok: true, intent: claimed, created: false, send: true };
  });
}

export async function recordMemberArtifactReceipt(params: {
  rootDir: string;
  identity: MemberArtifactDeliveryIdentity;
  receiptMessageIds: string[];
  nowMs?: number;
}): Promise<AssociationCommitResult> {
  const ids = params.receiptMessageIds.map((id) => id.trim()).filter((id) => id.length > 0);
  if (ids.length === 0 || ids.some((id) => id.toLowerCase() === "unknown")) {
    return { ok: false, reason: "receipt_required" };
  }
  const nowMs = params.nowMs ?? Date.now();
  return mutateIntent(params.rootDir, params.identity, (existing) => {
    if (existing.phase === "delivered") {
      return { ok: true, intent: existing, created: false };
    }
    if (existing.phase !== "unknown" || existing.externalEffect !== "unknown") {
      return { ok: false, reason: "receipt_not_after_unknown" };
    }
    return {
      ...existing,
      phase: "delivered",
      authorization: "allow",
      externalEffect: "acknowledged",
      retryable: false,
      receiptMessageIds: ids,
      updatedAtMs: nowMs,
    };
  });
}

export async function recordMemberArtifactBlocked(params: {
  rootDir: string;
  identity: MemberArtifactDeliveryIdentity;
  nowMs?: number;
}): Promise<AssociationCommitResult> {
  const nowMs = params.nowMs ?? Date.now();
  return mutateIntent(params.rootDir, params.identity, (existing) => {
    if (
      existing.phase === "blocked" ||
      existing.phase === "delivered" ||
      existing.phase === "unknown"
    ) {
      return { ok: true, intent: existing, created: false };
    }
    return {
      ...existing,
      phase: "blocked",
      bridgeSendStarted: false,
      externalEffect: "none",
      retryable: false,
      updatedAtMs: nowMs,
    };
  });
}

/** Only before a channel call, and only while effect is still none and send has not started. */
export async function recordMemberArtifactNotSent(params: {
  rootDir: string;
  identity: MemberArtifactDeliveryIdentity;
  nowMs?: number;
}): Promise<AssociationCommitResult> {
  const nowMs = params.nowMs ?? Date.now();
  return mutateIntent(params.rootDir, params.identity, (existing) => {
    if (existing.bridgeSendStarted || existing.externalEffect !== "none") {
      return { ok: false, reason: "effect_not_proven_absent" };
    }
    if (existing.phase !== "queued") {
      return { ok: false, reason: "not_queued" };
    }
    return {
      ...existing,
      phase: "failed_retryable",
      bridgeSendStarted: false,
      externalEffect: "none",
      retryable: true,
      updatedAtMs: nowMs,
    };
  });
}

export async function assignMemberArtifactQueueId(params: {
  rootDir: string;
  identity: MemberArtifactDeliveryIdentity;
  queueId: string;
  nowMs?: number;
}): Promise<AssociationCommitResult> {
  const queueId = compact(params.queueId);
  if (!queueId) {
    return { ok: false, reason: "queue_id_required" };
  }
  const nowMs = params.nowMs ?? Date.now();
  return mutateIntent(params.rootDir, params.identity, (existing) => {
    if (existing.phase === "queued" && existing.queueId === queueId) {
      return { ok: true, intent: existing, created: false };
    }
    if (existing.phase !== "associated" || existing.queueId !== null) {
      return { ok: false, reason: "not_associated" };
    }
    return { ...existing, queueId, updatedAtMs: nowMs };
  });
}

export async function markMemberArtifactQueued(params: {
  rootDir: string;
  identity: MemberArtifactDeliveryIdentity;
  queueId: string;
  nowMs?: number;
}): Promise<AssociationCommitResult> {
  const queueId = compact(params.queueId);
  const nowMs = params.nowMs ?? Date.now();
  return mutateIntent(params.rootDir, params.identity, (existing) => {
    if (existing.phase === "queued" && existing.queueId === queueId) {
      return { ok: true, intent: existing, created: false };
    }
    if (existing.phase !== "associated" || existing.queueId !== queueId) {
      return { ok: false, reason: "queue_not_assigned" };
    }
    const grantReady = existing.authorization === "authorization_pending";
    return {
      ...existing,
      phase: "queued",
      authorization: grantReady ? "allow" : existing.authorization,
      queueId,
      bridgeSendStarted: false,
      externalEffect: "none",
      retryable: false,
      receiptMessageIds: null,
      updatedAtMs: nowMs,
    };
  });
}

export function payloadTextDigest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Assigns a queue id only after the server grant matches. Does not write a queue file or send. */
export async function prepareMemberArtifactQueuePublication(params: {
  rootDir: string;
  authDir: string;
  identity: MemberArtifactDeliveryIdentity;
  payloadText: string;
  nowMs?: number;
}): Promise<
  | {
      ok: true;
      queueId: string;
      keyHash: string;
      channel: string;
      to: string;
      accountId: string | null;
      contentSha256: string;
    }
  | { ok: false; reason: string }
> {
  const keyHash = deliveryKeyHash(params.identity);
  const target = normalizeDeliveryTarget(params.identity.target);
  if (!keyHash || !target) {
    return { ok: false, reason: "target_required" };
  }
  const nowMs = params.nowMs ?? Date.now();
  const digest = payloadTextDigest(params.payloadText);
  return withDirectoryLock(params.rootDir, keyHash, async () => {
    const read = await readIntent(params.rootDir, keyHash);
    if (read.status === "unreadable") {
      return { ok: false, reason: read.reason };
    }
    if (read.status === "missing") {
      return { ok: false, reason: "intent_missing" };
    }
    const existing = read.intent;
    if (existing.phase === "queued" && existing.queueId) {
      return {
        ok: true,
        queueId: existing.queueId,
        keyHash,
        channel: existing.normalizedTarget.channel,
        to: existing.normalizedTarget.to,
        accountId: existing.normalizedTarget.accountId,
        contentSha256: existing.linkedContentSha256,
      };
    }
    if (existing.phase !== "associated") {
      return { ok: false, reason: "not_associated" };
    }
    if (digest !== existing.linkedContentSha256) {
      return { ok: false, reason: "content_hash_mismatch" };
    }
    const grant = await readServerOutboundArtifactGrant(params.authDir, keyHash);
    const auth = evaluateAcceptedArtifactOutboundAuthorization({
      tenantId: existing.tenantId,
      groupId: existing.groupId,
      actorId: existing.actorId,
      normalizedTarget: existing.normalizedTarget,
      acceptedArtifactVersion: existing.acceptedArtifactVersion,
      linkedContentSha256: existing.linkedContentSha256,
      grant,
    });
    if (auth.outcome !== "allow") {
      if (auth.outcome === "deny") {
        const blocked: MemberArtifactDeliveryIntent = {
          ...existing,
          phase: "blocked",
          updatedAtMs: nowMs,
        };
        await writeJsonDurable(intentPath(params.rootDir, keyHash), blocked);
      }
      return { ok: false, reason: auth.reason };
    }
    const queueId = existing.queueId ?? randomUUID();
    if (!existing.queueId) {
      await writeJsonDurable(intentPath(params.rootDir, keyHash), {
        ...existing,
        queueId,
        updatedAtMs: nowMs,
      });
    }
    return {
      ok: true,
      queueId,
      keyHash,
      channel: existing.normalizedTarget.channel,
      to: existing.normalizedTarget.to,
      accountId: existing.normalizedTarget.accountId,
      contentSha256: existing.linkedContentSha256,
    };
  });
}
